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
                                                  'receipt_sha256': external.digest(receipt.read_bytes())}}
        self.product_status = {'sha': self.source, 'total_count': 1,
                               'statuses': [{'context': 'product-flow/local', 'state': 'success'}]}
        self.latest_verify = 20
        self.can_approve = True
        self.default_branch = 'main'
        self.scope_name = external.REPO
        self.api_override = {}


    def transport(self, config, endpoint, payload=None, release=False):
        import base64
        if endpoint in self.api_override:
            return self.api_override[endpoint]
        if endpoint == 'installation/repositories?per_page=100':
            return {'total_count': 1, 'repositories': [{'id': 42, 'full_name': self.scope_name}]}
        if endpoint == 'apps/fixture': return self.identity['app']
        if endpoint == 'users/fixture[bot]': return self.actor
        if endpoint == 'user': return {'id': 18452532}
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
        if endpoint.endswith('/actions/runs/30'): return self.run
        if '/actions/workflows/10/runs?' in endpoint: return {'workflow_runs': [{'id': self.latest_verify}]}
        if endpoint.endswith('/branches/main/protection'): return self.protection
        if endpoint.endswith('/rulesets/12'): return self.ruleset
        if '/check-runs?filter=latest' in endpoint: return {'total_count': len(self.checks), 'check_runs': self.checks}
        if endpoint.endswith('/environments/production-release'): return self.environment
        if endpoint.endswith('/deployment-branch-policies'):
            return {'total_count': 1, 'branch_policies': [{'name': 'main', 'type': 'branch'}]}
        if endpoint.endswith('/pulls?per_page=100'):
            return [{**self.pr, 'merged_at': 'fixture', 'merge_commit_sha': self.main}]
        if '/git/commits/' in endpoint: return {'tree': {'sha': 'equal-reviewed-product-tree'}}
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

    def test_valid_single_human_path_binds_dispatch_and_reports_pending_without_approval(self):
        self.dispatch()
        self.assertEqual(self.writes, [{'ref': 'main', 'inputs': {'release_sha': self.main,
                          'verify_run': '20', 'acceptance_sha256': external.acceptance(self.body)}}])
        self.assertEqual(self.ready()['environment_ids'], [5])
        self.assertEqual(len(self.writes), 1)

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
        self.api_override[f'repos/{external.REPO}/actions/runs/20'] = {
            **self.verify, 'event': 'pull_request', 'head_sha': self.source}
        with patch.object(external, 'github', side_effect=self.transport):
            result = external.publish_acceptance(self.config, 443, 9, 20)
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


class WorkflowGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(dir=SCRIPT.parents[2] / '.evidence')
        cls.root = Path(cls.temp.name)
        workflow = cls.root / 'deploy.yml'
        workflow.write_bytes((SCRIPT.parents[2] / '.github/workflows/deploy.yml').read_bytes())
        patch_path = SCRIPT.parents[2] / 'docs/engineering/devops/shipping-control-setup/deploy.patch'
        subprocess.run(['patch', str(workflow), str(patch_path)], check=True, capture_output=True)
        parsed = subprocess.run(['node', '-e',
                                "process.stdout.write(JSON.stringify(require('yaml').parse(require('fs').readFileSync(process.argv[1],'utf8'))))",
                                str(workflow)], cwd=SCRIPT.parents[2], text=True, capture_output=True, check=True)
        cls.workflow = json.loads(parsed.stdout)
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


if __name__ == '__main__':
    unittest.main()
