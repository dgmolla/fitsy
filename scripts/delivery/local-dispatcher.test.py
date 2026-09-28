"""Process-level dispatcher checks with a disposable Git repository and fake transports."""

import json
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
 if a[:2]==['project','item-list']:
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
            'min_free_bytes': 1, 'worker_timeout_seconds': 10}))
        self.config.chmod(0o600)
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
                             {'terminal': 'verified', 'issue': 412, 'id': claim_id,
                              'branch': 'issue-412', 'worktree': str(worktree)}]}
        path = self.state / 'state.json'
        with mock.patch.object(dispatcher, 'retire_task_device', return_value={
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
            state['history'].append({'terminal': 'verified', 'id': claim_id, 'issue': issue,
                                     'branch': branch, 'worktree': str(worktree)})
        config = json.loads(self.config.read_text())
        path = self.state / 'state.json'
        def attempt(**kwargs):
            if kwargs['issue'] == 412:
                raise ValueError('device is booted')
            return {'freeBeforeBytes': 100, 'freeAfterBytes': 200}
        with mock.patch.object(dispatcher, 'retire_task_device', side_effect=attempt) as retire:
            dispatcher.retire_verified_simulator(config, state, path)
            self.assertEqual(state['simulator_retirement'][udids[0]]['status'], 'held')
            dispatcher.retire_verified_simulator(config, state, path)
            self.assertEqual(state['simulator_retirement'][udids[1]]['status'], 'retired')
            self.assertEqual([call.kwargs['issue'] for call in retire.call_args_list], [412, 413])

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

class ClaudeDispatcherProcessTest(DispatcherProcessTest):
    """Run the same crash, race, retry and receipt fixtures with the Claude adapter."""

    def setUp(self):
        super().setUp()
        config = json.loads(self.config.read_text())
        for profile in config['profiles'].values():
            profile.update({'provider': 'claude', 'model': 'configured-claude-model',
                            'executable': str(self.claude)})
        self.config.write_text(json.dumps(config))


if __name__ == '__main__':
    unittest.main()
