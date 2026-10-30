import hashlib
#!/usr/bin/env python3
"""Exercise actual release callers with only GitHub/Vercel boundaries replaced."""
import copy
import importlib.util
import io
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gate = load('routine-release')


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fitsy-release-')
        self.root = Path(self.temp.name)
        self.source = 'a' * 40
        self.prefix = f'repos/{gate.REPO}/'
        self.rows = {}
        verify = {'id': 20, 'path': '.github/workflows/verify.yml',
                  'event': 'push', 'head_branch': 'main', 'head_sha': self.source,
                  'repository': {'full_name': gate.REPO}, 'head_repository': {'full_name': gate.REPO},
                  'status': 'completed', 'conclusion': 'success'}
        self.event = {'workflow_run': copy.deepcopy(verify)}
        self.put('actions/runs/20', verify)
        self.put('git/ref/heads/main', {'object': {'sha': self.source}})
        self.put(f'actions/workflows/verify.yml/runs?head_sha={self.source}&event=push&per_page=1',
                 {'workflow_runs': [{'id': 20}]})
        gh = self.root / 'gh'
        gh.write_text('#!/usr/bin/env python3\nimport json,os,sys\nprint(json.dumps(json.load(open(os.environ["FIXTURE"]))[sys.argv[2]]))\n')
        gh.chmod(0o700)
        self.env = {**os.environ, 'PATH': str(self.root) + ':' + os.environ['PATH'],
                    'GITHUB_EVENT_NAME': 'workflow_run', 'GITHUB_REPOSITORY': gate.REPO,
                    'GITHUB_REF': 'refs/heads/main', 'GITHUB_RUN_ID': '30', 'GITHUB_SHA': 'f' * 40,
                    'GITHUB_EVENT_PATH': str(self.root / 'event'), 'GITHUB_OUTPUT': str(self.root / 'output'),
                    'FIXTURE': str(self.root / 'github')}

    def tearDown(self):
        self.temp.cleanup()

    def put(self, path, value):
        self.rows[self.prefix + path] = value

    def get(self, path):
        return self.rows[self.prefix + path]

    def drive(self, **env):
        (self.root / 'github').write_text(json.dumps(self.rows))
        (self.root / 'event').write_text(json.dumps(self.event))
        (self.root / 'output').write_text('')
        return subprocess.run([sys.executable, str(ROOT / 'scripts/deploy/routine-release.py')],
                              env={**self.env, **env}, text=True, capture_output=True)

    def test_actual_caller_uses_upstream_source_not_downstream_github_sha(self):
        result = self.drive()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / 'output').read_text(), f'release_sha={self.source}\n')
        self.assertEqual(json.loads(result.stdout), {'release_sha': self.source})

    def test_failed_non_main_non_push_wrong_workflow_or_repository_verify_is_refused(self):
        original = copy.deepcopy(self.rows)
        mutations = [
            ('actions/runs/20', 'conclusion', 'failure', 'successful same-repository'),
            ('actions/runs/20', 'status', 'in_progress', 'successful same-repository'),
            ('actions/runs/20', 'head_branch', 'feature', 'successful same-repository'),
            ('actions/runs/20', 'event', 'pull_request', 'successful same-repository'),
            ('actions/runs/20', 'path', '.github/workflows/other.yml', 'successful same-repository'),
            ('actions/runs/20', 'repository', {'full_name': 'attacker/fitsy'}, 'successful same-repository'),
            ('actions/runs/20', 'head_repository', {'full_name': 'attacker/fitsy'}, 'successful same-repository'),
            ('actions/runs/20', 'id', 21, 'upstream event/run mismatch'),
            ('actions/runs/20', 'head_sha', 'b' * 40, 'upstream event/run mismatch'),
        ]
        for path, key, value, reason in mutations:
            with self.subTest(path=path, key=key):
                self.rows = copy.deepcopy(original)
                self.get(path)[key] = value
                result = self.drive()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(reason, result.stderr)
                self.assertEqual((self.root / 'output').read_text(), '')

    def test_wrong_release_event_repository_or_ref_is_refused(self):
        for key, value in [('GITHUB_EVENT_NAME', 'workflow_dispatch'),
                           ('GITHUB_REPOSITORY', 'attacker/fitsy'), ('GITHUB_REF', 'refs/heads/feature')]:
            with self.subTest(key=key):
                result = self.drive(**{key: value})
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('unauthorized release event/repository/ref', result.stderr)
                self.assertEqual((self.root / 'output').read_text(), '')

    def test_superseded_main_sha_is_refused(self):
        self.get('git/ref/heads/main')['object']['sha'] = 'b' * 40
        result = self.drive()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('superseded protected main source', result.stderr)
        self.assertEqual((self.root / 'output').read_text(), '')

    def test_latest_push_verify_run_for_source_is_required(self):
        latest = self.get(f'actions/workflows/verify.yml/runs?head_sha={self.source}&event=push&per_page=1')
        for runs in ([], [{'id': 21}]):
            with self.subTest(runs=runs):
                latest['workflow_runs'] = runs
                result = self.drive()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('superseded Verify run', result.stderr)
                self.assertEqual((self.root / 'output').read_text(), '')


class GitDeploymentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        command = "process.stdout.write(JSON.stringify(require('yaml').parse(require('fs').readFileSync(process.argv[1],'utf8'))))"
        workflow = json.loads(subprocess.check_output(['node', '-e', command, str(ROOT / '.github/workflows/deploy.yml')],
                                                      cwd=ROOT, text=True))
        cls.steps = workflow['jobs']['smoke']['steps']

    def setUp(self):
        self.source = 'a' * 40
        bot = {'id': 35613825, 'login': 'vercel[bot]', 'type': 'Bot'}
        self.row = {'id': 12, 'sha': self.source, 'ref': self.source, 'environment': 'Production',
                    'creator': bot, 'production_environment': False, 'performed_via_github_app': None}
        self.url = 'https://fitsy-brnzbu5lq-dawits-projects-74b6e00f.vercel.app'
        self.status = {'id': 13, 'state': 'success', 'creator': bot, 'environment': 'Production',
                       'environment_url': self.url, 'target_url': self.url}
        # Failed observations now read public health for diagnostics. Keep every
        # scenario offline, including older refusal tests with no health fixture.
        transport = patch.object(gate.urllib.request, 'urlopen', side_effect=gate.urllib.error.URLError('offline fixture'))
        transport.start()
        self.addCleanup(transport.stop)

    def post_smoke(self, change, snapshot=None, during_health=None, missing=False):
        """Drive the real CLI selected by the workflow, replacing only transport."""
        self.trace = []
        self.post_phase = False
        self.health_response = {'status': 'ok', 'db': 'connected', 'deploymentSha': self.source}
        def github(config, endpoint):
            self.trace.append(endpoint)
            if endpoint.endswith('git/ref/heads/main'):
                return {'object': {'sha': self.source}}
            return [self.status] if '/statuses?' in endpoint else [self.row]
        def read(request, **kwargs):
            self.trace.append(request.full_url)
            if self.post_phase and during_health and request.full_url == 'https://fitsy.org/api/health':
                during_health()
            return io.StringIO(json.dumps(self.health_response))
        with tempfile.TemporaryDirectory(prefix='fitsy-post-smoke-') as directory, \
                patch.object(gate, 'github', side_effect=github), \
                patch.object(gate.urllib.request, 'urlopen', side_effect=read):
            output = io.StringIO()
            with patch.object(sys, 'argv', ['routine-release.py', 'observe', self.source]), patch('sys.stdout', output):
                gate.main()
            path = Path(directory) / 'vercel-deployment.json'
            path.write_text(output.getvalue() if snapshot is None else snapshot)
            if missing:
                path.unlink()
            change()
            self.trace.clear()
            self.post_phase = True
            command = next(step['run'] for step in self.steps if step.get('name') == 'Verify serving identity after smoke')
            args = [arg.replace('$RELEASE_SHA', self.source).replace('$RUNNER_TEMP', directory)
                    for arg in shlex.split(command)]
            self.assertEqual(args[:2], ['python3', 'scripts/deploy/routine-release.py'])
            final = io.StringIO()
            with patch.object(sys, 'argv', args[1:]), patch('sys.stdout', final):
                gate.main()
            return json.loads(final.getvalue())

    def test_actual_post_smoke_cli_refuses_new_pending_attempt_despite_healthy_old_source(self):
        def retry():
            self.row = dict(self.row, id=14)
            self.status = dict(self.status, state='pending')
        with self.assertRaises(ValueError):
            self.post_smoke(retry)

    def test_actual_post_smoke_cli_passes_unchanged_and_rechecks_after_health(self):
        result = self.post_smoke(lambda: None)
        self.assertEqual(result['deployment']['id'], 12)
        checks = [index for index, call in enumerate(self.trace) if '/deployments?' in call]
        self.assertEqual(len(checks), 2)
        self.assertLess(checks[0], self.trace.index(self.url + '/api/health'))
        self.assertGreater(checks[1], self.trace.index('https://fitsy.org/api/health'))
        self.assertTrue(self.trace[-1].endswith('git/ref/heads/main'))

    def test_actual_post_smoke_cli_refuses_failed_replaced_and_mid_health_attempts(self):
        original = copy.deepcopy((self.row, self.status))
        for replacement, state in ((False, 'pending'), (False, 'failure'), (True, 'failure'), (True, 'success')):
            self.row, self.status = copy.deepcopy(original)
            def change():
                self.status['state'] = state
                if replacement:
                    self.row['id'] = 14
                    self.status.update(environment_url=self.url.replace('brnzbu5lq', 'new'),
                                       target_url=self.url.replace('brnzbu5lq', 'new'))
            with self.subTest(replacement=replacement, state=state), self.assertRaises(ValueError):
                self.post_smoke(change)
        self.row, self.status = copy.deepcopy(original)
        def change_url():
            self.status.update(environment_url=self.url.replace('brnzbu5lq', 'new'),
                               target_url=self.url.replace('brnzbu5lq', 'new'))
        with self.assertRaises(ValueError):
            self.post_smoke(change_url)
        self.row, self.status = copy.deepcopy(original)
        def started_during_health():
            self.row['id'] = 14
            self.status['state'] = 'pending'
        with self.assertRaises(ValueError):
            self.post_smoke(lambda: None, during_health=started_during_health)
        self.assertEqual(sum('/deployments?' in call for call in self.trace), 2)

    def test_actual_post_smoke_cli_requires_readable_raw_snapshot_and_healthy_source(self):
        for value in ('', '{}', '[]', 'null'):
            with self.subTest(snapshot=value), self.assertRaises((ValueError, KeyError, TypeError)):
                self.post_smoke(lambda: None, snapshot=value)
        with self.assertRaises(FileNotFoundError):
            self.post_smoke(lambda: None, missing=True)
        with patch.object(sys, 'argv', ['routine-release.py', 'health', self.source]), \
                patch.object(gate, 'github') as read, self.assertRaises(ValueError):
            gate.main()
        read.assert_not_called()
        for value in ({'deploymentSha': 'b' * 40}, {'db': 'unreachable'}):
            with self.subTest(health=value), self.assertRaises(ValueError):
                self.post_smoke(lambda: self.health_response.update(value))

    def test_actual_workflow_preserves_snapshot_and_cannot_mask_observer_failure(self):
        observe = next(step['run'] for step in self.steps if step.get('name', '').startswith('Observe the exact'))
        lines = observe.strip().splitlines()
        snapshot = '$RUNNER_TEMP/vercel-deployment.json'
        self.assertEqual(shlex.split(lines[0])[-2:], ['>', snapshot])
        self.assertEqual(shlex.split(lines[1]), ['cat', snapshot])
        final = next(step['run'] for step in self.steps if step.get('name') == 'Verify serving identity after smoke')
        self.assertEqual(shlex.split(final)[-2:], ['$RELEASE_SHA', snapshot])
        with tempfile.TemporaryDirectory(prefix='fitsy-observe-failure-') as directory:
            root = Path(directory)
            (root / 'python3').write_text('#!/bin/bash\nprintf partial-json\nexit 7\n')
            (root / 'cat').write_text('#!/bin/bash\ntouch "$RUNNER_TEMP/display-ran"\n')
            for name in ('python3', 'cat'):
                (root / name).chmod(0o700)
            result = subprocess.run(['bash', '-e', '-c', observe], text=True, capture_output=True,
                                    env={**os.environ, 'RUNNER_TEMP': directory, 'RELEASE_SHA': self.source,
                                         'PATH': directory + ':' + os.environ['PATH']})
            self.assertEqual(result.returncode, 7, result.stderr)
            self.assertFalse((root / 'display-ran').exists())

    def result(self):
        with patch.object(gate, 'github', side_effect=[[self.row], [self.status]]):
            return gate.deployment(self.source)

    def test_actual_git_producer_shape_does_not_require_invented_app_or_production_boolean(self):
        self.assertEqual(self.result(), {'deployment': self.row, 'status': self.status})

    def test_wrong_source_issuer_environment_url_or_failed_build_cannot_pass(self):
        for key, value in [('sha', 'b' * 40), ('creator', {'id': 1}), ('environment', 'Preview')]:
            original = self.row[key]
            self.row[key] = value
            self.assertIsNone(self.result())
            self.row[key] = original
        for key, value in [('state', 'failure'), ('state', 'error'), ('state', 'inactive'),
                           ('creator', {'id': 1}), ('environment', 'Preview'),
                           ('target_url', 'https://attacker.invalid'), ('environment_url', 'https://attacker.invalid')]:
            original = self.status[key]
            self.status[key] = value
            with self.assertRaises(ValueError):
                self.result()
            self.status[key] = original
        with patch.object(gate, 'github', side_effect=[[self.row, self.row], [dict(self.status, state='failure')]]) as read:
            with self.assertRaises(ValueError):
                gate.deployment(self.source)
            self.assertEqual(read.call_count, 2)

    def test_pending_then_ready_actual_observer_requires_both_health_reads_and_current_main(self):
        result = self.result()
        with patch.object(gate, 'deployment', side_effect=[None, result]), patch.object(gate, 'current') as current, \
                patch.object(gate, 'health') as health, patch.object(gate.time, 'sleep'):
            gate.observe(self.source)
            self.assertEqual(health.call_args_list, [unittest.mock.call(self.source, self.url), unittest.mock.call(self.source)])
            self.assertEqual(current.call_count, 3)
        with patch.object(gate, 'deployment', return_value=result), patch.object(gate, 'current'), \
                patch.object(gate, 'health', side_effect=ValueError('source mismatch')), patch.object(gate.time, 'sleep'):
            with self.assertRaisesRegex(ValueError, 'not observed'):
                gate.observe(self.source)

    def failed_observation(self, response, *, state='error', transport_error=None):
        self.status['state'] = state
        self.status['log_url'] = self.log_url
        self.trace = []

        def github(config, endpoint):
            self.trace.append(endpoint)
            if endpoint.endswith('git/ref/heads/main'):
                return {'object': {'sha': self.source}}
            return [self.status] if '/statuses?' in endpoint else [self.row]

        output = io.StringIO()
        with patch.object(gate, 'github', side_effect=github), \
                patch.object(gate.urllib.request, 'urlopen',
                             return_value=io.StringIO(json.dumps(response)), side_effect=transport_error) as read, \
                patch.object(sys, 'argv', ['routine-release.py', 'observe', self.source]), \
                patch('sys.stdout', output), self.assertRaises(ValueError) as failure:
            gate.main()
        self.assertEqual(output.getvalue(), '', 'a failed observation must never emit a successful receipt')
        self.assertEqual(self.trace, [
            f'repos/{gate.REPO}/git/ref/heads/main', f'repos/{gate.REPO}/git/ref/heads/main',
            f'repos/{gate.REPO}/deployments?sha={self.source}&environment=Production&per_page=100',
            f'repos/{gate.REPO}/deployments/{self.row["id"]}/statuses?per_page=1',
        ], 'a terminal failure must not retry or select another deployment')
        return str(failure.exception), read

    log_url = 'https://vercel.com/dawits-projects-74b6e00f/fitsy-api/AC5ozgRAfyb2VX7bqMDyfYZqFNEL'

    def test_failed_observer_recovers_exact_logs_from_real_issue_650_status_shape(self):
        self.source = '605560241b8c076bef45585457175317d491f2b0'
        self.row.update(id=7409367502, sha=self.source, ref=self.source)
        self.log_url = 'https://fitsy-128l2az42-dawits-projects-74b6e00f.vercel.app'
        provider_id = '7coDSBVrAKVpB5zT45D2aUufd3LT'
        self.status.update(environment_url=self.log_url, target_url=self.log_url,
                           description='Deployment has failed \u2014 run this Vercel CLI command: '
                           f'npx vercel inspect dpl_{provider_id} --logs')
        serving = 'bfd87f8fbd7ee9863554e973870f6988248d102f'
        message, _ = self.failed_observation(
            {'status': 'ok', 'db': 'connected', 'deploymentSha': serving}, state='failure')
        self.assertIn(f'build/migration logs: https://vercel.com/dawits-projects-74b6e00f/fitsy-api/{provider_id};', message)
        self.assertIn('deployment=7409367502', message)
        self.assertIn(f'source={self.source}', message)
        self.assertIn(f'fitsy.org serving source: {serving}', message)
        self.assertNotIn('npx vercel', message)

    def test_failed_observer_rejects_unknown_or_injected_provider_failure_descriptions(self):
        self.log_url = self.url
        description = ('Deployment has failed \u2014 run this Vercel CLI command: '
                       'npx vercel inspect dpl_privateProviderDetail --logs')
        for value in (None, 7, {}, [description], 'private-provider-detail',
                      description + '\n', description + '; private-provider-detail',
                      description.replace('privateProviderDetail', '../private-provider-detail'),
                      description.replace('privateProviderDetail', 'id?token=private-provider-detail'),
                      description.replace('inspect', 'remove')):
            with self.subTest(description=value):
                self.status['description'] = value
                message, _ = self.failed_observation({})
                self.assertIn('build/migration logs: https://vercel.com/dawits-projects-74b6e00f/fitsy-api/deployments;', message)
                self.assertNotIn('privateProviderDetail', message)
                self.assertNotIn('private-provider-detail', message)

    def test_failed_observer_reports_exact_deployment_logs_and_older_serving_source(self):
        serving = 'bfd87f8fbd7ee9863554e973870f6988248d102f'
        for state in ('failure', 'error', 'inactive'):
            with self.subTest(state=state):
                message, read = self.failed_observation(
                    {'status': 'ok', 'db': 'connected', 'deploymentSha': serving}, state=state)
                self.assertIn(f'state={state}', message)
                self.assertIn(f'source={self.source}', message)
                self.assertIn('deployment=12', message)
                self.assertIn(self.log_url, message)
                self.assertIn(f'fitsy.org serving source: {serving}', message)
                self.assertIn('migration-failure-audit.sql', message)
                self.assertEqual(read.call_args.args[0].full_url, 'https://fitsy.org/api/health')
                self.assertEqual(read.call_args.kwargs['timeout'], 5)

    def test_failed_observer_preserves_failure_when_public_health_is_unavailable_or_malformed(self):
        for response, error in [(None, gate.urllib.error.URLError('private-driver-detail')),
                                ([], None), ({'deploymentSha': 'private-driver-detail'}, None)]:
            with self.subTest(response=response, error=error):
                message, _ = self.failed_observation(response, transport_error=error)
                self.assertIn('Vercel Git production deployment failed or inactive', message)
                self.assertIn('fitsy.org serving source: unavailable', message)
                self.assertNotIn('private-driver-detail', message)
                self.assertIn(self.log_url, message)

    def test_failed_observer_omits_untrusted_log_urls_and_provider_descriptions(self):
        self.status['description'] = 'private-provider-detail'
        for url in ('https://attacker.invalid/private-token', self.log_url + '?token=private-token',
                    self.log_url.replace('/fitsy-api/', '/other-project/'), None):
            with self.subTest(url=url):
                self.log_url = url
                message, _ = self.failed_observation({})
                self.assertIn('https://vercel.com/dawits-projects-74b6e00f/fitsy-api/deployments', message)
                self.assertNotIn('private-token', message)
                self.assertNotIn('private-provider-detail', message)
                self.assertNotIn('other-project', message)

    def test_public_health_must_report_exact_source_and_connected_database(self):
        import io
        healthy = {'status': 'ok', 'db': 'connected', 'deploymentSha': self.source}
        for key, value in [(None, None), ('deploymentSha', 'b' * 40), ('db', 'unreachable')]:
            data = dict(healthy)
            if key:
                data[key] = value
            with patch.object(gate.urllib.request, 'urlopen', return_value=io.StringIO(json.dumps(data))) as read:
                if key:
                    with self.assertRaises(ValueError):
                        gate.health(self.source)
                else:
                    gate.health(self.source)
                self.assertEqual(read.call_args.args[0].full_url, 'https://fitsy.org/api/health')


class ProductionIncidentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fitsy-incident-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        command = "process.stdout.write(JSON.stringify(require('yaml').parse(require('fs').readFileSync(process.argv[1],'utf8'))))"
        workflow = json.loads(subprocess.check_output(['node', '-e', command,
                              str(ROOT / '.github/workflows/deploy.yml')], cwd=ROOT, text=True))
        step = next(step for step in workflow['jobs']['smoke']['steps'] if step.get('name') == 'File incident on failure')
        self.assertEqual(step['if'], 'failure()')
        self.command = step['run']
        self.source = '1d479eabe7ee293280229a1e55a8471dd8a290c4'
        self.state = self.root / 'github.json'
        self.write_state({'issues': [], 'comments': {}, 'calls': []})
        gh = self.root / 'gh'
        gh.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
path = Path(os.environ['INCIDENT_FIXTURE'])
state = json.loads(path.read_text())
args = sys.argv[1:]
state['calls'].append(args)
path.write_text(json.dumps(state))
if args[0] == 'api':
    endpoint = args[1]
    assert args[2:] == ['--paginate', '--slurp'], args
    assert endpoint.startswith('repos/dgmolla/fitsy/issues'), endpoint
    if state.get('read_error') == 'all' or state.get('read_error', 'never-match') in endpoint:
        sys.exit(1)
    if '/comments?' in endpoint:
        number = endpoint.split('/')[4]
        rows = state['comments'].get(number, [])
    else:
        assert endpoint == 'repos/dgmolla/fitsy/issues?state=open&labels=incident&per_page=100', endpoint
        rows = [row for row in state['issues'] if row['state'] == 'open']
    print(json.dumps([rows[i:i+100] for i in range(0, len(rows), 100)] or [[]]))
else:
    assert args[:2] in (['issue', 'create'], ['issue', 'comment']), args
    repository = args[args.index('--repo')+1] if '--repo' in args else os.environ['GITHUB_REPOSITORY']
    assert repository == 'dgmolla/fitsy', args
    body = Path(args[args.index('--body-file')+1]).read_text()
    if args[1] == 'create':
        number = max([row['number'] for row in state['issues']] + [659]) + 1
        state['issues'].append({'number': number, 'state': 'open', 'body': body,
                                'title': args[args.index('--title')+1]})
    else:
        number = int(args[2])
        state['comments'].setdefault(str(number), []).append({'body': body})
    path.write_text(json.dumps(state))
    if state.get('write_error'):
        sys.exit(1)
    print(f'https://github.com/dgmolla/fitsy/issues/{number}')
''')
        gh.chmod(0o700)

    def write_state(self, state):
        self.state.write_text(json.dumps(state))

    def read_state(self):
        return json.loads(self.state.read_text())

    def drive(self, **env):
        return subprocess.run(['bash', '--noprofile', '--norc', '-euo', 'pipefail', '-c', self.command],
                              cwd=ROOT, text=True, capture_output=True, timeout=15,
                              env={**os.environ, 'PATH': str(self.root) + ':' + os.environ['PATH'],
                                   'RUNNER_TEMP': str(self.root), 'RELEASE_SHA': self.source,
                                   'GITHUB_SERVER_URL': 'https://github.com', 'GITHUB_REPOSITORY': gate.REPO,
                                   'GITHUB_RUN_ID': '40991993679', 'GITHUB_RUN_ATTEMPT': '1',
                                   'INCIDENT_FIXTURE': str(self.state), **env})

    def test_same_failed_release_is_reported_once_through_the_actual_workflow(self):
        for _ in range(2):
            result = self.drive()
            self.assertEqual(result.returncode, 0, result.stderr)
        state = self.read_state()
        self.assertEqual(len(state['issues']), 1)
        self.assertEqual(state['comments'], {})
        body = state['issues'][0]['body']
        self.assertTrue(body.startswith('**TL;DR:**'))
        self.assertIn('https://github.com/dgmolla/fitsy/actions/runs/40991993679', body)
        self.assertIn(f'https://github.com/dgmolla/fitsy/commit/{self.source}', body)
        self.assertIn('P3009', body)
        self.assertIn('separately authorized', body)
        self.assertIn('production-migration-recovery.yml', body)
        self.assertNotIn('KNOWN_GOOD_URL', body)

    def test_later_sources_and_rerun_attempts_append_evidence_without_rewriting_history(self):
        self.assertEqual(self.drive().returncode, 0)
        original = copy.deepcopy(self.read_state()['issues'])
        next_source = 'cc16ffb62d1b08cfaac8721436a1435b2ea5f86e'
        for attempt in ('1', '2', '2'):
            result = self.drive(RELEASE_SHA=next_source, GITHUB_RUN_ID='40992500000', GITHUB_RUN_ATTEMPT=attempt)
            self.assertEqual(result.returncode, 0, result.stderr)
        state = self.read_state()
        self.assertEqual(state['issues'], original)
        comments = state['comments']['660']
        self.assertEqual(len(comments), 2)
        for index, row in enumerate(comments, 1):
            self.assertTrue(row['body'].startswith('**TL;DR:**'))
            self.assertIn(f'/commit/{next_source}', row['body'])
            self.assertIn(f'/actions/runs/40992500000/attempts/{index}', row['body'])
        self.assertEqual(sum(call[:2] == ['issue', 'create'] for call in state['calls']), 1)

    def test_legacy_incident_is_adopted_without_duplicating_its_original_run(self):
        issue = {'number': 660, 'state': 'open', 'title': 'incident: prod release failed at 1d479ea',
                 'body': f'Source: {self.source}\n[Deploy logs](https://github.com/dgmolla/fitsy/actions/runs/40991993679)'}
        unrelated = {'number': 640, 'state': 'open', 'title': 'incident: OTA publish failed', 'body': ''}
        closed = {**issue, 'number': 643, 'state': 'closed'}
        pull = {**issue, 'number': 639, 'pull_request': {}}
        original = [unrelated, issue, closed, pull]
        self.write_state({'issues': original, 'comments': {}, 'calls': []})
        self.assertEqual(self.drive().returncode, 0)
        self.assertEqual(self.read_state()['comments'], {})
        result = self.drive(GITHUB_RUN_ID='40992500000')
        self.assertEqual(result.returncode, 0, result.stderr)
        state = self.read_state()
        self.assertEqual(state['issues'], original)
        self.assertEqual(list(state['comments']), ['660'])

    def test_paginated_incidents_and_comments_preserve_a_later_page_receipt(self):
        self.assertEqual(self.drive().returncode, 0)
        state = self.read_state()
        incident = state['issues'][0]
        state['issues'] = [{'number': number, 'state': 'open', 'title': 'unrelated incident', 'body': ''}
                           for number in range(100, 200)] + [incident]
        state['issues'].insert(0, {**incident, 'number': 50, 'title': 'incident: prod release failed at bfd87f8',
                                   'body': 'Legacy issue without a reporting marker'})
        state['comments']['660'] = [{'body': 'Historical evidence'} for _ in range(100)]
        self.write_state(state)
        self.assertEqual(self.drive(GITHUB_RUN_ID='40992500000').returncode, 0)
        self.assertEqual(self.drive(GITHUB_RUN_ID='40992500000').returncode, 0)
        state = self.read_state()
        self.assertEqual(len(state['issues']), 102)
        self.assertEqual(list(state['comments']), ['660'])
        self.assertEqual(len(state['comments']['660']), 101)

    def test_closed_incident_starts_a_new_report_without_reopening_or_editing_it(self):
        self.assertEqual(self.drive().returncode, 0)
        state = self.read_state()
        state['issues'][0]['state'] = 'closed'
        original = copy.deepcopy(state['issues'][0])
        self.write_state(state)
        result = self.drive(GITHUB_RUN_ID='40992500000')
        self.assertEqual(result.returncode, 0, result.stderr)
        state = self.read_state()
        self.assertEqual(state['issues'][0], original)
        self.assertEqual(len(state['issues']), 2)
        self.assertEqual(state['issues'][1]['state'], 'open')

    def test_failed_reads_or_uncertain_writes_never_create_a_fallback_or_repeat_a_write(self):
        self.assertEqual(self.drive().returncode, 0)
        original = self.read_state()
        for error in ('all', '/comments?'):
            with self.subTest(error=error):
                self.write_state({**original, 'calls': [], 'read_error': error})
                result = self.drive(GITHUB_RUN_ID='40992500000')
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn('inspect the GitHub outcome', result.stderr)
                self.assertFalse(any(call[0] == 'issue' for call in self.read_state()['calls']))
        for issues in ([], original['issues']):
            with self.subTest(existing=bool(issues)):
                self.write_state({'issues': issues, 'comments': {}, 'calls': [], 'write_error': True})
                result = self.drive(GITHUB_RUN_ID='40992500000')
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(sum(call[0] == 'issue' for call in self.read_state()['calls']), 1)

    def test_invalid_source_run_or_repository_is_refused_before_github_access(self):
        for env in ({'RELEASE_SHA': 'bad;source'}, {'GITHUB_RUN_ID': '1/other'},
                    {'GITHUB_RUN_ATTEMPT': '0'}, {'GITHUB_REPOSITORY': 'other/fitsy'},
                    {'GITHUB_SERVER_URL': 'https://attacker.invalid'}):
            with self.subTest(env=env):
                result = self.drive(**env)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(self.read_state()['calls'], [])


class VercelBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Reuse synthetic signing material across subprocesses, preserving real
        # JWT verification without repeated RSA generation in the bounded suite.
        cls.oidc_keys = json.loads(subprocess.check_output(['node', '-e', '''
