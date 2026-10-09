"""Process-level dispatcher checks with a disposable Git repository and fake transports."""

import json
from datetime import datetime, timedelta
import importlib.util
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name('local-dispatcher.py')
spec = importlib.util.spec_from_file_location('fitsy_dispatcher_under_test', SCRIPT)
dispatcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatcher)
FAKE_GH = r'''#!/usr/bin/env python3
import fcntl,json,os,sys
from pathlib import Path
p=Path(os.environ['FAKE_GH_STATE']); lock=p.with_suffix('.lock')
with lock.open('a') as f:
 fcntl.flock(f,fcntl.LOCK_EX)
 d=json.loads(p.read_text()); a=sys.argv[1:]; result=''
 if a[:2]==['api','graphql']:
  d['board_reads']=d.get('board_reads',0)+1
  if os.environ.get('FAKE_QUEUE_GENERIC_429'):
   p.write_text(json.dumps(d))
   print('HTTP/2 429\n\n'+json.dumps({'message':'Too many requests'}))
   raise SystemExit(1)
  if os.environ.get('FAKE_QUEUE_QUOTA_RESET'):
   p.write_text(json.dumps(d))
   print('HTTP/2 403\nX-Ratelimit-Remaining: 0\nX-Ratelimit-Reset: '+os.environ['FAKE_QUEUE_QUOTA_RESET']+'\n\n'+json.dumps({'errors':[{'message':'API rate limit exceeded'}]}))
   raise SystemExit(1)
  fields=['status','priority','progress','blocker','dependencies','next action','verified at','started at','last progress at']
  nodes=[]
  for x in d['items']:
   c=x['content']; node={'id':x['id'],'content':{**c,'__typename':c['type'],
    'repository':{'nameWithOwner':c['repository']},'labels':{'totalCount':len(x['labels']),'nodes':[{'name':n} for n in x['labels']]}}}
   node.update({f'f{i}':({'name':x.get(k)} if k in ('status','priority') else {'text':x.get(k)}) for i,k in enumerate(fields)})
   nodes.append(node)
  result=json.dumps({'data':{'node':{'items':{'totalCount':len(nodes),'nodes':nodes,'pageInfo':{'hasNextPage':False,'endCursor':None}}},'rateLimit':{'cost':2,'remaining':int(os.environ.get('FAKE_QUEUE_REMAINING','4998')),'resetAt':'2099-01-01T00:00:00Z'}}})
 elif a[:2]==['project','item-list']:
  result=json.dumps({'totalCount':len(d['items']),'items':d['items']})
 elif a[:2]==['project','item-edit']:
  item=next(x for x in d['items'] if x['id']==a[a.index('--id')+1]); field=a[a.index('--field-id')+1]
  if field=='PVTSSF_lAHOARmQNM4BkyAYzhjhV10': item['status']={'47fc9ee4':'In flight','f75ad846':'Queued'}[a[a.index('--single-select-option-id')+1]]
  elif field=='PVTF_lAHOARmQNM4BkyAYzhjhdPc': item['started at']=a[a.index('--text')+1]
  elif field=='PVTF_lAHOARmQNM4BkyAYzhjhdPg': item['progress']=a[a.index('--text')+1]
  elif field=='PVTF_lAHOARmQNM4BkyAYzhjhWMY': item['blocker']=a[a.index('--text')+1]
 elif a[:2]==['issue','view']:
  n=int(a[2]); item=next(x for x in d['items'] if x['content']['number']==n)
  if '-R' not in a: raise SystemExit('issue operation lacks repository identity')
  result=json.dumps({'state':item.get('issue_state','OPEN'),'title':item['content']['title'],
                     'body':item['content']['body'],'url':item['content']['url'],
                     'closedByPullRequestsReferences':[{'number':389}] if item.get('linked_pr') else []})
 elif a[:2]==['issue','comment']:
  if '-R' not in a: raise SystemExit('comment lacks repository identity')
  d.setdefault('comments',[]).append(a[a.index('--body')+1])
 elif a[:2]==['issue','edit']:
  if '-R' not in a: raise SystemExit('edit lacks repository identity')
  item=next(x for x in d['items'] if x['content']['number']==int(a[2]))
  item['labels'].append(a[a.index('--add-label')+1])
 elif a[:1]==['api'] and '/events?' in a[1]:
  n=int(a[1].split('/issues/')[1].split('/')[0]); result=d['ready_at'].get(str(n),'')
 elif a[:1]==['api'] and '/comments?' in a[1]:
  n=int(a[1].split('/issues/')[1].split('/')[0]); item=next(x for x in d['items'] if x['content']['number']==n)
  bodies=([{'id':2,'body':'<!-- fitsy-dispatch-claim:v1:known -->'}] if item.get('claim_comment') else [])
  if item.get('terminal'): bodies.append({'id':1,'body':item['terminal']})
  result='\n'.join(json.dumps(body) for body in bodies)
 elif a[:2]==['pr','view']:
  item=next(x for x in d['items'] if x.get('terminal') or x.get('linked_pr') or x.get('search_pr'))
  result=json.dumps({'state':'MERGED','headRefOid':'a'*40,'headRefName':item.get('branch',''),
                     'body':'Delivery-Issue: #'+str(999 if os.environ.get('FAKE_WRONG_PR_ISSUE') else item['content']['number']),
                     'mergeCommit':{'oid':'b'*40}})
 elif a[:2]==['pr','list']:
  result=json.dumps([{'number':389}] if any(x.get('search_pr') or x.get('linked_pr') for x in d['items']) else [])
 elif a[:2]==['run','list'] or a[:2]==['run','view']:
  runs=[{'workflowName':name,'headSha':'b'*40,'headBranch':'main','status':'completed',
         'conclusion':'failure' if name=='Verify' and os.environ.get('FAKE_BAD_CI') else 'success',
         'databaseId':run} for name,run in [('Verify',11),('Deploy',12)]]
  result=json.dumps(runs if a[1]=='list' else next(x for x in runs if x['databaseId']==int(a[2])))
 else: raise SystemExit('unexpected gh call: '+repr(a))
 p.write_text(json.dumps(d)); print(result)
'''
FAKE_CODEX = r'''#!/usr/bin/env python3
import fcntl,json,os,subprocess,sys,time
from pathlib import Path
p=Path(os.environ['FAKE_GH_STATE']); log=p.with_suffix('.workers')
sys.stdin.read()
with log.open('a') as f: f.write('started\n')
with p.with_suffix('.args').open('a') as f: f.write(json.dumps(sys.argv[1:])+'\n')
p.with_suffix('.worker-budget').write_text(os.environ.get('FITSY_DISPATCH_WORKER_TIMEOUT_SECONDS','missing'))
mode=os.environ.get('FAKE_WORKER_MODE','done')
if mode=='sleep': time.sleep(float(os.environ.get('FAKE_WORKER_SLEEP','2')))
if mode=='spawn_child':
 child=subprocess.Popen(['sleep','30'])
 p.with_suffix('.childpid').write_text(str(child.pid))
 time.sleep(30)
if mode=='fail': raise SystemExit(7)
with p.with_suffix('.lock').open('a') as f:
 fcntl.flock(f,fcntl.LOCK_EX); d=json.loads(p.read_text())
 item=next(x for x in d['items'] if x['status']=='In flight')
 item['status']='Done'; item['issue_state']='CLOSED'; item['verified at']='2026-09-27T00:10:00Z'
 item['branch']=os.environ['FITSY_DISPATCH_BRANCH']
 item['terminal']='<!-- fitsy-dispatch-terminal:v1 -->'+json.dumps({'issue':item['content']['number'],
  'claim_id':os.environ['FITSY_DISPATCH_CLAIM_ID'],'branch':item['branch'],'pr':389,
  'head_sha':'a'*40,'merge_sha':'b'*40,'verify_run':11,'deploy_run':12,'acceptance':'verified'})
 p.write_text(json.dumps(d))
'''


def run(*args, cwd=None, env=None):
    return subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True, timeout=20, check=True)


def item(number, *, status='Queued', labels=None, dependencies=None, priority='Next'):
    return {'id': f'item-{number}', 'content': {'number': number, 'type': 'Issue', 'repository': 'dgmolla/fitsy',
            'title': f'Fix issue {number}', 'body': 'Full acceptance remains here.\n' + 'Later clause. ' * 350,
            'url': f'https://github.com/dgmolla/fitsy/issues/{number}'},
            'status': status, 'priority': priority, 'labels': labels or ['dispatch-ready'],
            'dependencies': dependencies, 'blocker': None}


class DispatcherProcessTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.repo = self.base / 'repo'
        self.repo.mkdir()
        run('git', 'init', '-b', 'main', cwd=self.repo)
        run('git', 'config', 'user.email', 'fixture@example.test', cwd=self.repo)
        run('git', 'config', 'user.name', 'Fixture', cwd=self.repo)
        (self.repo / 'README.md').write_text('fixture\n')
        run('git', 'add', 'README.md', cwd=self.repo)
        run('git', 'commit', '-m', 'fixture', cwd=self.repo)
        remote = self.base / 'remote.git'
        run('git', 'init', '--bare', str(remote))
        run('git', 'remote', 'add', 'origin', str(remote), cwd=self.repo)
        run('git', 'push', '-u', 'origin', 'main', cwd=self.repo)
        self.gh = self.base / 'fake-gh'
        self.gh.write_text(FAKE_GH); self.gh.chmod(0o700)
        self.codex = self.base / 'fake-codex'
        self.codex.write_text(FAKE_CODEX); self.codex.chmod(0o700)
        self.claude = self.base / 'fake-claude'
        self.claude.write_text(FAKE_CODEX); self.claude.chmod(0o700)
        self.board = self.base / 'board.json'
        self.set_board([item(385)])
        self.worktrees = self.base / 'worktrees'; self.worktrees.mkdir()
        self.state = self.base / 'state'; self.state.mkdir(mode=0o700)
        self.config = self.base / 'config.json'
        self.config.write_text(json.dumps({'enabled': True, 'state_dir': str(self.state),
            'worktree_root': str(self.worktrees), 'repo_root': str(self.repo), 'gh_bin': str(self.gh),
            'git_bin': shutil.which('git'), 'jev_key_file': None,
            'profiles': {'standard': {'provider': 'codex', 'model': 'gpt-6-sol', 'effort': 'medium', 'executable': str(self.codex)},
                         'deep': {'provider': 'codex', 'model': 'gpt-6-sol', 'effort': 'high', 'executable': str(self.codex)}},
            'review': {'provider': 'codex', 'model': 'gpt-6-sol', 'effort': 'high'},
            'simulator_use_file': str(self.state / 'device-owner-uses.json'),
            'min_free_bytes': 1, 'scratch_reserve_bytes': 0, 'lsof_bin': str(self.base / 'fake-lsof'), 'worker_timeout_seconds': 10}))
        (self.base / 'fake-lsof').write_text('#!/bin/sh\nexit 1\n')
        (self.base / 'fake-lsof').chmod(0o700)
        self.config.chmod(0o600)
        (self.state / 'device-owner-uses.json').write_text(json.dumps({'version': 1, 'devices': {
            udid: {'owner': 'ended-fixture', 'last_owner_use': '2026-09-01T00:00:00Z',
                   'released_at': '2026-09-01T01:00:00Z'}
            for udid in ('9EC11FCA-B224-4380-A91D-235ED2BBF7C4', 'CE4397A7-AB61-4099-B843-51D38DA417D9')}}))
        self.env = {**os.environ, 'FAKE_GH_STATE': str(self.board)}

    def set_board(self, items):
        self.board.write_text(json.dumps({'items': items,
            'ready_at': {str(x['content']['number']): '2026-09-27T00:00:00Z' for x in items}}))

    def board_data(self):
        return json.loads(self.board.read_text())

    def state_data(self):
        return json.loads((self.state / 'state.json').read_text())

    def tick(self):
        return json.loads(run(sys.executable, str(SCRIPT), 'tick', '--config', str(self.config),
                              cwd=self.base, env=self.env).stdout)

    def until(self, predicate, seconds=8):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if predicate(): return
            time.sleep(0.05)
        self.fail('condition did not become true')

    def workers(self):
        log = self.board.with_suffix('.workers')
        return log.read_text().splitlines() if log.exists() else []

    def test_exhausted_live_queue_defers_without_claim_or_repeated_read(self):
        self.env['FAKE_QUEUE_QUOTA_RESET'] = '4070908800'
        first = self.tick()
        second = self.tick()
        self.assertEqual(first['state'], 'queue-read-backoff')
        self.assertEqual(second['state'], 'queue-read-backoff')
        fake = self.board_data()
        self.assertEqual(fake['board_reads'], 1)
        self.assertIsNone(json.loads((self.state / 'state.json').read_text()).get('active'))
        self.assertEqual(fake['items'][0]['status'], 'Queued')

    def test_complete_read_exhaustion_never_claims_or_changes_remote_card(self):
        self.env['FAKE_QUEUE_REMAINING'] = '0'
        for _ in range(2):
            self.assertEqual(self.tick()['state'], 'queue-read-backoff')
        fake = self.board_data()
        self.assertEqual(fake['board_reads'], 1)
        self.assertIsNone(self.state_data().get('active'))
        self.assertEqual(fake['items'][0]['status'], 'Queued')
        self.assertNotIn('dispatch-hold', fake['items'][0]['labels'])
        self.assertFalse(fake.get('comments'))

    def test_generic_http_429_suppresses_second_tick_read_without_claim(self):
        self.env['FAKE_QUEUE_GENERIC_429'] = '1'
        for _ in range(2):
            self.assertEqual(self.tick()['state'], 'queue-read-backoff')
        self.assertEqual(self.board_data()['board_reads'], 1)
        self.assertIsNone(self.state_data().get('active'))
        self.assertEqual(self.board_data()['items'][0]['status'], 'Queued')

    def test_installer_pause_after_initial_config_read_prevents_tick_admission(self):
        hooks = self.base / 'pause-hooks'; hooks.mkdir()
        (hooks / 'sitecustomize.py').write_text(
            'import json,os\nfrom pathlib import Path\noriginal=Path.read_text\n'
            'def raced(path,*a,**kw):\n value=original(path,*a,**kw)\n'
            ' if str(path.resolve())==os.environ.get("RACE_CONFIG") and json.loads(value).get("enabled"):\n'
            '  paused=json.loads(value);paused["enabled"]=False;path.write_text(json.dumps(paused))\n'
            ' return value\nPath.read_text=raced\n')
        result = run(sys.executable, str(SCRIPT), 'tick', '--config', str(self.config),
                     cwd=self.base, env={**self.env, 'PYTHONPATH': str(hooks),
                                         'RACE_CONFIG': str(self.config.resolve())})
        self.assertFalse(json.loads(self.config.read_text())['enabled'])
        self.assertEqual(json.loads(result.stdout)['state'], 'disabled')
        self.assertEqual(self.workers(), [])
        self.assertEqual(self.board_data()['items'][0]['status'], 'Queued')

    def test_worker_prompt_bounds_review_and_preserves_newer_human_scope(self):
        self.env['FAKE_WORKER_MODE'] = 'fail'
        self.tick()
        claim = self.state_data()['active']
        prompt = dispatcher.make_prompt(claim)
        self.assertIn('review-policy-human-relaxed-20261004.json', prompt)
        self.assertIn('two combined rounds, at most 900 seconds each and 1800 cumulative seconds per issue', prompt)
        self.assertIn('newer narrower human instructions take precedence over older grants', prompt)
        self.assertIn('Do not expand automatically', prompt)
        self.assertNotIn('top up only', prompt)
        self.assertIn('one consolidated repair and affected rereview', prompt)
        self.assertIn('Acknowledge human scope steering at the next safe command boundary', prompt)
        self.assertIn('use source-bound owned P2 deferrals and P3 advisories', prompt)
        self.assertIn('proceed directly to required acceptance and authorized shipping', prompt)
        self.assertIn('Retain every historical attempt and required review domain', prompt)
        self.assertNotIn('plus at most one durable', prompt)
        self.assertLess(prompt.index('--stage=cheap'), prompt.index('then use scripts/verify/shipping-session.mjs'))

    def test_worker_exports_configured_native_completion_budget(self):
        config = json.loads(self.config.read_text()); config['worker_timeout_seconds'] = 5400
        self.config.write_text(json.dumps(config))
        self.env['FITSY_DISPATCH_WORKER_TIMEOUT_SECONDS'] = '60'
        self.env['FAKE_WORKER_MODE'] = 'fail'
        self.tick()
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        self.assertEqual(self.board.with_suffix('.worker-budget').read_text(), '5400')

    def test_release_cleans_scratch_and_preserves_app_and_raw_history(self):
        self.env['FAKE_WORKER_MODE'] = 'fail'
        self.tick()
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        old = self.state_data()['active'].copy()
        self.until(lambda: dispatcher.pid_identity(old['launcher_pid']) is None)
        checkout = Path(old['worktree'])
        scratch = checkout / '.evidence/product-build/Build/Intermediates.noindex'
        app = checkout / '.evidence/product-build/Build/Products/Fitsy.app'
        scratch.mkdir(parents=True); app.mkdir(parents=True)
        (scratch / 'object.o').write_bytes(b'rebuildable')
        nested = scratch / 'ModuleCache.noindex'; nested.mkdir()
        (nested / 'module').write_text('nested rebuildable')
        sibling = checkout / '.evidence/product-build/SDKStatCaches.noindex'; sibling.mkdir()
        (sibling / 'sdk').write_text('sibling rebuildable')
        (app / 'binary').write_bytes(b'retained app')
        protected_cache = app / 'ModuleCache.noindex'
        protected_cache.mkdir(); (protected_cache / 'keep').write_text('app content')
        external = self.base / 'external-cache'
        external.mkdir(); (external / 'keep').write_text('external content')
        (checkout / '.evidence/external').symlink_to(external, target_is_directory=True)
        raw = checkout / '.evidence/review-failure.log'
        raw.write_text('historical failure')
        raw_named_cache = checkout / '.evidence/review/ModuleCache.noindex'
        raw_named_cache.mkdir(parents=True)
        (raw_named_cache / 'failure.log').write_text('retained raw review')
        self.tick()
        state = self.state_data()
        self.assertFalse(scratch.exists())
        self.assertFalse(sibling.exists())
        self.assertEqual((app / 'binary').read_bytes(), b'retained app')
        self.assertEqual(raw.read_text(), 'historical failure')
        self.assertEqual((raw_named_cache / 'failure.log').read_text(), 'retained raw review')
        self.assertEqual((protected_cache / 'keep').read_text(), 'app content')
        self.assertEqual((external / 'keep').read_text(), 'external content')
        record = state['resource_releases'][old['id']]
        self.assertEqual(record['state'], 'released')
        self.assertEqual(record['removed'], [str(scratch.resolve()), str(sibling.resolve())])
        self.assertEqual(state['history'][-1]['exit_code'], 7)
        receipt = json.loads((self.state / 'claims' / old['id'] / 'receipt.json').read_text())
        self.assertEqual(receipt['exit_code'], 7)

    def test_release_open_file_guard_keeps_scratch_and_persists_next_assessment(self):
        self.env['FAKE_WORKER_MODE'] = 'fail'
        self.tick()
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        old = self.state_data()['active'].copy()
        self.until(lambda: dispatcher.pid_identity(old['launcher_pid']) is None)
        scratch = Path(old['worktree']) / '.evidence/product-build/ModuleCache.noindex'
        scratch.mkdir(parents=True); (scratch / 'module').write_text('keep')
        (self.base / 'fake-lsof').write_text('#!/bin/sh\necho owned-open-file\nexit 0\n')
        self.tick()
        self.assertTrue(scratch.exists())
        self.assertEqual(self.state_data()['resource_releases'][old['id']]['state'], 'deferred')
        self.assertIn('ownership', self.state_data()['resource_releases'][old['id']]['reason'])

    def test_deferred_release_retries_after_holder_ends_with_failure_history(self):
        state, old, checkout = self.ended_checkout()
        scratch = checkout / '.evidence/product-build/ModuleCache.noindex'
        scratch.mkdir(parents=True); (scratch / 'module').write_text('rebuildable')
        state['resource_releases'].pop(old['id'])
        (self.state / 'state.json').write_text(json.dumps(state))
        (self.base / 'fake-lsof').write_text('#!/bin/sh\necho owned-open-file\nexit 0\n')
        self.tick()
        deferred = self.state_data()
        prior = deferred['resource_releases'][old['id']].copy()
        self.assertEqual(prior['state'], 'deferred')
        (self.base / 'fake-lsof').write_text('#!/bin/sh\nexit 1\n')
        deferred['resource_releases'][old['id']]['retry_after'] = time.time() - 1
        (self.state / 'state.json').write_text(json.dumps(deferred))
        self.tick()
        result = self.state_data()['resource_releases'][old['id']]
        self.assertFalse(scratch.exists(), 'ended open-file failure must be reconsidered')
        self.assertEqual(result['state'], 'released')
        self.assertTrue(any(x['reason'] == prior['reason'] for x in result['attempts']))
        self.assertEqual(result['attempts'][0]['removed'], [])
        self.assertEqual(self.state_data()['history'][-1]['exit_code'], 7)

    def deferred_scratch(self):
        state, old, checkout = self.ended_checkout()
        scratch = checkout / '.evidence/product-build/ModuleCache.noindex'
        scratch.mkdir(parents=True); (scratch / 'module').write_text('rebuildable')
        state['resource_releases'][old['id']] = {
            'issue': old['issue'], 'claim': old['id'], 'state': 'deferred', 'removed': [],
            'reason': 'open files or uncertain file ownership'}
        return state, old, scratch

    def test_deferred_release_honors_backoff_without_repeated_assessment(self):
        state, old, scratch = self.deferred_scratch()
        state['resource_releases'][old['id']]['retry_after'] = time.time() + 3600
        (self.state / 'state.json').write_text(json.dumps(state))
        before = state['resource_releases'][old['id']].copy()
        self.tick()
        self.assertTrue(scratch.exists())
        self.assertEqual(self.state_data()['resource_releases'][old['id']], before)

    def test_legacy_deferred_release_rechecks_live_holder_and_backs_off(self):
        state, old, scratch = self.deferred_scratch()
        (self.state / 'state.json').write_text(json.dumps(state))
        (self.base / 'fake-lsof').write_text('#!/bin/sh\necho still-open\nexit 0\n')
        self.tick()
        first = self.state_data()['resource_releases'][old['id']]
        self.assertTrue(scratch.exists())
        self.assertEqual(first['state'], 'deferred')
        self.assertGreaterEqual(first['retry_after'] - first['attempted_at'], 900)
        state = self.state_data(); state['resource_releases'][old['id']]['retry_after'] = time.time() - 1
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()
        second = self.state_data()['resource_releases'][old['id']]
        self.assertTrue(scratch.exists())
        self.assertEqual(second['attempt_count'], 2)
        self.assertEqual(second['retry_after'] - second['attempted_at'], 1800)
        self.assertEqual(second['attempts'][0]['reason'], 'open files or uncertain file ownership')
        self.assertEqual(second['attempts'][1]['reason'], first['reason'])

    def test_malformed_retry_deadline_does_not_authorize_cleanup(self):
        state, old, scratch = self.deferred_scratch()
        for bad in ['yesterday', True, float('inf'), 10**1000]:
            with self.subTest(deadline=bad):
                state['resource_releases'][old['id']]['retry_after'] = bad
                (self.state / 'state.json').write_text(json.dumps(state))
                self.tick()
                self.assertTrue(scratch.exists())
                self.assertNotIn('attempt_count', self.state_data()['resource_releases'][old['id']])

    def test_new_ended_claim_precedes_due_retry_without_erasing_old_failure(self):
        state, old, scratch = self.deferred_scratch()
        state['resource_releases'][old['id']]['retry_after'] = time.time() - 1
        new = {**old, 'id': '00000000-0000-0000-0000-000000000123',
               'worktree_origin_claim': old['id'],
               'finished_at': (datetime.fromisoformat(old['finished_at'].replace('Z', '+00:00')) +
                               timedelta(seconds=1)).isoformat()}
        directory = self.state / 'claims' / new['id']; directory.mkdir()
        (directory / 'receipt.json').write_text(json.dumps(new))
        state['history'].append(new)
        (self.state / 'state.json').write_text(json.dumps(state))
        prior = state['resource_releases'][old['id']].copy()
        self.tick()
        result = self.state_data()
        self.assertFalse(scratch.exists())
        self.assertEqual(result['resource_releases'][new['id']]['state'], 'released')
        self.assertEqual(result['resource_releases'][old['id']], prior)

    def test_deferred_deletion_intent_honors_backoff(self):
        state, old, scratch = self.deferred_scratch()
        prior = state['resource_releases'][old['id']]
        prior.update({'removal_intent': str(scratch), 'retry_after': time.time() + 900})
        (self.state / 'state.json').write_text(json.dumps(state))
        (self.base / 'fake-lsof').write_text('#!/bin/sh\necho still-open\nexit 0\n')
        self.tick(); self.tick()
        self.assertEqual(self.state_data()['resource_releases'][old['id']], prior)
        self.assertTrue(scratch.exists())

    def test_deferred_release_uses_durable_receipt_after_history_rollover(self):
        state, old, scratch = self.deferred_scratch()
        state['history'] = [{'id': 'later-%s' % n, 'issue': 999, 'terminal': 'verified'} for n in range(100)]
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()
        self.assertFalse(scratch.exists(), 'durable ended receipt must survive compact history rollover')
        self.assertEqual(self.state_data()['resource_releases'][old['id']]['state'], 'released')

    def test_pruned_release_preserves_damaged_durable_receipt_and_scratch(self):
        state, old, scratch = self.deferred_scratch()
        state['history'] = []
        receipt = self.state / 'claims' / old['id'] / 'receipt.json'
        receipt.write_text('[]')
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()
        self.assertTrue(scratch.exists())
        self.assertEqual(receipt.read_text(), '[]')
        self.assertEqual(self.state_data()['resource_releases'][old['id']], state['resource_releases'][old['id']])
        self.assertIn(str(receipt), self.state_data()['cold_retention_legacy'])

    def test_pruned_release_cannot_use_older_owner_when_newer_receipt_is_damaged(self):
        state, old, scratch = self.deferred_scratch()
        state['history'] = []
        newer = self.state / 'claims/newer-unresolved'; newer.mkdir()
        receipt = newer / 'receipt.json'; receipt.write_text('[]')
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()
        self.assertTrue(scratch.exists(), 'unreadable newer ownership cannot authorize an older release')
        self.assertEqual(receipt.read_text(), '[]')
        result = self.state_data()['resource_releases'][old['id']]
        self.assertEqual(result['state'], 'deferred')
        self.assertEqual(result['attempts'][0], state['resource_releases'][old['id']])
        self.assertIn(str(receipt), self.state_data()['cold_retention_legacy'])

    def test_retained_release_cannot_use_older_owner_when_newer_receipt_is_damaged(self):
        state, old, scratch = self.deferred_scratch()
        newer = self.state / 'claims/newer-unresolved'; newer.mkdir()
        receipt = newer / 'receipt.json'; receipt.write_text('[]')
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()
        self.assertTrue(scratch.exists(), 'compact history cannot bypass uncertain durable ownership')
        self.assertEqual(receipt.read_text(), '[]')

    def test_retained_release_preserves_valid_successor_without_terminal_release(self):
        state, old, scratch = self.deferred_scratch()
        successor = {**old, 'id': '00000000-0000-0000-0000-000000000456',
                     'worktree_origin_claim': old['id'], 'terminal': None, 'finished_at': None}
        directory = self.state / 'claims' / successor['id']; directory.mkdir()
        (directory / 'receipt.json').write_text(json.dumps(successor))
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()
        self.assertTrue(scratch.exists(), 'a successor requires its own terminal release proof')

    def test_missing_successor_receipt_never_authorizes_older_release(self):
        state, old, scratch = self.deferred_scratch()
        successor = {**old, 'id': '00000000-0000-0000-0000-000000000789',
                     'worktree_origin_claim': old['id'],
                     'finished_at': (datetime.fromisoformat(old['finished_at'].replace('Z', '+00:00')) +
                                     timedelta(seconds=1)).isoformat()}
        state['history'].append(successor)
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick(); self.tick()
        self.assertTrue(scratch.exists(), 'a missing known successor receipt cannot promote an older owner')

    def test_pruned_missing_successor_receipt_preserves_scratch(self):
        state, old, scratch = self.deferred_scratch()
        (self.state / 'claims/00000000-0000-0000-0000-000000000789').mkdir()
        state['history'] = []
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()
        self.assertTrue(scratch.exists(), 'missing successor receipt survives compact history rollover')

    def test_superseded_retry_settles_after_latest_owner_release(self):
        state, old, scratch = self.deferred_scratch()
        successor = {**old, 'id': '00000000-0000-0000-0000-000000000789',
                     'worktree_origin_claim': old['id'],
                     'finished_at': (datetime.fromisoformat(old['finished_at'].replace('Z', '+00:00')) +
                                     timedelta(seconds=1)).isoformat()}
        directory = self.state / 'claims' / successor['id']; directory.mkdir()
        (directory / 'receipt.json').write_text(json.dumps(successor))
        state['history'].append(successor)
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()  # Latest owner releases its scratch first.
        self.assertFalse(scratch.exists())
        self.tick()
        settled = self.state_data()['resource_releases'][old['id']]
        self.assertEqual(settled['state'], 'superseded', settled)
        self.assertEqual(settled['superseded_by'], successor['id'])
        self.assertEqual(settled['removed'], [])
        self.assertEqual(settled['attempts'][0]['reason'], 'open files or uncertain file ownership')
        self.tick()
        self.assertEqual(self.state_data()['resource_releases'][old['id']], settled)

    def test_pathless_same_generation_successor_preserves_scratch(self):
        state, old, scratch = self.deferred_scratch()
        successor = {**old, 'id': '00000000-0000-0000-0000-000000000abc',
                     'worktree_origin_claim': old['id'], 'worktree': None,
                     'finished_at': (datetime.fromisoformat(old['finished_at'].replace('Z', '+00:00')) +
                                     timedelta(seconds=1)).isoformat()}
        directory = self.state / 'claims' / successor['id']; directory.mkdir()
        (directory / 'receipt.json').write_text(json.dumps(successor))
        state['history'] = []
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()
        self.assertTrue(scratch.exists(), 'an explicitly linked successor without a path is unresolved ownership')

    def test_unassessed_durable_release_survives_history_rollover(self):
        state, old, scratch = self.deferred_scratch()
        state['resource_releases'].pop(old['id'])
        state['history'] = [{'id': 'later-%s' % n, 'issue': 999, 'terminal': 'verified'} for n in range(100)]
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()
        self.assertFalse(scratch.exists(), 'a valid unassessed durable release remains discoverable')

    def test_pruned_release_rechecks_current_open_holder(self):
        state, old, scratch = self.deferred_scratch()
        state['history'] = []
        (self.state / 'state.json').write_text(json.dumps(state))
        (self.base / 'fake-lsof').write_text('#!/bin/sh\necho still-open\nexit 0\n')
        self.tick()
        self.assertTrue(scratch.exists())
        result = self.state_data()['resource_releases'][old['id']]
        self.assertEqual(result['state'], 'deferred')
        self.assertEqual(result['retry_after'] - result['attempted_at'], 900)

    def test_pruned_interrupted_deletion_intent_reconciles_absence(self):
        state, old, scratch = self.deferred_scratch()
        scratch = scratch.resolve()
        shutil.rmtree(scratch)
        state['history'] = [{'id': 'later-%s' % n, 'issue': 999, 'terminal': 'verified'} for n in range(100)]
        state['resource_releases'][old['id']] = {'issue': old['issue'], 'claim': old['id'],
            'removed': [], 'removal_intent': str(scratch)}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()
        result = self.state_data()['resource_releases'][old['id']]
        self.assertEqual(result['state'], 'released', result)
        self.assertEqual(result['reconciled_absent'], [str(scratch)])
        self.assertEqual(result['removed'], [])
        self.assertNotIn('removal_intent', result)

    @unittest.skipUnless(shutil.which('lsof'), 'real process open-file fixture requires lsof')
    def test_open_source_process_protects_scratch_before_first_release_assessment(self):
        state, old, checkout = self.ended_checkout()
        state['resource_releases'] = {}
        (self.state / 'state.json').write_text(json.dumps(state))
        scratch = checkout / '.evidence/product-build/ModuleCache.noindex'
        scratch.mkdir(parents=True); (scratch / 'module').write_text('keep live build output')
        child = subprocess.Popen([sys.executable, '-c',
            'import sys,time; f=open(sys.argv[1]); print("ready",flush=True); time.sleep(30)',
            str(checkout / 'README.md')], stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(child.stdout.readline().strip(), 'ready')
            config = json.loads(self.config.read_text()); config['lsof_bin'] = shutil.which('lsof')
            self.config.write_text(json.dumps(config))
            self.tick()
            self.assertTrue(scratch.exists())
            result = self.state_data()['resource_releases'][old['id']]
            self.assertEqual(result['state'], 'deferred')
            self.assertIn('ownership', result['reason'])
        finally:
            child.terminate(); child.wait(); child.stdout.close()

    def ended_checkout(self):
        self.env['FAKE_WORKER_MODE'] = 'fail'
        self.tick()
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        old = self.state_data()['active'].copy()
        self.until(lambda: dispatcher.pid_identity(old['launcher_pid']) is None)
        self.tick()
        state = self.state_data()
        return state, state['history'][-1], Path(old['worktree'])

    def test_interrupted_delete_intent_is_reconciled_before_next_release(self):
        state, old, checkout = self.ended_checkout()
        scratch = checkout / '.evidence/product-build/ModuleCache.noindex'
        scratch.mkdir(parents=True); (scratch / 'module').write_text('rebuildable')
        state['resource_releases'][old['id']] = {'issue': old['issue'], 'claim': old['id'],
            'removed': [], 'removal_intent': str(scratch.resolve())}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()
        result = self.state_data()['resource_releases'][old['id']]
        self.assertFalse(scratch.exists())
        self.assertNotIn('removal_intent', result)
        self.assertEqual(result['state'], 'released')
        self.assertIn(str(scratch.resolve()), result['removed'])

    def test_absent_interrupted_delete_gets_uncertain_reconciliation_receipt(self):
        state, old, checkout = self.ended_checkout()
        scratch = checkout / '.evidence/product-build/ModuleCache.noindex'
        state['resource_releases'][old['id']] = {'issue': old['issue'], 'claim': old['id'],
            'removed': [], 'removal_intent': str(scratch.resolve())}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()
        result = self.state_data()['resource_releases'][old['id']]
        self.assertNotIn('removal_intent', result)
        self.assertEqual(result['removed'], [])
        self.assertIn(str(scratch.resolve()), result['reconciled_absent'])

    def test_interrupted_intent_cannot_delete_external_symlink_target(self):
        state, old, checkout = self.ended_checkout()
        outside = self.base / 'outside-module-cache'; outside.mkdir()
        (outside / 'keep').write_text('not task owned')
        scratch = checkout / '.evidence/product-build/ModuleCache.noindex'
        scratch.parent.mkdir(parents=True, exist_ok=True)
        scratch.symlink_to(outside, target_is_directory=True)
        state['resource_releases'][old['id']] = {'issue': old['issue'], 'claim': old['id'],
            'removed': [], 'removal_intent': str(scratch.absolute())}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.tick()
        result = self.state_data()['resource_releases'][old['id']]
        self.assertEqual((outside / 'keep').read_text(), 'not task owned')
        self.assertEqual(result['state'], 'deferred')
        self.assertIn('not owned', result['reason'])

    def test_disk_hold_persists_expired_retention_assessment(self):
        state, old, checkout = self.ended_checkout()
        state['history'][-1]['finished_at'] = '2026-09-01T00:00:00Z'
        state['resource_retention'] = {}
        (self.state / 'state.json').write_text(json.dumps(state))
        config = json.loads(self.config.read_text()); config['scratch_reserve_bytes'] = 10**18
        self.config.write_text(json.dumps(config))
        self.assertEqual(self.tick()['state'], 'resource-hold')
        self.assertEqual(self.state_data()['resource_retention'][str(checkout)]['state'], 'assessment-due')

    def test_changed_terminal_receipt_refuses_release(self):
        state, old, checkout = self.ended_checkout()
        scratch = checkout / '.evidence/product-build/ModuleCache.noindex'
        scratch.mkdir(parents=True); (scratch / 'keep').write_text('retained')
        state['resource_releases'].pop(old['id'])
        (self.state / 'state.json').write_text(json.dumps(state))
        receipt = self.state / 'claims' / old['id'] / 'receipt.json'
        value = json.loads(receipt.read_text()); value['terminal'] = 'changed'
        receipt.write_text(json.dumps(value))
        self.tick()
        self.assertTrue(scratch.exists())
        self.assertIn('terminal receipt', self.state_data()['resource_releases'][old['id']]['reason'])

    def test_resume_finds_durable_checkout_after_history_rollover(self):
        state, old, checkout = self.ended_checkout()
        (checkout / 'retained-source.txt').write_text('old issue source')
        state['history'] = [{'id': 'later-%s' % n, 'issue': 999, 'terminal': 'verified'} for n in range(100)]
        (self.state / 'state.json').write_text(json.dumps(state))
        self.set_board([item(385)])
        board = self.board_data(); board['ready_at']['385'] = '2026-09-27T01:00:00Z'
        self.board.write_text(json.dumps(board))
        self.tick()
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        new = self.state_data()['active']
        self.assertEqual(Path(new['worktree']).resolve(), checkout.resolve())
        self.assertEqual(new['resumed_from_claim'], old['id'])
        self.assertEqual((checkout / 'retained-source.txt').read_text(), 'old issue source')
        self.assertEqual(len(list(self.worktrees.iterdir())), 1)

    def test_reopened_verified_issue_preserves_completed_checkout_and_uses_current_main(self):
        self.tick()
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        old = self.state_data()['active'].copy()
        self.until(lambda: dispatcher.pid_identity(old['launcher_pid']) is None)
        self.tick()
        self.assertEqual(self.state_data()['history'][-1]['terminal'], 'verified')
        checkout = Path(old['worktree'])
        proof = checkout / '.evidence/earlier-accepted-proof.json'; proof.parent.mkdir(exist_ok=True)
        proof.write_text('earlier accepted device proof')
        self.set_board([item(385)])
        board = self.board_data(); board['ready_at']['385'] = '2026-09-27T01:00:00Z'
        self.board.write_text(json.dumps(board))
        self.tick()
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        new = self.state_data()['active']
        self.assertNotEqual(Path(new['worktree']).resolve(), checkout.resolve())
        self.assertNotIn('resumed_from_claim', new)
        self.assertEqual(proof.read_text(), 'earlier accepted device proof')
        self.assertEqual(run('git', 'rev-parse', 'HEAD', cwd=new['worktree']).stdout,
                         run('git', 'rev-parse', 'origin/main', cwd=self.repo).stdout)
        self.assertEqual(len(list(self.worktrees.iterdir())), 2)

    def test_authorized_resume_reuses_ended_issue_checkout(self):
        self.env['FAKE_WORKER_MODE'] = 'fail'
        self.tick()
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        old = self.state_data()['active'].copy()
        checkout = Path(old['worktree'])
        (checkout / 'retained-source.txt').write_text('unfinished work must survive\n')
        self.tick()
        self.set_board([item(385)])
        board = self.board_data()
        board['ready_at']['385'] = '2026-09-27T01:00:00Z'
        self.board.write_text(json.dumps(board))
        self.tick()
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        successor = self.state_data()['active']
        self.assertEqual(Path(successor['worktree']).resolve(), Path(old['worktree']).resolve())
        self.assertEqual(successor['branch'], old['branch'])
        self.assertNotEqual(successor['id'], old['id'])
        self.assertEqual((checkout / 'retained-source.txt').read_text(), 'unfinished work must survive\n')
        self.assertEqual(len(list(self.worktrees.iterdir())), 1)

    def test_created_checkout_survives_prelaunch_crash_before_claim_update(self):
        real_git = shutil.which('git')
        wrapped = self.base / 'crash-git'
        wrapped.write_text('#!' + sys.executable + '\nimport os,signal,subprocess,sys\n'
            + 'code=subprocess.call([' + repr(real_git) + ',*sys.argv[1:]])\n'
            + 'if code==0 and "worktree" in sys.argv and "add" in sys.argv: os.kill(os.getppid(),signal.SIGKILL)\n'
            + 'raise SystemExit(code)\n')
        wrapped.chmod(0o700)
        config = json.loads(self.config.read_text()); config['git_bin'] = str(wrapped)
        self.config.write_text(json.dumps(config))
        with self.assertRaises(subprocess.CalledProcessError):
            self.tick()
        checkout = next(self.worktrees.iterdir())
        (checkout / 'crash-retained-source.txt').write_text('preserve the orphan-window source')
        config['git_bin'] = real_git; self.config.write_text(json.dumps(config))
        self.tick()
        self.set_board([item(385)])
        board = self.board_data(); board['ready_at']['385'] = '2026-09-27T02:00:00Z'
        self.board.write_text(json.dumps(board))
        self.tick()
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        self.assertEqual(Path(self.state_data()['active']['worktree']).resolve(), checkout.resolve())
        self.assertEqual(len(list(self.worktrees.iterdir())), 1)
        self.assertEqual((checkout / 'crash-retained-source.txt').read_text(), 'preserve the orphan-window source')

    def test_creation_intent_without_created_checkout_can_retry_without_orphan(self):
        real_git = shutil.which('git')
        wrapped = self.base / 'crash-before-git'
        wrapped.write_text('#!' + sys.executable + '\nimport os,signal,subprocess,sys\n'
            + 'if "worktree" in sys.argv and "add" in sys.argv: os.kill(os.getppid(),signal.SIGKILL); raise SystemExit(1)\n'
            + 'raise SystemExit(subprocess.call([' + repr(real_git) + ',*sys.argv[1:]]))\n')
        wrapped.chmod(0o700)
        config = json.loads(self.config.read_text()); config['git_bin'] = str(wrapped)
        self.config.write_text(json.dumps(config))
        with self.assertRaises(subprocess.CalledProcessError):
            self.tick()
        self.assertEqual(list(self.worktrees.iterdir()), [])
        self.assertTrue(self.state_data()['active']['worktree_creation_intent'])
        config['git_bin'] = real_git; self.config.write_text(json.dumps(config))
        self.tick()
        self.set_board([item(385)])
        board = self.board_data(); board['ready_at']['385'] = '2026-09-27T02:00:00Z'
        self.board.write_text(json.dumps(board))
        self.tick()
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        self.assertEqual(len(list(self.worktrees.iterdir())), 1)

    def test_admission_preserves_floor_plus_scratch_reserve(self):
        self.set_board([])
        config = json.loads(self.config.read_text())
        config.update({'_path': str(self.config), 'min_free_bytes': 80, 'scratch_reserve_bytes': 40})
        state = {'active': None, 'history': []}
        with mock.patch.dict(os.environ, self.env), mock.patch.object(dispatcher.shutil, 'disk_usage',
                return_value=types.SimpleNamespace(free=100)):
            result = dispatcher.tick(config, state, self.state / 'state.json', SCRIPT)
        self.assertEqual(result['state'], 'resource-hold')
        self.assertEqual(result['required_free_bytes'], 120)
        self.assertEqual(self.workers(), [])

    def test_manual_successor_verified_claim_retires_only_its_receipt_device(self):
        claim_id = '12345678-1234-1234-1234-123456789abc'
        worktree = self.worktrees / f'fitsy-issue-412-{claim_id[:8]}'
        build = worktree / '.evidence/product-build'
        build.mkdir(parents=True)
        udid = '9EC11FCA-B224-4380-A91D-235ED2BBF7C4'
        (build / 'receipt.json').write_text(json.dumps({'simulator': udid}))
        config = json.loads(self.config.read_text())
        state = {'active': None, 'verified': {'412': {'id': claim_id, 'issue': 412, 'branch': 'issue-412'}},
                 'history': [{'terminal': 'parked-after-exit', 'issue': 412, 'id': claim_id,
                              'branch': 'issue-412', 'worktree': str(worktree)},
                             {'terminal': 'verified', 'finished_at': '2026-09-01T00:00:00Z', 'issue': 412, 'id': claim_id,
                              'branch': 'issue-412', 'worktree': str(worktree)}]}
        path = self.state / 'state.json'
        with mock.patch.object(dispatcher, 'board', return_value=[item(412, status='Done')]), \
             mock.patch.object(dispatcher, 'terminal_verified', return_value=True), \
             mock.patch.object(dispatcher, 'retire_task_device', return_value={
                'freeBeforeBytes': 100, 'freeAfterBytes': 200}) as retire:
            dispatcher.retire_verified_simulator(config, state, path)
            retire.assert_called_once()
            self.assertEqual(retire.call_args.kwargs['udid'], udid)
            self.assertEqual(state['simulator_retirement'][udid]['status'], 'retired')
            dispatcher.retire_verified_simulator(config, state, path)
            retire.assert_called_once()
        state['simulator_retirement'] = {}
        state['history'][-1]['id'] = 'other-claim'
        with mock.patch.object(dispatcher, 'retire_task_device') as retire:
            dispatcher.retire_verified_simulator(config, state, path)
            retire.assert_not_called()
        state['history'][-1]['id'] = claim_id
        state['active'] = {'issue': 414}
        with mock.patch.object(dispatcher, 'retire_task_device') as retire:
            dispatcher.retire_verified_simulator(config, state, path)
            retire.assert_not_called()
        state['active'] = None
        with mock.patch.object(dispatcher, 'board', return_value=[item(412, status='Queued')]), \
             mock.patch.object(dispatcher, 'terminal_verified', return_value=False), \
             mock.patch.object(dispatcher, 'retire_task_device') as retire:
            dispatcher.retire_verified_simulator(config, state, path)
            retire.assert_not_called()
            self.assertEqual(state['simulator_retirement'][udid]['status'], 'held')

    def test_recent_device_owner_release_protects_an_older_verified_task(self):
        claim_id = '12345678-1234-1234-1234-123456789abc'
        worktree = self.worktrees / f'fitsy-issue-412-{claim_id[:8]}'
        build = worktree / '.evidence/product-build'; build.mkdir(parents=True)
        udid = '9EC11FCA-B224-4380-A91D-235ED2BBF7C4'
        (build / 'receipt.json').write_text(json.dumps({'simulator': udid}))
        clock = dispatcher.utc()
        (self.state / 'device-owner-uses.json').write_text(json.dumps({'version': 1, 'devices': {
            udid: {'owner': 'later-owner', 'last_owner_use': clock, 'released_at': clock}}}))
        config = json.loads(self.config.read_text())
        state = {'active': None, 'verified': {'412': {'id': claim_id, 'issue': 412, 'branch': 'issue-412'}},
                 'history': [{'terminal': 'verified', 'finished_at': '2026-09-01T00:00:00Z', 'issue': 412,
                              'id': claim_id, 'branch': 'issue-412', 'worktree': str(worktree)}]}
        with mock.patch.object(dispatcher, 'board', return_value=[item(412, status='Done')]), \
             mock.patch.object(dispatcher, 'terminal_verified', return_value=True), \
             mock.patch.object(dispatcher, 'retire_task_device') as retire:
            dispatcher.retire_verified_simulator(config, state, self.state / 'state.json')
            retire.assert_not_called()
            self.assertEqual(state['simulator_retirement'][udid]['status'], 'held')

    def test_held_older_device_does_not_starve_later_verified_device(self):
        state = {'active': None, 'verified': {}, 'history': []}
        udids = ('9EC11FCA-B224-4380-A91D-235ED2BBF7C4',
                 'CE4397A7-AB61-4099-B843-51D38DA417D9')
        for issue, udid in zip((412, 413), udids):
            claim_id = f'{issue:08x}-1234-1234-1234-123456789abc'
            branch = f'issue-{issue}'
            worktree = self.worktrees / f'fitsy-issue-{issue}-{claim_id[:8]}'
            build = worktree / '.evidence/product-build'
            build.mkdir(parents=True)
            (build / 'receipt.json').write_text(json.dumps({'simulator': udid}))
            state['verified'][str(issue)] = {'id': claim_id, 'issue': issue, 'branch': branch}
            state['history'].append({'terminal': 'verified', 'finished_at': '2026-09-01T00:00:00Z', 'id': claim_id, 'issue': issue,
                                     'branch': branch, 'worktree': str(worktree)})
        config = json.loads(self.config.read_text())
        path = self.state / 'state.json'
        def attempt(**kwargs):
            if kwargs['issue'] == 412:
                raise ValueError('device is booted')
            return {'freeBeforeBytes': 100, 'freeAfterBytes': 200}
        with mock.patch.object(dispatcher, 'board', return_value=[item(412, status='Done'), item(413, status='Done')]), \
             mock.patch.object(dispatcher, 'terminal_verified', return_value=True), \
             mock.patch.object(dispatcher, 'retire_task_device', side_effect=attempt) as retire:
            dispatcher.retire_verified_simulator(config, state, path)
            self.assertEqual(state['simulator_retirement'][udids[0]]['status'], 'held')
            dispatcher.retire_verified_simulator(config, state, path)
            self.assertEqual(state['simulator_retirement'][udids[1]]['status'], 'retired')
            self.assertEqual([call.kwargs['issue'] for call in retire.call_args_list], [412, 413])

    def test_pruned_history_uses_exact_durable_verified_claim(self):
        claim_id = '12345678-1234-1234-1234-123456789abc'
        worktree = self.worktrees / f'fitsy-issue-412-{claim_id[:8]}'
        build = worktree / '.evidence/product-build'
        build.mkdir(parents=True)
        udid = '9EC11FCA-B224-4380-A91D-235ED2BBF7C4'
        (build / 'receipt.json').write_text(json.dumps({'simulator': udid}))
        saved = self.state / 'claims' / claim_id / 'receipt.json'
        saved.parent.mkdir(parents=True)
        claim = {'terminal': 'verified', 'finished_at': '2026-09-01T00:00:00Z', 'issue': 412, 'id': claim_id,
                 'branch': 'issue-412', 'worktree': str(worktree)}
        saved.write_text(json.dumps(claim))
        config = json.loads(self.config.read_text())
        state = {'active': None, 'verified': {'412': {'id': claim_id, 'issue': 412,
                 'branch': 'issue-412'}}, 'history': [{'terminal': 'verified', 'issue': 999}] * 100}
        path = self.state / 'state.json'
        with mock.patch.object(dispatcher, 'board', return_value=[item(412, status='Done')]), \
             mock.patch.object(dispatcher, 'terminal_verified', return_value=True), \
             mock.patch.object(dispatcher, 'retire_task_device', return_value={
                'freeBeforeBytes': 100, 'freeAfterBytes': 200}) as retire:
            dispatcher.retire_verified_simulator(config, state, path)
            retire.assert_called_once()
            self.assertEqual(state['simulator_retirement'][udid]['status'], 'retired')
        state['simulator_retirement'] = {}
        saved.write_text(json.dumps({**claim, 'id': 'wrong-claim'}))
        with mock.patch.object(dispatcher, 'retire_task_device') as retire:
            dispatcher.retire_verified_simulator(config, state, path)
            retire.assert_not_called()

    def test_unconfirmed_absence_retries_on_next_tick(self):
        claim_id = '12345678-1234-1234-1234-123456789abc'
        worktree = self.worktrees / f'fitsy-issue-412-{claim_id[:8]}'
        build = worktree / '.evidence/product-build'
        build.mkdir(parents=True)
        udid = '9EC11FCA-B224-4380-A91D-235ED2BBF7C4'
        (build / 'receipt.json').write_text(json.dumps({'simulator': udid}))
        config = json.loads(self.config.read_text())
        state = {'active': None, 'verified': {'412': {'id': claim_id, 'issue': 412,
                 'branch': 'issue-412'}}, 'history': [{'terminal': 'verified', 'finished_at': '2026-09-01T00:00:00Z', 'issue': 412,
                 'id': claim_id, 'branch': 'issue-412', 'worktree': str(worktree)}]}
        path = self.state / 'state.json'
        with mock.patch.object(dispatcher, 'board', return_value=[item(412, status='Done')]), \
             mock.patch.object(dispatcher, 'terminal_verified', return_value=True), \
             mock.patch.object(dispatcher, 'retire_task_device', side_effect=[
                 ValueError('device is absent'), {'freeBeforeBytes': 100, 'freeAfterBytes': 200}]) as retire:
            dispatcher.retire_verified_simulator(config, state, path)
            self.assertEqual(state['simulator_retirement'][udid]['status'], 'held')
            dispatcher.retire_verified_simulator(config, state, path)
            self.assertEqual(state['simulator_retirement'][udid]['status'], 'retired')
            self.assertEqual(retire.call_count, 2)

    def test_malformed_build_receipt_is_held_without_stalling_tick(self):
        claim_id = '12345678-1234-1234-1234-123456789abc'
        worktree = self.worktrees / f'fitsy-issue-412-{claim_id[:8]}'
        build = worktree / '.evidence/product-build'
        build.mkdir(parents=True)
        (build / 'receipt.json').write_text('{bad json')
        config = json.loads(self.config.read_text())
        state = {'active': None, 'verified': {'412': {'id': claim_id, 'issue': 412,
                 'branch': 'issue-412'}}, 'history': [{'terminal': 'verified', 'finished_at': '2026-09-01T00:00:00Z', 'issue': 412,
                 'id': claim_id, 'branch': 'issue-412', 'worktree': str(worktree)}]}
        dispatcher.retire_verified_simulator(config, state, self.state / 'state.json')
        self.assertEqual(state['simulator_retirement'][f'claim:{claim_id}']['status'], 'held')

    def test_idle_ready_pickup_race_and_next_dependency(self):
        self.set_board([item(385), item(351, dependencies='#385')])
        self.env['FAKE_WORKER_MODE'] = 'sleep'
        self.env['FAKE_WORKER_SLEEP'] = '1'
        p1 = subprocess.Popen([sys.executable, str(SCRIPT), 'tick', '--config', str(self.config)],
                              cwd=self.base, env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        p2 = subprocess.Popen([sys.executable, str(SCRIPT), 'tick', '--config', str(self.config)],
                              cwd=self.base, env=self.env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        r1 = p1.communicate(timeout=20); r2 = p2.communicate(timeout=20)
        self.assertEqual((p1.returncode, p2.returncode), (0, 0), (r1, r2))
        self.until(lambda: len(self.workers()) == 1)
        self.assertIn(self.tick()['state'], ('running', 'uncertain-launch'))
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        self.assertEqual(self.tick()['issue'], 351)
        self.until(lambda: len(self.workers()) == 2)
        self.assertEqual(self.board_data()['items'][0]['status'], 'Done')
        self.assertEqual(len(self.state_data()['history']), 1)

    def test_hold_dependency_and_uncertain_spawn_never_duplicate(self):
        self.set_board([item(385, labels=['dispatch-ready', 'dispatch-hold']), item(351, dependencies='#385')])
        self.assertEqual(self.tick()['state'], 'idle')
        self.assertEqual(self.workers(), [])
        state = self.state_data()
        state['active'] = {'id': 'uncertain', 'issue': 385, 'stage': 'running'}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.tick()['state'], 'uncertain-launch')
        self.assertEqual(self.workers(), [])

    def test_other_issue_green_pr_cannot_release_dependency(self):
        delivered = item(385, status='Done')
        delivered.update({'issue_state': 'CLOSED', 'verified at': '2026-09-27T00:10:00Z',
                          'branch': 'codex/issue-385-known'})
        delivered['terminal'] = '<!-- fitsy-dispatch-terminal:v1 -->' + json.dumps({
            'issue': 385, 'claim_id': 'known', 'branch': delivered['branch'],
            'pr': 389, 'head_sha': 'a' * 40, 'merge_sha': 'b' * 40,
            'verify_run': 11, 'deploy_run': 12, 'acceptance': 'verified'})
        self.set_board([delivered, item(351, dependencies='#385')])
        receipt = self.state / 'claims/known/receipt.json'
        receipt.parent.mkdir(parents=True)
        receipt.write_text(json.dumps({'terminal': 'verified', 'issue': 385, 'branch': delivered['branch']}))
        (self.state / 'state.json').write_text(json.dumps({'active': None, 'verified': {'385': {
            'id': 'known', 'issue': 385, 'branch': delivered['branch']}}, 'readiness': {},
            'classifications': {}, 'parked': {}, 'history': []}))
        self.env['FAKE_WRONG_PR_ISSUE'] = '1'
        self.assertEqual(self.tick()['state'], 'idle')
        self.assertEqual(self.workers(), [])

    def test_other_repository_card_cannot_satisfy_dependency(self):
        foreign = item(385, status='Done')
        foreign['content']['repository'] = 'someone/other'
        self.set_board([foreign, item(351, dependencies='#385')])
        self.assertEqual(self.tick()['state'], 'idle')
        self.assertEqual(self.workers(), [])

    def test_preexisting_verified_dependency_releases_ready_issue(self):
        historical = item(385, status='Done')
        historical.update({'issue_state': 'CLOSED', 'verified at': '2026-09-26T00:10:00Z',
                           'search_pr': True})
        self.set_board([historical, item(351, dependencies='#385')])
        self.assertEqual(self.tick()['issue'], 351)
        self.until(lambda: self.state_data()['active'].get('finished_at'))

    def test_managed_done_without_terminal_receipt_cannot_release_dependency(self):
        managed = item(385, status='Done')
        managed.update({'issue_state': 'CLOSED', 'verified at': '2026-09-27T00:10:00Z',
                        'search_pr': True, 'claim_comment': True})
        self.set_board([managed, item(351, dependencies='#385')])
        self.assertEqual(self.tick()['state'], 'idle')
        self.assertEqual(self.workers(), [])

    def test_proven_dead_launcher_parks_and_releases_independent_issue(self):
        launched = item(385, status='In flight')
        self.set_board([launched, item(351)])
        child = subprocess.Popen(['sleep', '0.1'], start_new_session=True)
        start = run('ps', '-p', str(child.pid), '-o', 'lstart=').stdout.strip()
        child.wait(timeout=3)
        state = {'version': 1, 'active': {'id': 'dead-launcher', 'issue': 385, 'item_id': 'item-385',
                 'stage': 'launching', 'launcher_pid': child.pid, 'launcher_started': start,
                 'ready_at': '2026-09-27T00:00:00Z'}, 'readiness': {}, 'classifications': {},
                 'parked': {}, 'history': []}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.tick()['issue'], 351)
        self.assertEqual(self.state_data()['history'][0]['terminal'], 'parked-after-exit')
        self.until(lambda: self.state_data()['active'].get('finished_at'))

    def test_launcher_exit_with_live_same_group_child_retains_lane(self):
        self.set_board([item(385, status='In flight'), item(351)])
        launcher = subprocess.Popen(['/bin/sh', '-c', 'sleep 3 &'], start_new_session=True)
        started = run('ps', '-p', str(launcher.pid), '-o', 'lstart=').stdout.strip()
        launcher.wait(timeout=2)
        self.addCleanup(lambda: os.killpg(launcher.pid, signal.SIGTERM)
                        if dispatcher.group_alive(launcher.pid) else None)
        self.assertTrue(dispatcher.group_alive(launcher.pid))
        state = {'version': 1, 'active': {'id': 'orphan-window', 'issue': 385, 'stage': 'launching',
                 'launcher_pid': launcher.pid, 'launcher_started': started,
                 'ready_at': '2026-09-27T00:00:00Z'}, 'readiness': {}, 'classifications': {},
                 'parked': {}, 'history': []}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.tick()['state'], 'uncertain-launch')
        self.assertEqual(self.workers(), [])

    def test_expired_unwitnessed_launch_group_retains_lane(self):
        self.set_board([item(385, status='In flight'), item(351)])
        launcher = subprocess.Popen(['/bin/sh', '-c', 'sleep 30 &'], start_new_session=True)
        started = run('ps', '-p', str(launcher.pid), '-o', 'lstart=').stdout.strip()
        launcher.wait(timeout=2)
        self.addCleanup(lambda: os.killpg(launcher.pid, signal.SIGKILL)
                        if dispatcher.group_alive(launcher.pid) else None)
        config = json.loads(self.config.read_text())
        config['worker_timeout_seconds'] = 1
        self.config.write_text(json.dumps(config))
        state = {'version': 1, 'active': {'id': 'expired-launch', 'issue': 385, 'stage': 'launching',
                 'launcher_pid': launcher.pid, 'launcher_started': started,
                 'claimed_at': '2026-09-27T00:00:00Z', 'ready_at': '2026-09-27T00:00:00Z'},
                 'readiness': {}, 'classifications': {}, 'parked': {}, 'history': []}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.tick()['state'], 'uncertain-launch')
        self.assertTrue(dispatcher.group_alive(launcher.pid))
        self.assertEqual(self.workers(), [])

    def test_reused_launcher_group_identity_is_never_signaled(self):
        self.set_board([item(385, status='In flight'), item(351)])
        unrelated = subprocess.Popen(['sleep', '30'], start_new_session=True)
        def stop_unrelated():
            if unrelated.poll() is None:
                unrelated.terminate()
            unrelated.wait(timeout=3)
        self.addCleanup(stop_unrelated)
        config = json.loads(self.config.read_text())
        config['worker_timeout_seconds'] = 1
        self.config.write_text(json.dumps(config))
        state = {'version': 1, 'active': {'id': 'reused-launch', 'issue': 385, 'stage': 'launching',
                 'launcher_pid': unrelated.pid, 'launcher_started': 'different process identity',
                 'claimed_at': '2026-09-27T00:00:00Z', 'ready_at': '2026-09-27T00:00:00Z'},
                 'readiness': {}, 'classifications': {}, 'parked': {}, 'history': []}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.tick()['state'], 'uncertain-launch')
        self.assertIsNone(unrelated.poll())
        self.assertEqual(self.workers(), [])

    def test_expired_running_group_without_launcher_receipt_releases_lane(self):
        self.set_board([item(385, status='In flight'), item(351)])
        worker = subprocess.Popen(['sleep', '30'], start_new_session=True)
        started = run('ps', '-p', str(worker.pid), '-o', 'lstart=').stdout.strip()
        self.addCleanup(lambda: os.killpg(worker.pid, signal.SIGKILL)
                        if dispatcher.group_alive(worker.pid) else None)
        config = json.loads(self.config.read_text())
        config['worker_timeout_seconds'] = 1
        self.config.write_text(json.dumps(config))
        state = {'version': 1, 'active': {'id': 'expired-running', 'issue': 385, 'stage': 'running',
                 'pid': worker.pid, 'pid_started': started, 'worker_pgid': worker.pid,
                 'started_at': '2026-09-27T00:00:00Z', 'claimed_at': '2026-09-27T00:00:00Z',
                 'ready_at': '2026-09-27T00:00:00Z'}, 'readiness': {},
                 'classifications': {}, 'parked': {}, 'history': []}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.tick()['issue'], 351)
        self.assertTrue(self.state_data()['history'][0]['timed_out'])
        worker.wait(timeout=3)
        self.assertIn('dispatch-hold', self.board_data()['items'][0]['labels'])

    def test_expired_stopped_worker_without_receipt_releases_lane(self):
        self.set_board([item(385, status='In flight'), item(351)])
        worker = subprocess.Popen(['sleep', '0.1'], start_new_session=True)
        started = run('ps', '-p', str(worker.pid), '-o', 'lstart=').stdout.strip()
        worker.wait(timeout=2)
        config = json.loads(self.config.read_text())
        config['worker_timeout_seconds'] = 1
        self.config.write_text(json.dumps(config))
        state = {'version': 1, 'active': {'id': 'expired-stopped', 'issue': 385, 'stage': 'running',
                 'pid': worker.pid, 'pid_started': started, 'worker_pgid': worker.pid,
                 'started_at': '2026-09-27T00:00:00Z', 'claimed_at': '2026-09-27T00:00:00Z',
                 'ready_at': '2026-09-27T00:00:00Z'}, 'readiness': {},
                 'classifications': {}, 'parked': {}, 'history': []}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.tick()['issue'], 351)
        self.assertTrue(self.state_data()['history'][0]['timed_out'])
        self.assertIn('dispatch-hold', self.board_data()['items'][0]['labels'])

    def test_uncertain_group_reconciles_after_all_members_stop(self):
        self.set_board([item(385, status='In flight'), item(351)])
        child = subprocess.Popen(['sleep', '0.2'], start_new_session=True)
        state = {'version': 1, 'active': {'id': 'group-uncertain', 'issue': 385,
                 'stage': 'ownership-uncertain', 'worker_pgid': child.pid,
                 'ready_at': '2026-09-27T00:00:00Z'}, 'readiness': {}, 'classifications': {},
                 'parked': {}, 'history': []}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.tick()['state'], 'ownership-uncertain')
        child.wait(timeout=3)
        self.assertEqual(self.tick()['issue'], 351)
        self.assertEqual(self.state_data()['history'][0]['terminal'], 'parked-after-exit')
        self.until(lambda: self.state_data()['active'].get('finished_at'))

    def test_uncertain_group_is_stopped_after_worker_wall_budget(self):
        self.set_board([item(385, status='In flight'), item(351)])
        child = subprocess.Popen(['sleep', '30'], start_new_session=True)
        started = run('ps', '-p', str(child.pid), '-o', 'lstart=').stdout.strip()
        self.addCleanup(lambda: os.killpg(child.pid, signal.SIGKILL)
                        if dispatcher.group_alive(child.pid) else None)
        config = json.loads(self.config.read_text())
        config['worker_timeout_seconds'] = 1
        self.config.write_text(json.dumps(config))
        state = {'version': 1, 'active': {'id': 'expired-group', 'issue': 385,
                 'stage': 'ownership-uncertain', 'worker_pgid': child.pid,
                 'pid': child.pid, 'pid_started': started,
                 'started_at': '2026-09-27T00:00:00Z', 'ready_at': '2026-09-27T00:00:00Z'},
                 'readiness': {}, 'classifications': {}, 'parked': {}, 'history': []}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.tick()['issue'], 351)
        self.assertTrue(self.state_data()['history'][0]['timed_out'])
        child.wait(timeout=3)
        self.assertIn('dispatch-hold', self.board_data()['items'][0]['labels'])

    def test_closed_merged_issue_with_failed_main_ci_cannot_release_dependency(self):
        delivered = item(385, status='Done')
        delivered['issue_state'] = 'CLOSED'
        delivered['verified at'] = '2026-09-27T00:10:00Z'
        delivered['branch'] = 'codex/issue-385-known'
        delivered['terminal'] = '<!-- fitsy-dispatch-terminal:v1 -->' + json.dumps({
            'issue': 385, 'claim_id': 'known', 'branch': delivered['branch'],
            'pr': 389, 'head_sha': 'a' * 40, 'merge_sha': 'b' * 40,
            'verify_run': 11, 'deploy_run': 12, 'acceptance': 'verified'})
        self.set_board([delivered, item(351, dependencies='#385')])
        receipt = self.state / 'claims/known/receipt.json'
        receipt.parent.mkdir(parents=True)
        receipt.write_text(json.dumps({'terminal': 'verified', 'issue': 385, 'branch': delivered['branch']}))
        (self.state / 'state.json').write_text(json.dumps({'active': None, 'verified': {'385': {
            'id': 'known', 'issue': 385, 'branch': delivered['branch']}}, 'readiness': {},
            'classifications': {}, 'parked': {}, 'history': []}))
        self.env['FAKE_BAD_CI'] = '1'
        self.assertEqual(self.tick()['state'], 'idle')
        self.assertEqual(self.workers(), [])

    def test_stale_claim_receipt_cannot_release_dependency(self):
        delivered = item(385, status='Done')
        delivered.update({'issue_state': 'CLOSED', 'verified at': '2026-09-27T00:10:00Z',
                          'branch': 'codex/unrelated'})
        delivered['terminal'] = '<!-- fitsy-dispatch-terminal:v1 -->' + json.dumps({
            'issue': 385, 'claim_id': 'old-claim', 'branch': 'codex/unrelated',
            'pr': 389, 'head_sha': 'a' * 40, 'merge_sha': 'b' * 40,
            'verify_run': 11, 'deploy_run': 12, 'acceptance': 'verified'})
        self.set_board([delivered, item(351, dependencies='#385')])
        receipt = self.state / 'claims/current-claim/receipt.json'
        receipt.parent.mkdir(parents=True)
        receipt.write_text(json.dumps({'terminal': 'verified', 'issue': 385,
                                       'branch': 'codex/issue-385-current'}))
        (self.state / 'state.json').write_text(json.dumps({'active': None, 'verified': {'385': {
            'id': 'current-claim', 'issue': 385, 'branch': 'codex/issue-385-current'}},
            'readiness': {}, 'classifications': {}, 'parked': {}, 'history': []}))
        self.assertEqual(self.tick()['state'], 'idle')
        self.assertEqual(self.workers(), [])

    def test_failure_parks_and_new_ready_event_allows_retry(self):
        self.env['FAKE_WORKER_MODE'] = 'fail'
        self.assertEqual(self.tick()['issue'], 385)
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        self.assertEqual(self.tick()['state'], 'idle')
        self.assertIn('dispatch-hold', self.board_data()['items'][0]['labels'])
        self.assertEqual(self.tick()['state'], 'idle')
        self.assertEqual(len(self.workers()), 1)
        data = self.board_data()
        data['items'][0]['labels'].remove('dispatch-hold')
        data['items'][0]['blocker'] = None
        data['ready_at']['385'] = '2026-09-27T01:00:00Z'
        self.board.write_text(json.dumps(data))
        self.assertEqual(self.tick()['issue'], 385)
        self.until(lambda: len(self.workers()) == 2)
        self.until(lambda: self.state_data()['active'].get('finished_at'))

    def test_live_or_reused_pid_retains_lane(self):
        child = subprocess.Popen(['sleep', '10'])
        def stop_child():
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=3)
        self.addCleanup(stop_child)
        start = run('ps', '-p', str(child.pid), '-o', 'lstart=').stdout.strip()
        state = {'version': 1, 'active': {'id': 'live', 'issue': 385, 'stage': 'running',
                 'pid': child.pid, 'pid_started': start}, 'readiness': {}, 'classifications': {}, 'parked': {}, 'history': []}
        (self.state / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.tick()['state'], 'running')
        state['active']['pid_started'] = 'wrong start time'
        (self.state / 'state.json').write_text(json.dumps(state))
        self.assertEqual(self.tick()['state'], 'uncertain-pid-reuse')
        self.assertEqual(self.workers(), [])

    def test_worker_wall_timeout_is_durable(self):
        self.env['FAKE_WORKER_MODE'] = 'sleep'
        self.env['FAKE_WORKER_SLEEP'] = '10'
        config = json.loads(self.config.read_text()); config['worker_timeout_seconds'] = 1
        self.config.write_text(json.dumps(config))
        self.tick()
        self.until(lambda: self.state_data()['active'].get('finished_at'), seconds=5)
        self.assertTrue(self.state_data()['active']['timed_out'])
        self.assertEqual(self.tick()['state'], 'idle')
        self.assertIn('dispatch-hold', self.board_data()['items'][0]['labels'])

    def test_timeout_stops_surviving_worker_group_child(self):
        self.env['FAKE_WORKER_MODE'] = 'spawn_child'
        config = json.loads(self.config.read_text()); config['worker_timeout_seconds'] = 1
        self.config.write_text(json.dumps(config))
        self.tick()
        self.until(lambda: self.board.with_suffix('.childpid').exists())
        child_pid = int(self.board.with_suffix('.childpid').read_text())
        def stop_child():
            try: os.kill(child_pid, signal.SIGKILL)
            except ProcessLookupError: pass
        self.addCleanup(stop_child)
        self.until(lambda: self.state_data()['active'].get('finished_at'), seconds=8)
        self.assertTrue(self.state_data()['active']['timed_out'])
        self.assertNotEqual(self.state_data()['active']['stage'], 'ownership-uncertain')
        self.assertEqual(self.tick()['state'], 'idle')
        self.assertIn('dispatch-hold', self.board_data()['items'][0]['labels'])

    def test_timeout_cannot_be_overwritten_by_late_verified_receipt(self):
        delivered = item(385, status='Done')
        delivered.update({'issue_state': 'CLOSED', 'verified at': '2026-09-27T00:10:00Z',
                          'branch': 'codex/issue-385-late'})
        delivered['terminal'] = '<!-- fitsy-dispatch-terminal:v1 -->' + json.dumps({
            'issue': 385, 'claim_id': 'late', 'branch': delivered['branch'], 'pr': 389,
            'head_sha': 'a' * 40, 'merge_sha': 'b' * 40, 'verify_run': 11,
            'deploy_run': 12, 'acceptance': 'verified'})
        self.set_board([delivered])
        (self.state / 'state.json').write_text(json.dumps({'active': {'id': 'late', 'issue': 385,
            'branch': delivered['branch'], 'stage': 'finished', 'timed_out': True,
            'finished_at': '2026-09-27T00:11:00Z', 'ready_at': '2026-09-27T00:00:00Z'},
            'readiness': {}, 'classifications': {}, 'parked': {}, 'history': []}))
        self.assertEqual(self.tick()['state'], 'idle')
        self.assertEqual(self.state_data()['history'][0]['terminal'], 'parked-after-exit')
        self.assertNotIn('385', self.state_data().get('verified', {}))

    def test_claude_adapter_uses_same_claim_lifecycle(self):
        config = json.loads(self.config.read_text())
        for value in config['profiles'].values():
            value.update({'provider': 'claude', 'model': 'configured-claude-model',
                          'executable': str(self.claude)})
        self.config.write_text(json.dumps(config))
        self.assertEqual(self.tick()['issue'], 385)
        self.until(lambda: self.state_data()['active'].get('finished_at'))
        args = json.loads(self.board.with_suffix('.args').read_text().splitlines()[0])
        self.assertIn('--print', args)
        self.assertIn('--verbose', args)
        self.assertIn('stream-json', args)
        self.assertEqual(args[args.index('--settings') + 1], '{"disableAllHooks":true}')
        self.assertIn('configured-claude-model', args)
        self.assertEqual(self.tick()['state'], 'idle')
        self.assertEqual(self.state_data()['history'][0]['terminal'], 'verified')

    def test_prelaunch_failure_is_parked_and_independent_issue_advances(self):
        self.set_board([item(385), item(351)])
        state = {'version': 1, 'active': {'id': 'prior-claim', 'issue': 385, 'stage': 'prepared',
                 'ready_at': '2026-09-27T00:00:00Z'}, 'readiness': {}, 'classifications': {},
                 'parked': {}, 'history': []}
        (self.state / 'state.json').write_text(json.dumps(state))
        result = self.tick()
        self.assertEqual(result['issue'], 351)
        self.assertEqual(self.state_data()['history'][0]['terminal'], 'parked-prelaunch')
        self.assertIn('dispatch-hold', self.board_data()['items'][0]['labels'])

    def test_low_confidence_jev_risk_remains_uncertain_with_live_shape(self):
        board_item = item(385)
        result = {'source': 'jev', 'model_requested': 'jev-latest', 'model_returned': 'jev-1.13.0',
                  'latency_ms': 2700, 'answers': {
                      'task_type': {'choice': 'bugfix', 'confidence': .99, 'accepted': True},
                      'risk': {'choice': 'medium', 'confidence': .32, 'accepted': False},
                      'profile': {'choice': 'deep', 'confidence': .62, 'accepted': True}}}
        config = json.loads(self.config.read_text()); config['jev_enabled'] = True
        state = {'classifications': {}}
        with mock.patch.object(dispatcher, 'jev', return_value=result):
            digest, classified = dispatcher.classify(config, state, board_item)
        self.assertEqual(classified['planning_risk'], 'unknown')
        self.assertEqual(classified['profile'], 'deep')
        self.assertEqual(classified['model_returned'], 'jev-1.13.0')
        self.assertEqual(classified['answers']['risk']['confidence'], .32)
        with mock.patch.object(dispatcher, 'jev', side_effect=AssertionError('cache miss')):
            self.assertEqual(dispatcher.classify(config, state, board_item)[0], digest)

    def test_jev_disabled_uses_deterministic_profile_without_provider_call(self):
        board_item = item(385)
        config = json.loads(self.config.read_text())
        state = {'classifications': {}}
        with mock.patch.object(dispatcher, 'jev', side_effect=AssertionError('provider called')):
            digest, classified = dispatcher.classify(config, state, board_item)
            self.assertEqual(dispatcher.classify(config, state, board_item)[0], digest)
        self.assertEqual(classified['source'], 'deterministic')
        self.assertEqual(classified['profile'], 'standard')
        self.assertEqual(classified['planning_risk'], 'unknown')
        self.assertIsNone(classified['model_requested'])
        config['jev_enabled'] = True
        with mock.patch.object(dispatcher, 'jev', side_effect=RuntimeError('offline')):
            opt_in_digest, fallback = dispatcher.classify(config, state, board_item)
        self.assertNotEqual(digest, opt_in_digest)
        self.assertEqual(fallback['source'], 'deterministic-fallback')

    def test_blocker_alert_has_single_confirmed_receipt(self):
        calls = []
        case = self
        class Slack:
            def __init__(self, store): pass
            def call(self, method, params=None, payload=None):
                calls.append(method)
                if method == 'auth.test': return {'user_id': 'USENDER'}
                if method == 'conversations.history': return {'messages': []}
                if method == 'chat.postMessage':
                    self_message = payload['text']
                    case.assertIn('🚨 *BLOCKED* <@UHUMAN>', self_message)
                    case.assertEqual(len(self_message.splitlines()), 3)
                    return {'channel': 'CCHANNEL', 'ts': '123.456'}
                raise AssertionError(method)
        bridge = types.SimpleNamespace(load_env=lambda: None,
            Config=types.SimpleNamespace(from_env=lambda: types.SimpleNamespace(channel='CCHANNEL')),
            Store=lambda settings: object(), Slack=Slack)
        config = {'slack': {'bridge_path': str(self.base), 'channel': 'CCHANNEL',
                            'sender': 'USENDER', 'recipient': 'UHUMAN'}}
        state = {}
        dispatcher.incident(state, {'issue': 385, 'id': 'claim-a'}, 'Required gate failed')
        path = self.state / 'alerts.json'
        with mock.patch.dict(sys.modules, {'bridge': bridge}):
            dispatcher.deliver_alerts(config, state, path)
            dispatcher.deliver_alerts(config, state, path)
        self.assertEqual(calls.count('chat.postMessage'), 1)
        alert = next(iter(state['alerts'].values()))
        self.assertEqual(alert['state'], 'delivered')
        self.assertEqual(alert['ts'], '123.456')

    def test_resolution_cancels_undelivered_blocker(self):
        state = {}
        dispatcher.incident(state, {'issue': 385, 'id': 'claim-a'}, 'Required gate failed')
        dispatcher.resolve_incidents(state, 385)
        alert = next(iter(state['alerts'].values()))
        self.assertEqual(alert['state'], 'cancelled')
        self.assertEqual(len(state['alerts']), 1)

    def test_uncertain_post_reconciles_before_resolution(self):
        state = {}
        dispatcher.incident(state, {'issue': 385, 'id': 'claim-a'}, 'Required gate failed')
        key, alert = next(iter(state['alerts'].items()))
        alert.update({'state': 'post-intent', 'post_intent': True})
        dispatcher.resolve_incidents(state, 385)
        self.assertEqual(alert['state'], 'resolution-check')
        class Slack:
            def __init__(self, store): pass
            def call(self, method, params=None, payload=None):
                if method == 'auth.test': return {'user_id': 'USENDER'}
                if method == 'conversations.history':
                    return {'messages': [{'user': 'USENDER', 'text': key, 'ts': '123.456'}]}
                raise AssertionError('stale BLOCKED must not post')
        bridge = types.SimpleNamespace(load_env=lambda: None,
            Config=types.SimpleNamespace(from_env=lambda: types.SimpleNamespace(channel='CCHANNEL')),
            Store=lambda settings: object(), Slack=Slack)
        config = {'slack': {'bridge_path': str(self.base), 'channel': 'CCHANNEL',
                            'sender': 'USENDER', 'recipient': 'UHUMAN'}}
        with mock.patch.dict(sys.modules, {'bridge': bridge}):
            dispatcher.deliver_alerts(config, state, self.state / 'alerts.json')
        self.assertEqual(alert['state'], 'delivered')
        self.assertEqual(state[f'alerts'][f'fitsy-resolved:{key}']['state'], 'pending')

    def test_other_issues_blocker_retries_while_worker_runs(self):
        state = {'active': {'id': 'live', 'issue': 351, 'stage': 'running'}}
        dispatcher.incident(state, {'issue': 385, 'id': 'claim-a'}, 'Required gate failed')
        calls = []
        class Slack:
            def __init__(self, store): pass
            def call(self, method, params=None, payload=None):
                calls.append(method)
                if method == 'auth.test': return {'user_id': 'USENDER'}
                if method == 'conversations.history': return {'messages': []}
                return {'channel': 'CCHANNEL', 'ts': '123.456'}
        bridge = types.SimpleNamespace(load_env=lambda: None,
            Config=types.SimpleNamespace(from_env=lambda: types.SimpleNamespace(channel='CCHANNEL')),
            Store=lambda settings: object(), Slack=Slack)
        config = {'slack': {'bridge_path': str(self.base), 'channel': 'CCHANNEL',
                            'sender': 'USENDER', 'recipient': 'UHUMAN'}}
        with mock.patch.dict(sys.modules, {'bridge': bridge}):
            self.assertEqual(dispatcher.tick(config, state, self.state / 'state.json', SCRIPT)['state'],
                             'uncertain-launch')
        self.assertEqual(calls.count('chat.postMessage'), 1)

    def test_claim_receipt_survives_bounded_history(self):
        state = {'active': {'id': 'claim-101'}, 'history': [{'id': str(i)} for i in range(100)]}
        claim = {'id': 'claim-101', 'issue': 385, 'ready_at': '2026-09-27T00:00:00Z',
                 'claimed_at': '2026-09-27T00:01:00Z', 'worker_profile': {'provider': 'claude'},
                 'classification': {'source': 'jev', 'model_returned': 'jev-1.13.0'}}
        dispatcher.archive(state, claim, 'verified', self.state / 'state.json')
        self.assertEqual(len(state['history']), 100)
        receipt = json.loads((self.state / 'claims/claim-101/receipt.json').read_text())
        self.assertEqual(receipt['terminal'], 'verified')
        self.assertEqual(receipt['worker_profile']['provider'], 'claude')

