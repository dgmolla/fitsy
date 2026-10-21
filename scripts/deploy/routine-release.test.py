#!/usr/bin/env python3
"""Exercise actual release callers with only GitHub/Vercel boundaries replaced."""
import base64
import copy
import importlib.util
import io
import json
import os
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
vercel = load('vercel-release')


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.evidence')
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


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.evidence')
        self.root = Path(self.temp.name)
        self.receipt = self.root / 'release.json'
        self.source = 'a' * 40
        self.serving = 'dpl_previous'
        self.calls = []
        self.target = {'id': 'dpl_target', 'url': 'target.vercel.app', 'projectId': vercel.PROJECT, 'ownerId': vercel.TEAM,
                       'target': 'production', 'readyState': 'READY', 'meta': {'githubCommitSha': self.source}}
        self.previous = dict(self.target, id='dpl_previous', url='previous.vercel.app')

    def tearDown(self):
        self.temp.cleanup()

    def api(self, path):
        self.calls.append(path)
        if path == '/v4/aliases/fitsy.org':
            return {'alias': 'fitsy.org', 'projectId': vercel.PROJECT, 'deployment': {'id': self.serving}}
        return self.previous if path.endswith('dpl_previous') else self.target

    def stage(self):
        with patch.object(vercel, 'api', side_effect=self.api), patch.object(vercel, 'current'), \
                patch.object(vercel.subprocess, 'check_output', side_effect=[self.source + '\n', '']), \
                patch.object(vercel, 'cli', return_value='https://target.vercel.app\n'):
            vercel.stage(self.source, self.receipt)

    def test_staged_target_and_actual_previous_serving_target_survive_rollback_history(self):
        # No deployment-list ordering is used. The current alias can be an older rollback.
        self.stage()
        data = json.loads(self.receipt.read_text())
        self.assertEqual((data['previous_id'], data['previous_url']), ('dpl_previous', 'previous.vercel.app'))
        def promote(*args):
            self.assertEqual(args, ('promote', 'target.vercel.app', '--yes'))
            self.serving = 'dpl_target'
        with patch.object(vercel, 'api', side_effect=self.api), patch.object(vercel, 'current'), \
                patch.object(vercel, 'cli', side_effect=promote):
            vercel.promote(self.receipt)
        self.assertEqual(json.loads(self.receipt.read_text())['phase'], 'promoted')

    def test_failed_build_wrong_project_wrong_source_and_not_ready_never_promote(self):
        with patch.object(vercel, 'api', side_effect=self.api), patch.object(vercel, 'current'), \
                patch.object(vercel.subprocess, 'check_output', side_effect=[self.source, '']), \
                patch.object(vercel, 'cli', side_effect=ValueError('build failed')) as cli:
            with self.assertRaises(ValueError):
                vercel.stage(self.source, self.receipt)
            self.assertEqual(cli.call_args.args[0], 'deploy')
            self.assertEqual(json.loads(self.receipt.read_text())['phase'], 'before-stage')
        for key, value in [('projectId', 'other'), ('ownerId', 'other-team'), ('readyState', 'ERROR'), ('meta', {'githubCommitSha': 'b' * 40})]:
            original = self.target[key]
            self.target[key] = value
            with self.assertRaises(ValueError):
                self.stage()
            self.target[key] = original

    def test_uncertain_promotion_reads_actual_alias_without_retrying(self):
        self.stage()
        def uncertain(*args):
            self.serving = 'dpl_target'
            raise subprocess.TimeoutExpired('safe-fixture-command', 1)
        with patch.object(vercel, 'api', side_effect=self.api), patch.object(vercel, 'current'), \
                patch.object(vercel, 'cli', side_effect=uncertain) as cli:
            vercel.promote(self.receipt)
            self.assertEqual(cli.call_count, 1)
        self.assertEqual(json.loads(self.receipt.read_text())['phase'], 'promoted')
        self.stage_again_for_failure()

    def stage_again_for_failure(self):
        self.serving = 'dpl_previous'
        self.stage()
        with patch.object(vercel, 'api', side_effect=self.api), patch.object(vercel, 'current'), \
                patch.object(vercel, 'cli', side_effect=ValueError('transport failed')) as cli:
            with self.assertRaisesRegex(ValueError, 'uncertain promotion'):
                vercel.promote(self.receipt)
            self.assertEqual(cli.call_count, 1)
        self.assertEqual(json.loads(self.receipt.read_text())['phase'], 'promotion-started')

    def test_stale_main_or_changed_serving_target_cannot_promote(self):
        self.stage()
        with patch.object(vercel, 'current', side_effect=ValueError('superseded main')), \
                patch.object(vercel, 'cli') as cli:
            with self.assertRaisesRegex(ValueError, 'superseded main'):
                vercel.promote(self.receipt)
            cli.assert_not_called()
        self.serving = 'dpl_unexpected'
        with patch.object(vercel, 'api', side_effect=self.api), patch.object(vercel, 'current'), \
                patch.object(vercel, 'cli') as cli:
            with self.assertRaisesRegex(ValueError, 'serving target changed'):
                vercel.promote(self.receipt)
            cli.assert_not_called()

    def test_health_and_alias_must_match_exact_target_around_smoke(self):
        self.stage()
        data = json.loads(self.receipt.read_text())
        data['phase'] = 'promoted'
        self.receipt.write_text(json.dumps(data))
        self.serving = 'dpl_target'
        healthy = {'status': 'ok', 'db': 'connected', 'deploymentSha': self.source}
        for source in (self.source, 'b' * 40):
            health = dict(healthy, deploymentSha=source)
            with patch.object(vercel, 'api', side_effect=self.api), \
                    patch.object(vercel.urllib.request, 'urlopen', return_value=io.StringIO(json.dumps(health))) as read:
                if source == self.source:
                    vercel.verify(self.receipt)
                else:
                    with self.assertRaisesRegex(ValueError, 'health/source mismatch'):
                        vercel.verify(self.receipt)
                self.assertEqual(read.call_args.args, ('https://fitsy.org/api/health',))
        self.serving = 'dpl_previous'
        with patch.object(vercel, 'api', side_effect=self.api), patch.object(vercel.urllib.request, 'urlopen') as read:
            with self.assertRaisesRegex(ValueError, 'serving deployment changed'):
                vercel.verify(self.receipt)
            read.assert_not_called()

    def test_missing_credential_refuses_without_cli_or_network_and_cli_environment_is_clean(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(vercel.subprocess, 'run') as run:
            with self.assertRaises(ValueError):
                vercel.cli('deploy')
            with self.assertRaises(ValueError):
                vercel.api('/v4/aliases/fitsy.org')
            run.assert_not_called()
        env = {'VERCEL_TOKEN': 'fixture-secret', 'GH_TOKEN': 'fixture-gh', 'PROD_DATABASE_URL': 'fixture-db',
               'EXPO_TOKEN': 'fixture-expo', 'HOME': '/broad-login', 'RUNNER_TEMP': str(self.root),
               'VERCEL_CLI': '/pinned/vercel', 'PATH': '/usr/bin:/bin'}
        with patch.dict(os.environ, env, clear=True), patch.object(vercel.subprocess, 'run') as run:
            run.return_value = subprocess.CompletedProcess([], 0, 'https://target.vercel.app\n')
            vercel.cli('deploy', '--prod', '--skip-domain', '--yes')
            child = run.call_args.kwargs['env']
            self.assertFalse(set(child) & {'GH_TOKEN', 'PROD_DATABASE_URL', 'EXPO_TOKEN'})
            self.assertEqual(child['VERCEL_TOKEN'], 'fixture-secret')
            self.assertNotIn('fixture-secret', run.call_args.args[0])
            self.assertNotEqual(child['HOME'], '/broad-login')


if __name__ == '__main__':
    unittest.main()
