#!/usr/bin/env python3
"""Exercise actual release callers with only GitHub/Vercel boundaries replaced."""
import base64
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
        self.source, self.reviewed, self.base, self.tree = (c * 40 for c in 'abcd')
        self.prefix = f'repos/{gate.REPO}/'
        self.rows = {}
        self.body = '**TL;DR:** Release the authorized change.\n\nDone means exact-source delivery.'
        digest = gate.approval.acceptance(self.body)
        verify = {'id': 20, 'workflow_id': gate.VERIFY, 'path': '.github/workflows/verify.yml',
                  'event': 'push', 'head_branch': 'main', 'head_sha': self.source,
                  'repository': {'full_name': gate.REPO}, 'head_repository': {'full_name': gate.REPO},
                  'status': 'completed', 'conclusion': 'success', 'run_attempt': 1, 'check_suite_id': 200}
        candidate = dict(verify, id=10, event='pull_request', head_sha=self.reviewed, check_suite_id=100, pull_requests=[])
        self.event = {'workflow_run': copy.deepcopy(verify)}
        self.put('actions/runs/20', verify)
        self.put('actions/runs/10', candidate)
        self.put('actions/runs/30', {'id': 30, 'workflow_id': gate.DEPLOY, 'path': '.github/workflows/deploy.yml',
                                    'event': 'workflow_run', 'head_branch': 'main', 'head_sha': self.source,
                                    'repository': {'full_name': gate.REPO}})
        self.put('git/ref/heads/main', {'object': {'sha': self.source}})
        for sha, event, run in ((self.source, 'push', 20), (self.reviewed, 'pull_request', 10)):
            self.put(f'actions/workflows/{gate.VERIFY}/runs?head_sha={sha}&event={event}&per_page=1',
                     {'workflow_runs': [{'id': run}]})
        self.put(f'commits/{self.source}/pulls?per_page=100', [{
            'number': 500, 'state': 'closed', 'merged_at': '2026-10-21T00:00:00Z',
            'merge_commit_sha': self.source, 'body': 'Delivery-Issue: #471\n',
            'head': {'sha': self.reviewed, 'repo': {'full_name': gate.REPO}},
            'base': {'sha': self.base, 'ref': 'main', 'repo': {'full_name': gate.REPO}}}])
        self.put('issues/471', {'body': self.body})
        checks = [{'name': name, 'head_sha': self.reviewed, 'app': {'id': gate.APP},
                   'status': 'completed', 'conclusion': 'success'}
                  for name in (gate.approval.CHECK, gate.approval.ACCEPTANCE_CHECK)]
        checks[0].update(external_id=f'issue-471:{self.reviewed}:{digest}',
                         output={'summary': f'Source {self.reviewed}; base {self.base}; acceptance {digest}; accounting fixture'})
        self.put(f'commits/{self.reviewed}/check-runs?filter=latest&per_page=100',
                 {'total_count': 2, 'check_runs': checks})
        self.put(f'commits/{self.reviewed}/status?per_page=100',
                 {'sha': self.reviewed, 'total_count': 1, 'statuses': [{'context': 'product-flow/local', 'state': 'success'}]})
        self.put(f'git/commits/{self.reviewed}', {'tree': {'sha': self.tree}})
        self.put(f'git/commits/{self.source}', {'tree': {'sha': self.tree},
                                              'parents': [{'sha': self.base}, {'sha': self.reviewed}]})
        self.put(f'actions/workflows/{gate.VERIFY}', {'path': '.github/workflows/verify.yml', 'state': 'active'})
        for sha in (self.base, self.reviewed, self.source):
            self.put(f'contents/.github/workflows/verify.yml?ref={sha}',
                     {'type': 'file', 'path': '.github/workflows/verify.yml', 'encoding': 'base64',
                      'content': base64.b64encode((ROOT / '.github/workflows/verify.yml').read_bytes()).decode()})
        for run in (verify, candidate):
            jobs = []
            for index, name in enumerate(gate.approval.VERIFY_JOBS):
                jid = run['id'] * 10 + index
                skipped = run['event'] == 'push' and name == 'Single-domain PR check'
                jobs.append({'id': jid, 'name': name, 'run_id': run['id'], 'run_attempt': 1,
                             'head_sha': run['head_sha'], 'status': 'completed', 'conclusion': 'skipped' if skipped else 'success',
                             'labels': [] if skipped else ['ubuntu-latest'],
                             'check_run_url': f'https://api.github.com/{self.prefix}check-runs/{jid}'})
                self.put(f'check-runs/{jid}', {'id': jid, 'name': name, 'head_sha': run['head_sha'],
                         'app': {'id': 15368, 'slug': 'github-actions'}, 'check_suite': {'id': run['check_suite_id']},
                         'status': 'completed', 'conclusion': 'success'})
            self.put(f'actions/runs/{run["id"]}/jobs?filter=latest&per_page=100', {'total_count': len(jobs), 'jobs': jobs})
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

    def test_wrong_failed_stale_source_run_workflow_and_issuer_are_refused(self):
        original = copy.deepcopy(self.rows)
        mutations = [
            ('actions/runs/20', 'conclusion', 'failure', 'successful same-repository'),
            ('actions/runs/20', 'event', 'pull_request', 'successful same-repository'),
            ('actions/runs/20', 'workflow_id', 99, 'upstream event/run mismatch'),
            ('actions/runs/20', 'run_attempt', 2, 'upstream event/run mismatch'),
            ('actions/runs/20', 'head_repository', {'full_name': 'attacker/fitsy'}, 'successful same-repository'),
            ('actions/runs/30', 'event', 'workflow_dispatch', 'wrong downstream workflow'),
            ('git/ref/heads/main', 'object', {'sha': 'e' * 40}, 'superseded protected main'),
            ('check-runs/200', 'app', {'id': 99, 'slug': 'github-actions'}, 'Verify job issuer'),
            ('git/commits/' + self.source, 'tree', {'sha': 'e' * 40}, 'merged tree differs'),
            ('issues/471', 'body', self.body + '\nAcceptance changed', 'current acceptance/review binding'),
        ]
        for path, key, value, reason in mutations:
            with self.subTest(path=path, key=key):
                self.rows = copy.deepcopy(original)
                self.get(path)[key] = value
                result = self.drive()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(reason, result.stderr)
                self.assertEqual((self.root / 'output').read_text(), '')
        self.rows = original
        self.assertNotEqual(self.drive(GITHUB_EVENT_NAME='workflow_dispatch').returncode, 0)
        self.assertNotEqual(self.drive(GITHUB_REPOSITORY='attacker/fitsy').returncode, 0)

    def test_wrong_app_and_stale_or_failed_candidate_ci_are_refused(self):
        checks = self.get(f'commits/{self.reviewed}/check-runs?filter=latest&per_page=100')['check_runs']
        checks[0]['app']['id'] = 99
        self.assertNotEqual(self.drive().returncode, 0)
        checks[0]['app']['id'] = gate.APP
        self.get('actions/runs/10')['conclusion'] = 'failure'
        self.assertNotEqual(self.drive().returncode, 0)
        self.get('actions/runs/10')['conclusion'] = 'success'
        self.get(f'actions/workflows/{gate.VERIFY}/runs?head_sha={self.reviewed}&event=pull_request&per_page=1')['workflow_runs'] = []
        self.assertNotEqual(self.drive().returncode, 0)

    def test_mutable_pr_base_cannot_substitute_for_reviewed_immutable_merge_parents(self):
        pr = self.get(f'commits/{self.source}/pulls?per_page=100')[0]
        pr['base']['sha'] = 'f' * 40
        result = self.drive()
        self.assertEqual(result.returncode, 0, result.stderr)
        merge = self.get(f'git/commits/{self.source}')
        merge['parents'][0]['sha'] = 'e' * 40
        result = self.drive()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('review comparison base mismatch', result.stderr)
        merge['parents'][0]['sha'] = self.base
        merge['parents'][1]['sha'] = 'e' * 40
        result = self.drive()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('immutable merge parent/reviewed head mismatch', result.stderr)


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


class VercelBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fitsy-vercel-build-')
        self.root = Path(self.temp.name)
        for name in ('scripts/dev/vercel-build.sh', 'scripts/deploy/migrate-prod.sh'):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        for name in ('npx', 'npm'):
            command = self.bin / name
            command.write_text('#!/bin/bash\nset -eu\nprintf "%s %s\\n" "' + name + '" "$*" >> "$CALLS"\n'
                               + ('if [[ "$*" == *"migrate deploy"* ]]; then exit "${MIGRATE_EXIT:-0}"; fi\n'
                                  if name == 'npx' else 'exit "${BUILD_EXIT:-0}"\n'))
            command.chmod(0o700)
        self.calls = self.root / 'calls'
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(('VERCEL', 'POSTGRES', 'PROD_', 'FITSY_ALLOW_PROD', 'GITHUB_ACTIONS'))}
        self.env.update(PATH=str(self.bin) + ':' + os.environ['PATH'], CALLS=str(self.calls),
                        VERCEL='1', VERCEL_ENV='production', VERCEL_PROJECT_ID='prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4',
                        VERCEL_GIT_PROVIDER='github', VERCEL_GIT_REPO_OWNER='dgmolla', VERCEL_GIT_REPO_SLUG='fitsy',
                        VERCEL_GIT_COMMIT_REF='main', VERCEL_GIT_COMMIT_SHA='a' * 40,
                        POSTGRES_URL_NON_POOLING='postgresql://postgres.zaxkmjqozvmbifiwbxps:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
                        POSTGRES_PRISMA_URL='postgresql://postgres.zaxkmjqozvmbifiwbxps:fixture@aws-1-us-east-1.pooler.supabase.com:6543/postgres')

    def tearDown(self):
        self.temp.cleanup()

    def drive(self, **changes):
        self.calls.write_text('')
        result = subprocess.run(['bash', 'scripts/dev/vercel-build.sh'], cwd=self.root,
                                env={**self.env, **changes}, text=True, capture_output=True)
        return result, self.calls.read_text().splitlines()

    def test_actual_production_build_migrates_before_build_using_existing_bindings(self):
        result, calls = self.drive()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['npx prisma migrate status --schema prisma/schema.prisma',
                                 'npx prisma migrate deploy --schema prisma/schema.prisma', 'npm run build -w apps/api'])

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
        dev = 'postgresql://postgres.dev:fixture@aws-1-us-east-1.pooler.supabase.com:5432/postgres'
        result, calls = self.drive(VERCEL_ENV='preview', POSTGRES_URL_NON_POOLING=dev, POSTGRES_PRISMA_URL=dev)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['npx prisma migrate deploy --schema prisma/schema.prisma', 'npm run build -w apps/api'])
        for env in ('preview', 'development', ''):
            for name in ('POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL'):
                values = {'POSTGRES_URL_NON_POOLING': dev, 'POSTGRES_PRISMA_URL': dev, name: self.env[name]}
                result, calls = self.drive(VERCEL_ENV=env, **values)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, [])

    def test_failed_migration_withholds_build_and_build_failure_is_not_success(self):
        result, calls = self.drive(MIGRATE_EXIT='7')
        self.assertEqual(result.returncode, 7)
        self.assertFalse(any(call.startswith('npm') for call in calls))
        result, calls = self.drive(BUILD_EXIT='9')
        self.assertEqual(result.returncode, 9)
        self.assertEqual(calls[-1], 'npm run build -w apps/api')


if __name__ == '__main__':
    unittest.main()
