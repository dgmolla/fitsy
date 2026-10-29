#!/usr/bin/env python3
"""Recovery regressions through the driver, with only host/GitHub/model boundaries faked."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SOURCE = Path(__file__).parent
sys.path.insert(0, str(SOURCE))
import context
import driver
import install
import planner
from recovery import (classify_failure, repair_prompt, requeue, park, gating_failures,
                      parking_body, MAX_REQUEUES_PER_DAY, RETRIAGE_SECONDS, redact)
from taskfiles import read_task, task_files, priority_notes, migrate_notes

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
SERVICE = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
p=Path(SERVICE_PATH); s=json.loads(p.read_text())
args=sys.argv[1:]; name=Path(sys.argv[0]).name
s['calls'].append({'tool':name,'args':args,'cwd':os.getcwd()})
if name=='lockf':
    if s.get('lock_error'):
        p.write_text(json.dumps(s)); sys.stdout.write(s.get('lock_stdout',''))
        print(s['lock_error'],file=sys.stderr); sys.exit(73)
    p.write_text(json.dumps(s)); os.execvp(args[3],args[3:])
elif name=='node' and 'preview-backend.mjs' in args[0]:
    print(json.dumps({'backend':'https://candidate.example.test'}))
elif name=='node':
    status=s.get('replays',['pass']).pop(0) if s.get('replays') else 'pass'
    if status=='failure':
        print(json.dumps({'status':'fail','summary':'Maestro flow shuffle failed; inspect '+s['artifacts']}))
    elif status=='error':
        print(json.dumps({'status':'fail','summary':'CoreSimulator unavailable'}))
    else:
        print(json.dumps({'name':'mobile-e2e','status':'pass','flows':['shuffle'],'evidence':s['artifacts']}))
    p.write_text(json.dumps(s)); sys.exit(0 if status=='pass' else 1)
elif name=='codex':
    s['prompts']=s.get('prompts',[])+[sys.stdin.read()]
    if s.get('inspect_worker_env'):
        s.setdefault('worker_environment_keys',[]).append(sorted(os.environ))
        s.setdefault('worker_auth',[]).append({key:os.environ.get(key) for key in ('CODEX_HOME','OPENAI_API_KEY')})
    print('Repair completed')
elif name=='gh':
    if args[:2]==['pr','view'] and 'statusCheckRollup' in ' '.join(args):
        print(json.dumps(s['pr']))
    elif args[:2]==['pr','view']: print(s.get('dependency','OPEN'))
    elif args[:2]==['issue','list']: print('[]')
    elif args[:2]==['issue','create']: print('https://github.com/dgmolla/fitsy/issues/999')
    elif args[:1]==['api'] and '/statuses' in args[1]: print(json.dumps(s.get('statuses',[])))
    elif 'comments' in args[1] if len(args)>1 else False: print('[]')
    elif '--body-file' in args:
        s.setdefault('comments',[]).append(Path(args[args.index('--body-file')+1]).read_text())
    else: print('[]')
elif name=='ps':
    print(s.get('processes',''))
elif name=='lsof':
    print(s.get('process_cwd',''))
elif name=='pgrep':
    p.write_text(json.dumps(s)); sys.exit(1)
elif name=='xcrun':
    print(json.dumps({'devices':{'runtime':[{'udid':os.environ['FITSY_XCTEST_SIM_UDID'],'state':'Booted'}]}}))
elif name=='git':
    if args[:1]==['fetch'] and s.get('fetch_error'):
        p.write_text(json.dumps(s)); print('Temporary fetch connectivity failure',file=sys.stderr); sys.exit(75)
    p.write_text(json.dumps(s)); os.execv(os.environ['REAL_GIT'],[os.environ['REAL_GIT']]+args)
p.write_text(json.dumps(s))
'''


def failure(**changes):
    return {'sim_state': 'failure', 'free_disk_gb': 20, 'simulator_booted': True,
            'api_status': 200, 'main_passed': True, 'flow': 'shuffle',
            'step': 'assertVisible: fresh restaurant', 'assertion_failure': True,
            'logs': 'Device: expected restaurant card; assertion failed.',
            'images': ['failure.png'], 'videos': ['failure.mp4'],
            'diff_stat': ' apps/mobile/search.tsx | 2 +-', 'diff_hunks': '-old\n+new',
            'head': 'a' * 40, 'main': 'b' * 40, **changes}


class ClassificationTest(unittest.TestCase):
    def test_environment_inputs_change_classification(self):
        self.assertEqual(classify_failure(failure()), 'app_bug')
        for changed in ({'sim_state': 'error', 'free_disk_gb': 1}, {'sim_state': 'error'}, {'free_disk_gb': 1},
                        {'api_status': 503, 'missing_env': ['UPSTASH_REDIS_REST_URL']},
                        {'api_status': 503}, {'simulator_booted': False},
                        {'logs': 'UPSTASH Redis not configured'}, {'logs': 'ENOSPC'}):
            with self.subTest(changed=changed):
                self.assertEqual(classify_failure(failure(**changed)), 'env')
        self.assertEqual(classify_failure(failure(api_status=503, candidate_stack=True)), 'app_bug')

    def test_main_failure_and_rerun_are_not_candidate_bugs(self):
        self.assertEqual(classify_failure(failure(main_same_failure=True)), 'stale_test')
        self.assertEqual(classify_failure(failure(main_same_failure=True, assertion_failure=False)), 'env')
        self.assertEqual(classify_failure(failure(rerun_passed=True)), 'flaky')
        self.assertEqual(classify_failure(failure(main_passed=False)), 'unknown')

    def test_non_gating_checks_are_excluded_until_app_bug_proven(self):
        checks = {'Verify': 'FAILURE', 'AI review': 'SUCCESS', 'Vercel': 'FAILURE',
                  'Simulator': 'ERROR', 'Vercel Preview Comments': 'ERROR'}
        self.assertEqual(gating_failures(checks, 'env'), ['Verify'])
        self.assertEqual(gating_failures(checks, 'app_bug'), ['Verify', 'Vercel', 'Vercel Preview Comments'])

    def test_prompt_contains_required_context_and_fails_when_each_is_removed(self):
        ev = failure()
        tag, prompt = repair_prompt(ev, [{'strategy': 'previous', 'outcome': 'failed'}], 1, 'original task')
        for text in ('host-reproduce', 'fresh restaurant', 'failure.png', 'failure.mp4',
                     'Device: expected restaurant', 'apps/mobile/search.tsx', '-old\n+new', 'previous'):
            self.assertIn(text, prompt)
        for key in ('flow', 'step', 'images', 'logs', 'diff_stat', 'diff_hunks'):
            incomplete = {**ev, key: [] if key == 'images' else ''}
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'Missing repair evidence'):
                repair_prompt(incomplete, [], 0, 'task')
        with self.assertRaisesRegex(ValueError, 'logs'):
            repair_prompt({**ev,'logs':'  \n'}, [], 0, 'task')

    def test_parked_dependency_requeues_only_after_merge_and_preserves_history(self):
        st = {'simrepair': 3, 'fix_rounds': 5, 'reruns': 2, 'env_retries': 2}
        park(st, 'Waiting for configuration fix', failure(), 'PR#587', 'old', now=100)
        self.assertFalse(requeue(st, failure(), 'new', 'OPEN', now=1100))
        self.assertIn('blocked', st)
        self.assertTrue(requeue(st, failure(), 'newer', 'MERGED', now=2100))
        for key in ('blocked', 'simrepair', 'fix_rounds', 'reruns', 'env_retries'):
            self.assertNotIn(key, st)
        self.assertEqual([row['kind'] for row in st['attempts']], ['park', 'requeue'])

    def test_periodic_retriage_and_rolling_requeue_cap(self):
        st = {}
        park(st, 'Redis unavailable', failure(api_status=503), 'env:api-config', 'main', now=100)
        self.assertFalse(requeue(st, failure(), 'main', now=101))
        self.assertFalse(requeue(st, failure(api_status=503), 'main', now=1100))
        self.assertTrue(requeue(st, failure(), 'main', now=2100))
        st['requeues'] = [2100] * MAX_REQUEUES_PER_DAY
        park(st, 'wait', failure(api_status=503), 'env:api-config', 'main', now=2101)
        self.assertFalse(requeue(st, failure(), 'newmain', now=3200))
        self.assertTrue(requeue(st, failure(), 'newmain', now=100000))

    def test_main_advance_cannot_requeue_unchanged_environment_or_open_pr(self):
        st = {}
        ev = failure(api_status=503)
        park(st, 'env', ev, 'env:api-config', 'main', now=100)
        self.assertFalse(requeue(st, ev, 'new', now=101))
        park(st, 'dependency', ev, 'PR#587', 'main', now=100)
        self.assertFalse(requeue(st, failure(), 'new', 'CLOSED', now=101))

    def test_fixed_api_or_disk_requeues_even_while_old_simulator_error_is_visible(self):
        for old, current, condition in (
                (failure(sim_state='error',api_status=503),failure(sim_state='error',api_status=200),'env:api-config'),
                (failure(sim_state='error',free_disk_gb=1),failure(sim_state='error',free_disk_gb=20),'environment')):
            st = {'blocked_evidence': old}
            park(st,'environment recovery',old,condition,'main',now=1)
            self.assertFalse(requeue(st,old,'main',now=1000))
            self.assertTrue(requeue(st,current,'main',now=2000))

    def test_redaction_before_published_diagnostics(self):
        self.assertNotIn('private', redact('Bearer private token=private password=private'))


class DriverTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.wt = self.root / 'wt'; self.wt.mkdir()
        subprocess.run(['git', 'init', '-q', '-b', 'main', str(self.wt)], check=True)
        self.git('config', 'user.name', 'Fixture'); self.git('config', 'user.email', 'fixture@example.test')
        (self.wt / 'file.txt').write_text('baseline\n')
        self.git('add', '.'); self.git('commit', '-qm', 'baseline')
        self.git('update-ref', 'refs/remotes/origin/main', self.git('rev-parse', 'HEAD'))
        self.artifacts = self.root / 'artifacts'; self.artifacts.mkdir()
        (self.artifacts / 'failure.png').write_bytes(PNG)
        (self.artifacts / 'device.log').write_text('Device: assertion failed on restaurant card')
        (self.artifacts / 'commands-(shuffle).json').write_text(json.dumps([
            {'command': {'assertVisible': 'fresh restaurant'}, 'metadata': {'status': 'FAILED',
             'error': {'message': 'assertVisible: fresh restaurant'}}}]))
        tools = self.root / 'bin'; tools.mkdir()
        self.service = self.root / 'service.json'
        real_git = shutil.which('git')
        for tool in ('node', 'lockf', 'codex', 'gh', 'ps', 'lsof', 'pgrep', 'xcrun', 'git'):
            executable = tools / tool
            executable.write_text(SERVICE.replace('#!/usr/bin/env python3', '#!' + sys.executable)
                                  .replace('SERVICE_PATH', repr(str(self.service))))
            executable.chmod(0o700)
        self.service.write_text(json.dumps({'calls': [], 'artifacts': str(self.artifacts)}))
        self.env = {**os.environ, 'PATH': str(tools) + ':' + os.environ['PATH'],
                    'LOOP_SERVICE': str(self.service), 'FITSY_XCTEST_SIM_UDID': 'a' * 36, 'REAL_GIT': real_git}
        self.environ = mock.patch.dict(os.environ, self.env)
        self.environ.start(); self.addCleanup(self.environ.stop)
        self.patch = mock.patch.multiple(driver, L=str(self.root), ROOT=str(self.root), ENV=self.env)
        self.patch.start(); self.addCleanup(self.patch.stop)
        self.meta = {'branch': 'codex/issue-583', 'title': 'Shuffle', 'body': 'Closes #583'}
        self.ev = failure(images=[str(self.artifacts / 'failure.png')])

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.wt), *args], text=True, stderr=subprocess.PIPE).strip()

    def service_state(self, **changes):
        state = json.loads(self.service.read_text()); state.update(changes)
        self.service.write_text(json.dumps(state))
        return state

    def repair(self, st, ev=None):
        return driver.repair_sim('50583-issue-583', str(self.wt), st, {'50583-issue-583': st},
                                 ev or self.ev, self.meta, 'Implement shuffle')

    def test_model_workers_receive_only_core_environment_and_provider_auth(self):
        self.env.update(VERCEL_TOKEN='test-vercel', POSTGRES_PRISMA_URL='test-database',
                        GH_TOKEN='test-github', AWS_SECRET_ACCESS_KEY='test-cloud',
                        BASH_ENV='/untrusted/startup', ZDOTDIR='/untrusted/zsh',
                        NODE_OPTIONS='--require=/untrusted/startup.js', UNKNOWN_HOST_VAR='test-private',
                        CODEX_HOME=str(self.root / 'codex-home'), OPENAI_API_KEY='test-provider', LC_ALL='C')
        self.service_state(inspect_worker_env=True)
        for tag in ('implementation', 'sim-repair'):
            self.assertIn('Repair completed', driver.codex(str(self.wt), 'Issue-derived task', tag))
        observed = self.service_state()
        expected = sorted(set(self.env) & {'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL',
                                          'TMPDIR', 'CODEX_HOME', 'OPENAI_API_KEY'})
        # Framework Python adds this macOS runtime key after process creation.
        runtime_keys = {'__CF_USER_TEXT_ENCODING'} if sys.platform == 'darwin' else set()
        self.assertEqual([sorted(set(keys) - runtime_keys) for keys in observed['worker_environment_keys']],
                         [expected, expected])
        self.assertEqual(observed['worker_auth'],
                         [{'CODEX_HOME': self.env['CODEX_HOME'], 'OPENAI_API_KEY': 'test-provider'}] * 2)
        probe = 'import json, os; print(json.dumps([os.environ.get(k) for k in ("VERCEL_TOKEN", "POSTGRES_PRISMA_URL")]))'
        self.assertEqual(json.loads(driver.sh(shlex.join([sys.executable, '-c', probe]), cwd=str(self.wt))),
                         ['test-vercel', 'test-database'])

    def test_three_real_repair_invocations_use_distinct_prompts_and_image_attachments(self):
        st = {}
        self.service_state(replays=['pass', 'failure', 'pass', 'failure', 'pass'])
        # Baseline comparison is an actual prepared clean Git checkout, not a mocked policy.
        driver.ENV['FITSY_LOOP_MAIN_CHECKOUT'] = str(self.wt)
        self.service_state(replays=['pass', 'failure', 'pass', 'failure', 'pass', 'pass'])
        for _ in range(3):
            self.assertEqual(self.repair(st), 'fixed')
        state = self.service_state()
        self.assertEqual(len(state['prompts']), 3)
        for prompt, expected in zip(state['prompts'], ('targeted', 'host-reproduce', 'compare-main')):
            self.assertIn(f'Strategy [{expected}]', prompt)
            self.assertIn('Never skip or disable flows', prompt)
        invocations = [call for call in state['calls'] if call['tool'] == 'codex']
        self.assertEqual(len(invocations), 3)
        for invocation in invocations:
            self.assertIn('--image', invocation['args'])
            self.assertEqual(invocation['args'][invocation['args'].index('-s') + 1], 'workspace-write')
        tags = sorted(path.name for path in self.root.glob('*simfix*.prompt'))
        self.assertTrue(any('targeted' in tag for tag in tags))
        self.assertTrue(any('host-reproduce' in tag for tag in tags))
        self.assertTrue(any('compare-main' in tag for tag in tags))
        host = [call['args'] for call in state['calls'] if call['tool'] == 'lockf']
        self.assertTrue(host)
        self.assertTrue(all(args[:3] == ['-t', '3600', str(self.root / 'sim.lock')] for args in host))

    def test_sim_error_never_calls_codex_and_parking_is_visible_and_deduplicated(self):
        st = {'pr': 585}
        self.service_state(replays=['error'])
        self.assertEqual(self.repair(st, failure(sim_state='error', free_disk_gb=1)), 'blocked')
        state = self.service_state()
        self.assertFalse(any(call['tool'] == 'codex' for call in state['calls']))
        self.assertEqual(len(state['comments']), 2)
        self.assertIn('Triage: env', state['comments'][0])
        self.assertIn('CoreSimulator unavailable', st['blocked'])
        driver.notify_park('50583-issue-583', st, self.ev, self.meta)
        self.assertEqual(len(self.service_state()['comments']), 2)

    def test_host_failure_after_fix_prevents_push_and_keeps_pending_validation(self):
        st = {}
        self.service_state(replays=['error'])
        self.assertEqual(self.repair(st), 'blocked')
        self.assertTrue(st['needs_local_validation'])
        self.assertFalse(any(call['tool'] == 'git' and 'push' in call['args'] for call in self.service_state()['calls']))

    def test_missing_media_stops_before_code_repair(self):
        st = {}
        self.assertEqual(self.repair(st, failure(images=[], videos=[])), 'blocked')
        self.assertIn('attached failure', st['blocked'])
        self.assertFalse(any(call['tool'] == 'codex' for call in self.service_state()['calls']))

    def test_flaky_rerun_files_one_issue_and_never_invokes_code_repair(self):
        st = {}
        self.assertEqual(self.repair(st, failure(rerun_passed=True)), 'retry')
        self.assertEqual(self.repair(st, failure(rerun_passed=True)), 'retry')
        calls = self.service_state()['calls']
        self.assertEqual(len([call for call in calls if call['tool']=='gh' and call['args'][:2]==['issue','create']]), 1)
        self.assertFalse(any(call['tool']=='codex' for call in calls))
        self.assertEqual(st['reruns'], 2)
        self.assertEqual(self.repair(st, failure(rerun_passed=True)), 'blocked')

    def test_sim_scope_and_simulator_gates_fail_closed_without_skip_fallbacks(self):
        self.service_state(statuses=[])
        self.assertEqual(driver.sim_gate(585,'a'*40)[0], 'wait')
        statuses=[{'context':'Sim scope','state':'success','description':'scope=full'},
                  {'context':'Simulator','state':'error','description':'runner failed'}]
        self.service_state(statuses=statuses)
        self.assertEqual(driver.sim_gate(585,'a'*40)[0], 'env')
        statuses[1]['state']='failure'
        self.service_state(statuses=statuses)
        self.assertEqual(driver.sim_gate(585,'a'*40)[0], 'fail')
        statuses[1]['state']='success'
        self.service_state(statuses=statuses)
        self.assertEqual(driver.sim_gate(585,'a'*40)[0], 'ok')

    def test_parking_counts_actual_rounds_and_preserves_counts_on_requeue(self):
        st = {'simrepair':3,'fix_rounds':5}
        park(st,'8 check rounds without all required gates green.',self.ev,'PR#587','old',now=1)
        body = parking_body('50583-issue-583',st,self.ev)
        self.assertIn('8 check rounds',body)
        self.assertIn('3 simulator repairs; 5 general fix rounds',body)
        self.assertTrue(requeue(st,self.ev,'new','MERGED',now=1000))
        self.assertEqual(st['attempts'][0]['simrepair'],3)
        self.assertEqual(st['attempts'][0]['fix_rounds'],5)

    def test_non_task_markdown_is_skipped_at_actual_task_entrypoint(self):
        path = self.root / 'NOTES-priority.md'; path.write_text('#583 BEFORE #547\n')
        st = {}
        self.assertEqual(driver.run_task(str(path), st), 'skipped')
        self.assertEqual(st, {})
        self.assertNotIn('ERROR', (self.root / 'driver.log').read_text())

    def test_existing_and_frontmatter_tasks_and_priority_note_migration(self):
        directory = self.root / 'tasks'; directory.mkdir()
        for number, header in ((547, ''), (583, '---\n')):
            (directory / f'5{number}-issue-{number}.md').write_text(
                header + f'branch: codex/issue-{number}\ntitle: Task\n---\nImplement this task.\n')
        note = directory / 'NOTES-priority.md'; note.write_text('Do shuffle (#583) BEFORE the widget (#547).\n')
        (directory / 'README.md').write_text('No frontmatter here\n')
        self.assertEqual([Path(path).stem for path in task_files(directory)], ['5583-issue-583', '5547-issue-547'])
        migrate_notes(directory)
        self.assertFalse(note.exists())
        self.assertTrue((directory / 'notes/NOTES-priority.md').exists())
        self.assertIn('#583', priority_notes(directory))
        self.assertEqual(len(task_files(directory)), 2)
        for body in ('branch: test\ntitle: Bad\nNo separator', '---\ntitle: Missing branch\n---\nTask',
                     '---\nbranch: bad;command\ntitle: bad\n---\nTask'):
            bad = directory / 'bad.md'; bad.write_text(body)
            self.assertIsNone(read_task(bad))

    def test_replay_pr585_raw_driver_sequence_triages_environment_without_code_repairs(self):
        import ast
        raw = (SOURCE / 'fixtures/pr-585.log').read_text()
        self.assertIn('NOTES-priority ERROR list index out of range', raw)
        self.assertIn('19:37:51 50583-issue-583 BLOCKED', raw)
        checks = [ast.literal_eval(line.split('checks ', 1)[1].split('} ', 1)[0] + '}')
                  for line in raw.splitlines() if ' checks {' in line]
        st = {'pr': 585}
        for check in checks:
            if check['Simulator'] not in ('ERROR', 'FAILURE'):
                continue
            ev = failure(sim_state=check['Simulator'].lower(), api_status=503,
                         missing_env=['UPSTASH_REDIS_REST_URL'], logs='Missing Upstash env configuration')
            self.service_state(replays=['error'])
            self.assertEqual(self.repair(st, ev), 'blocked')
        self.assertEqual(st['triage'], 'env')
        self.assertTrue(any(row['kind'] == 'environment-replay' for row in st['attempts']))
        self.assertFalse(any(call['tool'] == 'codex' for call in self.service_state()['calls']))
        self.assertIn('Delivery stopped', self.service_state()['comments'][0])

    def test_environment_retriage_uses_real_dependency_state_and_resets_counters(self):
        tasks = self.root / 'tasks'; tasks.mkdir()
        task = tasks / '50583-issue-583.md'
        task.write_text('---\nbranch: codex/issue-583\ntitle: Shuffle\n---\nImplement task\n')
        # The driver's standard source lookup is a real checkout.
        (self.root / 'wt3').symlink_to(self.wt, target_is_directory=True)
        st = {'simrepair': 3, 'fix_rounds': 5}
        park(st, 'dependency', self.ev, 'PR#587', 'old', now=1)
        s = {'50583-issue-583': st}
        driver.retriage([str(task)], s)
        self.assertIn('blocked', st)
        self.service_state(dependency='MERGED')
        st['triaged_at'] = 0
        driver.retriage([str(task)], s)
        self.assertNotIn('blocked', st)
        self.assertNotIn('simrepair', st)
        self.assertNotIn('fix_rounds', st)

    def test_failed_initial_fetch_recovers_preparation_before_worktree_exists(self):
        task, s = self.task_checkout(simrepair=3, fix_rounds=5, reruns=2, env_retries=2,
                                     attempts=[{'kind': 'code-repair', 'strategy': 'targeted'}])
        task.write_text('---\nbranch: codex/issue-583\ntitle: Shuffle\npr: 585\n---\nImplement shuffle\n')
        wt = self.root / 'loop' / ('wt-' + task.stem)
        wt.unlink()
        self.service_state(fetch_error=True)
        self.assertEqual(driver.run_task(str(task), s), 'blocked')
        st = s[task.stem]
        self.assertEqual(st['blocked_on'], 'env:preparation')
        self.assertFalse(wt.exists())
        st['triaged_at'] = 0
        driver.retriage([str(task)], s)
        self.assertIn('blocked', st)
        self.assertFalse(wt.exists())
        self.assertEqual(st['simrepair'], 3)
        fetches = lambda: [call for call in self.service_state()['calls']
                           if call['tool'] == 'git' and call['args'][:1] == ['fetch']]
        count = len(fetches())
        driver.retriage([str(task)], s)
        self.assertEqual(len(fetches()), count, 'Failed prerequisites must respect the re-triage interval')
        self.service_state(fetch_error=False)
        st['triaged_at'] = 0
        driver.retriage([str(task)], s)
        self.assertTrue((wt / 'file.txt').is_file())
        self.assertEqual(subprocess.check_output([self.env['REAL_GIT'], '-C', str(wt),
                                                 'branch', '--show-current'], text=True).strip(), 'codex/issue-583')
        for key in ('blocked', 'simrepair', 'fix_rounds', 'reruns', 'env_retries'):
            self.assertNotIn(key, st)
        self.assertEqual([row['outcome'] for row in st['attempts'] if row['kind'] == 'preparation-retriage'],
                         ['error', 'ready'])
        self.assertEqual(st['attempts'][0]['strategy'], 'targeted')
        self.assertTrue(all(Path(call['cwd']).resolve() == self.wt.resolve() for call in fetches()))
        self.assertFalse(any(call['tool'] == 'codex' for call in self.service_state()['calls']))

    def test_legacy_preparation_failure_requeues_without_worktree(self):
        task, s = self.task_checkout(simrepair=3, fix_rounds=5)
        wt = self.root / 'loop' / ('wt-' + task.stem)
        wt.unlink()
        task.write_text('---\nbranch: codex/issue-583\ntitle: Shuffle\n---\nImplement shuffle\n')
        st = s[task.stem]
        st.pop('pr')
        park(st, 'Worker execution stopped: git fetch failed', {'sim_state': 'error'},
             'environment', self.git('rev-parse', 'HEAD'), now=1)
        driver.retriage([str(task)], s)
        self.assertNotIn('blocked', st)
        self.assertNotIn('simrepair', st)
        self.assertNotIn('fix_rounds', st)
        self.assertTrue((wt / 'file.txt').is_file())

    def test_missing_worktree_does_not_clear_an_unrelated_source_blocker(self):
        task, s = self.task_checkout()
        wt = self.root / 'loop' / ('wt-' + task.stem)
        wt.unlink()
        st = s[task.stem]
        st['blocked_evidence'] = self.ev
        park(st, 'Application repair needed', self.ev, 'source', self.git('rev-parse', 'HEAD'), now=1)
        driver.retriage([str(task)], s)
        self.assertEqual(st['blocked_on'], 'source')
        self.assertIn('blocked', st)
        self.assertFalse(wt.exists())

    def test_environment_retriage_probes_recovery_while_simulator_status_is_stale(self):
        task, s = self.task_checkout(simrepair=3, fix_rounds=5)
        name = task.stem
        st = s[name]
        head = self.git('rev-parse', 'HEAD')
        artifacts = self.root / 'sim-review/evidence' / head[:12]
        shutil.copytree(self.artifacts, artifacts)
        ev = failure(head=head, main=head, sim_state='error', api_status=200,
                     logs='Redis not configured')
        st['blocked_evidence'] = ev
        park(st, 'Restore runner configuration', ev, 'environment', head, now=1)
        self.service_state(replays=['error', 'pass', 'pass'])
        with mock.patch('urllib.request.urlopen') as health:
            health.return_value.__enter__.return_value.status = 200
            driver.retriage([str(task)], s)
            self.assertIn('blocked', st)
            self.assertEqual(st['simrepair'], 3)
            pr = self.service_state()['pr']
            pr['headRefOid'] = 'b' * 40
            self.service_state(pr=pr)
            st['triaged_at'] = 0
            driver.retriage([str(task)], s)
            self.assertIn('blocked', st)
            pr['headRefOid'] = head
            self.service_state(pr=pr)
            st['triaged_at'] = 0
            driver.retriage([str(task)], s)
        self.assertNotIn('blocked', st)
        self.assertNotIn('simrepair', st)
        self.assertNotIn('fix_rounds', st)
        self.assertEqual([row['outcome'] for row in st['attempts'] if row['kind']=='environment-retriage'],
                         ['error', 'pass', 'pass'])
        self.assertFalse(any(call['tool']=='codex' for call in self.service_state()['calls']))

    def test_preparing_baseline_requeues_unknown_failure_without_main_advancing(self):
        task, s = self.task_checkout()
        st = s[task.stem]
        main = self.git('rev-parse', 'origin/main')
        (self.wt / 'candidate.txt').write_text('candidate change\n')
        self.git('add', '.'); self.git('commit', '-qm', 'candidate')
        head = self.git('rev-parse', 'HEAD')
        shutil.copytree(self.artifacts, self.root / 'sim-review/evidence' / head[:12])
        ev = failure(head=head, main=main, main_passed=False)
        self.service_state(replays=['failure'])
        self.assertEqual(self.repair(st, ev), 'blocked')
        self.assertEqual(st['blocked_on'], 'baseline')
        baseline = self.root / 'baseline'
        subprocess.run([self.env['REAL_GIT'], 'clone', '-q', str(self.wt), str(baseline)], check=True)
        subprocess.run([self.env['REAL_GIT'], '-C', str(baseline), 'checkout', '-q', main], check=True)
        driver.ENV['FITSY_LOOP_MAIN_CHECKOUT'] = str(baseline)
        pr = self.service_state()['pr']
        pr['headRefOid'] = head
        pr['statusCheckRollup'][2]['conclusion'] = 'FAILURE'
        self.service_state(pr=pr, replays=['pass'])
        st['triaged_at'] = 0
        with mock.patch('urllib.request.urlopen') as health:
            health.return_value.__enter__.return_value.status = 200
            driver.retriage([str(task)], s)
        self.assertNotIn('blocked', st)
        self.assertEqual(st['parked_main'], main)
        self.assertEqual(st['triaged_main'], main)
        self.assertFalse(any(call['tool']=='codex' for call in self.service_state()['calls']))

    def test_artifact_reader_extracts_failed_maestro_step_media_and_device_logs(self):
        ev = context.local_artifacts(self.artifacts)
        self.assertEqual(ev['flow'], 'shuffle')
        self.assertEqual(ev['step'], 'assertVisible: fresh restaurant')
        self.assertEqual(ev['images'], [str(self.artifacts / 'failure.png')])
        self.assertIn('Device: assertion failed', ev['logs'])

    def test_host_preflight_failure_cannot_be_misreported_as_app_bug_or_pass(self):
        self.service_state(replays=['error'])
        result = context.host_replay(str(self.wt), self.root / 'sim.lock', self.ev, self.env)
        self.assertEqual(result['status'], 'error')
        self.service_state(replays=['failure'])
        result = context.host_replay(str(self.wt), self.root / 'sim.lock', self.ev, self.env)
        self.assertEqual(result['status'], 'failure')
        self.assertIn('assertVisible', result['step'])
        calls = self.service_state()['calls']
        node = [call for call in calls if call['tool'] == 'node' and 'ci.mjs' in call['args'][0]]
        self.assertTrue(all('--scope=changed' in call['args'] for call in node))
        self.assertTrue(all(not any(arg.startswith('--flows=') for arg in call['args']) for call in node))

    def test_empty_replay_stdout_returns_redacted_environment_error(self):
        for output in ('', ' \n'):
            with self.subTest(stdout=output):
                self.service_state(lock_error='lockf: sim.lock: permission denied token=test-private',
                                   lock_stdout=output)
                result = context.host_replay(str(self.wt), self.root / 'sim.lock', self.ev, self.env)
                self.assertEqual(result['status'], 'error')
                self.assertEqual(result['exit_code'], 73)
                self.assertEqual(result['head'], self.git('rev-parse', 'HEAD'))
                self.assertIn('sim.lock: permission denied', result['logs'])
                self.assertIn('73', result['logs'])
                self.assertNotIn('test-private', result['logs'])

    def test_empty_replay_during_retriage_does_not_stop_other_tasks(self):
        task, s = self.task_checkout()
        st = s[task.stem]
        ev = failure(sim_state='error')
        st['blocked_evidence'] = ev
        park(st, 'Restore runner configuration', ev, 'environment', self.git('rev-parse', 'HEAD'), now=1)
        dependency = task.with_name('50601-issue-601.md')
        dependency.write_text('---\nbranch: codex/issue-601\ntitle: Dependency\n---\nImplement task\n')
        s[dependency.stem] = {'simrepair': 3}
        park(s[dependency.stem], 'Wait for dependency', ev, 'PR#587', self.git('rev-parse', 'HEAD'), now=1)
        self.service_state(lock_error='lockf: sim.lock: permission denied token=test-private', dependency='MERGED')
        with mock.patch('urllib.request.urlopen') as health:
            health.return_value.__enter__.return_value.status = 200
            driver.retriage([str(task), str(dependency)], s)
        self.assertIn('blocked', st)
        replay = next(row for row in st['attempts'] if row['kind'] == 'environment-retriage')
        self.assertEqual(replay['outcome'], 'error')
        self.assertIn('sim.lock: permission denied', replay['logs'])
        self.assertNotIn('test-private', replay['logs'])
        self.assertNotIn('blocked', s[dependency.stem])
        self.assertNotIn('simrepair', s[dependency.stem])

    def test_planner_receives_priority_notes_and_creates_valid_frontmatter(self):
        tasks = self.root / 'tasks'; (tasks / 'notes').mkdir(parents=True)
        (tasks / 'notes/priority.md').write_text('order: #608 > #583 > #547\n')
        # Only the external GitHub transport and model invocation are replaced.
        issues = [{'number': 608, 'title': 'Sandbox recovery', 'labels': [], 'body': 'Fix entitlement'}]
        def github(args):
            return json.dumps(issues) if args.startswith('issue list') else 'issue body'
        original = subprocess.run
        prompts = []
        def model(args, **kwargs):
            if isinstance(args, list) and args[:2] == ['codex', 'exec']:
                prompts.append(kwargs['input'])
                Path(args[args.index('-o') + 1]).write_text(json.dumps({'issue': 608, 'lane': 'backend', 'reason': 'priority note'}))
                return subprocess.CompletedProcess(args, 0)
            return original(args, **kwargs)
        with mock.patch.object(planner, 'L', str(self.root)), mock.patch.object(planner, 'gh', github), mock.patch('subprocess.run', model):
            picked = planner.pick({}, set())
            path = planner.make_task(*picked)
        self.assertIn('order: #608 > #583 > #547', prompts[0])
        self.assertEqual(read_task(path)[0]['branch'], 'codex/issue-608')
        self.assertTrue(Path(path).read_text().startswith('---\n'))

    def test_install_preserves_state_and_old_caller_consumes_recovery(self):
        host = self.root / 'loop'; (host / 'tasks').mkdir(parents=True)
        original = '# original driver\n'
        (host / 'driver.py').write_text(original)
        state = {'_planner_off': True}
        (host / 'state.json').write_text(json.dumps(state))
        (host / 'tasks/NOTES-priority.md').write_text('#583 before #547\n')
        (self.root / 'wt3').symlink_to(self.wt, target_is_directory=True)
        plan = install.install(host)
        self.assertEqual(plan['status'], 'planned')
        self.assertEqual((host / 'driver.py').read_text(), original)
        receipt = install.install(host, apply=True)
        self.assertEqual(receipt['status'], 'installed')
        result = subprocess.run([sys.executable, '-B', str(host / 'driver.py')],
                                env={**self.env, 'FITSY_LOOP_ROOT': str(self.root)}, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((host / 'tasks/notes/NOTES-priority.md').exists())
        self.assertEqual(json.loads((host / 'state.json').read_text()), state)
        self.assertIn('ALL DONE', (host / 'driver.log').read_text())
        self.assertTrue(list(host.glob('driver.py.*.bak')))
        self.assertEqual(json.loads((host / 'source-receipt.json').read_text())['source'], plan['source'])
        self.assertFalse(any(call['tool'] == 'codex' for call in self.service_state()['calls']))
        progress = subprocess.run([sys.executable,'-B',str(host/'progress.py')],env=self.env,text=True,capture_output=True,timeout=10)
        self.assertEqual(progress.returncode,0,progress.stderr)
        self.assertNotIn('NOTES-priority:',(self.root/'loop-progress.md').read_text())

    def test_installer_refuses_an_active_owner(self):
        import fcntl
        host = self.root / 'loop'; (host / 'tasks').mkdir(parents=True)
        (host / 'driver.py').write_text('original')
        with (host / 'driver.lock').open('a') as owner:
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(ValueError, 'owner is active'):
                install.install(host, apply=True)
        self.assertEqual((host / 'driver.py').read_text(), 'original')

    def task_checkout(self, **st):
        host = self.root / 'loop'; (host / 'tasks').mkdir(parents=True)
        task = host / 'tasks/50583-issue-583.md'
        task.write_text('---\nbranch: main\ntitle: Shuffle\npr: 585\n---\nImplement shuffle\n')
        (host / 'wt-50583-issue-583').symlink_to(self.wt, target_is_directory=True)
        (self.root / 'wt3').symlink_to(self.wt, target_is_directory=True)
        remote = self.root / 'origin.git'
        subprocess.run([self.env['REAL_GIT'], 'init', '--bare', '-q', str(remote)], check=True)
        self.git('remote', 'add', 'origin', str(remote))
        self.git('push', '-q', '-u', 'origin', 'main')
        self.service_state(calls=[], replays=['error'], pr={'headRefOid': self.git('rev-parse', 'HEAD'),
            'state':'OPEN', 'mergeStateStatus':'UNSTABLE', 'statusCheckRollup':[
            {'name':name,'conclusion':value,'status':'COMPLETED'} for name,value in
            [('Verify','SUCCESS'),('AI review','SUCCESS'),('Simulator','ERROR'),('Vercel','FAILURE')]]})
        return task, {'50583-issue-583': {'implemented':1,'pr':585,**st}}

    def test_actual_driver_error_status_never_enters_general_or_sim_code_fix(self):
        task, s = self.task_checkout()
        import io
        import urllib.error
        unavailable = urllib.error.HTTPError('https://candidate.example.test/api/health',503,'Unavailable',{},
                                             io.BytesIO(b'Missing Upstash env configuration'))
        with mock.patch('time.sleep'), mock.patch('urllib.request.urlopen', side_effect=unavailable):
            self.assertEqual(driver.run_task(str(task), s), 'blocked')
        self.assertEqual(s['50583-issue-583']['triage'], 'env')
        self.assertNotIn('fix_rounds', s['50583-issue-583'])
        self.assertFalse(any(call['tool']=='codex' for call in self.service_state()['calls']))

    def test_actual_driver_cannot_push_a_pending_repair_without_local_pass(self):
        task, s = self.task_checkout(needs_local_validation=True)
        with mock.patch('time.sleep'):
            self.assertEqual(driver.run_task(str(task), s), 'blocked')
        calls = self.service_state()['calls']
        self.assertFalse(any(call['tool']=='git' and 'push' in call['args'] for call in calls))
        self.assertTrue(s['50583-issue-583']['needs_local_validation'])

    def test_requeued_repair_revalidates_after_merging_new_source_before_push(self):
        task, s = self.task_checkout(needs_local_validation=True, simrepair=2)
        st = s[task.stem]
        base = self.git('rev-parse', 'HEAD')
        (self.wt / 'main-update.txt').write_text('new main source\n')
        self.git('add', '.'); self.git('commit', '-qm', 'advance main')
        self.git('push', '-q', 'origin', 'main')
        advanced = self.git('rev-parse', 'HEAD')
        self.git('reset', '--hard', base)
        park(st, 'Wait for dependency', self.ev, 'PR#587', base, now=1)
        self.assertTrue(requeue(st, self.ev, base, 'MERGED', now=1000))
        self.assertNotIn('simrepair', st)
        pr = self.service_state()['pr']
        pr['headRefOid'] = advanced
        self.service_state(calls=[], replays=['pass', 'error'], pr=pr, dependency='MERGED')
        with mock.patch('time.sleep'), self.assertRaisesRegex(RuntimeError, 'Current-source local Maestro pass'):
            driver.run_task(str(task), s)
        self.assertTrue((self.wt / 'main-update.txt').exists())
        self.assertTrue(st['needs_local_validation'])
        self.assertFalse(any(call['tool']=='git' and 'push' in call['args'] for call in self.service_state()['calls']))
        self.assertEqual(st['attempts'][-1]['kind'], 'pre-push-validation')


if __name__ == '__main__':
    unittest.main()