class ResourceRetentionTest(unittest.TestCase):
    def setUp(self):
        import resource_lifecycle
        self.resources = resource_lifecycle
        self.now = 1791201600
        self.old = '2026-09-01T00:00:00Z'

    def test_unknown_legacy_access_is_not_rewritten_as_recent(self):
        result = self.resources.retention({}, 'build_cache', {}, self.now)
        self.assertEqual(result['state'], 'unknown')

    def test_expired_unfinished_work_preserves_source(self):
        result = self.resources.retention({}, 'unfinished_checkout', {'released_at': self.old}, self.now)
        self.assertEqual(result['state'], 'assessment-due')
        self.assertIn('preserve branch, source and dirty work', result['next_action'])

    def test_durable_evidence_expires_only_to_retrievable_archive(self):
        result = self.resources.retention({}, 'durable_evidence', {'last_owner_use': self.old}, self.now)
        self.assertIn('never TTL purge', result['next_action'])

    def test_expired_generic_near_term_lease_does_not_renew_on_poll(self):
        record = {'released_at': self.old, 'near_term_lease': {
            'owner': 'ended', 'next_action': 'capture UI', 'last_owner_use': self.old}}
        first = self.resources.retention({}, 'booted_simulator', record, self.now)
        second = self.resources.retention({}, 'booted_simulator', record, self.now + 1800)
        self.assertEqual(first['state'], 'assessment-due')
        self.assertEqual(second['state'], 'assessment-due')
        self.assertEqual(record['near_term_lease']['last_owner_use'], self.old)

    def test_queued_pinned_app_survives_ttl_and_cache_budget(self):
        result = self.resources.retention({}, 'build_cache', {'last_owner_use': self.old,
            'bytes': 100 * 1024**3, 'pinned': True}, self.now)
        self.assertEqual(result['state'], 'retained')

    def test_transitive_dependency_reference_requires_live_end_consumer(self):
        edges = [('current431', 'treehouse4'), ('historical5', 'treehouse2'), ('treehouse4', 'shared')]
        self.assertEqual(self.resources.live_donors(edges, {'current431'}), {'treehouse4', 'shared'})
        self.assertNotIn('treehouse2', self.resources.live_donors(edges, {'current431'}))

    def test_seven_day_device_grace_and_unknown_release(self):
        self.assertEqual(self.resources.retention({}, 'task_simulator', {}, self.now)['state'], 'unknown')
        self.assertEqual(self.resources.retention({}, 'task_simulator', {'released_at': self.old, 'last_owner_use': self.old}, self.now)['state'], 'assessment-due')

