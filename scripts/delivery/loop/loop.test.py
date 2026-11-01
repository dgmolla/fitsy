#!/usr/bin/env python3
"""Recovery regressions through the driver, with only host/GitHub/model boundaries faked."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

SOURCE = Path(__file__).parent
# Driver fixtures run without a real simulator host; PreflightTest covers the check.
os.environ['FITSY_LOOP_FIXTURE_SKIP_PREFLIGHT'] = '1'
sys.path.insert(0, str(SOURCE))
import context
import driver
import host
import install
import planner
from lifecycle import Lifecycle
from recovery import (classify_failure, repair_prompt, requeue, park, gating_failures,
                      parking_body, MAX_REQUEUES_PER_DAY, RETRIAGE_SECONDS, redact)
from taskfiles import read_task, task_files, priority_notes, migrate_notes

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
SERVICE = '''#!/usr/bin/env python3
import json, os, subprocess, sys
from pathlib import Path
p=Path(SERVICE_PATH); s=json.loads(p.read_text())
args=sys.argv[1:]; name=Path(sys.argv[0]).name
s['calls'].append({'tool':name,'args':args,'cwd':os.getcwd()})
if name=='lockf':
    if s.get('lock_error'):
        p.write_text(json.dumps(s)); sys.stdout.write(s.get('lock_stdout',''))
        print(s['lock_error'],file=sys.stderr); sys.exit(73)
    p.write_text(json.dumps(s)); os.execvp(args[3],args[3:])
elif name=='sandbox-exec':
    s.setdefault('sandbox_profiles',[]).append(Path(args[1]).read_text())
    p.write_text(json.dumps(s))
    if s.get('sandbox_error'): print(s['sandbox_error'],file=sys.stderr); sys.exit(71)
    if s.get('sandbox_signal'):
        import resource
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.kill(os.getpid(), s['sandbox_signal'])
    os.execvp(args[2],args[2:])
elif name=='node' and 'preview-backend.mjs' in args[0]:
    s.setdefault('backend_environment_keys',[]).append(sorted(os.environ))
    if s.get('real_selector'):
        p.write_text(json.dumps(s)); os.execv(s['real_node'],[s['real_node']]+args)
    print(json.dumps({'backend':'https://candidate.example.test', 'deployment':{'id':'dpl_fixture'}}))
elif name=='node' and '--plan' in args:
    if s.get('real_plan'):
        p.write_text(json.dumps(s)); os.execv(s['real_node'],[s['real_node']]+args)
    required=s.get('native_required',True)
    print(json.dumps({'required':required, 'scope':'flow' if required else 'none', 'flows':['shuffle'] if required else []}))
elif name=='node' and args[0].endswith('/scripts/verify/run.mjs'):
    p.write_text(json.dumps(s)); os.execv(s['real_node'],[s['real_node']]+args)
elif name=='node':
    s.setdefault('native_environment_keys',[]).append(sorted(os.environ))
    status=s.get('replays',['pass']).pop(0) if s.get('replays') else 'pass'
    if status=='failure':
        print(json.dumps({'status':'fail','summary':'Maestro flow shuffle failed; inspect '+s['artifacts']}))
    elif status=='error':
        print(json.dumps({'status':'fail','summary':'CoreSimulator unavailable'}))
    else:
        print(json.dumps({'name':'mobile-e2e','status':'pass','flows':['shuffle'],'evidence':s['artifacts']}))
    if s.get('change_source_during_replay'):
        Path(s['candidate'],'file.txt').write_text('Changed while Maestro was running')
    p.write_text(json.dumps(s)); sys.exit(0 if status=='pass' else 1)
elif name=='codex':
    s['prompts']=s.get('prompts',[])+[sys.stdin.read()]
    if s.get('inspect_worker_env'):
        s.setdefault('worker_environment_keys',[]).append(sorted(os.environ))
        s.setdefault('worker_auth',[]).append({key:os.environ.get(key) for key in ('CODEX_HOME','OPENAI_API_KEY')})
    if s.get('edit_mobile'):
        target=Path(args[args.index('-C')+1])/'apps/mobile/components/ShuffleButton.tsx'; target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text('export const enabled = true;\\n'); s['native_required']=True
    if s.get('after_worker_pr'): s['pr']=s['after_worker_pr']
    print('Repair completed')
elif name=='gh':
    if args[:2]==['pr','view'] and 'statusCheckRollup' in ' '.join(args):
        if s.get('live_pr_head'):
            s['pr']['headRefOid']=subprocess.check_output([s['real_git'],'-C',s['candidate'],'rev-parse','HEAD'],text=True).strip()
        print(json.dumps(s['pr']))
    elif args[:2]==['pr','view']: print(s.get('dependency','OPEN'))
    elif args[:2]==['issue','list']: print('[]')
    elif args[:2]==['issue','create']: print('https://github.com/dgmolla/fitsy/issues/999')
    elif args[:1]==['api'] and '/pulls?' in args[1]: print(json.dumps(s.get('open_prs',[])))
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
    if 'push' in args and s.get('push_error'):
        s['push_error']=False; p.write_text(json.dumps(s)); print('Focused native check failed',file=sys.stderr); sys.exit(1)
    p.write_text(json.dumps(s)); os.execv(s['real_git'],[s['real_git']]+args)
elif name=='vercel': print(json.dumps(s['deployment']))
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

    def test_git_pre_push_signal_requires_host_recovery(self):
        for number in (6, 9, 11, 15):
            with self.subTest(signal=number):
                logs = (f'error: /private/tmp/fitsy-loop-publish-test/pre-push died of signal {number}\n'
                        "error: failed to push some refs to 'github.com:dgmolla/fitsy.git'\n")
                self.assertEqual(classify_failure({'logs': logs}), 'env')
                self.assertEqual(classify_failure(failure(logs=logs)), 'env')
        for logs in ('error: /private/tmp/pre-commit died of signal 6',
                     'Assertion failed: pre-push died of signal 6',
                     'error: /private/tmp/pre-push exited with code 1'):
            with self.subTest(logs=logs):
                self.assertEqual(classify_failure(failure(logs=logs)), 'app_bug')

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


class LifecycleTest(unittest.TestCase):
    # Exercise the real scheduler, scanner, threads, waits, signals and owner lock.
    # Only GitHub re-triage, planning and the task worker are external fixtures.
    PROCESS = '''
import json, os, sys, time
from pathlib import Path
config=json.loads(sys.argv[1]); sys.path.insert(0,config['source'])
import driver, planner
loop=Path(driver.L)
scan=driver.task_files
def task_files(*args):
    with (loop/'scans').open('a') as output: output.write('.')
    return scan(*args)
def execute_task(path,state):
    with (loop/'started').open('a') as output: print(Path(path).stem,file=output)
    while (loop/'hold').exists() and not (loop/'release').exists(): time.sleep(0.01)
    state.setdefault(Path(path).stem,{})['done']=1; driver.save(state)
    with (loop/'completed').open('a') as output: print(Path(path).stem,file=output)
def pick(*args):
    with (loop/'picks').open('a') as output: output.write('.')
    return config.get('planner_result')
driver.task_files=task_files; driver.execute_task=execute_task
def preflight_check(*args):
    if config.get('preflight') and not (loop/'preflight-ok').exists(): return config['preflight']
    return []
driver.preflight.check=preflight_check
driver.retriage=lambda *args: None; planner.pick=pick
if config.get('install_error'):
    def merged_source(*args): raise OSError('Fetch unavailable')
    driver.merged_source=merged_source
if config.get('install_race'):
    state=driver.state(); driver.state=lambda: state
    def merged_source(*args):
        path=loop/'install-scans'; old=path.read_text() if path.exists() else ''
        path.write_text(old+'.')
        if not old: driver.request_install(state)
        return None
    driver.merged_source=merged_source
if config.get('sweep'):
    import open_prs
    open_prs.SWEEP_SECONDS=0.04; open_prs.REQUEST_SECONDS=0
    driver.ENV['PATH']=config['bin']+':'+os.environ['PATH']
    driver.ENV['SWEEP_SERVICE']=str(loop/'service.json')
if config.get('fast'): driver.main(idle_seconds=0.04,active_seconds=0.02)
else: driver.main()
'''

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='fitsy-loop-lifecycle-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def start(self, name='loop', *, planner_off=True, task_state=None, **config):
        loop = self.root / name
        (loop / 'tasks').mkdir(parents=True, exist_ok=True)
        (loop / 'progress.py').write_text('# No external publishing in lifecycle fixtures.\n')
        (loop / 'state.json').write_text(json.dumps({'_planner_off': planner_off, **(task_state or {})}))
        process = subprocess.Popen([sys.executable, '-B', '-c', self.PROCESS,
                                    json.dumps({'source': str(SOURCE.resolve()), **config})],
                                   env={**{k: v for k, v in os.environ.items()
                                           if not (config.get('preflight') and k == 'FITSY_LOOP_FIXTURE_SKIP_PREFLIGHT')},
                                        'FITSY_LOOP_DIR': str(loop),
                                        'FITSY_LOOP_ROOT': str(self.root)},
                                   text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        def close():
            if process.poll() is None: process.kill()
            process.communicate(timeout=5)
        self.addCleanup(close)
        return loop, process

    def contents(self, loop, name):
        path = loop / name
        return path.read_text() if path.exists() else ''

    def until(self, predicate):
        deadline = time.monotonic() + 5
        while not predicate() and time.monotonic() < deadline: time.sleep(0.01)
        self.assertTrue(predicate(), 'Lifecycle checkpoint not reached within five seconds')

    def enqueue(self, loop, name):
        (loop / 'tasks' / (name + '.md')).write_text(
            f'branch: fix/{name}\ntitle: {name}\nlane: infra\n---\nImplement {name}\n')

    def clean_exit(self, process):
        stdout, stderr = process.communicate(timeout=3)
        self.assertEqual(process.returncode, 0, stdout + stderr)
        self.assertEqual(stderr, '')

    def test_empty_queue_rescans_and_dispatches_new_tasks_after_drain(self):
        for mode in ('planner-off', 'no-pick', 'failed-pick'):
            with self.subTest(mode=mode):
                loop, process = self.start(mode, fast=True, planner_off=mode == 'planner-off',
                                           planner_result='fail' if mode == 'failed-pick' else None)
                self.until(lambda: len(self.contents(loop, 'scans')) >= 3)
                self.assertIsNone(process.poll(), self.contents(loop, 'driver.log'))
                self.assertEqual(self.contents(loop, 'picks'), '' if mode == 'planner-off' else '.')
                for name in ('first', 'second'):
                    self.enqueue(loop, name)
                    self.until(lambda: name in self.contents(loop, 'completed').splitlines())
                    self.until(lambda: self.contents(loop, 'driver.log').count('IDLE') >=
                               (2 if name == 'first' else 3))
                (loop / 'STOP').touch()
                self.clean_exit(process)
                self.assertEqual(self.contents(loop, 'completed').splitlines(), ['first', 'second'])
                self.assertNotIn('ALL DONE', self.contents(loop, 'driver.log'))

    def test_failed_preflight_runs_no_task_and_reports_once(self):
        loop, process = self.start(fast=True, preflight=['simulator X does not exist'])
        self.enqueue(loop, 'blocked')
        self.until(lambda: 'PREFLIGHT FAILED' in self.contents(loop, 'driver.log'))
        time.sleep(0.3)
        self.assertEqual(self.contents(loop, 'started'), '')
        self.assertEqual(self.contents(loop, 'driver.log').count('PREFLIGHT FAILED'), 1)
        self.assertIn('simulator X does not exist', self.contents(loop, 'driver.log'))
        (loop / 'preflight-ok').touch()
        self.until(lambda: 'blocked' in self.contents(loop, 'completed'))
        self.assertIn('PREFLIGHT passed', self.contents(loop, 'driver.log'))
        (loop / 'STOP').touch(); self.clean_exit(process)

    def test_stop_file_interrupts_the_default_three_minute_idle(self):
        loop, process = self.start()
        self.until(lambda: 'IDLE' in self.contents(loop, 'driver.log'))
        self.assertIn('re-scan in 180 seconds', self.contents(loop, 'driver.log'))
        (loop / 'STOP').touch()
        self.clean_exit(process)
        self.assertIn('STOPPED stop file:', self.contents(loop, 'driver.log'))

    def test_failed_install_retains_request_without_stopping_dispatch_or_spinning(self):
        loop, process = self.start(fast=True, install_error=True, task_state={'_loop_install': 0})
        self.until(lambda: 'SELF-INSTALL deferred: Fetch unavailable' in self.contents(loop, 'driver.log'))
        self.enqueue(loop, 'later')
        self.until(lambda: 'later' in self.contents(loop, 'completed'))
        (loop / 'STOP').touch(); self.clean_exit(process)
        self.assertGreater(json.loads((loop / 'state.json').read_text())['_loop_install'], time.time())
        self.assertEqual(self.contents(loop, 'driver.log').count('SELF-INSTALL deferred:'), 1)

    def test_merge_arriving_during_source_check_keeps_its_install_request(self):
        loop, process = self.start(fast=True, install_race=True, task_state={'_loop_install': 0})
        self.until(lambda: len(self.contents(loop, 'install-scans')) >= 2)
        (loop / 'STOP').touch(); self.clean_exit(process)
        self.assertNotIn('_loop_install', json.loads((loop / 'state.json').read_text()))

    def test_open_pr_sweep_repeats_while_idle_and_between_task_dispatches(self):
        spec = importlib.util.spec_from_file_location('sweep_fixture', SOURCE / 'open_prs.test.py')
        sweep_tests = importlib.util.module_from_spec(spec); spec.loader.exec_module(sweep_tests)
        loop = self.root / 'loop'; (loop / 'tasks').mkdir(parents=True)
        self.enqueue(loop, 'ended')
        tools = self.root / 'bin'; tools.mkdir()
        gh = tools / 'gh'; gh.write_text('#!' + sys.executable + '\n' + sweep_tests.GH); gh.chmod(0o700)
        (loop / 'service.json').write_text(json.dumps({'pages': [[{
            'number': 700, 'head': {'ref': 'fix/ended', 'repo': {'full_name': 'dgmolla/fitsy'}}}]],
            'views': {'700': {'number': 700, 'headRefName': 'fix/ended', 'headRefOid': 'a'*40,
                'isCrossRepository': False, 'isDraft': False, 'state': 'OPEN',
                'mergeStateStatus': 'BEHIND'}}, 'calls': []}))
        loop, process = self.start(fast=True, sweep=True, bin=str(tools),
                                   task_state={'ended': {'done': 1, 'pr': 700, 'opened_by_loop': True}})
        def updates():
            try:
                data = json.loads((loop / 'service.json').read_text())
                return sum(args[:2] == ['pr', 'update-branch'] for args in data['calls'])
            except json.JSONDecodeError:
                return 0
        self.until(lambda: updates() >= 2)
        self.enqueue(loop, 'first')
        self.until(lambda: 'first' in self.contents(loop, 'completed'))
        before = updates()
        self.until(lambda: updates() > before)
        self.enqueue(loop, 'second')
        self.until(lambda: 'second' in self.contents(loop, 'completed'))
        (loop / 'STOP').touch(); self.clean_exit(process)
        self.assertEqual(self.contents(loop, 'started').splitlines(), ['first', 'second'])

    def test_existing_stop_file_prevents_planning_and_dispatch(self):
        loop = self.root / 'loop'; (loop / 'tasks').mkdir(parents=True)
        self.enqueue(loop, 'pending')
        (loop / 'STOP').touch()
        loop, process = self.start(planner_off=False)
        self.clean_exit(process)
        self.assertEqual(self.contents(loop, 'started'), '')
        self.assertEqual(self.contents(loop, 'picks'), '')
        self.assertEqual(self.contents(loop, 'scans'), '')

    def test_signals_interrupt_idle_with_successful_exit(self):
        for number in (signal.SIGTERM, signal.SIGINT):
            with self.subTest(number=number):
                loop, process = self.start(number.name)
                self.until(lambda: 'IDLE' in self.contents(loop, 'driver.log'))
                process.send_signal(number)
                self.clean_exit(process)
                self.assertIn('STOPPED ' + number.name, self.contents(loop, 'driver.log'))

    def test_stop_drains_current_worker_under_owner_lock_without_starting_more(self):
        import fcntl
        loop = self.root / 'loop'; (loop / 'tasks').mkdir(parents=True)
        self.enqueue(loop, 'current')
        (loop / 'hold').touch()
        loop, process = self.start(fast=True)
        self.until(lambda: self.contents(loop, 'started') == 'current\n')
        (loop / 'STOP').touch()
        self.until(lambda: 'STOPPING' in self.contents(loop, 'driver.log'))
        self.enqueue(loop, 'later')
        self.assertIsNone(process.poll())
        with (loop / 'driver.lock').open('a') as owner:
            with self.assertRaises(BlockingIOError):
                fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        (loop / 'release').touch()
        self.clean_exit(process)
        self.assertEqual(self.contents(loop, 'completed'), 'current\n')

    def test_signal_handlers_are_restored_even_when_scheduler_raises(self):
        previous = {number: signal.getsignal(number) for number in (signal.SIGINT, signal.SIGTERM)}
        with self.assertRaisesRegex(RuntimeError, 'scheduler crashed'):
            with Lifecycle(self.root).signals():
                raise RuntimeError('scheduler crashed')
        self.assertEqual({number: signal.getsignal(number) for number in previous}, previous)

    def test_launchagent_always_restarts_and_uses_existing_driver_and_log(self):
        agent = plistlib.loads((SOURCE / 'org.fitsy.loop-driver.plist').read_bytes())
        self.assertEqual(agent['ProgramArguments'], ['__PYTHON__', '-u', '-B', '__LOOP_DIR__/driver.py'])
        self.assertEqual(agent['WorkingDirectory'], '__LOOP_DIR__')
        self.assertEqual(agent['EnvironmentVariables']['FITSY_LOOP_DIR'], '__LOOP_DIR__')
        self.assertIn('__HOME__/.local/bin', agent['EnvironmentVariables']['PATH'])
        self.assertIs(agent['KeepAlive'], True)
        self.assertTrue(agent['RunAtLoad'])
        self.assertGreaterEqual(agent['ThrottleInterval'], 10)
        for key in ('StandardOutPath', 'StandardErrorPath'):
            self.assertEqual(agent[key], '__LOOP_DIR__/driver.log')
        self.assertNotIn('StartInterval', agent)


class InstallTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='fitsy-loop-install-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.loop = self.root / 'loop'; (self.loop / 'tasks').mkdir(parents=True)
        (self.loop / 'driver.py').write_text('# Legacy driver\n')
        self.home = self.root / 'home'; tools = self.home / '.local/bin'; tools.mkdir(parents=True)
        script = '''import json, os, sys
from pathlib import Path
p=Path(os.environ['HOME'])/'launchctl.json'
s=json.loads(p.read_text()) if p.exists() else {'calls': [], 'loaded': False}
args=sys.argv[1:]; s['calls'].append(args)
if args[0]=='bootstrap': s['loaded']=True
p.write_text(json.dumps(s))
sys.exit(0 if args[0]!='print' or s['loaded'] else 1)
'''
        for name, code in (('launchctl', script), ('ps', ''), ('lsof', '')):
            path = tools / name; path.write_text('#!' + sys.executable + '\n' + code); path.chmod(0o700)
        self.env = {**os.environ, 'HOME': str(self.home), 'PATH': str(tools) + ':' + os.environ['PATH']}
        environment = mock.patch.dict(os.environ, self.env)
        environment.start(); self.addCleanup(environment.stop)

    def test_manual_command_installs_and_loads_agent_idempotently_without_touching_state(self):
        import fcntl
        retained = {'tasks/pending.md': 'queued task', 'state.json': '{"task":{"pr":700}}',
                    'driver.log': 'existing history\n', 'progress.json': 'existing progress',
                    'evidence/receipt.json': 'retained evidence'}
        for name, data in retained.items():
            path = self.loop / name; path.parent.mkdir(exist_ok=True); path.write_text(data)
        command = [sys.executable, '-B', str(SOURCE / 'install.py'), '--directory', str(self.loop), '--apply']
        first = subprocess.run(command, env=self.env, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        agent_path = self.home / 'Library/LaunchAgents/org.fitsy.loop-driver.plist'
        self.assertTrue(agent_path.exists(), 'The one-command installer must install the LaunchAgent')
        agent = plistlib.loads(agent_path.read_bytes())
        self.assertEqual(agent['ProgramArguments'][-1], str((self.loop / 'driver.py').resolve()))
        before = {str(p.relative_to(self.loop)): p.read_bytes() for p in self.loop.rglob('*') if p.is_file()}
        with (self.loop / 'driver.lock').open('a') as owner:
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            second = subprocess.run(command, env=self.env, capture_output=True, text=True)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual({str(p.relative_to(self.loop)): p.read_bytes() for p in self.loop.rglob('*') if p.is_file()}, before)
        for name, data in retained.items(): self.assertEqual((self.loop / name).read_text(), data)
        calls = json.loads((self.home / 'launchctl.json').read_text())['calls']
        self.assertEqual(sum(call[0] == 'bootstrap' for call in calls), 1)

    def merged_source(self):
        repository = self.root / 'wt3'; repository.mkdir()
        def git(*args):
            return subprocess.check_output(['git', '-C', str(repository), *args], env=self.env, stderr=subprocess.PIPE).decode().strip()
        git('init', '-q', '-b', 'main')
        git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test')
        source = repository / 'scripts/delivery/loop'; source.mkdir(parents=True)
        for name in install.FILES: shutil.copyfile(SOURCE / name, source / name)
        git('add', '.'); git('commit', '-qm', 'baseline')
        origin = self.root / 'origin.git'
        subprocess.run(['git', 'init', '-q', '--bare', str(origin)], check=True)
        git('remote', 'add', 'origin', str(origin)); git('push', '-q', 'origin', 'main')
        receipt = install.install(self.loop, apply=True)
        (source / 'lifecycle.py').write_text((source / 'lifecycle.py').read_text() + '\n# Merged lifecycle fix\n')
        (source / 'driver.py').write_text((source / 'driver.py').read_text() + '\nlog("RUNNING MERGED LOOP SOURCE")\n')
        (source / 'new_helper.py').write_text('# New merged runtime module\n')
        (source / 'ignored.test.py').write_text('# Never install tests\n')
        (source / 'state.json').write_text('{"never":"replace local state"}')
        (repository / 'unrelated.txt').write_text('Never install this repository file\n')
        git('add', '.'); git('commit', '-qm', 'merged loop fix'); git('push', '-q', 'origin', 'main')
        # The updater must read the fetched commit, never these working-tree bytes.
        (source / 'lifecycle.py').write_text('uncommitted candidate code\n')
        return repository, Path(receipt['version'])

    def test_sync_uses_merged_loop_files_and_preserves_runtime_state_and_controls(self):
        import fcntl
        repository, previous = self.merged_source()
        retained = {'tasks/pending.md': 'queued', 'state.json': '{"task":{"pr":700}}',
                    'driver.log': 'history', 'progress.md': 'progress', 'STOP': 'intentional stop'}
        for name, data in retained.items(): (self.loop / name).write_text(data)
        with (self.loop / 'driver.lock').open('a') as owner, mock.patch.object(install, 'SOURCE', previous):
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            update = install.merged_source(repository, self.env)
            self.assertTrue(install.install_merged(self.loop, update, self.env, owner))
        current = Path(json.loads((self.loop / 'source-receipt.json').read_text())['version'])
        self.assertIn(b'Merged lifecycle fix', (current / 'lifecycle.py').read_bytes())
        self.assertNotIn(b'uncommitted candidate', (current / 'lifecycle.py').read_bytes())
        self.assertFalse((current / 'unrelated.txt').exists())
        self.assertTrue((current / 'new_helper.py').is_file())
        self.assertFalse((current / 'ignored.test.py').exists())
        self.assertFalse((current / 'state.json').exists())
        self.assertFalse((self.loop / 'unrelated.txt').exists())
        for name, data in retained.items(): self.assertEqual((self.loop / name).read_text(), data)
        controls = {str(p.relative_to(previous)): p.read_bytes() for p in (previous / 'controls').rglob('*') if p.is_file()}
        self.assertEqual({str(p.relative_to(current)): p.read_bytes() for p in (current / 'controls').rglob('*') if p.is_file()}, controls)
        with (self.loop / 'driver.lock').open('a') as owner, mock.patch.object(install, 'SOURCE', current):
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertIsNone(install.merged_source(repository, self.env))

    def test_installed_scheduler_drains_workers_restarts_and_consumes_new_source_without_losing_queue(self):
        self.merged_source()
        (self.loop / 'state.json').write_text('{"_planner_off":true}')
        for name, lane in (('current', 'infra'), ('data', 'pipeline'), ('later', 'infra')):
            (self.loop / 'tasks' / (name + '.md')).write_text(f'branch: fix/{name}\ntitle: {name}\nlane: {lane}\n---\nDo work\n')
        program = '''import os, runpy, sys, time
from pathlib import Path
loop=Path(os.environ['FITSY_LOOP_DIR'])
loaded=runpy.run_path(str(loop/'driver.py'),run_name='fixture')
driver=loaded['main'].__globals__
def work(path,state):
    name=Path(path).stem
    with (loop/'started').open('a') as f: print(name,file=f)
    if sys.argv[1]=='update':
        if name=='data':
            (loop/'data-started').touch()
            while not (loop/'release').exists(): time.sleep(0.01)
        if name=='current':
            while not (loop/'data-started').exists(): time.sleep(0.01)
            driver['request_install'](state)
            (loop/'merged').touch()
    state.setdefault(name,{})['done']=1; driver['save'](state)
    if sys.argv[1]=='resume': (loop/'STOP').touch()
driver['execute_task']=work; driver['retriage']=lambda *args: None
raise SystemExit(loaded['main'](idle_seconds=0.02,active_seconds=0.02))
'''
        env = {**self.env, 'FITSY_LOOP_DIR': str(self.loop), 'FITSY_LOOP_ROOT': str(self.root)}
        process = subprocess.Popen([sys.executable, '-B', '-c', program, 'update'], env=env,
                                   text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while not (self.loop / 'merged').exists() and time.monotonic() < deadline: time.sleep(0.01)
            self.assertTrue((self.loop / 'merged').exists())
            self.assertIsNone(process.poll())
            self.assertNotIn('later', (self.loop / 'started').read_text())
            (self.loop / 'release').touch()
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 75, stdout + stderr)
        finally:
            if process.poll() is None: process.kill()
            process.communicate(timeout=5)
        state = json.loads((self.loop / 'state.json').read_text())
        self.assertTrue(state['current']['done'] and state['data']['done'])
        self.assertNotIn('later', state)
        self.assertNotIn('_loop_install', state)
        # Emulate launchd's unsuccessful-exit restart through the same external entrypoint.
        resumed = subprocess.run([sys.executable, '-B', '-c', program, 'resume'], env=env,
                                 capture_output=True, text=True, timeout=10)
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertIn('RUNNING MERGED LOOP SOURCE', (self.loop / 'driver.log').read_text())
        self.assertTrue(json.loads((self.loop / 'state.json').read_text())['later']['done'])
        self.assertEqual((self.loop / 'started').read_text().splitlines().count('current'), 1)


class DriverTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.controls_directory = tempfile.TemporaryDirectory()
        for name, data in install.sources().items():
            if name.startswith('controls/'):
                path = Path(cls.controls_directory.name) / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)

    @classmethod
    def tearDownClass(cls):
        cls.controls_directory.cleanup()

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
        for tool in ('node', 'lockf', 'sandbox-exec', 'codex', 'gh', 'ps', 'lsof', 'pgrep', 'xcrun', 'git', 'vercel'):
            executable = tools / tool
            executable.write_text(SERVICE.replace('#!/usr/bin/env python3', '#!' + sys.executable)
                                  .replace('SERVICE_PATH', repr(str(self.service))))
            executable.chmod(0o700)
        self.service.write_text(json.dumps({'calls': [], 'artifacts': str(self.artifacts),
                                           'real_git': real_git, 'real_node': shutil.which('node')}))
        self.env = {**os.environ, 'PATH': str(tools) + ':' + os.environ['PATH'],
                    'LOOP_SERVICE': str(self.service), 'FITSY_XCTEST_SIM_UDID': 'a' * 36, 'REAL_GIT': real_git}
        self.environ = mock.patch.dict(os.environ, self.env)
        self.environ.start(); self.addCleanup(self.environ.stop)
        self.patch = mock.patch.multiple(driver, L=str(self.root), ROOT=str(self.root), ENV=self.env)
        self.patch.start(); self.addCleanup(self.patch.stop)
        controls = mock.patch.multiple(host, CONTROLS=Path(self.controls_directory.name) / 'controls',
                                       SANDBOX=str(tools / 'sandbox-exec'))
        controls.start(); self.addCleanup(controls.stop)
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

    def test_privileged_backend_preflight_ignores_candidate_code_and_imports(self):
        sentinel = self.wt / 'credential-exposure.txt'
        for name in ('preview-backend.mjs', 'backend-identity.mjs'):
            path = self.wt / 'scripts/sim' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('import fs from "node:fs"; fs.writeFileSync(' + json.dumps(str(sentinel)) +
                            ', process.env.GH_TOKEN || "executed"); throw new Error("candidate executed");')
        self.git('add', '.'); self.git('commit', '-qm', 'hostile candidate fixture')
        head = self.git('rev-parse', 'HEAD')
        deployment = {'id': 'dpl_fixture', 'name': 'fitsy-api', 'readyState': 'READY',
                      'target': 'preview', 'gitSource': {'sha': head}}
        self.env.update(GH_TOKEN='test-github', VERCEL_TOKEN='test-vercel', POSTGRES_PRISMA_URL='test-database',
                        NODE_OPTIONS='--require=/hostile/startup.js', NODE_PATH='/hostile/imports',
                        BASH_ENV='/hostile/startup.sh', EXPO_PUBLIC_API_URL='https://dev.fitsy.org')
        self.service_state(real_selector=True, deployment=deployment)
        selected = context.select_backend(self.wt, head, self.env)
        self.assertEqual(selected['backendRevision'], head)
        self.assertEqual(selected['deployment'], deployment)
        self.assertFalse(sentinel.exists(), 'Neither candidate entrypoint nor its imports may run privileged')
        observed = set(self.service_state()['backend_environment_keys'][0])
        self.assertIn('VERCEL_TOKEN', observed)
        self.assertTrue(observed.isdisjoint({'GH_TOKEN', 'POSTGRES_PRISMA_URL', 'NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV'}))

    def test_native_execution_has_isolation_and_only_dev_credentials(self):
        self.env.update(GH_TOKEN='test-github', VERCEL_TOKEN='test-vercel', POSTGRES_PRISMA_URL='test-database',
                        AWS_SECRET_ACCESS_KEY='test-cloud', NODE_OPTIONS='--require=/hostile/startup.js',
                        EXPO_PUBLIC_SUPABASE_URL='https://dev-fixture.supabase.co',
                        EXPO_PUBLIC_SUPABASE_ANON_KEY='test-public')
        replay = context.host_replay(self.wt, self.root / 'sim.lock', self.ev, self.env)
        self.assertEqual(replay['status'], 'pass', replay)
        observed = self.service_state()
        for keys in observed['native_environment_keys']:
            self.assertTrue(set(keys).isdisjoint({'GH_TOKEN', 'VERCEL_TOKEN', 'POSTGRES_PRISMA_URL',
                                               'AWS_SECRET_ACCESS_KEY', 'NODE_OPTIONS'}))
            self.assertIn('EXPO_PUBLIC_SUPABASE_ANON_KEY', keys)
        node = [call for call in observed['calls'] if call['tool']=='node' and 'ci.mjs' in call['args'][0] and '--plan' not in call['args']]
        self.assertTrue(all(Path(call['args'][0]).is_relative_to(host.CONTROLS) for call in node))
        self.assertEqual(len(observed['sandbox_profiles']), len(node))
        self.assertIn('(deny file-read-data', observed['sandbox_profiles'][0])
        self.assertIn('(deny process-info*)', observed['sandbox_profiles'][0])
        with host.isolated(self.wt, self.env, {'backend': 'https://dev.fitsy.org',
                                             'deployment': {'id': 'dpl_public'}}) as (_, selected):
            binary = str(Path(selected['PATH'].split(os.pathsep)[0]) / 'vercel')
            response = subprocess.run([binary, 'api', '/v13/deployments/dev.fitsy.org', '--raw'],
                                      env=selected, capture_output=True, text=True, check=True)
            self.assertEqual(json.loads(response.stdout), {'id': 'dpl_public'})
            self.assertNotEqual(subprocess.run([binary, 'deploy'], env=selected, capture_output=True).returncode, 0)

    def test_isolation_denial_never_falls_back_to_host_execution(self):
        self.service_state(sandbox_error='sandbox_apply: Operation not permitted')
        replay = context.host_replay(self.wt, self.root / 'sim.lock', self.ev, self.env)
        self.assertEqual(replay['status'], 'error')
        self.assertIn('Operation not permitted', replay['logs'])
        self.assertFalse(any(call['tool']=='node' and 'ci.mjs' in call['args'][0] and '--plan' not in call['args']
                             for call in self.service_state()['calls']))
        self.assertFalse(any(call['tool']=='codex' for call in self.service_state()['calls']))

    def test_dependency_symlinks_cannot_grant_host_reads_during_replay_or_publish(self):
        private_home = self.root / 'private-home'; private_home.mkdir()
        (private_home / 'credentials').write_text('synthetic-dependency-secret')
        self.env['HOME'] = str(private_home)
        for name in ('node_modules', 'apps/mobile/node_modules'):
            with self.subTest(name=name):
                dependency = self.wt / name
                dependency.parent.mkdir(parents=True, exist_ok=True)
                dependency.symlink_to(private_home, target_is_directory=True)
                try:
                    self.service_state(calls=[])
                    replay = context.host_replay(self.wt, self.root / 'sim.lock', self.ev, self.env)
                    self.assertEqual(replay['status'], 'error', replay)
                    self.assertIn('Unapproved dependency root', replay['logs'])
                    with self.assertRaisesRegex(ValueError, 'Unapproved dependency root'):
                        host.publish(self.wt, 'main', self.env)
                    calls = self.service_state()['calls']
                    self.assertFalse(any(call['tool']=='sandbox-exec' or
                                         call['tool']=='git' and 'push' in call['args'] for call in calls))
                finally:
                    dependency.unlink()

    def test_dependency_links_accept_only_the_original_installed_paths(self):
        approved = SOURCE.parents[2] / 'node_modules'
        dependency = self.wt / 'node_modules'
        dependency.symlink_to(approved, target_is_directory=True)
        self.assertEqual(context.host_replay(self.wt, self.root / 'sim.lock', self.ev, self.env)['status'], 'pass')
        dependency.unlink()
        dependency.symlink_to(Path(self.env['HOME']), target_is_directory=True)
        self.assertEqual(context.host_replay(self.wt, self.root / 'sim.lock', self.ev, self.env)['status'], 'error')

    def test_missing_dependency_manifest_never_falls_back_to_candidate_permissions(self):
        controls = self.root / 'missing-manifest-controls'; shutil.copytree(host.CONTROLS, controls)
        (controls / 'dependency-roots.json').unlink()
        (self.wt / 'node_modules').symlink_to(Path(self.env['HOME']), target_is_directory=True)
        with mock.patch.object(host, 'CONTROLS', controls):
            replay = context.host_replay(self.wt, self.root / 'sim.lock', self.ev, self.env)
            self.assertEqual(replay['status'], 'error')
            self.assertIn('Install reviewed loop controls', replay['logs'])
            with self.assertRaisesRegex(ValueError, 'Install reviewed loop controls'):
                host.publish(self.wt, 'main', self.env)
        self.assertFalse(any(call['tool']=='sandbox-exec' for call in self.service_state()['calls']))

    def test_symlinked_blocker_never_reaches_parking_diagnostics(self):
        private = self.root / 'id_ed25519'
        secret = 'synthetic-credential-canary-never-publish'
        private.write_text(secret)
        (self.wt / '.infra-blocked').symlink_to(private)
        st = {'pr':585}
        self.assertEqual(self.repair(st), 'blocked')
        observed = self.service_state()
        self.assertNotIn(secret, json.dumps({'state':st, 'comments':observed['comments']}))
        self.assertIn('regular workspace file', st['blocked'])
        self.assertEqual(private.read_text(), secret)
        self.assertEqual(len(observed['comments']), 2)

    def test_regular_blocker_is_bounded_redacted_and_consumed(self):
        marker = self.wt / '.infra-blocked'
        marker.write_text('Missing configuration token=synthetic-private\n' + 'x' * 6000 + 'unread-tail')
        st = {'pr':585}
        self.assertEqual(self.repair(st), 'blocked')
        self.assertNotIn('synthetic-private', st['blocked'])
        self.assertNotIn('unread-tail', st['blocked'])
        self.assertLessEqual(len(st['blocked']), 1500)
        self.assertFalse(marker.exists())

    def test_nonregular_and_hardlinked_blockers_are_rejected(self):
        private = self.root / 'host-credential'; private.write_text('synthetic-hardlink-secret')
        marker = self.wt / '.infra-blocked'
        for kind in ('directory', 'hardlink', 'fifo'):
            with self.subTest(kind=kind):
                if kind=='directory': marker.mkdir()
                elif kind=='hardlink': os.link(private, marker)
                else: os.mkfifo(marker)
                try:
                    st = {'pr':585}
                    self.assertEqual(self.repair(st), 'blocked')
                    self.assertIn('regular workspace file', st['blocked'])
                    self.assertNotIn('synthetic-hardlink-secret', json.dumps(self.service_state()['comments']))
                finally:
                    if marker.is_dir(): marker.rmdir()
                    elif marker.exists(): marker.unlink()

    def test_claim_wrapper_uses_only_claim_files_in_home(self):
        private_home = self.root / 'claim-home'; private_home.mkdir()
        # Portable filesystem boundary: fail any non-claim write in HOME. The
        # host lane below exercises this same wrapper under the real OS policy.
        python = self.root / 'bin/python3'
        python.write_text('#!' + sys.executable + r'''
import os, pathlib, re, sys
home = pathlib.Path(os.environ['HOME'])
def claim_only(event, args):
    if event != 'open' or not isinstance(args[0], str) or not args[2] & (os.O_WRONLY | os.O_RDWR | os.O_CREAT):
        return
    path = pathlib.Path(args[0])
    if path.parent == home and not re.fullmatch(r'\.fitsy-sim-claim\.(json|lock|json\.[a-z0-9_]+\.tmp)', path.name):
        raise PermissionError('Non-claim HOME write denied: ' + path.name)
sys.addaudithook(claim_only)
sys.argv = sys.argv[1:]
exec(compile(sys.stdin.read(), '<claim-fixture>', 'exec'))
''')
        python.chmod(0o700)
        env = {**self.env, 'HOME':str(private_home), 'FITSY_PRODUCT_ROOT':str(self.wt),
               'FITSY_SIM_OWNER':'fixture'}
        command = ['lockf', '-t', '3600', str(Path.home() / 'fitsy-refactor/loop/sim.lock'),
                   'bash', host.control('scripts/sim/sim')]
        claim = private_home / '.fitsy-sim-claim.json'
        for action in ('claim', 'claim', 'release'):
            result = subprocess.run([*command, action], env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['status'], 'pass')
        self.assertFalse(claim.exists())
        self.assertEqual([path.name for path in private_home.iterdir()], ['.fitsy-sim-claim.lock'])

    @unittest.skipUnless(os.environ.get('FITSY_MEDIA_INTEGRATION') == '1', 'Requires the canonical host media lane')
    def test_real_host_sandbox_denies_credentials_and_preserves_child_isolation(self):
        private_home = self.root / 'private-home'; private_home.mkdir()
        self.env.update(HOME=str(private_home), FITSY_SIM_OWNER='loop-isolation-fixture')
        private_credential = private_home / 'credentials.json'; private_credential.write_text('synthetic-home-secret')
        credential = self.root / 'host-auth.json'; credential.write_text('synthetic-host-secret')
        dotenv = self.wt / '.env.local'; dotenv.write_text('GH_TOKEN=synthetic-host-secret\n')
        link = self.wt / 'auth-link'; link.symlink_to(credential)
        # Freeze a trusted dependency root before the candidate links exist.
        # Direct HOME links must fail before either native or verifier execution;
        # links nested in an approved tree still face the actual OS read denial.
        controls = self.root / 'isolation-controls'; shutil.copytree(host.CONTROLS, controls)
        trusted = self.root / 'shared/node_modules'; trusted.mkdir(parents=True)
        (controls / 'dependency-roots.json').write_text(json.dumps([str(trusted.resolve())]))
        pinned = mock.patch.object(host, 'CONTROLS', controls)
        pinned.start(); self.addCleanup(pinned.stop)
        (trusted / 'host-link').symlink_to(private_home, target_is_directory=True)
        dependency_secrets = []
        for name in ('node_modules', 'apps/mobile/node_modules'):
            dependency = self.wt / name; dependency.parent.mkdir(parents=True, exist_ok=True)
            dependency.symlink_to(private_home, target_is_directory=True)
            with self.assertRaisesRegex(ValueError, 'Unapproved dependency root'):
                with host.isolated(self.wt, self.env):
                    self.fail('Candidate dependency link must not authorize host reads')
            with self.assertRaisesRegex(ValueError, 'Unapproved dependency root'):
                host.publish(self.wt, 'main', self.env)
            dependency.unlink(); dependency.symlink_to(trusted, target_is_directory=True)
            dependency_secrets.append(dependency / 'host-link/credentials.json')
        self.env.update(GH_TOKEN='synthetic-host-secret', VERCEL_TOKEN='synthetic-host-secret',
                        POSTGRES_PRISMA_URL='synthetic-host-secret')
        attempt = '''import json, os, pathlib, subprocess, sys
def denied(path):
    try: pathlib.Path(path).read_text(); return False
    except PermissionError: return True
result = {'host_file': denied(sys.argv[1]), 'dotenv': denied(sys.argv[2]), 'symlink': denied(sys.argv[3]),
          'home_file': denied(sys.argv[4]),
          'dependency_link': denied(sys.argv[5]), 'mobile_dependency_link': denied(sys.argv[6]),
          'env': all(key not in os.environ for key in ('GH_TOKEN','VERCEL_TOKEN','POSTGRES_PRISMA_URL'))}
pathlib.Path('native-output.txt').write_text('owned workspace output')
child = subprocess.run([sys.executable, '-I', '-c', 'import pathlib,sys; pathlib.Path(sys.argv[1]).read_text()',
                        sys.argv[1]], capture_output=True)
result['child'] = child.returncode != 0 and b'PermissionError' in child.stderr
print(json.dumps(result))
'''
        # Use the actual OS boundary here. An unavailable sandbox fails the host
        # lane and prevents its receipt; the ordinary portable suite skips it.
        with host.isolated(self.wt, self.env) as (_, selected):
            temporary = Path(selected['TMPDIR'])
            self.assertIn('-Djava.io.tmpdir=' + str(temporary), selected['JAVA_TOOL_OPTIONS'])
            policy = (temporary / 'native.sb').read_text()
            for granted in ('/Library/Preferences/com.apple.dt.Xcode.plist', '.env.example'):
                self.assertIn(granted, policy)
            self.assertNotIn('.gitconfig', policy)
            self.assertEqual(selected['GIT_CONFIG_NOSYSTEM'], '1')
            result = subprocess.run(['/usr/bin/sandbox-exec', '-f', str(temporary / 'native.sb'),
                                     sys.executable, '-I', '-c', attempt, str(credential), str(dotenv), str(link),
                                     str(private_credential), *(str(path) for path in dependency_secrets)],
                                    cwd=self.wt, env=selected, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), dict.fromkeys(('host_file','dotenv','symlink','home_file',
                              'dependency_link','mobile_dependency_link','env','child'), True))
            # Exercise the actual wrapper, atomic claim replacement, parent
            # directory fsync and release under the emitted OS profile.
            command = ['/usr/bin/lockf', '-t', '3600', str(Path.home() / 'fitsy-refactor/loop/sim.lock'),
                       '/usr/bin/sandbox-exec', '-f', str(temporary / 'native.sb'),
                       '/bin/bash', str(host.CONTROLS / 'scripts/sim/sim')]
            claim = private_home / '.fitsy-sim-claim.json'
            for minutes in ('1', '2'):
                acquired = subprocess.run([*command, 'claim', '--minutes', minutes], cwd=self.wt,
                                          env=selected, capture_output=True, text=True, timeout=30)
                self.assertEqual(acquired.returncode, 0, acquired.stderr)
                self.assertEqual(json.loads(claim.read_text())['owner'], 'loop-isolation-fixture')
                self.assertEqual(claim.stat().st_mode & 0o777, 0o600)
                self.assertEqual(list(private_home.glob('.fitsy-sim-claim.json.*.tmp')), [])
            previous = claim.read_bytes()
            refused = subprocess.run([*command, 'claim'], cwd=self.wt,
                                     env={**selected, 'FITSY_SIM_OWNER':'other-owner'},
                                     capture_output=True, text=True, timeout=30)
            self.assertNotEqual(refused.returncode, 0)
            self.assertEqual(claim.read_bytes(), previous)
            released = subprocess.run([*command, 'release'], cwd=self.wt,
                                      env=selected, capture_output=True, text=True, timeout=30)
            self.assertEqual(released.returncode, 0, released.stderr)
            self.assertFalse(claim.exists())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.wt / 'native-output.txt').read_text(), 'owned workspace output')
        # Check the actual authenticated publication boundary as well: hostile
        # verifier code gets no credential files or environment, and its hook
        # cannot replace the owner's required selections.
        verifier = self.wt / 'scripts/verify/run.mjs'; verifier.parent.mkdir(parents=True)
        verifier.write_text("import fs from 'node:fs';\nconst paths=" +
                            json.dumps([str(credential), str(dotenv), str(link), str(private_credential),
                                        *(str(path) for path in dependency_secrets)]) + ''';
const denied = paths.map(path => { try { fs.readFileSync(path); return false; }
  catch (error) { return error.code === 'EPERM' || error.code === 'EACCES'; } });
denied.push(['GH_TOKEN','VERCEL_TOKEN','POSTGRES_PRISMA_URL'].every(key => !(key in process.env)));
fs.mkdirSync('.evidence', {recursive:true});
fs.appendFileSync('.evidence/published.jsonl', JSON.stringify(denied)+'\\n');
if (denied.some(value => !value)) process.exit(1);
''')
        hook = self.wt / '.githooks/pre-push'; hook.parent.mkdir()
        hook.write_text('#!/bin/sh\ntouch .evidence/untrusted-hook-ran\n'); hook.chmod(0o755)
        self.git('config', 'core.hooksPath', '.githooks')
        self.git('add', '.'); self.git('commit', '-qm', 'isolated publication fixture')
        origin = self.root / 'isolated-origin.git'
        subprocess.run([self.env['REAL_GIT'], 'init', '--bare', '-q', str(origin)], check=True)
        self.git('remote', 'add', 'origin', str(origin))
        real_path = str(Path(self.service_state()['real_node']).parent) + ':/usr/bin:/bin:/usr/sbin:/sbin'
        with mock.patch.object(host, 'SANDBOX', '/usr/bin/sandbox-exec'):
            published = host.publish(self.wt, 'main', {**self.env, 'PATH':real_path})
        self.assertEqual(published.returncode, 0, published.stderr)
        self.assertEqual([json.loads(line) for line in (self.wt / '.evidence/published.jsonl').read_text().splitlines()],
                         [[True] * 7, [True] * 7])
        self.assertFalse((self.wt / '.evidence/untrusted-hook-ran').exists())

    def test_production_credentials_are_rejected_before_native_execution(self):
        self.env['EXPO_PUBLIC_SUPABASE_URL'] = 'https://zaxkmjqozvmbifiwbxps.supabase.co'
        replay = context.host_replay(self.wt, self.root / 'sim.lock', self.ev, self.env)
        self.assertEqual(replay['status'], 'error')
        self.assertIn('Production Supabase', replay['logs'])
        self.assertFalse(self.service_state()['calls'])

    def test_candidate_fixture_configuration_cannot_widen_host_read_permissions(self):
        fixture = self.wt / 'untracked-fixtures.json'
        fixture.write_text(json.dumps({'version': 1, 'fixtures': {'default': {
            'prepare': ['/usr/bin/python3', str(self.root / 'host-auth.json')]}}}))
        self.env['FITSY_E2E_FIXTURES'] = str(fixture)
        replay = context.host_replay(self.wt, self.root / 'sim.lock', self.ev, self.env)
        self.assertEqual(replay['status'], 'error')
        self.assertIn('outside candidate writable roots', replay['logs'])
        self.assertFalse(self.service_state().get('native_environment_keys'))

    def test_native_selection_uses_installed_policy_and_candidate_source(self):
        for name, body in {
                'apps/mobile/components/ShuffleButton.tsx': 'export const enabled = true;\n',
                'apps/mobile/e2e/flows/shuffle.yaml': 'appId: com.fitsy.mobile\n---\n- launchApp\n',
                'scripts/route-reviewers.sh': '#!/bin/sh\ntouch candidate-policy-executed\nprintf \'["frontend"]\'\n',
                'scripts/verify/risk-tiers.yml': 'invalid candidate policy\n'}.items():
            path = self.wt / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(body)
        self.service_state(real_plan=True)
        result = context.host_replay(self.wt, self.root / 'sim.lock', {}, self.env)
        self.assertEqual(result['status'], 'pass', result)
        self.assertTrue(result['required'], 'Candidate mobile source must retain native coverage')
        self.assertFalse((self.wt / 'candidate-policy-executed').exists())

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
        self.git('branch', 'codex/issue-583')
        self.git('push', '-q', 'origin', 'codex/issue-583')
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
                         ['error', 'pass'])
        self.assertTrue(any(row['kind']=='retriage-prerequisite' for row in st['attempts']))
        self.assertFalse(any(call['tool']=='codex' for call in self.service_state()['calls']))

    def test_environment_retriage_keeps_fresh_assertion_evidence_and_requires_a_baseline(self):
        task, s = self.task_checkout(simrepair=3, fix_rounds=5)
        st = s[task.stem]
        head = self.git('rev-parse', 'HEAD')
        ev = failure(head=head, main=head, sim_state='error', main_passed=False,
                     logs='Host sandbox unavailable')
        st['blocked_evidence'] = ev
        park(st, 'Restore host dependency', ev, 'environment', head, now=1)
        # A repaired host now reaches an assertion while GitHub still says ERROR.
        self.service_state(replays=['failure'])
        with mock.patch('urllib.request.urlopen') as health:
            health.return_value.__enter__.return_value.status = 200
            driver.retriage([str(task)], s)
        self.assertNotIn('blocked', st)
        self.assertNotIn('simrepair', st)
        self.assertNotIn('fix_rounds', st)
        fresh = st['repair_evidence']
        self.assertEqual(fresh['head'], head)
        self.assertEqual(fresh['source'], context.source_hash(self.wt, self.env))
        self.assertEqual(fresh['sim_state'], 'failure')
        self.assertEqual(fresh['flow'], 'shuffle')
        self.assertEqual(fresh['step'], 'assertVisible: fresh restaurant')
        self.assertEqual(fresh['images'], [str(self.artifacts / 'failure.png')])
        self.assertIn('assertion failed', fresh['logs'])
        self.assertEqual(classify_failure(fresh), 'unknown')
        self.assertFalse(fresh.get('main_passed'))
        self.assertIn('merge-base', fresh['main_comparison'])
        persisted = json.loads((self.root / 'state.json').read_text())[task.stem]
        self.assertEqual(persisted['blocked_evidence'], fresh)
        # The actual next task entrypoint must consume the fresh evidence, but
        # unavailable baseline proof still prevents a candidate code repair.
        self.service_state(replays=['failure'])
        with mock.patch('time.sleep'), mock.patch('urllib.request.urlopen') as health:
            health.return_value.__enter__.return_value.status = 200
            self.assertEqual(driver.run_task(str(task), s), 'blocked')
        self.assertEqual(st['blocked_on'], 'baseline')
        self.assertFalse(any(call['tool']=='codex' for call in self.service_state()['calls']))
        # Supplying the baseline later must retain the failed journey even when
        # the old GitHub ERROR has no flow/artifacts of its own.
        baseline = self.root / 'prepared-baseline'
        subprocess.run([self.env['REAL_GIT'], 'clone', '-q', '--branch', 'main',
                        str(self.root / 'origin.git'), str(baseline)], check=True)
        self.env['FITSY_LOOP_MAIN_CHECKOUT'] = str(baseline)
        self.service_state(replays=['pass'])
        st['triaged_at'] = 0
        with mock.patch('urllib.request.urlopen') as health:
            health.return_value.__enter__.return_value.status = 200
            driver.retriage([str(task)], s)
        self.assertNotIn('blocked', st)
        self.assertTrue(st['repair_evidence']['main_passed'])
        self.assertEqual(st['repair_evidence']['flow'], 'shuffle')
        # Reused artifacts must never conceal newly broken host dependencies.
        observed = driver.current_repair_evidence(self.wt, {**fresh, 'api_status':503, 'free_disk_gb':1}, st)
        self.assertEqual(observed['api_status'], 503)
        self.assertEqual(observed['free_disk_gb'], 1)
        self.assertEqual(classify_failure(observed), 'env')
        observed = driver.current_repair_evidence(self.wt, {**fresh,
            'preflight_logs':'No ready fitsy-api preview for this head'}, st)
        self.assertEqual(classify_failure(observed), 'env')

    def test_failed_replay_rejects_source_drift_before_returning_actionable_evidence(self):
        self.service_state(replays=['failure'], change_source_during_replay=True, candidate=str(self.wt))
        result = context.host_replay(self.wt, self.root / 'sim.lock', self.ev, self.env)
        self.assertEqual(result['status'], 'error', result)
        self.assertIn('Source changed', result['logs'])
        self.assertNotIn('assertion_failure', result)

    def test_parked_checkout_fast_forwards_to_the_observed_repaired_pr_head(self):
        task, s = self.task_checkout(simrepair=3, fix_rounds=5)
        st = s[task.stem]
        previous = self.git('rev-parse', 'HEAD')
        ev = failure(head=previous, main=previous, sim_state='error', api_status=503)
        st['blocked_evidence'] = ev
        park(st, 'Restore API configuration', ev, 'env:api-config', previous, now=1)
        (self.wt / 'repair.txt').write_text('Host repair commit\n')
        self.git('add', '.'); self.git('commit', '-qm', 'host repair')
        repaired = self.git('rev-parse', 'HEAD')
        self.git('push', '-q', 'origin', 'main')
        self.git('reset', '--hard', previous)
        pr = self.service_state()['pr']; pr['headRefOid'] = repaired
        self.service_state(pr=pr, replays=['pass'])
        with mock.patch('urllib.request.urlopen') as health:
            health.return_value.__enter__.return_value.status = 200
            driver.retriage([str(task)], s)
        self.assertEqual(self.git('rev-parse', 'HEAD'), repaired)
        self.assertEqual((self.wt / 'repair.txt').read_text(), 'Host repair commit\n')
        self.assertNotIn('blocked', st)
        for key in ('simrepair', 'fix_rounds'):
            self.assertNotIn(key, st)
        replay = next(row for row in st['attempts'] if row['kind']=='environment-retriage')
        self.assertEqual(replay['head'], repaired)
        self.assertEqual(replay['outcome'], 'pass')
        self.assertFalse(any(call['tool']=='codex' for call in self.service_state()['calls']))

    def test_parked_refresh_preserves_dirty_and_unpublished_divergent_work(self):
        task, s = self.task_checkout()
        head = self.git('rev-parse', 'HEAD')
        path = self.wt / 'file.txt'; path.write_text('unfinished edit\n')
        with self.assertRaisesRegex(ValueError, 'unfinished edits'):
            driver.refresh_pr_head(str(self.wt), 'main', head)
        self.assertEqual(path.read_text(), 'unfinished edit\n')
        self.assertEqual(self.git('rev-parse', 'HEAD'), head)
        self.git('add', '.'); self.git('commit', '-qm', 'unpublished work')
        local = self.git('rev-parse', 'HEAD')
        with self.assertRaisesRegex(ValueError, 'unpublished commits'):
            driver.refresh_pr_head(str(self.wt), 'main', head)
        self.assertEqual(self.git('rev-parse', 'HEAD'), local)
        self.assertEqual(path.read_text(), 'unfinished edit\n')
        other = self.root / 'host-repair'
        real = self.env['REAL_GIT']
        subprocess.run([real, 'clone', '-q', '-b', 'main', str(self.root / 'origin.git'), str(other)], check=True)
        def remote(*args):
            return subprocess.check_output([real, '-C', str(other), *args], text=True, stderr=subprocess.PIPE).strip()
        remote('checkout', '-q', 'main')
        remote('config', 'user.name', 'Host'); remote('config', 'user.email', 'host@example.test')
        (other / 'remote.txt').write_text('independent host repair\n')
        remote('add', '.'); remote('commit', '-qm', 'remote repair'); remote('push', '-q', 'origin', 'main')
        with self.assertRaises(RuntimeError):
            driver.refresh_pr_head(str(self.wt), 'main', remote('rev-parse', 'HEAD'))
        self.assertEqual(self.git('rev-parse', 'HEAD'), local)
        self.assertEqual(path.read_text(), 'unfinished edit\n')

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
        process = subprocess.Popen([sys.executable, '-B', str(host / 'driver.py')],
                                   env={**self.env, 'FITSY_LOOP_ROOT': str(self.root)},
                                   text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if (host / 'driver.log').exists() and 'IDLE' in (host / 'driver.log').read_text(): break
                if process.poll() is not None: break
                time.sleep(0.01)
            self.assertIsNone(process.poll(), 'Installed driver must remain alive on an empty queue')
            self.assertIn('IDLE', (host / 'driver.log').read_text())
            (host / 'STOP').touch()
            _, stderr = process.communicate(timeout=3)
            self.assertEqual(process.returncode, 0, stderr)
        finally:
            if process.poll() is None: process.kill()
            process.communicate(timeout=5)
        self.assertTrue((host / 'tasks/notes/NOTES-priority.md').exists())
        self.assertEqual(json.loads((host / 'state.json').read_text()), state)
        self.assertIn('STOPPED stop file:', (host / 'driver.log').read_text())
        self.assertEqual((Path(receipt['version']) / 'lifecycle.py').read_bytes(),
                         (SOURCE / 'lifecycle.py').read_bytes())
        self.assertEqual((Path(receipt['version']) / 'open_prs.py').read_bytes(),
                         (SOURCE / 'open_prs.py').read_bytes())
        # The PR's one-line legacy-driver change must consume that same snapshot.
        documentation = (SOURCE.parents[2] / 'docs/engineering/devops/loop-driver.md').read_text()
        delegation = documentation.split('```python\n', 1)[1].split('```', 1)[0]
        self.assertEqual(len(delegation.strip().splitlines()), 1)
        delegated = subprocess.run([sys.executable, '-B', '-c', 'import json, sys; L = sys.argv[1]\n' + delegation,
                                    str(host)], env=self.env, text=True, capture_output=True, timeout=3)
        self.assertEqual(delegated.returncode, 0, delegated.stderr)
        self.assertTrue(list(host.glob('driver.py.*.bak')))
        self.assertEqual(json.loads((host / 'source-receipt.json').read_text())['source'], plan['source'])
        installed = Path(receipt['version']) / 'controls/scripts/sim/preview-backend.mjs'
        self.assertEqual(installed.read_bytes(), (SOURCE.parents[2] / 'scripts/sim/preview-backend.mjs').read_bytes())
        dependencies = Path(receipt['version']) / 'controls/dependency-roots.json'
        self.assertEqual(json.loads(dependencies.read_text()),
                         [str(SOURCE.resolve().parents[2] / name) for name in
                          ('node_modules', 'apps/mobile/node_modules') if (SOURCE.parents[2] / name).is_dir()])
        self.assertTrue(os.access(Path(receipt['version']) / 'controls/scripts/sim/xcodebuild', os.X_OK))
        # Existing callers resolve both Python recovery and JS imports from this
        # installed version, without importing candidate-controlled modules.
        code = ('import json, os, runpy, sys; loaded=runpy.run_path(sys.argv[1],run_name="fixture"); '
                'c=loaded["context"]; print(json.dumps(c.select_backend(sys.argv[2],sys.argv[3],os.environ)))')
        selected = subprocess.run([sys.executable, '-B', '-c', code, str(host / 'driver.py'),
                                   str(self.wt), self.git('rev-parse', 'HEAD')],
                                  env=self.env, text=True, capture_output=True, timeout=10)
        self.assertEqual(selected.returncode, 0, selected.stderr)
        self.assertEqual(json.loads(selected.stdout)['deployment']['id'], 'dpl_fixture')
        preflight = [call for call in self.service_state()['calls']
                     if call['tool']=='node' and 'preview-backend.mjs' in call['args'][0]][-1]
        self.assertEqual(Path(preflight['args'][0]), installed)
        self.assertFalse(any(call['tool'] == 'codex' for call in self.service_state()['calls']))
        progress = subprocess.run([sys.executable,'-B',str(host/'progress.py')],env=self.env,text=True,capture_output=True,timeout=10)
        self.assertEqual(progress.returncode,0,progress.stderr)
        self.assertNotIn('NOTES-priority:',(self.root/'loop-progress.md').read_text())
        # The original installed entrypoint must consume the frozen permissions,
        # even when a later worker replaces its dependency path.
        private_home = self.root / 'installation-home'; private_home.mkdir()
        (self.wt / 'node_modules').symlink_to(private_home, target_is_directory=True)
        code = ('import os, runpy, sys; loaded=runpy.run_path(sys.argv[1],run_name="fixture"); '
                'loaded["context"].host.profile(sys.argv[2],sys.argv[3],dict(os.environ))')
        rejected = subprocess.run([sys.executable,'-B','-c',code,str(host/'driver.py'),str(self.wt),str(self.root)],
                                  env=self.env,text=True,capture_output=True,timeout=10)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertIn('Unapproved dependency root', rejected.stderr)

    def test_installed_entrypoint_sweeps_prs_after_their_original_tasks_ended(self):
        loop = self.root / 'loop'; (loop / 'tasks').mkdir(parents=True)
        (self.root / 'wt3').symlink_to(self.wt, target_is_directory=True)
        (loop / 'driver.py').write_text('# Legacy entrypoint\n')
        (loop / 'tasks/original.md').write_text('branch: fix/ended\ntitle: Ended work\n---\nKeep acceptance.\n')
        state = {'_planner_off': True, 'original': {'done': 1, 'pr': 700}}
        (loop / 'state.json').write_text(json.dumps(state))
        (loop / 'driver.log').write_text('12:00:00 original PR https://github.com/dgmolla/fitsy/pull/700\n')
        self.service_state(open_prs=[{'number': 700, 'head': {
            'ref': 'fix/ended', 'repo': {'full_name': 'dgmolla/fitsy'}}}],
            pr={'number': 700, 'headRefName': 'fix/ended', 'headRefOid': 'a'*40,
                'isCrossRepository': False, 'isDraft': False, 'state': 'OPEN',
                'mergeStateStatus': 'BEHIND', 'statusCheckRollup': []})
        # The installed owner's normal PATH discovers this isolated CLI at HOME.
        home = self.root / 'fixture-home'; tools = home / '.local/bin'; tools.mkdir(parents=True)
        (tools / 'gh').symlink_to(self.root / 'bin/gh')
        install.install(loop, apply=True)
        process = subprocess.Popen([sys.executable, '-B', str(loop / 'driver.py')],
                                   env={**self.env, 'HOME': str(home), 'FITSY_LOOP_ROOT': str(self.root)},
                                   text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if 'updated BEHIND PR 700' in (loop / 'driver.log').read_text(): break
                if process.poll() is not None: break
                time.sleep(0.01)
            self.assertIn('updated BEHIND PR 700', (loop / 'driver.log').read_text())
            (loop / 'STOP').touch()
            _, stderr = process.communicate(timeout=3)
            self.assertEqual(process.returncode, 0, stderr)
        finally:
            if process.poll() is None: process.kill()
            process.communicate(timeout=5)
        self.assertEqual(json.loads((loop / 'state.json').read_text()), state)
        calls = self.service_state()['calls']
        self.assertIn(['pr', 'update-branch', '700', '-R', 'dgmolla/fitsy'],
                      [call['args'] for call in calls if call['tool'] == 'gh'])

    def test_installer_rejects_dependency_symlinks_before_recording_permissions(self):
        source = self.root / 'installation/scripts/delivery/loop'; source.mkdir(parents=True)
        for name in install.FILES:
            shutil.copyfile(SOURCE / name, source / name)
        (source.parents[2] / 'node_modules').symlink_to(Path(self.env['HOME']), target_is_directory=True)
        with mock.patch.object(install, 'SOURCE', source):
            with self.assertRaisesRegex(ValueError, 'canonical directory'):
                install.sources()

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
        self.service_state(calls=[], replays=['error'], native_required=False, pr={'headRefOid': self.git('rev-parse', 'HEAD'),
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

    def test_general_review_repair_with_simulator_failure_requires_local_pass_before_push(self):
        task, s = self.task_checkout()
        pr = self.service_state()['pr']
        for check in pr['statusCheckRollup']:
            if check['name'] in ('AI review', 'Simulator'):
                check['conclusion'] = 'FAILURE'
        after = json.loads(json.dumps(pr))
        after['statusCheckRollup'][1]['conclusion'] = 'SUCCESS'
        after['statusCheckRollup'][2]['conclusion'] = 'ERROR'
        self.service_state(pr=pr, native_required=True, edit_mobile=True, live_pr_head=True,
                           candidate=str(self.wt), after_worker_pr=after)
        with mock.patch('time.sleep'), mock.patch('urllib.request.urlopen') as health:
            health.return_value.__enter__.return_value.status = 200
            with self.assertRaisesRegex(RuntimeError, 'Current-source local Maestro pass'):
                driver.run_task(str(task), s)
        calls = self.service_state()['calls']
        workers = [i for i, call in enumerate(calls) if call['tool']=='codex']
        pushes = [i for i, call in enumerate(calls) if call['tool']=='git' and call['args'][:1]==['push']]
        self.assertEqual(len(workers), 1)
        self.assertEqual(pushes, [], 'A published head needs no push; a failed repair may never publish')
        self.assertTrue(s[task.stem]['needs_local_validation'])
        self.assertNotIn('simrepair', s[task.stem])

    def test_hook_repair_revalidates_new_native_source_before_retrying_push(self):
        task, s = self.task_checkout()
        (self.wt / 'file.txt').write_text('Unpublished tooling change\n')
        self.service_state(push_error=True, edit_mobile=True, live_pr_head=True, candidate=str(self.wt))
        with mock.patch('time.sleep'), self.assertRaisesRegex(RuntimeError, 'Current-source local Maestro pass'):
            driver.run_task(str(task), s)
        calls = self.service_state()['calls']
        self.assertEqual(len([call for call in calls if call['tool']=='git' and 'push' in call['args']]), 1)
        self.assertTrue(s[task.stem]['needs_local_validation'])

    def test_pre_push_isolation_denial_never_invokes_a_code_repair_or_publishes(self):
        task, s = self.task_checkout()
        before = self.git('rev-parse', 'origin/main')
        (self.wt / 'file.txt').write_text('Pending tooling repair\n')
        self.service_state(sandbox_error='sandbox_apply: Operation not permitted')
        with mock.patch('time.sleep'), self.assertRaisesRegex(RuntimeError, 'Isolated pre-push environment recovery'):
            driver.run_task(str(task), s)
        self.assertFalse(any(call['tool']=='codex' for call in self.service_state()['calls']))
        self.assertEqual(self.git('ls-remote', 'origin', 'refs/heads/main').split()[0], before)

    def test_pre_push_signal_never_invokes_a_code_repair_or_publishes(self):
        task, s = self.task_checkout()
        before = self.git('rev-parse', 'origin/main')
        (self.wt / 'file.txt').write_text('Pending tooling repair\n')
        self.service_state(sandbox_signal=signal.SIGABRT)
        with mock.patch('time.sleep'), self.assertRaisesRegex(RuntimeError, 'Isolated pre-push environment recovery') as raised:
            driver.run_task(str(task), s)
        self.assertIn('pre-push died of signal 6', str(raised.exception))
        calls = self.service_state()['calls']
        self.assertFalse(any(call['tool']=='codex' for call in calls))
        self.assertEqual(len([call for call in calls if call['tool']=='git' and call['args'][:1]==['push']]), 1)
        self.assertEqual(self.git('ls-remote', 'origin', 'refs/heads/main').split()[0], before)

    def test_actual_driver_isolates_verifier_credentials_and_preserves_both_hook_checks(self):
        task, s = self.task_checkout()
        hook = self.wt / '.githooks/pre-push'; hook.parent.mkdir()
        hook.write_bytes((SOURCE.parents[2] / '.githooks/pre-push').read_bytes())
        hook.chmod(0o755)
        commit_hook = hook.with_name('pre-commit')
        commit_hook.write_text('#!/bin/sh\nmkdir -p .evidence\ntouch .evidence/untrusted-commit-hook-ran\n')
        commit_hook.chmod(0o755)
        self.git('config', 'core.hooksPath', '.githooks')
        verifier = self.wt / 'scripts/verify/run.mjs'; verifier.parent.mkdir(parents=True)
        verifier.write_text('''import fs from 'node:fs';
fs.mkdirSync('.evidence', {recursive:true});
fs.appendFileSync('.evidence/verifier.jsonl', JSON.stringify({args:process.argv.slice(2),
  credentials:['GH_TOKEN','VERCEL_TOKEN','POSTGRES_PRISMA_URL','AWS_SECRET_ACCESS_KEY']
    .filter(key => key in process.env)})+'\\n');
if (fs.existsSync('.evidence/reject-hook')) process.exit(1);
''')
        (self.wt / '.gitignore').write_text('.evidence/\n')
        self.env.update(GH_TOKEN='synthetic-github', VERCEL_TOKEN='synthetic-deployment',
                        POSTGRES_PRISMA_URL='synthetic-database', AWS_SECRET_ACCESS_KEY='synthetic-cloud')
        # Compare the real ordinary hook's recipe with the authenticated driver
        # path. A changed hook contract must update the trusted caller too.
        ordinary = subprocess.run(['/bin/bash', '-p', str(hook)], cwd=self.wt,
                                  env=host.dev_environment(self.wt, self.env), capture_output=True, text=True)
        self.assertEqual(ordinary.returncode, 0, ordinary.stderr)
        report = self.wt / '.evidence/verifier.jsonl'
        expected = [json.loads(line)['args'] for line in report.read_text().splitlines()]
        self.assertEqual(len(expected), 2)
        report.unlink()
        self.service_state(replays=['error'], live_pr_head=True, candidate=str(self.wt))
        with mock.patch('time.sleep'), mock.patch('urllib.request.urlopen') as health:
            health.return_value.__enter__.return_value.status = 200
            self.assertEqual(driver.run_task(str(task), s), 'blocked')
        observed = [json.loads(line) for line in report.read_text().splitlines()]
        self.assertFalse((self.wt / '.evidence/untrusted-commit-hook-ran').exists(),
                         'Host staging must not execute candidate hooks before publication either')
        self.assertEqual([row['args'] for row in observed], expected)
        self.assertEqual([row['credentials'] for row in observed], [[], []])
        self.assertTrue(any(call['tool']=='sandbox-exec' and '/scripts/verify/run.mjs' in ' '.join(call['args'])
                            for call in self.service_state()['calls']))
        self.assertEqual(self.git('rev-parse', 'origin/main'), self.git('rev-parse', 'HEAD'))
        # A real failed verification must refuse the next publication.
        before = self.git('rev-parse', 'origin/main')
        (self.wt / 'file.txt').write_text('Must not be published after a failed hook\n')
        self.git('add', 'file.txt'); self.git('commit', '-qm', 'unverified fixture')
        (self.wt / '.evidence/reject-hook').touch()
        rejected = host.publish(self.wt, 'main', self.env)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertEqual(self.git('ls-remote', 'origin', 'refs/heads/main').split()[0], before)

    def test_requeued_repair_revalidates_after_merging_new_source_before_push(self):
        task, s = self.task_checkout(needs_local_validation=True, simrepair=2)
        task.write_text('---\nbranch: codex/issue-583\ntitle: Shuffle\npr: 585\n---\nImplement shuffle\n')
        self.git('checkout', '-qb', 'codex/issue-583')
        self.git('push', '-q', '-u', 'origin', 'codex/issue-583')
        st = s[task.stem]
        base = self.git('rev-parse', 'HEAD')
        (self.wt / 'main-update.txt').write_text('new main source\n')
        self.git('add', '.'); self.git('commit', '-qm', 'advance main')
        self.git('push', '-q', 'origin', 'HEAD:main')
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



class SandboxProfileTest(unittest.TestCase):
    def setUp(self):
        controls = tempfile.TemporaryDirectory(); self.addCleanup(controls.cleanup)
        (Path(controls.name) / 'dependency-roots.json').write_text('[]')
        patcher = mock.patch.object(host, 'CONTROLS', Path(controls.name)); patcher.start(); self.addCleanup(patcher.stop)
        repo = tempfile.TemporaryDirectory(); self.addCleanup(repo.cleanup)
        subprocess.run(['git', 'init', '-q', repo.name], check=True)
        self.repo = Path(repo.name)

    def test_profile_permits_root_listing_only(self):
        with tempfile.TemporaryDirectory() as d:
            policy = host.profile(self.repo, Path(d), {'HOME': d, 'PATH': os.environ['PATH']})
        self.assertIn('(require-not (literal "/"))', policy)
        self.assertNotIn('(require-not (subpath "/"))', policy)

    @unittest.skipUnless(sys.platform == 'darwin' and Path(host.SANDBOX).exists(), 'macOS sandbox only')
    def test_sandboxed_process_starts_without_dyld_abort(self):
        # Regression: denying "/" made dyld abort every hook (signal 6).
        with tempfile.TemporaryDirectory() as d:
            policy = Path(d) / 'p.sb'
            policy.write_text(host.profile(self.repo, Path(d), {'HOME': d, 'PATH': os.environ['PATH']}))
            result = subprocess.run([host.SANDBOX, '-f', str(policy), '/bin/bash', '-p', '-c', 'true'], timeout=30)
        self.assertEqual(result.returncode, 0)

    @unittest.skipUnless(sys.platform == 'darwin' and Path(host.SANDBOX).exists(), 'macOS sandbox only')
    def test_sandbox_writes_dev_null_but_not_home(self):
        # Regression: Maestro's launcher died on "/dev/null: Operation not permitted".
        with tempfile.TemporaryDirectory() as d, tempfile.TemporaryDirectory(dir=Path.home()) as outside:
            policy = Path(d) / 'p.sb'
            policy.write_text(host.profile(self.repo, Path(d), {'HOME': str(Path.home()), 'PATH': os.environ['PATH']}))
            ok = subprocess.run([host.SANDBOX, '-f', str(policy), '/bin/bash', '-p', '-c', ': > /dev/null'], timeout=30)
            denied = subprocess.run([host.SANDBOX, '-f', str(policy), '/bin/bash', '-p', '-c',
                                     ': > ' + shlex.quote(str(Path(outside) / 'x'))], timeout=30, capture_output=True)
        self.assertEqual(ok.returncode, 0)
        self.assertNotEqual(denied.returncode, 0)


class SandboxRegexTest(unittest.TestCase):
    def test_claim_staging_regex_is_raw_posix(self):
        escaped = host.posix_escape('/Users/a-b/.fitsy-sim-claim.json.')
        self.assertEqual(escaped, '/Users/a-b/\\.fitsy-sim-claim\\.json\\.')
        self.assertNotIn('\\-', escaped)


class GitconfigIsolationTest(unittest.TestCase):
    def test_scratch_gitconfig_drops_host_credentials(self):
        with tempfile.TemporaryDirectory() as home, tempfile.TemporaryDirectory() as scratch:
            Path(home, '.gitconfig').write_text('[user]\n\tname = Dev\n[http]\n\textraHeader = Authorization: Bearer SYNTHETIC\n')
            env = {'HOME': home, 'PATH': os.environ['PATH']}
            config = host.scratch_gitconfig(scratch, env).read_text()
            self.assertIn('Dev', config)
            self.assertNotIn('SYNTHETIC', config)


class PreflightTest(unittest.TestCase):
    def setUp(self):
        import preflight
        self.preflight = preflight
        d = tempfile.TemporaryDirectory(); self.addCleanup(d.cleanup)
        self.dir = Path(d.name).resolve()
        home = mock.patch.dict(os.environ, HOME=str(self.dir)); home.start(); self.addCleanup(home.stop)
        self.root = self.dir / 'repo'
        for name in ('node_modules', 'apps/mobile/node_modules', 'scripts/deploy', '.config/fitsy-e2e', 'jdk/bin'):
            (self.root / name if not name.startswith(('.', 'jdk')) else self.dir / name).mkdir(parents=True)
        for name in preflight.BASELINES:
            (self.root / name).write_text('{"build_number": "7"}')
        (self.dir / '.config/fitsy-e2e/fitsy-fixtures.json').write_text('{"fixtures": {"entitled": {}}}')
        for path in (self.dir / 'maestro', self.dir / 'jdk/bin/java'):
            path.write_text('#!/bin/sh\n'); path.chmod(0o755)
        self.settings = self.dir / 'loop.env'
        self.settings.write_text('# loop\nFITSY_XCTEST_SIM_UDID=SIM-1\nexport FITSY_SIM_OWNER="loop"\n'
                                 f'MAESTRO_BIN={self.dir}/maestro\nJAVA_HOME={self.dir}/jdk\n'
                                 'EXPO_PUBLIC_API_URL=https://dev.fitsy.org\n'
                                 'FITSY_E2E_FIXTURES=~/.config/fitsy-e2e/fitsy-fixtures.json\n')
        self.env = {'FITSY_LOOP_SETTINGS': str(self.settings)}
        preflight.load_settings(self.env)
        self.sims = mock.Mock(return_value=mock.Mock(stdout='iPhone 15 (SIM-1) (Booted)'))

    def check(self, **overrides):
        return self.preflight.check(self.root, {**self.env, **overrides}, run=self.sims, sandbox=lambda *a: None)

    def test_settings_file_parses_quotes_exports_and_home(self):
        self.assertEqual(self.env['FITSY_SIM_OWNER'], 'loop')
        self.assertTrue(self.env['FITSY_E2E_FIXTURES'].startswith(str(Path.home())))
        self.assertTrue(self.preflight.read_settings(self.settings))

    def test_complete_host_passes(self):
        self.assertEqual(self.check(), [])

    def test_each_missing_prerequisite_fails_closed(self):
        cases = {
            'FITSY_XCTEST_SIM_UDID': ({'FITSY_XCTEST_SIM_UDID': 'SIM-404'}, 'does not exist'),
            'owner': ({'FITSY_SIM_OWNER': ''}, 'FITSY_SIM_OWNER is not set'),
            'maestro': ({'MAESTRO_BIN': str(self.dir / 'nope')}, 'MAESTRO_BIN'),
            'java': ({'JAVA_HOME': str(self.root)}, 'JAVA_HOME'),
            'prod api': ({'EXPO_PUBLIC_API_URL': 'https://api.fitsy.org'}, 'must be https://dev.fitsy.org'),
            'fixtures outside config': ({'FITSY_E2E_FIXTURES': str(self.dir / 'f.json')}, '~/.config/fitsy-e2e'),
            'settings file': ({'FITSY_LOOP_SETTINGS': str(self.dir / 'none.env')}, 'settings file'),
        }
        for name, (overrides, expected) in cases.items():
            with self.subTest(name):
                problems = self.check(**overrides)
                self.assertTrue(any(expected in problem for problem in problems), problems)

    def test_missing_dependencies_and_baseline_fail(self):
        shutil.rmtree(self.root / 'node_modules')
        (self.root / self.preflight.BASELINES[1]).unlink()
        problems = ' '.join(self.check())
        self.assertIn('npm ci', problems)
        self.assertIn('fingerprint baseline', problems)

    def test_sandbox_runs_last_and_its_failure_is_reported(self):
        sandbox = mock.Mock(return_value='sandbox cannot start a shell that writes /dev/null')
        self.preflight.check(self.root, {**self.env, 'FITSY_SIM_OWNER': ''}, run=self.sims, sandbox=sandbox)
        sandbox.assert_not_called()
        problems = self.preflight.check(self.root, self.env, run=self.sims, sandbox=sandbox)
        self.assertEqual(problems, ['sandbox cannot start a shell that writes /dev/null'])
        self.assertIn('no tasks will run', self.preflight.message(problems))

    def test_launchagent_template_points_at_settings_file(self):
        agent = plistlib.loads((SOURCE / 'org.fitsy.loop-driver.plist').read_bytes())
        self.assertEqual(agent['EnvironmentVariables']['FITSY_LOOP_SETTINGS'], '__HOME__/.config/fitsy-loop/loop.env')
        self.assertIn('preflight.py', install.FILES)


if __name__ == '__main__':
    unittest.main()
