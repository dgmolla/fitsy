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
                     'scripts/deploy/activate-runtime-role.ts',
                     'prisma/schema.prisma', 'prisma/migrations/migration_lock.toml',
                     'prisma/migrations/20261028120000_pipeline_writer_roles/migration.sql',
                     'prisma/migrations/20261028130000_hex_jobs/migration.sql',
                     'prisma/migrations/20261028140000_pipeline_ue_rate_limit/migration.sql',
                     'prisma/migrations/20261028150000_pipeline_pdf_jobs/migration.sql'):
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
Module._load = function(name, ...args) {
  if (name === '@prisma/client') return { PrismaClient: class {
    async $transaction(fn) {
      return fn({ $queryRaw: async () => [], $executeRawUnsafe: async () => {
        if (process.env.ROLE_ACTIVATION_EXIT === '1') throw Error('private-fixture-password');
        return 0;
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
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith(('VERCEL', 'POSTGRES', 'SUPABASE', 'PIPELINE_DATABASE_URL', 'PROD_', 'FITSY_ALLOW_PROD', 'FITSY_PIPELINE_ROLES', 'GITHUB_ACTIONS', 'UPSTASH', 'NODE_OPTIONS'))}
        self.env.update(PATH=str(self.bin) + ':' + os.environ['PATH'], CALLS=str(self.calls),
                        MIGRATIONS=str(self.migrations),
                        NODE_OPTIONS=f'--require={database_transport} --import={transport}', REDIS_RESULT='ok',
                        UPSTASH_REDIS_REST_URL='https://quota.example.test',
                        UPSTASH_REDIS_REST_TOKEN='private-fixture-token',
                        VERCEL='1', VERCEL_ENV='production', VERCEL_PROJECT_ID='prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4',
                        VERCEL_GIT_PROVIDER='github', VERCEL_GIT_REPO_OWNER='dgmolla', VERCEL_GIT_REPO_SLUG='fitsy',
                        VERCEL_GIT_COMMIT_REF='main', VERCEL_GIT_COMMIT_SHA='a' * 40,
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
                                env=env, text=True, capture_output=True)
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
        role = '20261028120000_pipeline_writer_roles'
        original = {path: path.read_bytes() for path in (self.root / 'prisma/migrations').glob('*/migration.sql')}
        for approval in (None, '', 'a' * 64, 'true'):
            for runtime in (self.env['POSTGRES_PRISMA_URL'], self.env['POSTGRES_PRISMA_URL'].replace('fitsy_app.', 'postgres.')):
                with self.subTest(approval=approval, role='legacy' if 'postgres.' in runtime else 'fitsy_app'):
                    result, calls = self.drive(FITSY_PIPELINE_ROLES_APPROVED_SHA256=approval, POSTGRES_PRISMA_URL=runtime,
                                               ROLE_ACTIVATION_EXIT='1' if 'postgres.' in runtime else '0')
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(calls[-1], 'npm run build -w apps/api')
                    self.assertEqual(json.loads(self.migrations.read_text()),
                                     ['20261028110000_unrelated_before', '20261028130000_unrelated_after'])
                    self.assertIn('holding ' + role, result.stderr)
                    self.assertEqual({path: path.read_bytes() for path in original}, original)

    def test_matching_approval_includes_exact_role_migration(self):
        result, calls = self.drive()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls[-1], 'npm run build -w apps/api')
        self.assertEqual(json.loads(self.migrations.read_text()), [
            '20261028110000_unrelated_before', '20261028120000_pipeline_writer_roles',
            '20261028130000_hex_jobs', '20261028130000_unrelated_after',
            '20261028140000_pipeline_ue_rate_limit', '20261028150000_pipeline_pdf_jobs'])
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
            self.assertEqual(calls, ['redis EVAL'])
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
                     'scripts/deploy/pipeline-roles-approval.mjs', 'scripts/deploy/activate-runtime-role.ts'):
            self.assertIn(path, paths)

    def test_actual_production_build_migrates_before_build_using_existing_bindings(self):
        direct = 'postgresql://postgres:fixture@db.zaxkmjqozvmbifiwbxps.supabase.co/postgres'
        for bindings in ({}, {'POSTGRES_URL_NON_POOLING': direct, 'POSTGRES_PRISMA_URL': direct.replace('postgres:', 'fitsy_app:')}):
            with self.subTest(route='direct' if bindings else 'qualified pooler'):
                result, calls = self.drive(**bindings)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(calls, ['redis EVAL', 'npx prisma migrate status --schema prisma/schema.prisma',
                                         'npx prisma migrate deploy --schema prisma/schema.prisma', 'npm run build -w apps/api'])

    def test_actual_production_build_accepts_supavisor_options_reference_route(self):
        route = ('postgresql://postgres:fixture@aws-1-us-east-1.pooler.supabase.com:{port}/postgres'
                 '?sslmode=require&options=reference%3Dzaxkmjqozvmbifiwbxps')
        result, calls = self.drive(POSTGRES_URL_NON_POOLING=route.format(port=5432),
                                   POSTGRES_PRISMA_URL=route.format(port=6543).replace('postgres:', 'fitsy_app:') + '&pgbouncer=true')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['redis EVAL', 'npx prisma migrate status --schema prisma/schema.prisma',
                                 'npx prisma migrate deploy --schema prisma/schema.prisma', 'npm run build -w apps/api'])

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
        self.assertEqual(calls, ['redis EVAL', 'npx prisma migrate deploy --schema prisma/schema.prisma', 'npm run build -w apps/api'])
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
        result, calls = self.drive(BUILD_EXIT='9')
        self.assertEqual(result.returncode, 9)
        self.assertEqual(calls[-1], 'npm run build -w apps/api')


if __name__ == '__main__':
    unittest.main()