const { generateKeyPairSync } = require('node:crypto');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.stdout.write(JSON.stringify({
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  publicKey: publicKey.export({ format: 'jwk' }),
}));
'''], text=True))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fitsy-vercel-build-')
        self.root = Path(self.temp.name)
        for name in ('scripts/dev/vercel-build.sh', 'scripts/deploy/migrate-prod.sh', 'scripts/lib/db-target-guard.ts',
                     'apps/api/services/rateLimitStoreConfig.ts', 'scripts/deploy/pipeline-roles-approval.mjs',
                     'scripts/deploy/activate-runtime-role.ts', 'scripts/deploy/runtime-migrations-preflight.ts',
                     'scripts/deploy/migration-failure-audit.ts', 'scripts/deploy/migration-failure-audit.sql',
                     'prisma/schema.prisma', 'prisma/migrations/migration_lock.toml',
                     'prisma/migrations/20261028120000_pipeline_writer_roles/migration.sql',
                     'prisma/migrations/20261028130000_hex_jobs/migration.sql',
                     'prisma/migrations/20261028140000_pipeline_ue_rate_limit/migration.sql',
                     'prisma/migrations/20261028150000_pipeline_pdf_jobs/migration.sql',
                     'prisma/migrations/20261029010000_widget_search_tokens/migration.sql'):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        # Migrations on either side of the held role change must still deploy.
        for name in ('20261028110000_unrelated_before', '20261028130000_unrelated_after'):
            target = self.root / 'prisma/migrations' / name
            target.mkdir()
            (target / 'migration.sql').write_text('SELECT 1;\n')
        # The deployment preflight and shared quota service execute unchanged;
        # substitute only the external Redis REST transport, never its caller.
        for name in ('scripts/deploy/rate-limit-preflight.ts', 'apps/api/services/rateLimitStore.ts'):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        (self.root / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
        database_transport = self.root / 'database-transport.cjs'
        database_transport.write_text("""const Module = require('module'), original = Module._load;
const assert = require('node:assert/strict');
const { readFileSync, appendFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
Module._load = function(name, ...args) {
  if (name === '@prisma/client') return { PrismaClient: class {
    async $queryRaw(strings, migration) {
      assert.match(strings.join('?'), /SELECT checksum FROM public\\._prisma_migrations/);
      assert.match(strings.join('?'), /finished_at IS NOT NULL AND rolled_back_at IS NULL/);
      assert.equal(migration, '20261029010000_widget_search_tokens');
      appendFileSync(process.env.CALLS, 'runtime migration preflight\\n');
      const checksum = createHash('sha256').update(readFileSync('prisma/migrations/' + migration + '/migration.sql')).digest('hex');
      switch (process.env.RUNTIME_MIGRATION_STATE) {
        case 'missing': return [];
        case 'changed': return [{ checksum: '0'.repeat(64) }];
        case 'duplicate': return [{ checksum }, { checksum }];
        case 'driver-error': throw Error('private-fixture-database-detail');
        default: return [{ checksum }]; // A previously applied migration remains valid when held.
      }
    }
    async $transaction(fn) {
      return fn({ $queryRaw: async () => [], $executeRawUnsafe: async sql => {
        if (sql === 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY') {
          appendFileSync(process.env.CALLS, 'audit read only\\n');
          return 0;
        }
        if (sql === "SET LOCAL statement_timeout = '5s'") {
          appendFileSync(process.env.CALLS, 'audit statement timeout\\n');
          return 0;
        }
        if (process.env.ROLE_ACTIVATION_EXIT === '1') throw Error('private-fixture-password');
        return 0;
      }, $queryRawUnsafe: async sql => {
        assert.equal(sql, readFileSync('scripts/deploy/migration-failure-audit.sql', 'utf8')
          .split(';').find(statement => statement.includes('AS migration_failure_audit')));
        const preflight = process.argv.includes('--preflight');
        appendFileSync(process.env.CALLS, preflight ? 'migration history preflight\\n' : 'migration failure audit\\n');
        switch (process.env[preflight ? 'PREFLIGHT_AUDIT_STATE' : 'AUDIT_STATE']) {
          case 'driver-error': throw Error('private-fixture-database-detail');
          case 'missing': return [];
          case 'timeout': return new Promise(() => {});
          default: return [{ migration_failure_audit: JSON.parse(process.env[preflight ? 'PREFLIGHT_AUDIT_REPORT' : 'AUDIT_REPORT']) }];
        }
      } });
    }
    async $disconnect() {}
  } };
  return original.call(this, name, ...args);
};
""")
        transport = self.root / 'redis-transport.mjs' 
        transport.write_text('const { privateKey, publicKey } = ' + json.dumps(self.oidc_keys) + ''';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { sign } from 'node:crypto';
