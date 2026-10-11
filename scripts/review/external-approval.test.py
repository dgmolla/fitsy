"""External-boundary fixtures prove validation behavior, never installed authority."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('external-approval.py')
spec = importlib.util.spec_from_file_location('external', SCRIPT)
external = importlib.util.module_from_spec(spec)
spec.loader.exec_module(external)


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.source, self.base = 'a' * 40, 'b' * 40
        self.body = '**TL;DR:** Frozen nutrition acceptance.\nStatus: Queued\nKeep ranges visible.\n'
        verdict = {'source_sha': self.source, 'base_sha': self.base,
                   'domains': {'correctness': {'verdict': 'pass', 'findings': []},
                               'danger-zone': {'verdict': 'pass', 'findings': []}},
                   'summary': 'Fixture only', 'limitations': []}
        self.artifacts = {'verdict': json.dumps(verdict).encode(),
                          'prompt': f'issue443 {self.source} {self.base} correctness danger-zone'.encode(),
                          'stderr': b'model: gpt-6-sol\nsandbox: read-only\napproval: never\nreasoning effort: high\n'}
        self.execution = {'kind': 'completed', 'returncode': 0, 'elapsed_seconds': 252.8,
                          'stdout_bytes': len(self.artifacts['verdict']),
                          'stderr_bytes': len(self.artifacts['stderr'])}
        self.artifacts['execution'] = json.dumps(self.execution).encode()
        self.ledger = b'{"event":"retained fixture history"}\n'
        self.approval = {'issue': 443, 'source_sha': self.source, 'base_sha': self.base,
                         'acceptance_sha256': external.acceptance(self.body),
                         'domains': ['correctness', 'danger-zone'], 'provider': 'codex',
                         'model': 'gpt-6-sol', 'reasoning_effort': 'high',
                         'artifacts': {key: {'sha256': external.digest(raw)} for key, raw in self.artifacts.items()}}
        self.policy = {'domains': ['correctness', 'danger-zone'],
                       'ledger_sha256': external.digest(self.ledger), 'execution_timeout_seconds': 300,
                       'accounting_provenance': 'https://github.com/dgmolla/fitsy/issues/443#issuecomment-123'}

    def validate(self):
        external.validate_review(self.approval, self.artifacts, self.ledger, self.policy,
                                 443, self.source, self.body)

    def replace_artifact(self, key, value):
        self.artifacts[key] = json.dumps(value).encode()
        self.approval['artifacts'][key]['sha256'] = external.digest(self.artifacts[key])

    def test_complete_bound_fixture_is_valid(self):
        self.validate()

    def test_forged_receipt_cannot_replace_operator_observed_digest(self):
        self.artifacts['execution'] = b'{"kind":"completed"}'
        with self.assertRaisesRegex(ValueError, 'artifact changed'):
            self.validate()

    def test_changed_acceptance_invalidates_original_review(self):
        self.body += 'New product requirement.\n'
        with self.assertRaisesRegex(ValueError, 'acceptance changed'):
            self.validate()

    def test_status_only_update_preserves_acceptance(self):
        self.body = self.body.replace('Status: Queued', 'Status: In flight')
        self.validate()

    def test_details_remain_acceptance(self):
        self.body += '<details>\nStatus: essential product behavior\n</details>'
        with self.assertRaisesRegex(ValueError, 'acceptance changed'):
            self.validate()

    def test_source_mismatch_refuses(self):
        self.source = 'c' * 40
        with self.assertRaisesRegex(ValueError, 'source mismatch'):
            self.validate()

    def test_missing_domain_refuses(self):
        self.approval['domains'].pop()
        with self.assertRaisesRegex(ValueError, 'domains mismatch'):
            self.validate()

    def test_failed_or_incomplete_transport_never_passes(self):
        for updates in ({'kind': 'timeout'}, {'returncode': 1}, {'elapsed_seconds': 301},
                        {'elapsed_seconds': True}, {'elapsed_seconds': float('nan')}):
            with self.subTest(updates=updates):
                self.replace_artifact('execution', {**self.execution, **updates})
                with self.assertRaisesRegex(ValueError, 'incomplete provider'):
                    self.validate()

    def test_confirmed_finding_refuses_even_with_consistent_hashes(self):
        verdict = json.loads(self.artifacts['verdict'])
        verdict['domains']['correctness'] = {'verdict': 'fail', 'findings': [{'priority': 'P2'}]}
        self.replace_artifact('verdict', verdict)
        self.replace_artifact('execution', {**self.execution, 'stdout_bytes': len(self.artifacts['verdict'])})
        with self.assertRaisesRegex(ValueError, 'did not pass'):
            self.validate()

    def test_no_ledger_reset_or_new_unreconciled_execution(self):
        self.ledger += b'{"event":"another attempt"}\n'
        with self.assertRaisesRegex(ValueError, 'history changed'):
            self.validate()

    def test_wrong_provider_trace_refuses(self):
        self.artifacts['stderr'] = self.artifacts['stderr'].replace(b'read-only', b'danger-full-access')
        self.approval['artifacts']['stderr']['sha256'] = external.digest(self.artifacts['stderr'])
        self.replace_artifact('execution', {**self.execution, 'stderr_bytes': len(self.artifacts['stderr'])})
        with self.assertRaisesRegex(ValueError, 'context mismatch'):
            self.validate()

    def test_caller_copy_cannot_publish_real_check(self):
        result = subprocess.run([sys.executable, '-I', str(SCRIPT), 'publish-review', '--issue', '443', '--pr', '1'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('refused', result.stderr)

    def test_unsafe_ancestor_refuses_protected_artifact(self):
        import os
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            directory.chmod(0o777)
            leaf = directory / 'proof'
            leaf.write_text('fixture'); leaf.chmod(0o600)
            with self.assertRaisesRegex(ValueError, 'custody'):
                external.protected_bytes(leaf, os.getuid())

    def test_real_system_config_directory_avoids_platform_aliases(self):
        import os
        system_file = external.CONFIG.parent.parent / 'passwd'
        if not system_file.is_file():
            self.skipTest('Unix system identity file unavailable')
        self.assertTrue(external.protected_bytes(system_file, os.getuid()))


class CompositionTests(unittest.TestCase):
    def setUp(self):
        self.path = 'scripts/review/run-review.sh'
        self.product = 'apps/mobile/app/detail.tsx'
        self.reviewed = {self.path: ('100755', 'blob', 'old'), self.product: ('100644', 'blob', 'nutrition')}
        self.controls = {self.path: ('100755', 'blob', 'approved')}
        self.candidate = {**self.reviewed, self.path: self.controls[self.path]}

    def validate(self):
        external.validate_composition(self.reviewed, self.candidate, self.controls, [self.path])

    def test_frozen_product_plus_approved_controls_reuses_review(self):
        self.validate()

    def test_product_edit_refuses(self):
        self.candidate[self.product] = ('100644', 'blob', 'new')
        with self.assertRaisesRegex(ValueError, 'frozen product'):
            self.validate()

    def test_extra_unreviewed_file_refuses(self):
        self.candidate['apps/mobile/extra.ts'] = ('100644', 'blob', 'extra')
        with self.assertRaises(ValueError):
            self.validate()

    def test_control_startup_or_hook_change_refuses(self):
        self.candidate[self.path] = ('100755', 'blob', 'malicious-startup')
        with self.assertRaises(ValueError):
            self.validate()

    def test_mode_or_symlink_change_refuses(self):
        self.candidate[self.product] = ('120000', 'blob', 'nutrition')
        with self.assertRaises(ValueError):
            self.validate()

    def test_cannot_label_nutrition_a_control(self):
        with self.assertRaisesRegex(ValueError, 'product path'):
            external.validate_composition(self.reviewed, self.candidate, self.controls, [self.product])


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.source = 'a' * 40
        self.run = {'path': '.github/workflows/deploy.yml', 'event': 'workflow_run', 'head_branch': 'main',
                    'head_sha': self.source, 'repository': {'full_name': 'dgmolla/fitsy'}}
        self.verify = {**self.run, 'path': '.github/workflows/verify.yml', 'event': 'push',
                       'status': 'completed', 'conclusion': 'success'}
        self.protection = {'enforce_admins': {'enabled': True}, 'required_status_checks': {
            'strict': True, 'checks': [{'context': external.CHECK, 'app_id': 123},
                                      {'context': external.ACCEPTANCE_CHECK, 'app_id': 123}]}}
        self.config = {'app_id': 123, 'release_checks': [{'name': 'Static (L0-L1)', 'app_id': 456}]}
        self.checks = [{'name': 'Static (L0-L1)', 'app': {'id': 456}, 'head_sha': self.source,
                        'status': 'completed', 'conclusion': 'success'}]

    def validate(self):
        external.validate_release(self.run, self.verify, self.source, self.checks, self.protection, self.config)

    def test_successful_exact_main_fixture_ready(self):
        self.validate()

    def test_failed_rerun_refuses(self):
        self.verify['conclusion'] = 'failure'
        with self.assertRaisesRegex(ValueError, 'Verify failed'):
            self.validate()

    def test_other_workflow_cannot_substitute_verify(self):
        self.verify['path'] = '.github/workflows/forged.yml'
        with self.assertRaises(ValueError):
            self.validate()

    def test_old_head_verify_refuses(self):
        self.verify['head_sha'] = 'b' * 40
        with self.assertRaises(ValueError):
            self.validate()

    def test_failed_required_check_refuses(self):
        self.checks[0]['conclusion'] = 'failure'
        with self.assertRaisesRegex(ValueError, 'release check failed'):
            self.validate()

    def test_forged_check_issuer_refuses(self):
        self.checks[0]['app']['id'] = 999
        with self.assertRaises(ValueError):
            self.validate()

    def test_unbound_merge_protection_refuses(self):
        self.protection['required_status_checks']['checks'][0]['app_id'] = None
        with self.assertRaisesRegex(ValueError, 'issuer binding'):
            self.validate()

    def test_candidate_dispatch_cannot_be_release(self):
        self.run['event'] = 'workflow_dispatch'
        with self.assertRaisesRegex(ValueError, 'protected main'):
            self.validate()

    def test_current_main_must_match(self):
        self.run['head_sha'] = 'b' * 40
        with self.assertRaises(ValueError):
            self.validate()

    def test_only_independent_user_can_integrate_through_pr(self):
        ruleset = {'target': 'branch', 'enforcement': 'active',
                   'conditions': {'ref_name': {'include': ['refs/heads/main'], 'exclude': []}},
                   'bypass_actors': [{'actor_id': 18452532, 'actor_type': 'User', 'bypass_mode': 'pull_request'}],
                   'rules': [{'type': 'update', 'parameters': {'update_allows_fetch_and_merge': False}}]}
        config = {'merge_operator_user_id': 18452532}
        external.validate_merge_custody(ruleset, config)
        ruleset['bypass_actors'].append({'actor_id': 999, 'actor_type': 'Integration', 'bypass_mode': 'always'})
        with self.assertRaisesRegex(ValueError, 'merge custody'):
            external.validate_merge_custody(ruleset, config)

    def test_initiating_merge_actor_cannot_approve_release(self):
        environment = {'name': 'production-release', 'can_admins_bypass': False,
                       'protection_rules': [{'type': 'required_reviewers', 'prevent_self_review': True,
                                             'reviewers': [{'type': 'User', 'reviewer': {'id': 777}}]}],
                       'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True}}
        config = {'merge_operator_user_id': 18452532, 'release_reviewer_user_id': 777}
        external.validate_release_reviewer(environment, [18452532, 18452532], 777, config)
        for identity in (18452532, None):
            with self.subTest(identity=identity), self.assertRaisesRegex(ValueError, 'distinct'):
                external.validate_release_reviewer(environment, [18452532, 18452532], identity, config)
        with self.assertRaisesRegex(ValueError, 'distinct'):
            external.validate_release_reviewer(environment, [18452532, 777], 777, config)

    def test_missing_bypass_or_self_review_protection_refuses(self):
        environment = {'name': 'production-release', 'can_admins_bypass': True,
                       'protection_rules': [{'type': 'required_reviewers', 'prevent_self_review': True,
                                             'reviewers': [{'type': 'User', 'reviewer': {'id': 777}}]}],
                       'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True}}
        config = {'merge_operator_user_id': 18452532, 'release_reviewer_user_id': 777}
        with self.assertRaisesRegex(ValueError, 'reviewer protection'):
            external.validate_release_reviewer(environment, [18452532], 777, config)
        environment['can_admins_bypass'] = False
        environment['protection_rules'][0]['prevent_self_review'] = False
        with self.assertRaisesRegex(ValueError, 'reviewer protection'):
            external.validate_release_reviewer(environment, [18452532], 777, config)


class AcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.source = 'a' * 40
        self.receipt = {'head_sha': self.source, 'source_identity': 'identity', 'stage': 'full',
                        'finished_at': '2026-10-10T00:00:00Z', 'arguments': ['--layer=all', '--scope=all'],
                        'results': [{'name': 'tests', 'status': 'pass', 'blocking': True},
                                    {'name': 'product-flow', 'status': 'pass', 'blocking': True}]}
        self.policy = {'source_identity': 'identity', 'arguments': ['--layer=all', '--scope=all'],
                       'required_checks': {'tests': 'pass', 'product-flow': 'pass'}}

    def validate(self):
        external.validate_acceptance(self.receipt, self.policy, self.source)

    def test_operator_observed_full_recipe_passes(self):
        self.validate()

    def test_failed_required_local_check_refuses(self):
        self.receipt['results'][0]['status'] = 'fail'
        with self.assertRaisesRegex(ValueError, 'acceptance failed'):
            self.validate()

    def test_missing_native_proof_refuses(self):
        self.receipt['results'].pop()
        with self.assertRaises(ValueError):
            self.validate()

    def test_cheap_subset_cannot_replace_full_acceptance(self):
        self.receipt['stage'] = 'cheap'
        with self.assertRaisesRegex(ValueError, 'recipe mismatch'):
            self.validate()

    def test_comparison_or_dirty_source_identity_cannot_replace_frozen_source(self):
        self.receipt['source_identity'] = 'dirty-or-hidden'
        with self.assertRaises(ValueError):
            self.validate()

    def test_unexpected_blocking_failure_refuses(self):
        self.receipt['results'].append({'name': 'other-required', 'status': 'fail', 'blocking': True})
        with self.assertRaisesRegex(ValueError, 'blocking local'):
            self.validate()


class PublishBoundaryTests(unittest.TestCase):
    """Drive real validation and only replace the external GitHub transport."""
    def setUp(self):
        import os
        baseline = ReviewTests(); baseline.setUp()
        self.source, self.body = baseline.source, baseline.body
        self.temp = tempfile.TemporaryDirectory(dir=SCRIPT.parents[2] / '.evidence')
        self.root = Path(self.temp.name)
        completed = self.root / 'completed'; completed.mkdir()
        approval = baseline.approval
        for name, raw in baseline.artifacts.items():
            path = self.root / name; path.write_bytes(raw)
            approval['artifacts'][name]['path'] = str(path)
        manifest = completed / 'issue-443.json'; manifest.write_text(json.dumps(approval))
        (self.root / 'issue-443.jsonl').write_bytes(baseline.ledger)
        self.config = {'operator_uid': os.getuid(), 'app_id': 123,
                       'review_home': str(self.root), 'budget_home': str(self.root),
                       'reviews': {'443': {**baseline.policy, 'manifest_sha256': external.digest(manifest.read_bytes())}}}
        self.pr = {'state': 'open', 'body': 'Delivery-Issue: #443\n',
                   'head': {'sha': self.source, 'repo': {'full_name': external.REPO}},
                   'base': {'ref': 'main', 'repo': {'full_name': external.REPO}}}
        self.writes = []
        self.calls = []

    def tearDown(self):
        self.temp.cleanup()

    def transport(self, config, endpoint, payload=None, release=False):
        self.calls.append(endpoint)
        if endpoint.endswith('/pulls/9'):
            return self.pr
        if endpoint.endswith('/issues/443'):
            return {'body': self.body}
        if endpoint.endswith('/check-runs') and payload is not None:
            self.writes.append(payload)
            return {'app': {'id': 123}, 'head_sha': payload['head_sha'],
                    'conclusion': payload['conclusion'], 'html_url': 'https://fixture.invalid/check'}
        raise AssertionError(f'unexpected API request: {endpoint}')

    def test_valid_bound_execution_reaches_check_write_in_external_fixture(self):
        with patch.object(external, 'github', side_effect=self.transport):
            result = external.publish(self.config, 443, 9)
        self.assertEqual(result['source_sha'], self.source)
        self.assertEqual(len(self.writes), 1)
        self.assertEqual(self.writes[0]['name'], external.CHECK)

    def test_forged_provider_artifact_never_reaches_write(self):
        (self.root / 'execution').write_text('{"kind":"completed"}')
        with patch.object(external, 'github', side_effect=self.transport):
            with self.assertRaisesRegex(ValueError, 'artifact changed'):
                external.publish(self.config, 443, 9)
        self.assertFalse(self.writes)

    def test_acceptance_change_never_reaches_write(self):
        self.body += 'New requirement.\n'
        with patch.object(external, 'github', side_effect=self.transport):
            with self.assertRaisesRegex(ValueError, 'acceptance changed'):
                external.publish(self.config, 443, 9)
        self.assertFalse(self.writes)

    def test_head_changes_during_publication_never_reaches_write(self):
        def changing(config, endpoint, payload=None, release=False):
            result = self.transport(config, endpoint, payload, release)
            if endpoint.endswith('/pulls/9') and self.calls.count(endpoint) == 2:
                import copy
                result = copy.deepcopy(result); result['head']['sha'] = 'c' * 40
            return result
        with patch.object(external, 'github', side_effect=changing):
            with self.assertRaisesRegex(ValueError, 'PR source'):
                external.publish(self.config, 443, 9)
        self.assertFalse(self.writes)


if __name__ == '__main__':
    unittest.main()