class SimulatorUseProcessTest(unittest.TestCase):
    """Exercise the real shared-lock CLI with a disposable home and fake simctl."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / 'home'; self.home.mkdir()
        self.repo = self.root / 'repo'; (self.repo / 'scripts/sim').mkdir(parents=True)
        source = SCRIPT.parent.parent / 'sim'
        for name in ('sim', 'sim_resource_uses.py'):
            shutil.copy2(source / name, self.repo / 'scripts/sim' / name)
        self.bin = self.root / 'bin'; self.bin.mkdir()
        self.udid = '9EC11FCA-B224-4380-A91D-235ED2BBF7C4'
        xcrun = self.bin / 'xcrun'
        xcrun.write_text('#!/bin/sh\nif [ "$3" = devices ]; then echo "iPhone 16 (' + self.udid + ') (Booted)"; fi\n[ "${FAKE_SIM_FAIL:-}" != 1 ]\n')
        xcrun.chmod(0o755)
        self.env = {**os.environ, 'HOME': str(self.home), 'FITSY_SIM_OWNER': 'owner-a',
                    'PATH': str(self.bin) + ':' + os.environ['PATH']}

    def run_sim(self, *args, owner=None, fail=False):
        env = {**self.env, 'FITSY_SIM_OWNER': owner or 'owner-a'}
        if fail:
            env['FAKE_SIM_FAIL'] = '1'
        return subprocess.run(['bash', str(self.repo / 'scripts/sim/sim'), *args],
                              env=env, text=True, capture_output=True)

    def record(self):
        return json.loads((self.home / '.fitsy-sim-uses.json').read_text())['devices'][self.udid]

    def test_interrupted_atomic_claim_renewal_keeps_previous_owner_and_recovers(self):
        self.run_sim('claim'); self.run_sim('install', 'fixture.app')
        claim = self.home / '.fitsy-sim-claim.json'; before = claim.read_bytes()
        spy = self.root / 'crash-before-replace'; spy.mkdir()
        (spy / 'sitecustomize.py').write_text("import os,signal\noriginal=os.replace\ndef interrupted(src,dst):\n if str(dst).endswith('/.fitsy-sim-claim.json'):os.kill(os.getpid(),signal.SIGKILL)\n return original(src,dst)\nos.replace=interrupted\n")
        result = subprocess.run(['bash', str(self.repo / 'scripts/sim/sim'), 'claim'],
            env={**self.env, 'PYTHONPATH': str(spy)}, text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(claim.read_bytes(), before)
        self.assertEqual(self.run_sim('claim').returncode, 0)
        self.assertEqual(self.run_sim('release').returncode, 0)
        self.assertFalse(self.record()['pending_use'])
        self.assertIsNotNone(self.record()['released_at'])

    def test_malformed_legacy_claim_preserves_raw_owner_evidence_and_recovery_guidance(self):
        claim = self.home / '.fitsy-sim-claim.json'
        for raw in [b'{"owner":"owner-a","expires":', b'{}', b'[]']:
            with self.subTest(raw=raw):
                claim.write_bytes(raw)
                for args in [('claim',), ('install', 'fixture.app'), ('release',)]:
                    result = self.run_sim(*args)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('reconcile its owner', result.stderr)
                    self.assertEqual(claim.read_bytes(), raw)
                self.assertFalse((self.home / '.fitsy-sim-uses.json').exists())

    def test_actual_use_claim_renewal_and_release_survive_owner_metadata_removal(self):
        self.assertEqual(self.run_sim('claim').returncode, 0)
        self.assertEqual(self.run_sim('install', 'fixture.app').returncode, 0)
        used = self.record()['last_owner_use']
        self.assertEqual(self.run_sim('status').returncode, 0)
        self.assertEqual(self.run_sim('claim').returncode, 0)
        self.assertEqual(self.record()['last_owner_use'], used)
        self.assertEqual(self.run_sim('release').returncode, 0)
        self.assertFalse((self.home / '.fitsy-sim-claim.json').exists())
        self.assertIsNotNone(self.record()['released_at'])
        self.assertFalse(self.record()['pending_use'])

    def test_denied_other_owner_command_does_not_change_device_clock(self):
        self.run_sim('claim'); self.run_sim('install', 'fixture.app')
        before = self.record()
        self.assertNotEqual(self.run_sim('launch', 'com.fitsy', owner='other').returncode, 0)
        self.assertEqual(self.record(), before)

    def test_observer_cannot_replace_the_active_owner_clock(self):
        self.run_sim('claim'); self.run_sim('install', 'fixture.app')
        before = self.record()
        for command in ('screenshot', 'logs'):
            self.assertNotEqual(self.run_sim(command, 'observer', owner='other').returncode, 0)
            self.assertEqual(self.record(), before)
        self.run_sim('release')
        self.assertEqual(self.record()['owner'], 'owner-a')
        self.assertIsNotNone(self.record()['released_at'])

    def test_canonical_runner_handoff_records_exact_raw_command_device(self):
        runner = (SCRIPT.parent.parent / 'sim/product-flow.mjs').resolve().as_uri()
        code = "import {claimDevice,recordDeviceUse,releaseDevice} from " + json.dumps(runner) + ";"
        code += "import {execFileSync} from 'node:child_process';"
        code += "const udid=" + json.dumps(self.udid) + ";claimDevice(udid);"
        code += "execFileSync('xcrun',['simctl','install',udid,'fixture.app']);recordDeviceUse(udid);releaseDevice();"
        result = subprocess.run(['node', '--input-type=module', '-e', code], env=self.env,
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.record()['owner'], 'owner-a')
        self.assertIsNotNone(self.record()['last_owner_use'])
        self.assertIsNotNone(self.record()['released_at'])
        self.assertFalse(self.record()['pending_use'])

    def test_canonical_native_completion_crosses_one_hour_within_worker_budget(self):
        runner = (SCRIPT.parent.parent / 'sim/product-flow.mjs').resolve().as_uri()
        for budget, elapsed_minutes in [(5400, 61), (7200, 119)]:
            with self.subTest(budget=budget):
                code = 'import {claimDevice,recordDeviceUse,releaseDevice} from ' + json.dumps(runner) + ';'
                code += 'import fs from "node:fs";const udid=' + json.dumps(self.udid) + ';claimDevice(udid);'
                code += 'const file=' + json.dumps(str(self.home / '.fitsy-sim-claim.json')) + ';'
                code += 'const claim=JSON.parse(fs.readFileSync(file));'
                code += 'if(claim.expires-Date.now()/1000<' + str(budget) + ')throw new Error("lease shorter than worker budget");'
                code += 'claim.expires-=' + str(elapsed_minutes * 60) + ';fs.writeFileSync(file,JSON.stringify(claim));'
                code += 'recordDeviceUse(udid);releaseDevice();'
                result = subprocess.run(['node', '--input-type=module', '-e', code],
                    env={**self.env, 'FITSY_DISPATCH_WORKER_TIMEOUT_SECONDS': str(budget)},
                    text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse(self.record()['pending_use'])
                self.assertIsNotNone(self.record()['released_at'])

    def test_already_booted_device_reuse_records_actual_owned_use_and_release(self):
        self.assertEqual(self.run_sim('claim').returncode, 0)
        result = self.run_sim('boot')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['udid'], self.udid)
        record = self.record()
        self.assertEqual(record['owner'], 'owner-a')
        self.assertFalse(record['pending_use'])
        self.assertIsNotNone(record['last_owner_use'])
        self.assertIsNone(record['released_at'])
        self.assertEqual(self.run_sim('release').returncode, 0)
        self.assertIsNotNone(self.record()['released_at'])

    def test_repeated_completion_cannot_renew_actual_use_without_new_intent(self):
        self.run_sim('claim'); self.run_sim('use-intent', self.udid)
        self.assertEqual(self.run_sim('use-complete', self.udid).returncode, 0)
        before = self.record(); time.sleep(0.02)
        result = self.run_sim('use-complete', self.udid)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('outstanding exact device intent', result.stderr)
        self.assertEqual(self.record(), before)
        self.assertEqual(self.run_sim('use-intent', self.udid).returncode, 0)
        self.assertEqual(self.run_sim('use-complete', self.udid).returncode, 0)

    def test_completed_device_event_requires_owned_intent(self):
        self.run_sim('claim')
        self.assertNotEqual(self.run_sim('use-complete', self.udid).returncode, 0)
        self.assertNotEqual(self.run_sim('use-intent', self.udid, owner='other').returncode, 0)
        self.assertFalse((self.home / '.fitsy-sim-uses.json').exists())

    def test_claim_free_completed_command_has_bounded_owner_release(self):
        self.assertEqual(self.run_sim('install', 'fixture.app').returncode, 0)
        record = self.record()
        self.assertEqual(record['last_owner_use'], record['released_at'])
        self.assertFalse(record['pending_use'])
        self.assertFalse((self.home / '.fitsy-sim-claim.json').exists())

    def test_expired_reclaim_without_use_cannot_renew_device_release(self):
        self.run_sim('claim'); self.run_sim('install', 'fixture.app')
        before = self.record()
        path = self.home / '.fitsy-sim-claim.json'
        claim = json.loads(path.read_text()); claim['expires'] = time.time() - 1
        path.write_text(json.dumps(claim))
        self.run_sim('claim'); self.run_sim('release')
        self.assertEqual(self.record(), before)

    def test_expired_release_without_active_session_does_not_stamp_clock(self):
        self.run_sim('claim'); self.run_sim('install', 'fixture.app')
        before = self.record()
        path = self.home / '.fitsy-sim-claim.json'
        claim = json.loads(path.read_text()); claim['expires'] = time.time() - 1
        path.write_text(json.dumps(claim))
        self.run_sim('release')
        self.assertEqual(self.record(), before)

    def test_incomplete_arguments_do_not_create_a_device_action_intent(self):
        self.run_sim('claim'); self.run_sim('install', 'fixture.app')
        before = self.record()
        for args in [('install',), ('launch',), ('launch', '--url'), ('screenshot',),
                     ('logs', '--grep'), ('logs', '--grep', '['), ('logs', '--seconds')]:
            with self.subTest(args=args):
                self.assertNotEqual(self.run_sim(*args).returncode, 0)
                self.assertEqual(self.record(), before)
        self.assertEqual(self.run_sim('release').returncode, 0)
        self.assertFalse(self.record()['pending_use'])
        from sim_resource_uses import owner_release
        release = owner_release(self.home / '.fitsy-sim-uses.json', self.udid)
        self.assertEqual(release['released_at'], self.record()['released_at'])
        from resource_lifecycle import retention
        self.assertEqual(retention({}, 'task_simulator', release, time.time() + 8 * 86400)['state'],
                         'assessment-due')

    def test_empty_log_filter_completes_observation_but_log_command_failure_stays_uncertain(self):
        self.run_sim('claim'); self.run_sim('install', 'fixture.app')
        self.assertEqual(self.run_sim('logs', '--grep', 'absent-pattern').returncode, 0)
        self.assertFalse(self.record()['pending_use'])
        self.assertEqual(self.run_sim('release').returncode, 0)
        from sim_resource_uses import owner_release
        self.assertIsNotNone(owner_release(self.home / '.fitsy-sim-uses.json', self.udid)['released_at'])
        self.run_sim('claim')
        self.assertNotEqual(self.run_sim('logs', '--grep', 'absent-pattern', fail=True).returncode, 0)
        self.assertTrue(self.record()['pending_use'])
        self.run_sim('release')
        self.assertEqual(owner_release(self.home / '.fitsy-sim-uses.json', self.udid), {})

    def test_failed_action_retains_unknown_pending_use_instead_of_aging_device(self):
        self.run_sim('claim'); self.run_sim('install', 'fixture.app')
        before = self.record()['last_owner_use']
        self.assertNotEqual(self.run_sim('launch', 'com.fitsy', fail=True).returncode, 0)
        self.assertTrue(self.record()['pending_use'])
        self.assertEqual(self.record()['last_owner_use'], before)
        self.run_sim('release')
        from sim_resource_uses import owner_release
        self.assertEqual(owner_release(self.home / '.fitsy-sim-uses.json', self.udid), {})

class ClaudeDispatcherProcessTest(DispatcherProcessTest):
    """Run the same crash, race, retry and receipt fixtures with the Claude adapter."""

    def setUp(self):
        super().setUp()
        config = json.loads(self.config.read_text())
        for profile in config['profiles'].values():
            profile.update({'provider': 'claude', 'model': 'configured-claude-model',
                            'executable': str(self.claude)})
        self.config.write_text(json.dumps(config))


class QueueReadTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = {'state_dir': self.tmp.name, 'gh_bin': '/fixture/gh'}

    def page(self, ids, total=None, next_page=False, cursor=None, remaining=4000):
        return {'data': {'node': {'items': {'totalCount': len(ids) if total is None else total,
            'pageInfo': {'hasNextPage': next_page, 'endCursor': cursor},
            'nodes': [{'id': identity, 'content': {'__typename': 'Issue', 'number': n,
                'title': 'Product', 'repository': {'nameWithOwner': 'dgmolla/fitsy'},
                'labels': {'totalCount': 1, 'nodes': [{'name': 'dispatch-ready'}]}},
                **{f'f{i}': None for i in range(len(dispatcher.BOARD_FIELDS))},
                'f0': {'name': 'Queued'}, 'f1': {'name': 'Next'}} for n, identity in enumerate(ids)]}},
            'rateLimit': {'cost': 2, 'remaining': remaining, 'resetAt': '2099-01-01T00:00:00Z'}}}

    def response(self, data, code=0, headers=''):
        return subprocess.CompletedProcess([], code, headers + json.dumps(data), '')

    def test_live_queue_has_all_76_items_with_scalar_fields_and_one_page(self):
        with mock.patch.object(dispatcher.subprocess, 'run', return_value=self.response(self.page([str(n) for n in range(76)]))) as transport:
            rows = dispatcher.board(self.config)
        self.assertEqual(len(rows), 76)
        self.assertEqual(rows[0]['status'], 'Queued')
        self.assertEqual(rows[0]['labels'], ['dispatch-ready'])
        self.assertEqual(transport.call_count, 1)
        query = transport.call_args.args[0]
        self.assertIn('project=' + dispatcher.PROJECT_ID, query)
        self.assertNotIn('fieldValues(first:100)', dispatcher.BOARD_QUERY)
        self.assertNotIn('body', dispatcher.BOARD_QUERY)

    def test_more_than_100_cards_paginate_until_complete(self):
        pages = [self.response(self.page([str(n) for n in range(100)], 101, True, 'cursor')),
                 self.response(self.page(['last'], 101))]
        with mock.patch.object(dispatcher.subprocess, 'run', side_effect=pages) as transport:
            self.assertEqual(len(dispatcher.board(self.config)), 101)
        self.assertIn('after=cursor', transport.call_args.args[0])

    def test_incomplete_duplicate_drifting_and_stalled_pages_fail_closed(self):
        scenarios = [[self.page([], 2, True, 'cursor')], [self.page(['one'], 2)], [self.page(['one', 'one'])],
            [self.page(['one'], 2, True, 'cursor'), self.page(['two'], 3)],
            [self.page(['one'], 3, True, 'cursor'), self.page(['two'], 3, True, 'cursor')]]
        for pages in scenarios:
            with self.subTest(pages=pages), mock.patch.object(dispatcher.subprocess, 'run', side_effect=[self.response(p) for p in pages]):
                with self.assertRaises(RuntimeError):
                    dispatcher.board(self.config)

    def test_truncated_labels_cannot_hide_a_dispatch_hold(self):
        page = self.page(['one']); page['data']['node']['items']['nodes'][0]['content']['labels']['totalCount'] = 2
        with mock.patch.object(dispatcher.subprocess, 'run', return_value=self.response(page)):
            with self.assertRaisesRegex(RuntimeError, 'labels incomplete'):
                dispatcher.board(self.config)

    def test_quota_error_persists_exact_reset_and_no_second_network_read(self):
        failure = {'errors': [{'message': 'API rate limit exceeded'}]}
        response = self.response(failure, 1, 'HTTP/2 403\nX-Ratelimit-Remaining: 0\nX-Ratelimit-Reset: 4070908800\n\n')
        with mock.patch.object(dispatcher.subprocess, 'run', return_value=response) as transport:
            for _ in range(2):
                with self.assertRaises(dispatcher.QueueReadBackoff):
                    dispatcher.board(self.config)
        self.assertEqual(transport.call_count, 1)
        receipt = json.loads((Path(self.tmp.name) / 'github-queue-quota.json').read_text())
        self.assertEqual(receipt['retry_at'], 4070908801)
        self.assertNotIn('items', receipt)
        self.assertEqual((Path(self.tmp.name) / 'github-queue-quota.json').stat().st_mode & 0o777, 0o600)

    def test_reset_requires_a_new_live_complete_read(self):
        dispatcher.write_json(Path(self.tmp.name) / 'github-queue-quota.json', {'retry_at': 1})
        with mock.patch.object(dispatcher.subprocess, 'run', return_value=self.response(self.page(['fresh']))) as transport:
            self.assertEqual(dispatcher.board(self.config)[0]['id'], 'fresh')
        self.assertEqual(transport.call_count, 1)

    def test_retry_after_without_primary_reset_honors_server_delay(self):
        response = self.response({'message': 'Too many requests'}, 1, 'HTTP/2 429\nRetry-After: 60\n\n')
        with mock.patch.object(dispatcher.time, 'time', return_value=1000), mock.patch.object(dispatcher.subprocess, 'run', return_value=response):
            with self.assertRaises(dispatcher.QueueReadBackoff) as raised:
                dispatcher.board(self.config)
        self.assertEqual(raised.exception.retry_at, 1061)

    def test_secondary_throttle_does_not_wait_for_unexhausted_primary_reset(self):
        response = self.response({'message': 'Too many requests'}, 1,
            'HTTP/2 429\nX-RateLimit-Remaining: 4000\nX-RateLimit-Reset: 4600\nRetry-After: 60\n\n')
        with mock.patch.object(dispatcher.time, 'time', return_value=1000), mock.patch.object(dispatcher.subprocess, 'run', return_value=response):
            with self.assertRaises(dispatcher.QueueReadBackoff) as raised:
                dispatcher.board(self.config)
        self.assertEqual(raised.exception.retry_at, 1061)

    def test_non_json_429_also_suppresses_repeated_network_reads(self):
        response = subprocess.CompletedProcess([], 1, 'HTTP/2 429\n\nToo many requests', '')
        with mock.patch.object(dispatcher.time, 'time', return_value=1000), mock.patch.object(dispatcher.subprocess, 'run', return_value=response) as transport:
            for _ in range(2):
                with self.assertRaises(dispatcher.QueueReadBackoff):
                    dispatcher.board(self.config)
        self.assertEqual(transport.call_count, 1)

    def test_primary_query_cost_exhaustion_uses_reset_even_when_remaining_nonzero(self):
        response = self.response({'errors': [{'message': 'API rate limit exceeded'}]}, 1,
            'HTTP/2 403\nX-RateLimit-Remaining: 89\nX-RateLimit-Reset: 4600\n\n')
        with mock.patch.object(dispatcher.time, 'time', return_value=1000), mock.patch.object(dispatcher.subprocess, 'run', return_value=response):
            with self.assertRaises(dispatcher.QueueReadBackoff) as raised:
                dispatcher.board(self.config)
        self.assertEqual(raised.exception.retry_at, 4601)

    def test_unsupported_field_value_cannot_hide_hold_or_dependency(self):
        for field in ('f3', 'f4'):
            page = self.page(['one']); page['data']['node']['items']['nodes'][0][field] = {}
            with self.subTest(field=field), mock.patch.object(dispatcher.subprocess, 'run', return_value=self.response(page)):
                with self.assertRaisesRegex(RuntimeError, 'field type unsupported'):
                    dispatcher.board(self.config)

    def test_partial_graphql_errors_never_accept_available_cards(self):
        page = self.page(['one']); page['errors'] = [{'message': 'timeout'}]
        with mock.patch.object(dispatcher.subprocess, 'run', return_value=self.response(page)):
            with self.assertRaisesRegex(RuntimeError, 'read failed'):
                dispatcher.board(self.config)


if __name__ == '__main__':
    unittest.main()