const now = Math.floor(Date.now() / 1000);
const owner = 'dawits-projects-74b6e00f';
const issuer = `https://oidc.vercel.com/${owner}`;
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const data = encode({ alg: 'RS256', kid: 'vercel-fixture' }) + '.' + encode({
  iss: issuer, aud: `https://vercel.com/${owner}`,
  sub: `owner:${owner}:project:fitsy-api:environment:production`,
  owner_id: 'team_VVc52BrZfx5IT2B1mDI5AuPT', project_id: 'prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4',
  environment: 'production', iat: now, nbf: now, exp: now + 300,
});
process.env.VERCEL_OIDC_TOKEN = data + '.' + sign('RSA-SHA256', Buffer.from(data), privateKey).toString('base64url');
globalThis.fetch = async (url, init) => {
  if (String(url) === `${issuer}/.well-known/jwks`) return Response.json({
    keys: [{ ...publicKey, kid: 'vercel-fixture', alg: 'RS256', use: 'sig' }],
  });
  assert.equal(String(url), 'https://quota.example.test/');
  assert.equal(init.headers.Authorization, 'Bearer private-fixture-token');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  const args = JSON.parse(init.body);
  assert.equal(args[0], 'EVAL');
  assert.equal(args[3], 'fitsy:rate-limit:v1:{deployment-readiness}:identities');
  assert.match(args[4], /^fitsy:rate-limit:v1:\\{deployment-readiness\\}:[a-f0-9]{64}$/);
  assert.deepEqual(args.slice(5, 8), ['1000', '1', '1000']);
  appendFileSync(process.env.CALLS, 'redis EVAL\\n');
  switch (process.env.REDIS_RESULT) {
    case 'http': return new Response('private-fixture-diagnostic', { status: 503 });
    case 'readonly': return Response.json({ error: 'private-fixture-diagnostic' });
    case 'invalid': return Response.json({ result: [1] });
    case 'denied': return Response.json({ result: [0, 0, 1000] });
    case 'timeout': return new Promise(() => {});
    default: return Response.json({ result: [1, 0, 0] });
  }
};
''')
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        command = self.bin / 'npx'
        command.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ['CALLS'], 'a') as log:
    log.write('npx ' + ' '.join(args) + '\\n')
if args[:3] == ['prisma', 'migrate', 'deploy']:
    schema = Path(args[args.index('--schema') + 1])
    migrations = sorted(path.parent.name for path in (schema.parent / 'migrations').glob('*/migration.sql'))
    Path(os.environ['MIGRATIONS']).write_text(json.dumps(migrations))
    sys.stderr.write(os.environ.get('MIGRATE_STDERR', ''))
    sys.exit(int(os.environ.get('MIGRATE_EXIT', '0')))
''')
        command.chmod(0o700)
        command = self.bin / 'npm'
        # Execute the same runtime validation used at API module load. A no-op
        # build boundary previously hid the second legacy-credential failure.
        command.write_text('''#!/bin/bash
set -eu
printf 'npm %s\\n' "$*" >> "$CALLS"
node --import tsx -e 'require("./scripts/lib/db-target-guard").assertRuntimeDatabase(process.env.POSTGRES_PRISMA_URL)'
exit "${BUILD_EXIT:-0}"
''')
        command.chmod(0o700)
        self.calls = self.root / 'calls'
        self.migrations = self.root / 'migrations.json'
        self.incident = json.loads((ROOT / 'scripts/deploy/fixtures/incident-661.json').read_text())
        self.audit = self.incident['migration_failure_audit']
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(('VERCEL', 'POSTGRES', 'SUPABASE', 'PIPELINE_DATABASE_URL', 'PROD_', 'FITSY_ALLOW_PROD', 'FITSY_PIPELINE_ROLES', 'GITHUB_ACTIONS', 'UPSTASH', 'NODE_OPTIONS'))}
        self.env.update(PATH=str(self.bin) + ':' + os.environ['PATH'], CALLS=str(self.calls),
                        MIGRATIONS=str(self.migrations),
                        AUDIT_REPORT=json.dumps(self.audit),
                        PREFLIGHT_AUDIT_REPORT=json.dumps({**self.audit, 'migration_history': []}),
                        NODE_OPTIONS=f'--require={database_transport} --import={transport}', REDIS_RESULT='ok',
                        UPSTASH_REDIS_REST_URL='https://quota.example.test',
                        UPSTASH_REDIS_REST_TOKEN='private-fixture-token',
                        VERCEL='1', VERCEL_ENV='production', VERCEL_PROJECT_ID='prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4',
                        VERCEL_GIT_PROVIDER='github', VERCEL_GIT_REPO_OWNER='dgmolla', VERCEL_GIT_REPO_SLUG='fitsy',
                        VERCEL_GIT_COMMIT_REF='main', VERCEL_GIT_COMMIT_SHA=self.incident['source'],
                        SUPABASE_URL='https://zaxkmjqozvmbifiwbxps.supabase.co',
                        FITSY_PIPELINE_ROLES_APPROVED_SHA256=hashlib.sha256((ROOT / 'prisma/migrations/20261028120000_pipeline_writer_roles/migration.sql').read_bytes()).hexdigest(),
                        POSTGRES_URL_NON_POOLING='postgresql://postgres.zaxkmjqozvmbifiwbxps:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
                        POSTGRES_PRISMA_URL='postgresql://fitsy_app.zaxkmjqozvmbifiwbxps:fixture@aws-1-us-east-1.pooler.supabase.com:6543/postgres')

    def tearDown(self):
        self.temp.cleanup()

    def drive(self, **changes):
        self.calls.write_text('')
        self.migrations.unlink(missing_ok=True)
        env = {**self.env, **changes}
        env = {key: value for key, value in env.items() if value is not None}
        result = subprocess.run(['bash', 'scripts/dev/vercel-build.sh'], cwd=self.root,
                                env=env, text=True, capture_output=True, timeout=30)
        calls = self.calls.read_text().splitlines()
        # Production uses a disposable filtered schema. Keep existing order
        # assertions while also proving the actual CLI input was removed.
        for index, call in enumerate(calls):
            if call.startswith('npx prisma migrate ') and '--schema ' in call:
                schema = call.split('--schema ', 1)[1]
                if schema != 'prisma/schema.prisma':
                    self.assertFalse(Path(schema).parent.exists(), 'temporary migration input leaked')
                    calls[index] = call.replace(schema, 'prisma/schema.prisma')
        return result, calls

    def test_failed_runtime_activation_withholds_build_and_private_driver_errors(self):
        dev = 'postgresql://postgres.kegycybiruksmrzvniha:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
        for environment in ('production', 'preview'):
            bindings = {} if environment == 'production' else {
                'SUPABASE_URL': 'https://kegycybiruksmrzvniha.supabase.co',
                'POSTGRES_URL_NON_POOLING': dev, 'POSTGRES_PRISMA_URL': dev.replace('postgres.', 'fitsy_app.')}
            result, calls = self.drive(VERCEL_ENV=environment, ROLE_ACTIVATION_EXIT='1', **bindings)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(any(call.startswith('npm') for call in calls))
            self.assertIn('Runtime database role activation failed', result.stderr)
            self.assertIn('database login activation', result.stderr)
            self.assertNotIn('activation skipped', result.stderr)
            self.assertNotIn('private-fixture-password', result.stderr)

    def test_preview_invalid_runtime_bindings_fail_instead_of_skipping(self):
        dev = 'postgresql://postgres.kegycybiruksmrzvniha:private-fixture-password@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
        for runtime in (dev.replace(':private-fixture-password@', '@'),
                        dev.replace('postgres.', 'pipeline_writer.'), dev.replace('postgres.', 'fitsy_audit_readonly.')):
            result, calls = self.drive(VERCEL_ENV='preview', SUPABASE_URL='https://kegycybiruksmrzvniha.supabase.co',
                                       POSTGRES_URL_NON_POOLING=dev, POSTGRES_PRISMA_URL=runtime)
            self.assertEqual(result.returncode, 1)
            self.assertFalse(any(call.startswith('npm') for call in calls))
            self.assertIn('Runtime database role activation failed', result.stderr)
            self.assertNotIn('activation skipped', result.stderr)
            self.assertNotIn('private-fixture-password', result.stderr)

    def test_preview_legacy_runtime_binding_skips_activation_and_builds_privately(self):
        dev = 'postgresql://postgres.kegycybiruksmrzvniha:private-fixture-password@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
        result, calls = self.drive(VERCEL_ENV='preview', SUPABASE_URL='https://kegycybiruksmrzvniha.supabase.co',
                                   POSTGRES_URL_NON_POOLING=dev, POSTGRES_PRISMA_URL=dev, ROLE_ACTIVATION_EXIT='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls[-1], 'npm run build -w apps/api')
        self.assertIn('runtime role activation skipped', result.stderr)
        self.assertIn('fitsy_app is not configured', result.stderr)
        self.assertNotIn('private-fixture-password', result.stdout + result.stderr)

    def test_unapproved_role_migration_is_held_while_other_migrations_and_build_proceed(self):
        self.assert_unapproved_role_build(626)

    def test_incident_622_build_proceeds_with_unapproved_role_sql_held(self):
        self.assert_unapproved_role_build(622)

    def test_incident_617_build_proceeds_with_unapproved_role_sql_held(self):
        self.assert_unapproved_role_build(617)

    def assert_unapproved_role_build(self, number):
        # These incidents stopped before migrations or API compilation.
        # Replay each source without executing unapproved controlled SQL.
        incident = json.loads((ROOT / f'scripts/deploy/__fixtures__/incident-{number}.json').read_text())
        role = '20261028120000_pipeline_writer_roles'
        original = {path: path.read_bytes() for path in (self.root / 'prisma/migrations').glob('*/migration.sql')}
        for approval in (None, '', 'a' * 64, 'true'):
            for runtime in (self.env['POSTGRES_PRISMA_URL'], self.env['POSTGRES_PRISMA_URL'].replace('fitsy_app.', 'postgres.')):
                with self.subTest(approval=approval, role='legacy' if 'postgres.' in runtime else 'fitsy_app'):
                    result, calls = self.drive(VERCEL_GIT_COMMIT_SHA=incident['source'],
                                               FITSY_PIPELINE_ROLES_APPROVED_SHA256=approval, POSTGRES_PRISMA_URL=runtime,
                                               ROLE_ACTIVATION_EXIT='1' if 'postgres.' in runtime else '0')
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(calls, ['redis EVAL', 'audit read only', 'audit statement timeout',
                                             'migration history preflight',
                                             'npx prisma migrate status --schema prisma/schema.prisma',
                                             'npx prisma migrate deploy --schema prisma/schema.prisma',
                                             'runtime migration preflight', 'npm run build -w apps/api'])
                    self.assertEqual(json.loads(self.migrations.read_text()),
                                     ['20261028110000_unrelated_before', '20261028130000_unrelated_after'])
                    self.assertIn('holding ' + role, result.stderr)
                    self.assertNotIn(incident['build_stderr'], result.stderr)
                    self.assertEqual({path: path.read_bytes() for path in original}, original)

    def test_held_widget_migration_withholds_build_until_its_schema_is_applied(self):
        name = '20261029010000_widget_search_tokens'
        for role in ('postgres', 'fitsy_app'):
            with self.subTest(role=role):
                runtime = self.env['POSTGRES_PRISMA_URL'].replace('fitsy_app.', role + '.')
                result, calls = self.drive(FITSY_PIPELINE_ROLES_APPROVED_SHA256=None,
                                           POSTGRES_PRISMA_URL=runtime, RUNTIME_MIGRATION_STATE='missing')
                self.assertNotEqual(result.returncode, 0, 'a held WidgetToken migration must not publish its API')
                self.assertFalse(any(call.startswith('npm') for call in calls))
                self.assertIn(name, result.stderr)
                self.assertNotIn(name, json.loads(self.migrations.read_text()))
                self.assertEqual(sum(call.startswith('npx prisma migrate deploy ') for call in calls), 1)
                self.assertFalse(any('resolve' in call for call in calls))

    def test_runtime_schema_failure_withholds_production_and_preview_builds_privately(self):
        dev = 'postgresql://postgres.kegycybiruksmrzvniha:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
        for environment in ('production', 'preview'):
            bindings = {} if environment == 'production' else {
                'POSTGRES_URL_NON_POOLING': dev, 'POSTGRES_PRISMA_URL': dev.replace('postgres.', 'fitsy_app.'),
                'SUPABASE_URL': 'https://kegycybiruksmrzvniha.supabase.co'}
            for state in ('missing', 'changed', 'duplicate', 'driver-error'):
                with self.subTest(environment=environment, state=state):
                    result, calls = self.drive(VERCEL_ENV=environment, RUNTIME_MIGRATION_STATE=state, **bindings)
                    self.assertEqual(result.returncode, 1, result.stderr)
                    self.assertFalse(any(call.startswith('npm') for call in calls))
                    self.assertEqual(calls.count('runtime migration preflight'), 1)
                    self.assertIn('Runtime migration preflight failed', result.stderr)
                    self.assertNotIn('private-fixture-database-detail', result.stderr + result.stdout)
                    self.assertNotIn('fixture@', result.stderr + result.stdout)
                    self.assertFalse(any('resolve' in call for call in calls))

    def test_matching_approval_includes_exact_role_migration(self):
        result, calls = self.drive()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls[-1], 'npm run build -w apps/api')
        self.assertEqual(json.loads(self.migrations.read_text()), [
            '20261028110000_unrelated_before', '20261028120000_pipeline_writer_roles',
            '20261028130000_hex_jobs', '20261028130000_unrelated_after',
            '20261028140000_pipeline_ue_rate_limit', '20261028150000_pipeline_pdf_jobs',
            '20261029010000_widget_search_tokens'])
        self.assertNotIn('holding ', result.stderr)

    def test_changed_role_sql_is_held_until_the_new_bytes_are_approved(self):
        sql = self.root / 'prisma/migrations/20261028120000_pipeline_writer_roles/migration.sql'
        sql.write_bytes(sql.read_bytes() + b'\n-- changed after approval\n')
        result, calls = self.drive()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls[-1], 'npm run build -w apps/api')
        self.assertEqual(json.loads(self.migrations.read_text()),
                         ['20261028110000_unrelated_before', '20261028130000_unrelated_after'])

    def test_missing_role_sql_fails_closed_without_an_unfiltered_retry(self):
        (self.root / 'prisma/migrations/20261028120000_pipeline_writer_roles/migration.sql').unlink()
        for approval in (None, self.env['FITSY_PIPELINE_ROLES_APPROVED_SHA256']):
            result, calls = self.drive(FITSY_PIPELINE_ROLES_APPROVED_SHA256=approval)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(calls, ['redis EVAL', 'audit read only', 'audit statement timeout', 'migration history preflight',
                                     'audit read only', 'audit statement timeout', 'migration failure audit'])
            self.assertFalse(self.migrations.exists())

    def test_pipeline_and_audit_credentials_cannot_become_the_app_runtime_binding(self):
        for role in ('pipeline_writer', 'fitsy_audit_readonly', 'unknown'):
            result, calls = self.drive(POSTGRES_PRISMA_URL=self.env['POSTGRES_PRISMA_URL'].replace('fitsy_app.', role + '.'))
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(calls, [])

    def test_missing_shared_store_withholds_deployment_before_migrations_or_build(self):
        for environment in ('production', 'preview'):
            for missing in ('both', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'):
                changes = {'VERCEL_ENV': environment}
                if environment == 'preview':
                    changes.update(POSTGRES_URL_NON_POOLING='postgresql://fixture:fixture@localhost:5432/dev',
                                   POSTGRES_PRISMA_URL='postgresql://fitsy_app:fixture@localhost:5432/dev')
                for key in ('UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'):
                    if missing in ('both', key):
                        changes[key] = ''
                with self.subTest(environment=environment, missing=missing):
                    result, calls = self.drive(**changes)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(calls, [])
                    self.assertIn('UPSTASH_REDIS_REST_URL', result.stderr)
                    self.assertIn('UPSTASH_REDIS_REST_TOKEN', result.stderr)
                    self.assertNotIn('private-fixture-token', result.stdout + result.stderr)

    def test_incident_602_store_recovery_preserves_guarded_build_order(self):
        incident = json.loads((ROOT / 'scripts/deploy/__fixtures__/incident-602.json').read_text())
        dev = 'postgresql://postgres.kegycybiruksmrzvniha:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
        for environment in ('production', 'preview'):
            bindings = {} if environment == 'production' else {
                'SUPABASE_URL': 'https://kegycybiruksmrzvniha.supabase.co',
                'POSTGRES_URL_NON_POOLING': dev, 'POSTGRES_PRISMA_URL': dev.replace('postgres.', 'fitsy_app.')}
            source = {'VERCEL_ENV': environment, 'VERCEL_GIT_COMMIT_SHA': incident['source'], **bindings}
            # The retained diagnostic does not reveal which binding failed.
            # Cover absent configuration and a configured but unwritable store.
            for failure, expected_calls in (({'UPSTASH_REDIS_REST_URL': '', 'UPSTASH_REDIS_REST_TOKEN': ''}, []),
                                            ({'REDIS_RESULT': 'readonly'}, ['redis EVAL'])):
                with self.subTest(environment=environment, failure=list(failure)):
                    result, calls = self.drive(**source, **failure)
                    self.assertEqual(result.returncode, 1, result.stderr)
                    self.assertIn(incident['build_stderr'], result.stderr)
                    self.assertEqual(calls, expected_calls)
                    self.assertFalse(self.migrations.exists())
                    self.assertNotIn('private-fixture', result.stdout + result.stderr)

            # A separately restored provider permits the same source to build;
            # readiness must not bypass migration/history/runtime-schema gates.
            result, calls = self.drive(**source)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Shared rate-limit store preflight passed', result.stdout)
            history = ['audit read only', 'audit statement timeout', 'migration history preflight',
                       'npx prisma migrate status --schema prisma/schema.prisma'] if environment == 'production' else []
            self.assertEqual(calls, ['redis EVAL', *history,
                                     'npx prisma migrate deploy --schema prisma/schema.prisma',
                                     'runtime migration preflight', 'npm run build -w apps/api'])

    def test_invalid_shared_store_configuration_is_private_and_withholds_build(self):
        dev = 'postgresql://postgres.kegycybiruksmrzvniha:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
        invalid = [('UPSTASH_REDIS_REST_URL', value) for value in
                   ('http://quota.example.test', 'not-a-url-private-value',
                    'https://user:private-value@quota.example.test',
                    'https://quota.example.test?token=private-value', 'https://quota.example.test#private-value')]
        invalid += [('UPSTASH_REDIS_REST_TOKEN', value) for value in (' ', '\n', 'private-value\n')]
        for environment in ('production', 'preview'):
            bindings = {} if environment == 'production' else {'POSTGRES_URL_NON_POOLING': dev, 'POSTGRES_PRISMA_URL': dev.replace('postgres.', 'fitsy_app.')}
            for key, value in invalid:
                with self.subTest(environment=environment, key=key, value=value):
                    result, calls = self.drive(VERCEL_ENV=environment, **bindings, **{key: value})
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(calls, [])
                    self.assertIn('rate-limit store preflight failed', result.stderr)
                    self.assertNotIn('private-value', result.stdout + result.stderr)
                    self.assertNotIn('private-fixture-token', result.stdout + result.stderr)

    def test_vercel_and_dev_mirror_consume_guarded_build_inputs(self):
        config = json.loads((ROOT / 'vercel.json').read_text())
        self.assertEqual(config['buildCommand'], 'bash scripts/dev/vercel-build.sh')
        command = "process.stdout.write(JSON.stringify(require('yaml').parse(require('fs').readFileSync(process.argv[1],'utf8'))))"
        workflow = json.loads(subprocess.check_output(['node', '-e', command,
                              str(ROOT / '.github/workflows/mirror-dev-branch.yml')], cwd=ROOT, text=True))
        paths = workflow['on']['push']['paths']
        for path in ('scripts/dev/vercel-build.sh', 'scripts/deploy/migrate-prod.sh',
                     'scripts/deploy/rate-limit-preflight.ts', 'scripts/lib/db-target-guard.ts',
                     'scripts/deploy/pipeline-roles-approval.mjs', 'scripts/deploy/activate-runtime-role.ts',
                     'scripts/deploy/runtime-migrations-preflight.ts',
                     'scripts/deploy/migration-failure-audit.ts', 'scripts/deploy/migration-failure-audit.sql'):
            self.assertIn(path, paths)

    def test_actual_production_build_migrates_before_build_using_existing_bindings(self):
        direct = 'postgresql://postgres:fixture@db.zaxkmjqozvmbifiwbxps.supabase.co/postgres'
        for bindings in ({}, {'POSTGRES_URL_NON_POOLING': direct, 'POSTGRES_PRISMA_URL': direct.replace('postgres:', 'fitsy_app:')}):
            with self.subTest(route='direct' if bindings else 'qualified pooler'):
                result, calls = self.drive(**bindings)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(calls, ['redis EVAL', 'audit read only', 'audit statement timeout', 'migration history preflight',
                                         'npx prisma migrate status --schema prisma/schema.prisma',
                                         'npx prisma migrate deploy --schema prisma/schema.prisma',
                                         'runtime migration preflight', 'npm run build -w apps/api'])

    def test_actual_production_build_accepts_supavisor_options_reference_route(self):
        route = ('postgresql://postgres:fixture@aws-1-us-east-1.pooler.supabase.com:{port}/postgres'
                 '?sslmode=require&options=reference%3Dzaxkmjqozvmbifiwbxps')
        result, calls = self.drive(POSTGRES_URL_NON_POOLING=route.format(port=5432),
                                   POSTGRES_PRISMA_URL=route.format(port=6543).replace('postgres:', 'fitsy_app:') + '&pgbouncer=true')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['redis EVAL', 'audit read only', 'audit statement timeout', 'migration history preflight',
                                 'npx prisma migrate status --schema prisma/schema.prisma',
                                 'npx prisma migrate deploy --schema prisma/schema.prisma',
                                 'runtime migration preflight', 'npm run build -w apps/api'])

    def test_supavisor_options_route_rejects_ambiguous_or_overridden_targets(self):
        base = 'postgresql://postgres:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
        reference = 'options=reference%3Dzaxkmjqozvmbifiwbxps'
        queries = ['', 'options=reference%3Dother', reference + '&' + reference,
                   reference + '&options=reference%3Dother',
                   reference + '%20reference%3Dother', reference + '%20-c%20reference%3Dother',
                   'options=reference%253Dzaxkmjqozvmbifiwbxps',
                   reference + '&sslmode=require&sslmode=disable']
        queries += [reference + '&' + key + '=other'
                    for key in ('host', 'hostaddr', 'port', 'user', 'dbname', 'database', 'service', 'reference')]
        invalid = [base + '?' + query for query in queries]
        invalid += [(base + '?' + reference).replace('postgres:fixture', 'postgres.other:fixture'),
                    (base + '?' + reference).replace('postgres:fixture', 'postgres.zaxkmjqozvmbifiwbxps:fixture'),
                    (base + '?' + reference).replace('fixture', ''),
                    (base + '?' + reference).replace('pooler.supabase.com', 'attacker.invalid'),
                    (base + '?' + reference).replace('/postgres?', '/other?'),
                    (base + '?options=reference%3Dother').replace('fixture', 'zaxkmjqozvmbifiwbxps')]
        for name in ('POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL'):
            for url in invalid:
                with self.subTest(name=name, url=url):
                    result, calls = self.drive(**{name: url})
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(calls, [])
                    self.assertNotIn('fixture@', result.stderr)
        result, calls = self.drive(POSTGRES_URL_NON_POOLING=(base + '?' + reference).replace(':5432/', ':6543/'))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_wrong_project_ref_repository_and_missing_credentials_withhold_build(self):
        for name, value in [('VERCEL', ''), ('VERCEL_PROJECT_ID', 'other'), ('VERCEL_GIT_COMMIT_REF', 'feature'),
                            ('VERCEL_GIT_REPO_OWNER', 'other'), ('VERCEL_GIT_REPO_SLUG', 'other'),
                            ('VERCEL_GIT_PROVIDER', 'other'), ('VERCEL_GIT_COMMIT_SHA', ''),
                            ('POSTGRES_URL_NON_POOLING', ''), ('POSTGRES_PRISMA_URL', '')]:
            with self.subTest(name=name):
                result, calls = self.drive(**{name: value})
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, [])

    def test_wrong_database_and_misleading_password_cannot_pass_target_guard(self):
        for name in ('POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL'):
            for url in ('postgresql://postgres:zaxkmjqozvmbifiwbxps@db.other.supabase.co/postgres',
                        'postgresql://postgres.other:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
                        'postgresql://postgres.zaxkmjqozvmbifiwbxps:fixture@attacker.invalid/postgres',
                        'postgresql://postgres.zaxkmjqozvmbifiwbxps:fixture@aws-1-us-east-1.pooler.supabase.com:5432/other'):
                result, calls = self.drive(**{name: url})
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, [])
                self.assertNotIn('fixture@', result.stderr)
        result, calls = self.drive(POSTGRES_URL_NON_POOLING=self.env['POSTGRES_PRISMA_URL'])
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_preview_migrates_only_development_and_development_refuses_either_production_binding(self):
        dev = 'postgresql://postgres.kegycybiruksmrzvniha:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
        result, calls = self.drive(VERCEL_ENV='preview', SUPABASE_URL='https://kegycybiruksmrzvniha.supabase.co',
                                   POSTGRES_URL_NON_POOLING=dev, POSTGRES_PRISMA_URL=dev.replace('postgres.', 'fitsy_app.'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['redis EVAL', 'npx prisma migrate deploy --schema prisma/schema.prisma',
                                 'runtime migration preflight', 'npm run build -w apps/api'])
        for env in ('preview', 'development', ''):
            for name in ('POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL'):
                values = {'POSTGRES_URL_NON_POOLING': dev, 'POSTGRES_PRISMA_URL': dev.replace('postgres.', 'fitsy_app.'), name: self.env[name]}
                result, calls = self.drive(VERCEL_ENV=env, **values)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, [])

    def test_runtime_auth_project_mismatch_withholds_build(self):
        dev = 'postgresql://postgres.kegycybiruksmrzvniha:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
        for environment in ('production', 'preview'):
            bindings = {} if environment == 'production' else {'POSTGRES_URL_NON_POOLING': dev, 'POSTGRES_PRISMA_URL': dev.replace('postgres.', 'fitsy_app.')}
            wrong_auth = 'https://kegycybiruksmrzvniha.supabase.co' if environment == 'production' else self.env['SUPABASE_URL']
            for role in ('fitsy_app', 'postgres'):
                for auth in ('', wrong_auth):
                    with self.subTest(environment=environment, auth=auth, role=role):
                        runtime = bindings.get('POSTGRES_PRISMA_URL', self.env['POSTGRES_PRISMA_URL']).replace('fitsy_app.', role + '.')
                        result, calls = self.drive(VERCEL_ENV=environment, SUPABASE_URL=auth,
                                                   **{**bindings, 'POSTGRES_PRISMA_URL': runtime})
                        self.assertEqual(result.returncode, 1, result.stderr)
                        self.assertFalse(any(call.startswith('npm') for call in calls))
                        self.assertIn('Runtime database role activation failed', result.stderr)
                        self.assertNotIn('activation skipped', result.stderr)
                        self.assertNotIn('fixture@', result.stdout + result.stderr)

    def test_missing_or_unsafe_redis_configuration_withholds_migration_and_build(self):
        dev = 'postgresql://postgres.kegycybiruksmrzvniha:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
        for environment in ('production', 'preview'):
            bindings = {} if environment == 'production' else {'POSTGRES_URL_NON_POOLING': dev, 'POSTGRES_PRISMA_URL': dev.replace('postgres.', 'fitsy_app.')}
            for missing in ({'UPSTASH_REDIS_REST_URL': '', 'UPSTASH_REDIS_REST_TOKEN': ''},
                            {'UPSTASH_REDIS_REST_URL': ''}, {'UPSTASH_REDIS_REST_TOKEN': ''},
                            {'UPSTASH_REDIS_REST_URL': 'http://quota.example.test'},
                            {'UPSTASH_REDIS_REST_URL': 'https://private-fixture-token@quota.example.test'},
                            {'UPSTASH_REDIS_REST_URL': 'https://quota.example.test?token=private-fixture-token'}):
                with self.subTest(environment=environment, configuration=list(missing)):
                    result, calls = self.drive(VERCEL_ENV=environment, **bindings, **missing)
                    self.assertEqual(result.returncode, 1, result.stderr)
                    self.assertEqual(calls, [])
                    self.assertIn('rate-limit store preflight failed', result.stderr)
                    self.assertNotIn('private-fixture-token', result.stdout + result.stderr)

    def test_unwritable_unavailable_or_invalid_redis_withholds_migration_and_build(self):
        for response in ('http', 'readonly', 'invalid', 'denied', 'timeout'):
            with self.subTest(response=response):
                result, calls = self.drive(REDIS_RESULT=response)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(calls, ['redis EVAL'])
                self.assertIn('rate-limit store preflight failed', result.stderr)
                self.assertNotIn('private-fixture-token', result.stdout + result.stderr)
                self.assertNotIn('private-fixture-diagnostic', result.stdout + result.stderr)

    def test_undeployed_development_still_builds_without_redis(self):
        dev = 'postgresql://postgres.kegycybiruksmrzvniha:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
        result, calls = self.drive(VERCEL_ENV='development', VERCEL='', POSTGRES_URL_NON_POOLING=dev,
                                   POSTGRES_PRISMA_URL=dev.replace('postgres.', 'fitsy_app.'), SUPABASE_URL='https://kegycybiruksmrzvniha.supabase.co',
                                   UPSTASH_REDIS_REST_URL='', UPSTASH_REDIS_REST_TOKEN='')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['npm run build -w apps/api'])

    def test_failed_migration_withholds_build_and_build_failure_is_not_success(self):
        for approval in (None, self.env['FITSY_PIPELINE_ROLES_APPROVED_SHA256']):
            result, calls = self.drive(MIGRATE_EXIT='7', FITSY_PIPELINE_ROLES_APPROVED_SHA256=approval)
            self.assertEqual(result.returncode, 7)
            self.assertFalse(any(call.startswith('npm') for call in calls))
            self.assertEqual(sum(call.startswith('npx prisma migrate deploy ') for call in calls), 1)
            self.assertIn('migration-failure-audit.sql', result.stderr)
            self.assertIn('production-migration-recovery.yml', result.stderr)
            self.assertIn('recovery requires separate authorization', result.stderr)
        result, calls = self.drive(BUILD_EXIT='9')
        self.assertEqual(result.returncode, 9)
        self.assertEqual(calls[-1], 'npm run build -w apps/api')

    def test_incident_prisma_failure_is_preserved_even_when_audit_is_unavailable(self):
        # A concurrent failed attempt can appear after the read-only preflight.
        # Replay the original provider diagnostic at the real build boundary;
        # holding its SQL must neither hide the error nor authorize recovery.
        for number, audit_state in ((number, state) for number in (628, 634, 635) for state in ('ok', 'driver-error')):
            with self.subTest(incident=number, audit_state=audit_state):
                incident = json.loads((ROOT / f'scripts/deploy/__fixtures__/incident-{number}.json').read_text())
                result, calls = self.drive(VERCEL_GIT_COMMIT_SHA=incident['source'], MIGRATE_EXIT='1',
                                           MIGRATE_STDERR=incident['prisma_stderr'], AUDIT_STATE=audit_state,
                                           FITSY_PIPELINE_ROLES_APPROVED_SHA256=None)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn(incident['prisma_stderr'], result.stderr)
                self.assertIn('production-migration-recovery.yml', result.stderr)
                self.assertEqual(sum(call.startswith('npx prisma migrate deploy ') for call in calls), 1)
                self.assertEqual(calls[-3:], ['audit read only', 'audit statement timeout', 'migration failure audit'])
                self.assertFalse(any('resolve' in call or call.startswith('npm') for call in calls))
                self.assertNotIn('runtime migration preflight', calls)
                self.assertNotIn('20261028130000_hex_jobs', json.loads(self.migrations.read_text()))
                reports = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
                self.assertEqual(reports, [{'migration_failure_audit': self.audit}] if audit_state == 'ok' else [])
                self.assertNotIn('private-fixture-database-detail', result.stdout + result.stderr)

    def test_original_and_later_incidents_name_the_retained_attempt_before_prisma(self):
        # The later read-only #661 snapshot identifies the retained attempt from
        # #628's aborted transaction, subsequently reported as P3009 by #634.
        attempt = self.audit['migration_history'][0]
        for number, approval in ((number, approval) for number in (628, 634)
                                 for approval in (None, self.env['FITSY_PIPELINE_ROLES_APPROVED_SHA256'])):
            with self.subTest(incident=number, approved=approval is not None):
                incident = json.loads((ROOT / f'scripts/deploy/__fixtures__/incident-{number}.json').read_text())
                self.assertIn(attempt['migration_name'], incident['prisma_stderr'])
                result, calls = self.drive(VERCEL_GIT_COMMIT_SHA=incident['source'],
                                           PREFLIGHT_AUDIT_REPORT=json.dumps(self.audit),
                                           FITSY_PIPELINE_ROLES_APPROVED_SHA256=approval)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(calls, ['redis EVAL', 'audit read only', 'audit statement timeout',
                                         'migration history preflight'])
                self.assertIn(attempt['migration_name'], result.stderr)
                self.assertIn(attempt['id'], result.stderr)
                self.assertIn(attempt['started_at'], result.stderr)
                self.assertIn('production-migration-recovery.yml', result.stderr)
                self.assertNotIn('private-fixture', result.stdout + result.stderr)
                self.assertFalse(self.migrations.exists())

    def test_unresolved_history_stops_before_prisma_even_when_failed_sql_is_held(self):
        # Replay #661's exact Vercel audit. Held SQL and role approval cannot
        # authorize another Prisma invocation against this retained failure.
        for approval in (None, self.env['FITSY_PIPELINE_ROLES_APPROVED_SHA256']):
            with self.subTest(approved=approval is not None):
                result, calls = self.drive(MIGRATE_EXIT='7', PREFLIGHT_AUDIT_REPORT=json.dumps(self.audit),
                                           FITSY_PIPELINE_ROLES_APPROVED_SHA256=approval)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(calls, ['redis EVAL', 'audit read only', 'audit statement timeout',
                                         'migration history preflight'])
                reports = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
                self.assertEqual(reports, [{'migration_failure_audit': self.audit}])
                self.assertIn('unresolved migration history', result.stderr)
                self.assertIn('production-migration-recovery.yml', result.stderr)
                self.assertFalse(self.migrations.exists())

    def test_other_unresolved_attempts_and_partial_objects_also_withhold_prisma(self):
        audit = copy.deepcopy(self.audit)
        audit['migration_history'][0].update(id='other-attempt', migration_name='other_failed_migration')
        audit['migration_history'].append({**self.audit['migration_history'][0], 'id': 'settled-attempt',
                                           'finished_at': '2026-10-29T12:00:00+00:00', 'unresolved': False})
        audit['migration_history'].append({**self.audit['migration_history'][0],
                                           'id': 'interrupted-attempt', 'migration_name': 'interrupted\nfixture'})
        audit['relations'][0]['present'] = True
        result, calls = self.drive(PREFLIGHT_AUDIT_REPORT=json.dumps(audit))
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(calls, ['redis EVAL', 'audit read only', 'audit statement timeout', 'migration history preflight'])
        reports = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
        self.assertEqual(reports, [{'migration_failure_audit': audit}])
        diagnostics = [json.loads(line.removeprefix('Unresolved migration attempt: '))
                       for line in result.stderr.splitlines() if line.startswith('Unresolved migration attempt: ')]
        self.assertEqual(diagnostics, [
            {'migration_name': 'other_failed_migration', 'id': 'other-attempt',
             'started_at': audit['migration_history'][0]['started_at']},
            {'migration_name': 'interrupted\nfixture', 'id': 'interrupted-attempt',
             'started_at': audit['migration_history'][2]['started_at']},
        ])
        self.assertFalse(self.migrations.exists())

    def test_incomplete_or_inconsistent_history_evidence_cannot_authorize_deploy(self):
        for change in ({'unresolved': None}, {'unresolved': False}):
            with self.subTest(change=change):
                audit = copy.deepcopy(self.audit)
                audit['migration_history'][0].update(change)
                result, calls = self.drive(PREFLIGHT_AUDIT_REPORT=json.dumps(audit))
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertFalse(self.migrations.exists())
                self.assertFalse(any(call.startswith(('npx', 'npm')) for call in calls))
                self.assertIn('Migration failure audit unavailable', result.stderr)

    def test_missing_snapshot_fields_or_duplicate_objects_cannot_authorize_deploy(self):
        invalid = []
        for field in ('database', 'inspected_at', 'migration_history', 'roles', 'relations', 'runtime_schema'):
            audit = copy.deepcopy(self.audit)
            del audit[field]
            invalid.append(audit)
        for field in ('roles', 'relations'):
            audit = copy.deepcopy(self.audit)
            audit[field][0] = audit[field][1]
            invalid.append(audit)
        audit = copy.deepcopy(self.audit)
        del audit['relations'][0]['acl']
        invalid.append(audit)
        for audit in invalid:
            with self.subTest(audit=audit):
                result, calls = self.drive(PREFLIGHT_AUDIT_REPORT=json.dumps(audit))
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertFalse(self.migrations.exists())
                self.assertFalse(any(call.startswith(('npx', 'npm')) for call in calls))
                self.assertIn('Migration failure audit unavailable', result.stderr)
                self.assertEqual(result.stdout, 'Shared rate-limit store preflight passed\n')

    def test_invalid_post_failure_snapshot_preserves_the_original_migration_failure(self):
        audit = copy.deepcopy(self.audit)
        audit['runtime_schema'] = {'private-fixture-database-detail': 'fixture@'}
        result, calls = self.drive(MIGRATE_EXIT='7', AUDIT_REPORT=json.dumps(audit))
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertEqual(sum(call.startswith('npx prisma migrate deploy ') for call in calls), 1)
        self.assertFalse(any('resolve' in call or call.startswith('npm') for call in calls))
        self.assertEqual(result.stdout, 'Shared rate-limit store preflight passed\n')
        self.assertIn('Migration failure audit unavailable', result.stderr)
        self.assertNotIn('private-fixture-database-detail', result.stderr)
        self.assertNotIn('fixture@', result.stderr)

    def test_valid_additional_audit_evidence_is_preserved_for_recovery_comparison(self):
        audit = copy.deepcopy(self.audit)
        audit['additional_evidence'] = {'reviewed': True}
        audit['relations'][0]['additional_metadata'] = 'retained object evidence'
        audit['runtime_schema']['additional_metadata'] = 'retained runtime evidence'
        result, calls = self.drive(MIGRATE_EXIT='7', AUDIT_REPORT=json.dumps(audit))
        self.assertEqual(result.returncode, 7, result.stderr)
        reports = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
        self.assertEqual(reports, [{'migration_failure_audit': audit}])
        self.assertFalse(any('resolve' in call or call.startswith('npm') for call in calls))

    def test_settled_history_allows_deploy_but_does_not_establish_runtime_schema_readiness(self):
        for field in ('finished_at', 'rolled_back_at'):
            audit = copy.deepcopy(self.audit)
            audit['migration_history'][0].update({field: '2026-10-29T12:00:00+00:00', 'unresolved': False})
            for runtime in ('applied', 'missing'):
                with self.subTest(field=field, runtime=runtime):
                    result, calls = self.drive(PREFLIGHT_AUDIT_REPORT=json.dumps(audit),
                                               FITSY_PIPELINE_ROLES_APPROVED_SHA256=None, RUNTIME_MIGRATION_STATE=runtime)
                    self.assertEqual(result.returncode, 0 if runtime == 'applied' else 1, result.stderr)
                    self.assertEqual(sum(call.startswith('npx prisma migrate deploy ') for call in calls), 1)
                    self.assertEqual(calls.count('runtime migration preflight'), 1)
                    self.assertEqual(any(call.startswith('npm') for call in calls), runtime == 'applied')
                    self.assertNotIn('migration_failure_audit', result.stdout)
                    self.assertNotIn('20261028130000_hex_jobs', json.loads(self.migrations.read_text()))

    def test_unavailable_history_preflight_withholds_prisma_without_retry_or_private_errors(self):
        for state in ('driver-error', 'missing', 'timeout'):
            with self.subTest(state=state):
                result, calls = self.drive(PREFLIGHT_AUDIT_STATE=state)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(calls, ['redis EVAL', 'audit read only', 'audit statement timeout', 'migration history preflight'])
                self.assertIn('Migration failure audit unavailable', result.stderr)
                self.assertNotIn('private-fixture-database-detail', result.stdout + result.stderr)
                self.assertNotIn('fixture@', result.stdout + result.stderr)
                self.assertEqual(result.stdout, 'Shared rate-limit store preflight passed\n')
                self.assertFalse(self.migrations.exists())

    def test_failed_migration_emits_read_only_evidence_without_resolving_or_retrying(self):
        for approval in (None, self.env['FITSY_PIPELINE_ROLES_APPROVED_SHA256']):
            result, calls = self.drive(MIGRATE_EXIT='7', FITSY_PIPELINE_ROLES_APPROVED_SHA256=approval)
            self.assertEqual(result.returncode, 7, result.stderr)
            self.assertEqual(calls[-3:], ['audit read only', 'audit statement timeout', 'migration failure audit'])
            reports = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
            self.assertEqual(reports, [{'migration_failure_audit': self.audit}])
            self.assertEqual(sum(call.startswith('npx prisma migrate deploy ') for call in calls), 1)
            self.assertFalse(any('resolve' in call or call.startswith('npm') for call in calls))
            self.assertNotIn('runtime migration preflight', calls)

    def test_failed_audit_preserves_migration_failure_and_withholds_private_errors(self):
        for state in ('driver-error', 'missing', 'timeout'):
            with self.subTest(state=state):
                result, calls = self.drive(MIGRATE_EXIT='7', AUDIT_STATE=state)
                self.assertEqual(result.returncode, 7, result.stderr)
                self.assertEqual(calls[-3:], ['audit read only', 'audit statement timeout', 'migration failure audit'])
                self.assertIn('Migration failure audit unavailable', result.stderr)
                self.assertEqual(result.stdout, 'Shared rate-limit store preflight passed\n')
                self.assertNotIn('private-fixture-database-detail', result.stderr)
                self.assertNotIn('fixture@', result.stderr)
                self.assertEqual(sum(call.startswith('npx prisma migrate deploy ') for call in calls), 1)
                self.assertFalse(any('resolve' in call or call.startswith('npm') for call in calls))

    def test_build_audit_cli_requires_production_target_and_trusted_identity(self):
        for changes in ({'VERCEL_GIT_COMMIT_REF': 'dev'}, {'VERCEL_PROJECT_ID': 'other-project'},
                        {'VERCEL_ENV': 'preview'}, {'FITSY_ALLOW_PROD_WRITE': ''},
                        {'POSTGRES_URL_NON_POOLING': self.env['POSTGRES_URL_NON_POOLING'].replace(
                            'zaxkmjqozvmbifiwbxps', 'kegycybiruksmrzvniha')}):
            with self.subTest(changes=changes):
                for args in (['--prod'], ['--prod', '--preflight']):
                    self.calls.write_text('')
                    result = subprocess.run(['node', '--import', 'tsx', 'scripts/deploy/migration-failure-audit.ts', *args],
                                            cwd=self.root, env={**self.env, 'FITSY_ALLOW_PROD_WRITE': '1', **changes},
                                            text=True, capture_output=True, timeout=15)
                    self.assertEqual(result.returncode, 1, result.stderr)
                    self.assertEqual(self.calls.read_text(), '')
                    self.assertEqual(result.stdout, '')
                    self.assertIn('Migration failure audit unavailable', result.stderr)
                    self.assertNotIn('fixture@', result.stderr)

    def test_build_audit_cli_refuses_recovery_and_unknown_arguments(self):
        for args in ([], ['--preflight'], ['--prod', '--resolve'], ['--prod', '--preflight', '--resolve']):
            with self.subTest(args=args):
                self.calls.write_text('')
                result = subprocess.run(['node', '--import', 'tsx', 'scripts/deploy/migration-failure-audit.ts', *args],
                                        cwd=self.root, env={**self.env, 'FITSY_ALLOW_PROD_WRITE': '1'},
                                        text=True, capture_output=True, timeout=15)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertEqual(self.calls.read_text(), '')
                self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    if sys.argv[1:] == ['--list-tests']:
        suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
        print(json.dumps([test.id().removeprefix('__main__.') for group in suite for test in group]))
    else:
        unittest.main()
