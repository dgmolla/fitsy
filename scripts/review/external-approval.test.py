"""External-boundary fixtures prove validation behavior, never installed authority."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import ssl
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('external-approval.py')
REPO_ROOT = SCRIPT.parents[2]
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

    def test_reviewed_maintenance_control_reuses_frozen_product_without_allowing_other_workflows(self):
        path = '.github/workflows/dev-maintenance.yml'
        reviewed = {**self.reviewed, path: ('100644', 'blob', 'unprotected')}
        controls = {path: ('100644', 'blob', 'protected')}
        candidate = {**reviewed, path: controls[path]}
        external.validate_composition(reviewed, candidate, controls, [path])
        with self.assertRaisesRegex(ValueError, 'product path'):
            external.validate_composition(reviewed, candidate, controls, ['.github/workflows/unreviewed.yml'])

    def test_reviewed_native_workflow_regression_is_an_exact_control_path(self):
        path = 'scripts/deploy/native-compatibility.test.ts'
        reviewed = {**self.reviewed, path: ('100644', 'blob', 'stale-push-fixture')}
        controls = {path: ('100644', 'blob', 'dispatch-fixture')}
        candidate = {**reviewed, path: controls[path]}
        external.validate_composition(reviewed, candidate, controls, [path])
        for unrelated in ('scripts/deploy/native-compatibility.test.ts.backup',
                          'scripts/deploy/ota.sh'):
            with self.subTest(path=unrelated), self.assertRaisesRegex(ValueError, 'product path'):
                external.validate_composition(reviewed, candidate, controls, [unrelated])


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.source = 'a' * 40
        self.run = {'path': '.github/workflows/deploy.yml', 'event': 'workflow_dispatch', 'head_branch': 'main',
                    'head_sha': self.source, 'repository': {'full_name': 'dgmolla/fitsy'}}
        self.verify = {**self.run, 'path': '.github/workflows/verify.yml', 'event': 'push',
                       'status': 'completed', 'conclusion': 'success'}
        self.protection = {'enforce_admins': {'enabled': True}, 'required_status_checks': {
            'strict': True, 'checks': [{'context': external.CHECK, 'app_id': 123},
                                      {'context': external.ACCEPTANCE_CHECK, 'app_id': 123},
                                      {'context': 'product-flow/local', 'app_id': None}]}}
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

    def test_removed_required_product_gate_refuses(self):
        self.protection['required_status_checks']['checks'].pop()
        with self.assertRaisesRegex(ValueError, 'product gate'):
            self.validate()

    def test_unbound_merge_protection_refuses(self):
        self.protection['required_status_checks']['checks'][0]['app_id'] = None
        with self.assertRaisesRegex(ValueError, 'issuer binding'):
            self.validate()

    def test_candidate_dispatch_cannot_be_release(self):
        self.run['event'] = 'workflow_run'
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

    def test_observed_github_update_rule_without_parameters(self):
        # Ruleset25054221 GET omitted the optional parameters on this non-fork.
        ruleset = {'target': 'branch', 'enforcement': 'active',
                   'conditions': {'ref_name': {'include': ['refs/heads/main'], 'exclude': []}},
                   'bypass_actors': [{'actor_id': 18452532, 'actor_type': 'User', 'bypass_mode': 'pull_request'}],
                   'rules': [{'type': 'update'}]}
        external.validate_merge_custody(ruleset, {'merge_operator_user_id': 18452532})

    def test_update_rule_rejects_invalid_parameters_and_extra_rules(self):
        ruleset = {'target': 'branch', 'enforcement': 'active',
                   'conditions': {'ref_name': {'include': ['refs/heads/main'], 'exclude': []}},
                   'bypass_actors': [{'actor_id': 18452532, 'actor_type': 'User', 'bypass_mode': 'pull_request'}]}
        invalid_parameters = [None, True, False, 0, [], '', {},
                              {'update_allows_fetch_and_merge': True},
                              {'update_allows_fetch_and_merge': None},
                              {'update_allows_fetch_and_merge': 0},
                              {'update_allows_fetch_and_merge': 'false'},
                              {'update_allows_fetch_and_merge': False, 'unknown': False}]
        invalid_rules = [[{'type': 'update', 'parameters': value}] for value in invalid_parameters]
        invalid_rules += [None, {}, [], [None], [{'type': 'update'}, {'type': 'update'}],
                          [{'type': 'update', 'unknown': False}], [{'type': 'deletion'}]]
        for rules in invalid_rules:
            with self.subTest(rules=rules):
                ruleset['rules'] = rules
                with self.assertRaisesRegex(ValueError, 'merge custody'):
                    external.validate_merge_custody(ruleset, {'merge_operator_user_id': 18452532})

    def test_observed_rule_retains_scope_and_bypass_restrictions(self):
        ruleset = {'target': 'branch', 'enforcement': 'active',
                   'conditions': {'ref_name': {'include': ['refs/heads/main'], 'exclude': []}},
                   'bypass_actors': [{'actor_id': 18452532, 'actor_type': 'User', 'bypass_mode': 'pull_request'}],
                   'rules': [{'type': 'update'}]}
        changes = [('target', 'tag'), ('enforcement', 'evaluate'),
                   ('conditions', {'ref_name': {'include': ['~ALL'], 'exclude': []}}),
                   ('conditions', {'ref_name': {'include': ['refs/heads/main'], 'exclude': ['refs/heads/main']}}),
                   ('bypass_actors', []),
                   ('bypass_actors', [{'actor_id': 999, 'actor_type': 'User', 'bypass_mode': 'pull_request'}]),
                   ('bypass_actors', [{'actor_id': 18452532, 'actor_type': 'User', 'bypass_mode': 'always'}]),
                   ('bypass_actors', [{'actor_id': 18452532, 'actor_type': 'Integration', 'bypass_mode': 'pull_request'}])]
        for key, value in changes:
            with self.subTest(key=key, value=value):
                with self.assertRaisesRegex(ValueError, 'merge custody'):
                    external.validate_merge_custody({**ruleset, key: value}, {'merge_operator_user_id': 18452532})

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
        self.config.update(app_id=5285837, installation_id=170592990,
                           dispatch_actor_user_id=888, dispatch_actor_login='fixture[bot]',
                           merge_operator_user_id=18452532, release_reviewer_user_id=18452532,
                           verify_workflow_id=10, deploy_workflow_id=11, merge_custody_ruleset_id=12,
                           release_checks=[{'name': 'Tests', 'app_id': 15368}])
        self.config['app_token_file'] = str(self.root / 'token')
        (self.root / 'token').write_text('synthetic-installation-token'); (self.root / 'token').chmod(0o600)
        permissions = {'metadata': 'read', 'checks': 'write', 'contents': 'read', 'issues': 'read',
                       'pull_requests': 'read', 'actions': 'write', 'administration': 'read'}
        self.identity = {'app': {'id': 5285837, 'slug': 'fixture'},
                         'installation': {'app_id': 5285837, 'id': 170592990,
                                          'account': {'login': 'dgmolla'}, 'repository_selection': 'selected',
                                          'permissions': permissions},
                         'token': {'sha256': external.digest((self.root / 'token').read_bytes()),
                                   'permissions': permissions, 'expires_at': '2099-01-01T00:00:00Z'},
                         'repository_id': 42}
        self.save_identity()
        self.actor = {'id': 888, 'login': 'fixture[bot]', 'type': 'Bot'}

    def tearDown(self):
        self.temp.cleanup()

    def save_identity(self):
        path = self.root / 'identity.json'; path.write_text(json.dumps(self.identity)); path.chmod(0o600)
        self.config.update(app_identity_file=str(path), app_identity_sha256=external.digest(path.read_bytes()))


    def transport(self, config, endpoint, payload=None, release=False):
        self.calls.append(endpoint)
        if endpoint == 'installation/repositories?per_page=100':
            return {'total_count': 1, 'repositories': [{'id': 42, 'full_name': external.REPO}]}
        if endpoint == 'apps/fixture': return self.identity['app']
        if endpoint == 'users/fixture[bot]': return self.actor
        if endpoint.endswith('/pulls/9'):
            return self.pr
        if endpoint.endswith('/issues/443'):
            return {'body': self.body}
        if endpoint.endswith('/check-runs') and payload is not None:
            self.writes.append(payload)
            return {'app': {'id': config['app_id']}, 'head_sha': payload['head_sha'],
                    'conclusion': payload['conclusion'], 'html_url': 'https://fixture.invalid/check'}
        raise AssertionError(f'unexpected API request: {endpoint}')

    def test_valid_bound_execution_reaches_check_write_in_external_fixture(self):
        with patch.object(external, 'github', side_effect=self.transport):
            result = external.publish(self.config, 443, 9)
        self.assertEqual(result['source_sha'], self.source)
        self.assertEqual(len(self.writes), 1)
        self.assertEqual(self.writes[0]['name'], external.CHECK)

    def test_changed_token_provenance_cannot_publish_protected_check(self):
        (self.root / 'token').write_text('changed-synthetic-token')
        with patch.object(external, 'github', side_effect=self.transport):
            with self.assertRaisesRegex(ValueError, 'token changed'):
                external.publish(self.config, 443, 9)
        self.assertFalse(self.writes)

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


class DispatchBoundaryTests(PublishBoundaryTests):
    """Exercise dispatch/readiness using real validators and fixture GitHub I/O only."""
    def setUp(self):
        super().setUp()
        import base64
        self.main = 'c' * 40
        self.verify = {'id': 20, 'workflow_id': 10, 'path': '.github/workflows/verify.yml',
                       'event': 'push', 'head_branch': 'main', 'head_sha': self.main,
                       'repository': {'full_name': external.REPO}, 'status': 'completed', 'conclusion': 'success'}
        self.run = {'id': 30, 'workflow_id': 11, 'path': '.github/workflows/deploy.yml',
                    'event': 'workflow_dispatch', 'head_branch': 'main', 'head_sha': self.main,
                    'repository': {'full_name': external.REPO}, 'actor': dict(self.actor),
                    'triggering_actor': dict(self.actor),
                    'display_title': external.dispatch_title(self.main, 20, external.acceptance(self.body))}
        self.environment = {'name': 'production-release', 'can_admins_bypass': False,
                            'protection_rules': [{'type': 'required_reviewers', 'prevent_self_review': True,
                                                  'reviewers': [{'type': 'User', 'reviewer': {'id': 18452532}}]}],
                            'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True}}
        self.ruleset = {'target': 'branch', 'enforcement': 'active',
                        'conditions': {'ref_name': {'include': ['refs/heads/main'], 'exclude': []}},
                        'bypass_actors': [{'actor_id': 18452532, 'actor_type': 'User', 'bypass_mode': 'pull_request'}],
                        'rules': [{'type': 'update', 'parameters': {'update_allows_fetch_and_merge': False}}]}
        self.checks = [{'name': 'Tests', 'app': {'id': 15368}, 'head_sha': self.main,
                        'status': 'completed', 'conclusion': 'success'}]
        self.protection = {'enforce_admins': {'enabled': True}, 'required_status_checks': {
            'strict': True, 'checks': [{'context': name, 'app_id': 5285837}
                                      for name in (external.CHECK, external.ACCEPTANCE_CHECK)] +
                      [{'context': 'product-flow/local', 'app_id': None}]}}
        self.workflow_bytes = b'fixture independently approved workflow bytes'
        for name in ('verify', 'deploy'):
            self.config[name + '_workflow_sha256'] = external.digest(self.workflow_bytes)
        acceptance = AcceptanceTests(); acceptance.setUp()
        receipt = self.root / 'acceptance.json'; receipt.write_text(json.dumps(acceptance.receipt))
        self.config['local_acceptance'] = {'443': {**acceptance.policy, 'receipt_path': str(receipt),
                                                  'receipt_sha256': external.digest(receipt.read_bytes()),
                                                  'source_tree_sha': 'equal-reviewed-product-tree'}}
        self.pr.update(number=9, merge_commit_sha='d' * 40)
        self.pr['base']['sha'] = 'b' * 40
        self.candidate_verify = {**self.verify, 'id': 21, 'event': 'pull_request', 'head_sha': self.source,
                                 'run_attempt': 1, 'check_suite_id': 100,
                                 'pull_requests': [{'number': 9, 'base': {'sha': 'b' * 40},
                                                    'head': {'sha': self.source}}]}
        self.candidate_jobs = [{'id': 1000 + i, 'name': name, 'run_id': 21, 'run_attempt': 1,
                                'head_sha': self.source, 'status': 'completed', 'conclusion': 'success',
                                'labels': ['ubuntu-latest'],
                                'check_run_url': f'https://api.github.com/repos/{external.REPO}/check-runs/{1000+i}'}
                               for i, name in enumerate(external.VERIFY_JOBS)]
        self.candidate_checks = {job['id']: {'id': job['id'], 'name': job['name'], 'head_sha': self.source,
                                            'status': 'completed', 'conclusion': 'success',
                                            'check_suite': {'id': 100},
                                            'app': {'id': 15368, 'slug': 'github-actions'}}
                                 for job in self.candidate_jobs}
        self.product_status = {'sha': self.source, 'total_count': 1,
                               'statuses': [{'context': 'product-flow/local', 'state': 'success'}]}
        self.latest_verify = 20
        self.can_approve = True
        self.default_branch = 'main'
        self.scope_name = external.REPO
        self.api_override = {}


    def test_merged_release_accepts_empty_mutable_run_association(self):
        # Captured GitHub behavior: the same successful PR run loses this list after merge.
        self.pr.update(state='closed', merged_at='2026-10-17T18:56:04Z')
        self.candidate_verify['pull_requests'] = []
        context = self.dispatch()
        self.assertEqual(context['source_sha'], self.main)
        self.assertEqual(context['reviewed_source_sha'], self.source)
        self.assertEqual(len(self.writes), 1)

    def test_merged_release_rejects_missing_malformed_or_wrong_association(self):
        import copy
        original = copy.deepcopy(self.candidate_verify)
        for value in (None, {}, 'missing', [{'number': 99}],
                      [{'number': 9, 'base': None, 'head': {}}],
                      original['pull_requests'] * 2):
            with self.subTest(association=value):
                self.candidate_verify = {**copy.deepcopy(original), 'pull_requests': value}
                with self.assertRaises(ValueError): self.dispatch()
                self.assertFalse(self.writes)
        self.candidate_verify = copy.deepcopy(original)
        del self.candidate_verify['pull_requests']
        with self.assertRaisesRegex(ValueError, 'association unavailable'): self.dispatch()
        for side in ('base', 'head'):
            self.candidate_verify = copy.deepcopy(original)
            self.candidate_verify['pull_requests'][0][side]['sha'] = 'f' * 40
            with self.assertRaisesRegex(ValueError, 'event PR/base/head'): self.dispatch()
            self.assertFalse(self.writes)

    def test_empty_association_requires_actual_merged_main_provenance(self):
        import copy
        self.candidate_verify['pull_requests'] = []
        endpoint = f'repos/{external.REPO}'
        valid = {**copy.deepcopy(self.pr), 'state': 'closed', 'merged_at': 'fixture',
                 'merge_commit_sha': self.main}
        for key, value in (('state', 'open'), ('merged_at', None), ('merged_at', True),
                           ('merge_commit_sha', 'f' * 40)):
            with self.subTest(field=key):
                self.api_override[f'{endpoint}/commits/{self.main}/pulls?per_page=100'] = [{**valid, key: value}]
                with self.assertRaises(ValueError): self.dispatch()
                self.assertFalse(self.writes)
        for side in ('base', 'head'):
            changed = copy.deepcopy(valid)
            changed[side]['repo']['full_name'] = 'foreign/repository'
            self.api_override[f'{endpoint}/commits/{self.main}/pulls?per_page=100'] = [changed]
            with self.assertRaisesRegex(ValueError, 'merged-main PR'): self.dispatch()
        self.api_override[f'{endpoint}/commits/{self.main}/pulls?per_page=100'] = [valid, valid]
        with self.assertRaisesRegex(ValueError, 'unique protected PR'): self.dispatch()
        self.api_override.clear()
        for value in ({'tree': {'sha': 'wrong'}, 'parents': [{'sha': 'b' * 40}, {'sha': self.source}]},
                      {'tree': {'sha': 'equal-reviewed-product-tree'}, 'parents': [{'sha': self.source}, {'sha': 'b' * 40}]}):
            self.api_override[f'{endpoint}/git/commits/{self.main}'] = value
            with self.assertRaisesRegex(ValueError, 'merge tree/base/head'): self.dispatch()
            self.assertFalse(self.writes)

    def transport(self, config, endpoint, payload=None, release=False):
        import base64
        if endpoint in self.api_override:
            return self.api_override[endpoint]
        if endpoint == 'installation/repositories?per_page=100':
            return {'total_count': 1, 'repositories': [{'id': 42, 'full_name': self.scope_name}]}
        if endpoint == 'apps/fixture': return self.identity['app']
        if endpoint == 'users/fixture[bot]': return self.actor
        if endpoint == 'user': return {'id': 18452532, 'type': 'User'}
        if endpoint == f'repos/{external.REPO}': return {'default_branch': self.default_branch}
        if '/contents/' in endpoint:
            path = endpoint.split('/contents/')[1].split('?')[0]
            return {'type': 'file', 'path': path, 'encoding': 'base64',
                    'content': base64.b64encode(self.workflow_bytes).decode()}
        if endpoint.endswith('/actions/workflows/10'): return {'path': '.github/workflows/verify.yml', 'state': 'active'}
        if endpoint.endswith('/actions/workflows/11'): return {'path': '.github/workflows/deploy.yml', 'state': 'active'}
        if endpoint.endswith('/git/ref/heads/main'): return {'object': {'sha': self.main}}
        if endpoint.endswith(f'/commits/{self.source}/status?per_page=100'): return self.product_status
        if endpoint.endswith('/actions/runs/20'): return self.verify
        if endpoint.endswith('/actions/runs/21'): return self.candidate_verify
        if endpoint.endswith('/actions/runs/21/jobs?filter=latest&per_page=100'):
            return {'total_count': len(self.candidate_jobs), 'jobs': self.candidate_jobs}
        if '/check-runs/' in endpoint and int(endpoint.rsplit('/', 1)[1]) in self.candidate_checks:
            return self.candidate_checks[int(endpoint.rsplit('/', 1)[1])]
        if endpoint.endswith('/actions/runs/30'): return self.run
        if '/actions/workflows/10/runs?' in endpoint:
            return {'workflow_runs': [{'id': 21 if 'event=pull_request' in endpoint else self.latest_verify}]}
        if endpoint.endswith('/branches/main/protection'): return self.protection
        if endpoint.endswith('/rulesets/12'): return self.ruleset
        if '/check-runs?filter=latest' in endpoint: return {'total_count': len(self.checks), 'check_runs': self.checks}
        if endpoint.endswith('/environments/production-release'): return self.environment
        if endpoint.endswith('/deployment-branch-policies'):
            return {'total_count': 1, 'branch_policies': [{'name': 'main', 'type': 'branch'}]}
        if endpoint.endswith('/pulls?per_page=100'):
            return [{**self.pr, 'state': 'closed', 'merged_at': 'fixture', 'merge_commit_sha': self.main}]
        if '/git/commits/' in endpoint:
            return {'tree': {'sha': 'equal-reviewed-product-tree'},
                    'parents': [{'sha': 'b' * 40}, {'sha': self.source}]}
        if '/git/trees/' in endpoint: return {'truncated': False, 'tree': []}
        if endpoint.endswith('/pending_deployments'):
            return [{'environment': {'id': 5, 'name': 'production-release'}, 'current_user_can_approve': self.can_approve}]
        if endpoint.endswith('/actions/workflows/11/dispatches'):
            self.writes.append(payload); return None  # documented legacy 204 transport
        return super().transport(config, endpoint, payload, release)

    def dispatch(self):
        with patch.object(external, 'github', side_effect=self.transport):
            return external.dispatch_release(self.config, 20)

    def ready(self):
        with patch.object(external, 'github', side_effect=self.transport):
            return external.release_ready(self.config, 30, 20)

    def test_ruleset_metadata_uses_verified_human_credential_before_dispatch(self):
        metadata_calls = []
        def transport(config, endpoint, payload=None, release=False):
            if endpoint == 'user':
                metadata_calls.append((endpoint, release))
                return {'id': 18452532, 'type': 'User'}
            if endpoint.endswith('/rulesets/12'):
                metadata_calls.append((endpoint, release))
                value = dict(self.ruleset)
                if not release:
                    value.pop('bypass_actors')
                return value
            return self.transport(config, endpoint, payload, release)
        with patch.object(external, 'github', side_effect=transport):
            external.dispatch_release(self.config, 20)
        self.assertEqual(metadata_calls, [('user', True),
                         (f'repos/{external.REPO}/rulesets/12', True)])
        self.assertEqual(len(self.writes), 1)

    def test_valid_single_human_path_binds_dispatch_and_reports_pending_without_approval(self):
        self.dispatch()
        self.assertEqual(self.writes, [{'ref': 'main', 'inputs': {'release_sha': self.main,
                          'verify_run': '20', 'acceptance_sha256': external.acceptance(self.body)}}])
        self.assertEqual(self.ready()['environment_ids'], [5])
        self.assertEqual(len(self.writes), 1)

    def test_wrong_custody_actor_refuses_before_ruleset_read_or_dispatch(self):
        for actor in ({'id': 999, 'type': 'User'}, {'id': 18452532, 'type': 'Bot'},
                      {'id': '18452532', 'type': 'User'}, {}):
            with self.subTest(actor=actor):
                calls = []
                def transport(config, endpoint, payload=None, release=False):
                    calls.append((endpoint, release))
                    if endpoint == 'user': return actor
                    return self.transport(config, endpoint, payload, release)
                with patch.object(external, 'github', side_effect=transport):
                    with self.assertRaisesRegex(ValueError, 'pinned human operator'):
                        external.dispatch_release(self.config, 20)
                self.assertNotIn((f'repos/{external.REPO}/rulesets/12', True), calls)
                self.assertFalse(self.writes)

    def test_missing_or_changed_human_ruleset_refuses_before_dispatch(self):
        import copy
        original = copy.deepcopy(self.ruleset)
        invalid = [None, [],
                   original['bypass_actors'] + [{'actor_id': 999, 'actor_type': 'User', 'bypass_mode': 'pull_request'}],
                   [{'actor_id': 18452532, 'actor_type': 'User', 'bypass_mode': 'always'}]]
        for actors in invalid:
            with self.subTest(actors=actors):
                self.ruleset = copy.deepcopy(original)
                if actors is None: self.ruleset.pop('bypass_actors')
                else: self.ruleset['bypass_actors'] = actors
                with self.assertRaisesRegex(ValueError, 'merge custody unavailable'):
                    self.dispatch()
                self.assertFalse(self.writes)
        self.ruleset = copy.deepcopy(original)
        self.ruleset['rules'] = [{'type': 'update', 'parameters': {'update_allows_fetch_and_merge': True}}]
        with self.assertRaisesRegex(ValueError, 'merge custody unavailable'):
            self.dispatch()
        self.assertFalse(self.writes)

    def test_human_initiation_or_rerun_refuses_even_with_same_release_title(self):
        for field in ('actor', 'triggering_actor'):
            saved = self.run[field]
            self.run[field] = {'id': 18452532, 'login': 'dgmolla', 'type': 'User'}
            with self.assertRaisesRegex(ValueError, 'App deployment initiation'):
                self.ready()
            self.run[field] = saved

    def test_wrong_app_installation_permissions_or_token_refuse_before_dispatch(self):
        import copy
        original = copy.deepcopy(self.identity)
        for section, key, value in [('app', 'id', 999), ('installation', 'id', 999),
                                     ('installation', 'app_id', 999), ('token', 'sha256', 'forged'),
                                     ('token', 'expires_at', '2020-01-01T00:00:00Z'),
                                     ('installation', 'permissions', {'actions': 'write'})]:
            self.identity = copy.deepcopy(original); self.identity[section][key] = value; self.save_identity()
            with self.subTest(section=section, key=key), self.assertRaises(ValueError): self.dispatch()
            self.assertFalse(self.writes)

    def test_unpinned_identity_receipt_refuses(self):
        (self.root / 'identity.json').write_text('{}')
        with self.assertRaisesRegex(ValueError, 'provenance'): self.dispatch()

    def test_wrong_actor_scope_or_default_workflow_refuse(self):
        self.actor['id'] = 999
        with self.assertRaises(ValueError): self.dispatch()
        self.actor['id'] = 888; self.scope_name = 'other/repo'
        with self.assertRaises(ValueError): self.dispatch()
        self.scope_name = external.REPO; self.default_branch = 'candidate'
        with self.assertRaises(ValueError): self.dispatch()
        self.default_branch = 'main'; self.workflow_bytes += b'changed'
        with self.assertRaisesRegex(ValueError, 'workflow bytes'): self.dispatch()
        self.assertFalse(self.writes)

    def test_failed_missing_or_superseded_verify_never_dispatches(self):
        self.verify['conclusion'] = 'failure'
        with self.assertRaises(ValueError): self.dispatch()
        self.verify['conclusion'] = 'success'; self.latest_verify = 999
        with self.assertRaisesRegex(ValueError, 'superseded'): self.dispatch()
        self.latest_verify = 20; self.verify['head_sha'] = 'd' * 40
        with self.assertRaises(ValueError): self.dispatch()
        self.assertFalse(self.writes)

    def test_forged_review_failed_checks_and_changed_acceptance_never_dispatch(self):
        raw = (self.root / 'execution').read_bytes(); (self.root / 'execution').write_text('{}')
        with self.assertRaises(ValueError): self.dispatch()
        (self.root / 'execution').write_bytes(raw); self.checks[0]['conclusion'] = 'failure'
        with self.assertRaises(ValueError): self.dispatch()
        self.checks[0]['conclusion'] = 'success'; self.body += 'New accepted requirement.'
        with self.assertRaises(ValueError): self.dispatch()
        self.assertFalse(self.writes)

    def test_other_source_or_input_approval_refuses(self):
        self.run['head_sha'] = 'd' * 40
        with self.assertRaisesRegex(ValueError, 'dispatch source'): self.ready()
        self.run['head_sha'] = self.main; self.run['display_title'] += 'forged'
        with self.assertRaisesRegex(ValueError, 'dispatch source'): self.ready()

    def test_missing_protected_eligibility_or_bypass_refuses(self):
        self.can_approve = False
        with self.assertRaisesRegex(ValueError, 'approval unavailable'): self.ready()
        self.can_approve = True; self.environment['can_admins_bypass'] = True
        with self.assertRaises(ValueError): self.ready()

    def test_changed_token_or_scope_cannot_publish_either_protected_check(self):
        token = (self.root / 'token').read_bytes()
        for kind in ('token', 'scope'):
            if kind == 'token': (self.root / 'token').write_text('changed-synthetic-token')
            else:
                (self.root / 'token').write_bytes(token); self.scope_name = 'other/repository'
            for operation in (lambda: external.publish(self.config, 443, 9),
                              lambda: external.publish_acceptance(self.config, 443, 9, 20)):
                with patch.object(external, 'github', side_effect=self.transport), self.assertRaises(ValueError):
                    operation()
                self.assertFalse(self.writes)

    def test_valid_installation_can_publish_source_bound_acceptance(self):
        with patch.object(external, 'github', side_effect=self.transport):
            result = external.publish_acceptance(self.config, 443, 9, 21)
        self.assertEqual(result['source_sha'], self.source)
        self.assertEqual(self.writes[0]['name'], external.ACCEPTANCE_CHECK)

    def test_failed_missing_or_wrong_source_product_status_never_dispatches(self):
        import copy
        original = copy.deepcopy(self.product_status)
        for state in ('failure', 'pending'):
            self.product_status['statuses'][0]['state'] = state
            with self.assertRaisesRegex(ValueError, 'product gate'): self.dispatch()
        self.product_status = copy.deepcopy(original); self.product_status['statuses'] = []
        with self.assertRaisesRegex(ValueError, 'product gate'): self.dispatch()
        self.product_status = copy.deepcopy(original); self.product_status['sha'] = 'd' * 40
        with self.assertRaisesRegex(ValueError, 'product status'): self.dispatch()
        self.assertFalse(self.writes)

    def test_main_race_refuses_before_write(self):
        calls = 0
        def moving(config, endpoint, payload=None, release=False):
            nonlocal calls
            if endpoint.endswith('/git/ref/heads/main'):
                calls += 1
                if calls == 2: return {'object': {'sha': 'd' * 40}}
            return self.transport(config, endpoint, payload, release)
        with patch.object(external, 'github', side_effect=moving), self.assertRaisesRegex(ValueError, 'main changed'):
            external.dispatch_release(self.config, 20)
        self.assertFalse(self.writes)

    def test_same_uid_cannot_load_authority(self):
        import os
        raw = json.dumps({'operator_uid': os.getuid(), 'candidate_uid': os.getuid()}).encode()
        with patch.object(external, 'protected_bytes', return_value=raw), self.assertRaisesRegex(ValueError, 'candidate'):
            external.authority()


class TokenTransportTests(unittest.TestCase):
    """Use the real credential loader; replace only the outbound CLI/API process."""
    def setUp(self):
        self.fixture = PublishBoundaryTests(); self.fixture.setUp()
        self.config = self.fixture.config
        self.config['gh_path'] = '/fixture/gh'
        self.original = (self.fixture.root / 'token').read_text()

    def tearDown(self):
        self.fixture.tearDown()

    def test_renewed_token_after_validation_never_reaches_publication_write(self):
        with patch.object(external, 'github', side_effect=self.fixture.transport):
            external.installation_identity(self.config)
        (self.fixture.root / 'token').write_text('new-synthetic-token')
        from types import SimpleNamespace
        with patch.object(external.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='{}')) as outbound:
            with self.assertRaisesRegex(ValueError, 'token changed'):
                external.github(self.config, 'repos/dgmolla/fitsy/check-runs', {'name': external.CHECK})
            outbound.assert_not_called()

    def test_same_validated_bytes_are_used_if_file_renews_during_request(self):
        from types import SimpleNamespace
        original_read = external.protected_bytes
        def renewal(path, uid, private=False):
            raw = original_read(path, uid, private)
            if str(path) == self.config['app_identity_file']:
                (self.fixture.root / 'token').write_text('new-synthetic-token')
            return raw
        with patch.object(external, 'protected_bytes', side_effect=renewal), patch.object(
                external.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='{}')) as outbound:
            external.github(self.config, 'repos/dgmolla/fitsy/check-runs', {'name': external.CHECK})
        self.assertEqual(outbound.call_args.kwargs['env']['GH_TOKEN'], self.original)

    def test_valid_token_metadata_reaches_existing_transport(self):
        from types import SimpleNamespace
        with patch.object(external.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='{}')) as outbound:
            self.assertEqual(external.github(self.config, 'repos/dgmolla/fitsy/check-runs', {'name': external.CHECK}), {})
        self.assertEqual(outbound.call_args.kwargs['env']['GH_TOKEN'], self.original)

    def test_custody_reader_uses_protected_human_token_for_identity_and_ruleset_only(self):
        from types import SimpleNamespace
        fixture = DispatchBoundaryTests(); fixture.setUp()
        try:
            config = {**fixture.config, 'gh_path': '/fixture/gh',
                      'release_token_file': str(fixture.root / 'human-token')}
            Path(config['release_token_file']).write_text('synthetic-human-token')
            Path(config['release_token_file']).chmod(0o600)
            def transport(argv, **kwargs):
                self.assertEqual(kwargs['env']['GH_TOKEN'], 'synthetic-human-token')
                self.assertNotIn('--method', argv)
                self.assertEqual(kwargs['env']['GH_CONFIG_DIR'], '/var/empty')
                value = {'id': 18452532, 'type': 'User'} if argv[-1] == 'user' else fixture.ruleset
                return SimpleNamespace(returncode=0, stdout=json.dumps(value))
            with patch.object(external.subprocess, 'run', side_effect=transport) as outbound:
                self.assertEqual(external.merge_custody(config), fixture.ruleset)
            self.assertEqual([call.args[0][-1] for call in outbound.call_args_list],
                             ['user', f'repos/{external.REPO}/rulesets/12'])
        finally:
            fixture.tearDown()


class WorkflowGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(dir=SCRIPT.parents[2] / '.evidence')
        cls.root = Path(cls.temp.name)
        workflow = cls.root / 'deploy.yml'
        workflow.write_bytes((SCRIPT.parents[2] / '.github/workflows/deploy.yml').read_bytes())
        parsed = subprocess.run(['node', '-e',
                                "process.stdout.write(JSON.stringify(require('yaml').parse(require('fs').readFileSync(process.argv[1],'utf8'))))",
                                str(workflow)], cwd=SCRIPT.parents[2], text=True, capture_output=True, check=True)
        cls.workflow = json.loads(parsed.stdout)
        maintenance = SCRIPT.parents[2] / '.github/workflows/dev-maintenance.yml'
        parsed = subprocess.run(['node', '-e',
                                "process.stdout.write(JSON.stringify(require('yaml').parse(require('fs').readFileSync(process.argv[1],'utf8'))))",
                                str(maintenance)], cwd=SCRIPT.parents[2], text=True, capture_output=True, check=True)
        cls.maintenance = json.loads(parsed.stdout)
        cls.gate = cls.workflow['jobs']['changes']['steps'][0]['run']
        # Only the remote GitHub API boundary is replaced with synthetic files.
        gh = cls.root / 'gh'
        gh.write_text('#!/usr/bin/env python3\nimport os,sys\nfrom pathlib import Path\np="latest-input" if "/workflows/" in sys.argv[-1] else "verify-input" if sys.argv[-1].endswith("/20") else "release-input"\nprint((Path(os.environ["RUNNER_TEMP"])/(p+".json")).read_text())\n')
        gh.chmod(0o700)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.actor = {'id': 888, 'login': 'fixture[bot]', 'type': 'Bot'}
        self.run = {'workflow_id': 352171272, 'event': 'workflow_dispatch', 'head_branch': 'main',
                    'head_sha': 'a' * 40, 'path': '.github/workflows/deploy.yml',
                    'actor': dict(self.actor), 'triggering_actor': dict(self.actor)}
        self.verify = {'workflow_id': 352020416, 'path': '.github/workflows/verify.yml',
                       'event': 'push', 'head_branch': 'main', 'repository': {'full_name': external.REPO},
                       'head_sha': 'a' * 40, 'status': 'completed', 'conclusion': 'success'}
        self.latest = {'workflow_runs': [{'id': 20}]}

    def drive(self, **updates):
        import os
        for name, value in [('release-input', self.run), ('verify-input', self.verify), ('latest-input', self.latest)]:
            (self.root / (name + '.json')).write_text(json.dumps(value))
        env = {'PATH': str(self.root) + ':' + os.environ['PATH'], 'RUNNER_TEMP': str(self.root),
               'GITHUB_RUN_ID': '30', 'GITHUB_REPOSITORY': external.REPO, 'RELEASE_SHA': 'a' * 40,
               'ACCEPTANCE_SHA': 'b' * 64, 'VERIFY_RUN': '20',
               'DISPATCH_ACTOR_ID': '888', 'DISPATCH_ACTOR_LOGIN': 'fixture[bot]', **updates}
        return subprocess.run(['/bin/bash', '-e', '-c', self.gate], env=env, text=True, capture_output=True)

    def test_valid_fixture_passes_actual_workflow_gate(self):
        result = self.drive(); self.assertEqual(result.returncode, 0, result.stderr)

    def test_human_run_and_human_rerun_fail_actual_gate(self):
        for field in ('actor', 'triggering_actor'):
            original = self.run[field]; self.run[field] = {'id': 18452532, 'login': 'dgmolla', 'type': 'User'}
            self.assertNotEqual(self.drive().returncode, 0)
            self.run[field] = original

    def test_wrong_source_failed_verify_and_superseded_verify_fail_actual_gate(self):
        self.run['head_sha'] = 'c' * 40; self.assertNotEqual(self.drive().returncode, 0)
        self.run['head_sha'] = 'a' * 40; self.verify['conclusion'] = 'failure'; self.assertNotEqual(self.drive().returncode, 0)
        self.verify['conclusion'] = 'success'; self.latest['workflow_runs'] = []; self.assertNotEqual(self.drive().returncode, 0)

    def test_uninstalled_actor_and_injected_inputs_fail_before_api(self):
        self.assertNotEqual(self.drive(DISPATCH_ACTOR_ID='INSTALLATION_PROBE_REQUIRED').returncode, 0)
        self.assertNotEqual(self.drive(VERIFY_RUN='20; echo forged').returncode, 0)

    def test_production_jobs_depend_on_gate_and_retain_protection(self):
        # Walk the job DAG, because a gate without consumers proves no release boundary.
        jobs = self.workflow['jobs']
        for name in ('migrate', 'smoke', 'ota'):
            job = jobs[name]
            self.assertEqual(job['environment'], 'production-release')
            needs = job['needs'] if isinstance(job['needs'], list) else [job['needs']]
            self.assertIn('changes', needs)
            self.assertTrue(any(step.get('with', {}).get('ref') == '${{ inputs.release_sha }}' for step in job['steps']))

    def test_monthly_production_credential_requires_protected_main_while_nightly_stays_dev_only(self):
        jobs = self.maintenance['jobs']
        monthly = jobs['monthly-snapshot']
        self.assertEqual(monthly['environment'], 'production-release')
        self.assertEqual(monthly['if'], "github.ref == 'refs/heads/main' && (github.event.schedule == '0 10 1 * *' || github.event_name == 'workflow_dispatch')")
        production_consumers = [name for name, job in jobs.items() if 'secrets.PROD_DATABASE_URL' in json.dumps(job)]
        self.assertEqual(production_consumers, ['monthly-snapshot'])
        self.assertNotIn('environment', jobs['nightly'])


class ProductionTlsMaterialTests(unittest.TestCase):
    def test_prisma_relative_ca_is_the_pinned_public_supabase_root(self):
        # The protected URI is supplied only in operator custody. This catches a
        # missing, moved, or replaced CA before either production consumer runs.
        relative = '../docs/engineering/devops/shipping-control-setup/supabase-root-2021-ca.crt'
        certificate = (REPO_ROOT / 'prisma' / relative).resolve(strict=True)
        self.assertEqual(certificate, REPO_ROOT / 'docs/engineering/devops/shipping-control-setup/supabase-root-2021-ca.crt')
        pem = certificate.read_bytes()
        self.assertEqual(hashlib.sha256(pem).hexdigest(),
                         '700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7')
        der = ssl.PEM_cert_to_DER_cert(pem.decode('ascii'))
        self.assertEqual(hashlib.sha256(der).hexdigest(),
                         '807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa')


def custody_fixture_directory():
    # Protected fixture bytes need secure ancestry even when the command's
    # short TMPDIR is beneath a sticky system directory for Unix sockets.
    if sys.platform == 'darwin':
        raw = subprocess.check_output(['/usr/bin/getconf', 'DARWIN_USER_TEMP_DIR'], text=True).strip()
        parent = Path(raw).resolve(strict=True)
    else:
        parent = Path.home().resolve(strict=True)
    for probe in (parent, *parent.parents):
        metadata = probe.lstat()
        if (probe.is_symlink() or metadata.st_uid not in (0, os.getuid())
                or metadata.st_mode & 0o022
                or (sys.platform == 'darwin' and (probe / '.codex/config.toml').exists())):
            raise RuntimeError('secure operator fixture temp ancestry unavailable')
    temporary = tempfile.TemporaryDirectory(prefix='custody-', dir=parent)
    metadata = Path(temporary.name).lstat()
    if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) != 0o700:
        temporary.cleanup()
        raise RuntimeError('private operator fixture temp directory unavailable')
    return temporary


class ProfileCustodyTests(unittest.TestCase):
    """Real private fixture bytes, synthetic OS observations; never installation evidence."""
    def setUp(self):
        import os
        self.os = os
        self.temporary = custody_fixture_directory()
        self.addCleanup(self.temporary.cleanup)
        self.paths = {}
        for key in ('launcher', 'profile', 'receipt', 'state'):
            with tempfile.NamedTemporaryFile(prefix='custody-'+key+'-', dir=self.temporary.name,
                                             delete=False) as file:
                self.paths[key] = Path(file.name)
            self.addCleanup(self.paths[key].unlink, missing_ok=True)
        self.launcher = b'reviewed fixture launcher'
        self.profile = b'reviewed fixture profile'
        self.boundary = dict(kind='codex-permission-profile', claim_id='fixture-claim', issue=463,
                             source_sha='a'*40, comparison_base='b'*40)
        for key, raw in (('launcher', self.launcher), ('profile', self.profile)):
            path = self.paths[key]; path.write_bytes(raw); path.chmod(0o600)
            self.boundary.update({key+'_path': str(path), key+'_sha256': external.digest(raw)})
        self.receipt = {**self.boundary, 'version': 1, 'independently_approved': True,
                        'worker_pid': 999999, 'worker_started': 'fixture-start',
                        'live_denials': dict.fromkeys(('operator_files', 'approval_credentials', 'claim_write',
                            'other_branch_write', 'workspace_secrets', 'command_network', 'operator_execution'), True)}
        self.claim = dict(id='fixture-claim', issue=463, pid=999999, pid_started='fixture-start',
                          worker_pgid=999998, stage='running', worker_boundary=dict(
                              kind='codex-permission-profile', config_sha256=external.digest(self.profile),
                              operator_home_read=False, network=False))
        self.boundary['receipt_path'] = str(self.paths['receipt'])
        self.boundary['claim_state_path'] = str(self.paths['state'])
        self.config = dict(operator_uid=os.getuid(), candidate_uid=os.getuid(), candidate_boundary=self.boundary)
        self.save()

    def save(self):
        raw = json.dumps(self.receipt).encode()
        self.paths['receipt'].write_bytes(raw); self.paths['receipt'].chmod(0o600)
        self.boundary['receipt_sha256'] = external.digest(raw)
        self.paths['state'].write_text(json.dumps({'active': self.claim})); self.paths['state'].chmod(0o600)

    def check(self):
        from types import SimpleNamespace
        # Only OS process inventory is synthetic; protected_bytes and all validation are real.
        with patch.object(external.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout='fixture-start\n')):
            with patch.object(external.os, 'getpgid', return_value=999998):
                external.candidate_custody(self.config, self.os.getuid())

    def test_pinned_profile_is_a_distinct_prepared_contract(self):
        self.check()

    def test_private_fixture_ignores_sticky_command_tmpdir(self):
        with tempfile.TemporaryDirectory() as command_tmp:
            sticky = Path(command_tmp); sticky.chmod(0o1777)
            with patch.dict(os.environ, {'TMPDIR': str(sticky)}):
                with custody_fixture_directory() as directory:
                    leaf = Path(directory) / 'receipt'
                    leaf.write_bytes(b'fixture'); leaf.chmod(0o600)
                    self.assertFalse(leaf.is_relative_to(sticky))
                    self.assertEqual(external.protected_bytes(leaf, os.getuid(), private=True), b'fixture')

    def test_same_uid_without_boundary_remains_refused(self):
        with self.assertRaisesRegex(ValueError, 'candidate'):
            external.candidate_custody({'operator_uid': self.os.getuid(), 'candidate_uid': self.os.getuid()}, self.os.getuid())

    def test_changed_profile_launcher_or_receipt_is_refused(self):
        for name in ('profile', 'launcher', 'receipt'):
            path = self.paths[name]; original = path.read_bytes(); path.write_bytes(original+b'changed')
            with self.assertRaises(ValueError): self.check()
            path.write_bytes(original)

    def test_partial_denial_wrong_source_and_unapproved_receipt_are_refused(self):
        import copy
        original = copy.deepcopy(self.receipt)
        for change in ({'source_sha': 'c'*40}, {'comparison_base': 'c'*40}, {'claim_id': 'other'},
                       {'independently_approved': False}, {'live_denials': {'operator_files': True}}):
            self.receipt = {**original, **change}; self.save()
            with self.assertRaises(ValueError): self.check()

    def test_inactive_reused_or_candidate_operator_process_is_refused(self):
        original = dict(self.claim)
        for change in ({'stage': 'finished'}, {'finished_at': 'ended'}, {'pid_started': 'reused'},
                       {'worker_pgid': self.os.getpgrp()}):
            self.claim = {**original, **change}; self.save()
            with self.assertRaises(ValueError): self.check()

    def test_other_candidate_cannot_reuse_profile_authority(self):
        for issue, source in ((443, 'a'*40), (463, 'c'*40)):
            with self.assertRaisesRegex(ValueError, 'issue/source'):
                external.review_inputs(self.config, issue, source, 'fixture')


class CIAcceptanceTests(unittest.TestCase):
    """Actual existing publication consumer with fake GitHub only, never real CI."""
    def setUp(self):
        self.f = DispatchBoundaryTests()
        self.f.setUp()
        self.addCleanup(self.f.tearDown)
        self.f.config['local_acceptance']['443']['required_checks'] = {}

    def publish(self):
        with patch.object(external, 'github', side_effect=self.f.transport):
            return external.publish_acceptance(self.f.config, 443, 9, 21)

    def test_ci_first_valid_without_local_full_receipt(self):
        policy = self.f.config['local_acceptance']['443']
        Path(policy.pop('receipt_path')).unlink()
        policy.pop('receipt_sha256')
        self.assertEqual(self.publish()['source_sha'], self.f.source)
        self.assertEqual(len(self.f.writes), 1)
        self.assertEqual(self.f.writes[0]['name'], external.ACCEPTANCE_CHECK)

    def test_wrong_run_identity_event_base_head_and_attempt_refuse(self):
        import copy
        original = copy.deepcopy(self.f.candidate_verify)
        for key, value in [('id', 22), ('workflow_id', 99), ('path', '.github/workflows/other.yml'),
                           ('event', 'push'), ('head_sha', 'f' * 40), ('conclusion', 'failure'),
                           ('status', 'in_progress'), ('run_attempt', True), ('pull_requests', [])]:
            with self.subTest(key=key):
                self.f.candidate_verify = {**copy.deepcopy(original), key: value}
                with self.assertRaises(ValueError): self.publish()
                self.assertFalse(self.f.writes)
        for side in ('base', 'head'):
            self.f.candidate_verify = copy.deepcopy(original)
            self.f.candidate_verify['pull_requests'][0][side]['sha'] = 'f' * 40
            with self.assertRaisesRegex(ValueError, 'event PR/base/head'): self.publish()
        self.assertFalse(self.f.writes)

    def test_missing_failed_skipped_wrong_attempt_and_nonstandard_jobs_refuse(self):
        import copy
        original = copy.deepcopy(self.f.candidate_jobs)
        self.f.candidate_jobs = original[:-1]
        with self.assertRaisesRegex(ValueError, 'job missing'): self.publish()
        for key, value in [('conclusion', 'skipped'), ('status', 'queued'), ('run_attempt', 2),
                           ('head_sha', 'f' * 40), ('run_id', 99), ('labels', ['ubuntu-latest-8-cores']),
                           ('check_run_url', 'https://candidate.invalid/check')]:
            with self.subTest(key=key):
                self.f.candidate_jobs = copy.deepcopy(original)
                self.f.candidate_jobs[0][key] = value
                with self.assertRaisesRegex(ValueError, 'job failed'): self.publish()
        self.assertFalse(self.f.writes)

    def test_forged_issuer_suite_or_source_cannot_replace_real_execution(self):
        import copy
        original = copy.deepcopy(self.f.candidate_checks)
        for key, value in [('app', {'id': 999, 'slug': 'github-actions'}),
                           ('check_suite', {'id': 999}), ('head_sha', 'f' * 40),
                           ('conclusion', 'failure')]:
            self.f.candidate_checks = copy.deepcopy(original)
            self.f.candidate_checks[1000][key] = value
            with self.assertRaisesRegex(ValueError, 'issuer/execution'): self.publish()
        self.assertFalse(self.f.writes)

    def test_changed_workflow_or_coverage_suppressing_source_tree_refuses(self):
        import base64
        endpoint = f'repos/{external.REPO}'
        self.f.api_override[f'{endpoint}/contents/.github/workflows/verify.yml?ref={self.f.source}'] = {
            'type': 'file', 'path': '.github/workflows/verify.yml', 'encoding': 'base64',
            'content': base64.b64encode(b'jobs: {tests: {steps: [{run: true}]}}').decode()}
        with self.assertRaisesRegex(ValueError, 'candidate-controlled'): self.publish()
        self.f.api_override.clear()
        self.f.api_override[f'{endpoint}/git/commits/{self.f.source}'] = {
            'tree': {'sha': 'candidate-registry-or-test-script-skipping-coverage'}}
        with self.assertRaisesRegex(ValueError, 'verification/source tree'): self.publish()
        self.assertFalse(self.f.writes)

    def test_stale_run_merge_tree_or_comparison_refuses(self):
        endpoint = f'repos/{external.REPO}'
        self.f.api_override[f'{endpoint}/actions/workflows/10/runs?head_sha={self.f.source}&event=pull_request&per_page=1'] = {'workflow_runs': [{'id': 22}]}
        with self.assertRaisesRegex(ValueError, 'superseded'): self.publish()
        self.f.api_override.clear()
        self.f.api_override[f'{endpoint}/git/commits/{self.f.pr["merge_commit_sha"]}'] = {
            'tree': {'sha': 'different-merge-tree'}, 'parents': [{'sha': 'b' * 40}, {'sha': self.f.source}]}
        with self.assertRaisesRegex(ValueError, 'merge tree/base/head'): self.publish()
        self.f.api_override.clear()
        self.f.pr['base']['sha'] = 'f' * 40
        with self.assertRaisesRegex(ValueError, 'comparison base'): self.publish()
        self.assertFalse(self.f.writes)

    def test_applicable_real_media_still_requires_exact_local_evidence(self):
        f = self.f; endpoint = f'repos/{external.REPO}'
        f.api_override[f'{endpoint}/git/commits/' + 'b' * 40] = {'tree': {'sha': 'base-tree'}}
        for tree, sha in [('base-tree', 'old'), ('equal-reviewed-product-tree', 'new')]:
            f.api_override[f'{endpoint}/git/trees/{tree}?recursive=1'] = {
                'truncated': False, 'tree': [{'path': 'scripts/verify/test.sh', 'mode': '100755', 'type': 'blob', 'sha': sha}]}
        with self.assertRaisesRegex(ValueError, 'real-media'): self.publish()
        policy = f.config['local_acceptance']['443']
        receipt = {'head_sha': f.source, 'source_identity': 'identity', 'stage': 'full',
                   'finished_at': 'fixture-only', 'arguments': ['--only=media-integration'],
                   'results': [{'name': 'media-integration', 'status': 'pass', 'blocking': True}]}
        file = f.root / 'media-only.json'; file.write_text(json.dumps(receipt))
        policy.update(required_checks={'media-integration': 'pass'}, arguments=['--only=media-integration'],
                      receipt_path=str(file), receipt_sha256=external.digest(file.read_bytes()))
        self.assertEqual(self.publish()['source_sha'], f.source)
        f.writes.clear(); receipt['head_sha'] = 'f' * 40; file.write_text(json.dumps(receipt))
        policy['receipt_sha256'] = external.digest(file.read_bytes())
        with self.assertRaisesRegex(ValueError, 'source/recipe'): self.publish()
        self.assertFalse(f.writes)


if __name__ == '__main__':
    unittest.main()
