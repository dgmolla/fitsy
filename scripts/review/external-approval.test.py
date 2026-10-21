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

REAL_RUN = subprocess.run
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
        system_file = Path('/private/etc/passwd' if sys.platform == 'darwin' else '/etc/passwd')
        if not system_file.is_file():
            self.skipTest('Unix system identity file unavailable')
        self.assertTrue(external.protected_bytes(system_file, os.getuid()))


    def test_missing_fixed_configuration_has_no_environment_or_legacy_fallback(self):
        expected = Path('/opt/fitsy-approval/delivery-authority.json' if sys.platform == 'darwin'
                        else '/etc/fitsy/delivery-authority.json')
        self.assertEqual(external.CONFIG, expected)
        with patch.dict(os.environ, {'HOME': '/candidate-selected-home'}), \
                patch.object(external, 'protected_bytes', side_effect=FileNotFoundError(expected)) as reader:
            with self.assertRaises(FileNotFoundError):
                external.authority()
        reader.assert_called_once_with(expected, os.getuid())


class CanonicalReviewTests(unittest.TestCase):
    """Real parser/gate and protected file reads; no publishing authority is granted."""
    def setUp(self):
        ReviewTests.setUp(self)
        self.scratch = tempfile.TemporaryDirectory(prefix='approval-canonical-', dir=REPO_ROOT / '.evidence')
        self.addCleanup(self.scratch.cleanup)
        self.operator = Path(self.scratch.name) / 'operator'
        self.operator.mkdir()
        self.install = patch.object(external, 'INSTALL', self.operator / 'external-approval.py')
        self.install.start()
        self.addCleanup(self.install.stop)
        validators = {}
        for name in ('review-round', 'review-gate'):
            raw = SCRIPT.with_name(name + '.py').read_bytes()
            (self.operator / (name + '.py')).write_bytes(raw)
            validators[name] = external.digest(raw)
        self.root = self.operator / 'evidence' / 'issue-443' / self.source
        self.receipt = self.root / '.evidence' / 'tests' / 'cheap.json'
        self.receipt.parent.mkdir(parents=True)
        self.receipt.write_text(json.dumps({'id': 'cheap', 'source_sha': self.source,
            'result': 'pass', 'exit_code': 0, 'command': 'npm run verify -- --stage=cheap',
            'finished_at': '2026-10-21T06:10:18+00:00'}))
        self.policy['canonical_review'] = {'validators': validators, 'diff_sha256': 'd' * 64,
            'evidence_root': str(self.root), 'dispositions': {}}
        self.verdict = {key: self.approval[key] for key in (
            'issue', 'source_sha', 'base_sha', 'acceptance_sha256', 'provider', 'model', 'reasoning_effort')}
        self.verdict.update(verdict='pass', domains={domain: 'pass' for domain in self.policy['domains']}, findings=[])
        self.store_verdict()

    def validate(self):
        external.validate_review(self.approval, self.artifacts, self.ledger, self.policy,
                                 443, self.source, self.body, os.getuid())

    def store_verdict(self):
        self.artifacts['verdict'] = ('Review response\n```json\n' + json.dumps(self.verdict) + '\n```\n').encode()
        self.approval['artifacts']['verdict']['sha256'] = external.digest(self.artifacts['verdict'])
        ReviewTests.replace_artifact(self, 'execution', {**self.execution,
            'stdout_bytes': len(self.artifacts['verdict']), 'stderr_bytes': len(self.artifacts['stderr'])})

    def add_p2(self):
        self.verdict.update(verdict='fail', findings=[{
            'severity': 'CONFIRMED', 'priority': 'P2', 'domains': ['correctness'],
            'file': 'scripts/review/review-budget.py', 'line': 860,
            'summary': 'Optional receipt compatibility', 'scenario': 'Historical native receipt only',
            'fix': 'Preserve supported receipt binding', 'impact': 'Owned optional recovery'}])
        self.verdict['domains']['correctness'] = 'fail'
        self.store_verdict()
        finding = {key: value for key, value in self.verdict['findings'][0].items() if key != 'domains'}
        canonical_hash = lambda value: external.digest(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())
        self.sidecar = {'version': 1, 'lens': 'correctness', 'source_sha': self.source,
            'diff_sha256': 'd' * 64,
            'review_sha256': canonical_hash({'lens': 'correctness', 'verdict': 'fail', 'findings': [finding]}),
            'findings': [{'index': 0, 'finding_sha256': canonical_hash(finding), 'priority': 'P2',
                'disposition': 'defer', 'owner': 'Original outcome owner, existing issue330',
                'acceptance': 'Resume when an actual native-only receipt requires correction',
                'impact': {key: 'Bounded optional historical compatibility' for key in
                           ('user_outcome', 'trigger', 'scope', 'evidence', 'contract')},
                'required_tests': [{'id': 'cheap', 'receipt': '.evidence/tests/cheap.json',
                                   'sha256': external.digest(self.receipt.read_bytes())}]}]}
        self.sidecar_path = self.root / '.evidence' / 'correctness.json'
        self.store_sidecar()

    def store_sidecar(self):
        self.sidecar_path.write_text(json.dumps(self.sidecar))
        self.policy['canonical_review']['dispositions']['correctness'] = {
            'path': str(self.sidecar_path), 'sha256': external.digest(self.sidecar_path.read_bytes())}

    def test_complete_string_domains_pass_without_changing_raw_bytes(self):
        before = dict(self.artifacts)
        self.validate()
        self.assertEqual(self.artifacts, before)

    def test_owned_p2_uses_real_gate_and_preserves_raw_fail(self):
        self.add_p2()
        before = dict(self.artifacts)
        self.validate()
        self.assertEqual(self.artifacts, before)
        self.assertIn(b'"verdict": "fail"', self.artifacts['verdict'])

    def test_missing_forged_stale_unowned_dispositions_refuse(self):
        self.add_p2()
        row = self.policy['canonical_review']['dispositions'].pop('correctness')
        with self.assertRaisesRegex(ValueError, 'missing dispositions'):
            self.validate()
        self.policy['canonical_review']['dispositions']['correctness'] = row
        self.sidecar_path.write_text('{}')
        with self.assertRaisesRegex(ValueError, 'disposition changed'):
            self.validate()
        for field, value, reason in (('source_sha', 'c' * 40, 'stale disposition'),
                                     ('owner', '', 'unowned'), ('finding_sha256', '0' * 64, 'stale finding')):
            with self.subTest(field=field):
                self.add_p2()
                target = self.sidecar if field == 'source_sha' else self.sidecar['findings'][0]
                target[field] = value
                self.store_sidecar()
                with self.assertRaisesRegex(ValueError, reason):
                    self.validate()

    def test_changed_or_stale_required_test_refuses(self):
        self.add_p2()
        original = self.receipt.read_bytes()
        self.receipt.write_bytes(original + b'\n')
        with self.assertRaisesRegex(ValueError, 'test receipt changed'):
            self.validate()
        receipt = json.loads(original)
        receipt['source_sha'] = 'c' * 40
        self.receipt.write_text(json.dumps(receipt))
        self.sidecar['findings'][0]['required_tests'][0]['sha256'] = external.digest(self.receipt.read_bytes())
        self.store_sidecar()
        with self.assertRaisesRegex(ValueError, 'failed or stale required test'):
            self.validate()

    def test_p0_p1_cannot_be_dispositioned(self):
        for priority in ('P0', 'P1'):
            with self.subTest(priority=priority):
                self.add_p2()
                self.verdict['findings'][0]['priority'] = priority
                self.store_verdict()
                with self.assertRaisesRegex(ValueError, 'P0/P1 finding blocks'):
                    self.validate()

    def test_incomplete_missing_wrong_domains_or_inconsistent_verdict_refuse(self):
        for update in ({'verdict': 'incomplete'}, {'domains': {'correctness': 'pass'}},
                       {'domains': {'correctness': 'pass', 'other': 'pass'}}, {'verdict': 'fail'}):
            with self.subTest(update=update):
                original = dict(self.verdict)
                self.verdict.update(update)
                self.store_verdict()
                with self.assertRaisesRegex(ValueError, 'incomplete or invalid'):
                    self.validate()
                self.verdict = original

    def test_wrong_source_issue_base_acceptance_or_provider_refuse(self):
        for field, value in (('source_sha', 'c' * 40), ('base_sha', 'c' * 40), ('issue', 346),
                             ('acceptance_sha256', 'c' * 64), ('provider', 'claude'),
                             ('model', 'other'), ('reasoning_effort', 'low')):
            with self.subTest(field=field):
                original = self.verdict[field]
                self.verdict[field] = value
                self.store_verdict()
                with self.assertRaisesRegex(ValueError, 'binding mismatch'):
                    self.validate()
                self.verdict[field] = original

    def test_original_stream_hashes_and_byte_counts_remain_required(self):
        self.artifacts['verdict'] = self.artifacts['verdict'].rstrip(b'\n')
        with self.assertRaisesRegex(ValueError, 'artifact changed'):
            self.validate()
        self.approval['artifacts']['verdict']['sha256'] = external.digest(self.artifacts['verdict'])
        with self.assertRaisesRegex(ValueError, 'incomplete provider'):
            self.validate()

    def test_provider_failure_or_incomplete_execution_refuses(self):
        for update in ({'kind': 'timeout'}, {'returncode': 1}):
            with self.subTest(update=update):
                execution = json.loads(self.artifacts['execution'])
                ReviewTests.replace_artifact(self, 'execution', {**execution, **update})
                with self.assertRaisesRegex(ValueError, 'incomplete provider'):
                    self.validate()

    def test_candidate_root_symlink_or_writable_test_refuses(self):
        self.add_p2()
        canonical = self.policy['canonical_review']
        canonical['evidence_root'] = str(REPO_ROOT)
        with self.assertRaisesRegex(ValueError, 'operator-held'):
            self.validate()
        canonical['evidence_root'] = str(self.root)
        self.receipt.chmod(0o666)
        with self.assertRaisesRegex(ValueError, 'custody'):
            self.validate()
        self.receipt.chmod(0o600)
        target = self.receipt.with_suffix('.original')
        self.receipt.rename(target)
        self.receipt.symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'custody'):
            self.validate()

    def test_changed_or_candidate_selected_companion_refuses_before_execution(self):
        helper = self.operator / 'review-gate.py'
        helper.write_text('raise AssertionError("candidate code executed")')
        with self.assertRaisesRegex(ValueError, 'validator changed'):
            self.validate()
        helper.unlink()
        helper.symlink_to(SCRIPT.with_name('review-gate.py'))
        with self.assertRaisesRegex(ValueError, 'custody'):
            self.validate()

    def test_lexically_relative_disposition_cannot_escape_protected_root(self):
        self.add_p2()
        escaped = self.root.parent / 'escaped.json'
        escaped.write_bytes(self.sidecar_path.read_bytes())
        row = self.policy['canonical_review']['dispositions']['correctness']
        row['path'] = str(self.root / '.evidence' / '..' / '..' / 'escaped.json')
        with self.assertRaisesRegex(ValueError, 'outside protected evidence'):
            self.validate()

    def test_disposition_symlink_or_writable_ancestor_refuses(self):
        self.add_p2()
        original = self.sidecar_path.with_suffix('.original')
        self.sidecar_path.rename(original)
        self.sidecar_path.symlink_to(original)
        with self.assertRaisesRegex(ValueError, 'custody'):
            self.validate()
        self.sidecar_path.unlink()
        original.rename(self.sidecar_path)
        self.sidecar_path.parent.chmod(0o777)
        with self.assertRaisesRegex(ValueError, 'custody'):
            self.validate()
        self.sidecar_path.parent.chmod(0o700)

    def install_review_inputs(self):
        review_home = self.operator / 'review-home'
        budget_home = self.operator / 'budget-home'
        (review_home / 'completed').mkdir(parents=True)
        budget_home.mkdir()
        for name, raw in self.artifacts.items():
            path = self.operator / name
            path.write_bytes(raw)
            self.approval['artifacts'][name]['path'] = str(path)
        manifest = review_home / 'completed' / 'issue-443.json'
        manifest.write_text(json.dumps(self.approval))
        self.policy['manifest_sha256'] = external.digest(manifest.read_bytes())
        ledger = budget_home / 'issue-443.jsonl'
        ledger.write_bytes(self.ledger)
        config = {'operator_uid': os.getuid(), 'reviews': {'443': self.policy},
                  'review_home': str(review_home), 'budget_home': str(budget_home)}
        return config, manifest, ledger

    def test_actual_review_inputs_checks_manifest_and_original_ledger(self):
        self.add_p2()
        config, manifest, ledger = self.install_review_inputs()
        self.assertEqual(external.review_inputs(config, 443, self.source, self.body), self.approval)
        ledger.write_bytes(self.ledger + b'changed history')
        with self.assertRaisesRegex(ValueError, 'history changed'):
            external.review_inputs(config, 443, self.source, self.body)
        ledger.write_bytes(self.ledger)
        manifest.write_bytes(manifest.read_bytes() + b'\n')
        with self.assertRaisesRegex(ValueError, 'manifest'):
            external.review_inputs(config, 443, self.source, self.body)

    def test_read_only_local_operation_reuses_p2_authority_without_pr_or_write(self):
        self.add_p2()
        config, _, _ = self.install_review_inputs()
        observed = []
        def transport(config, endpoint, payload=None, release=False):
            self.assertIsNone(payload)
            self.assertEqual(endpoint, 'repos/dgmolla/fitsy/issues/443')
            observed.append(endpoint)
            return {'body': self.body}
        with patch.object(external, 'github', side_effect=transport):
            result = external.validate_local_review(config, 443, self.source, self.base, ['correctness'])
            self.assertEqual(result['canonical_review'], 'pass')
            self.assertEqual(result['domains'], self.policy['domains'])
            for source, base, domains in (('c' * 40, self.base, ['correctness']),
                    (self.source, 'c' * 40, ['correctness']), (self.source, self.base, ['other']),
                    (self.source, self.base, []), (self.source, self.base, ['correctness', 'correctness'])):
                with self.subTest(source=source, base=base, domains=domains), self.assertRaises(ValueError):
                    external.validate_local_review(config, 443, source, base, domains)
            self.assertIsNone(external.validate_local_review(config, 346, self.source, self.base, ['correctness']))
        self.assertTrue(observed)
        self.assertIn(b'"verdict": "fail"', self.artifacts['verdict'])


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

    def test_approved_disjoint_main_changes_preserve_frozen_product_and_deletions(self):
        base = {self.path: self.reviewed[self.path], self.product: ('100644', 'blob', 'before'),
                'removed-product': ('100644', 'blob', 'removed')}
        main = {**base, 'approved-main': ('100644', 'blob', 'independent')}
        candidate = {**self.candidate, 'approved-main': main['approved-main']}
        external.validate_composition(self.reviewed, candidate, self.controls, [self.path],
                                      reviewed_base=base, main=main)
        candidate['removed-product'] = base['removed-product']
        with self.assertRaisesRegex(ValueError, 'frozen product'):
            external.validate_composition(self.reviewed, candidate, self.controls, [self.path],
                                          reviewed_base=base, main=main)

    def test_overlapping_or_partial_main_context_refuses(self):
        with self.assertRaisesRegex(ValueError, 'complete approved main'):
            external.validate_composition(self.reviewed, self.candidate, self.controls, [self.path],
                                          main=self.reviewed)
        base = {self.product: ('100644', 'blob', 'before')}
        main = {self.product: ('100644', 'blob', 'competing')}
        with self.assertRaisesRegex(ValueError, 'overlap'):
            external.validate_composition(self.reviewed, self.candidate, self.controls, [self.path],
                                          reviewed_base=base, main=main)

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
                         'repository_id': 1188934600}
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
            return {'total_count': 1, 'repositories': [{'id': 1188934600, 'full_name': external.REPO}]}
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


    def transport(self, config, endpoint, payload=None, release=False):
        import base64
        if endpoint in self.api_override:
            return self.api_override[endpoint]
        if endpoint == 'installation/repositories?per_page=100':
            return {'total_count': 1, 'repositories': [{'id': 1188934600, 'full_name': self.scope_name}]}
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
    # This ignored data directory is never a reviewer or subprocess cwd.
    parent = REPO_ROOT / '.evidence'
    parent.mkdir(mode=0o700, exist_ok=True)
    for probe in (parent, *parent.parents):
        metadata = probe.lstat()
        if (probe.is_symlink() or metadata.st_uid not in (0, os.getuid())
                or metadata.st_mode & 0o022):
            raise RuntimeError('secure operator fixture temp ancestry unavailable')
    git = '/Applications/Xcode.app/Contents/Developer/usr/bin/git' if sys.platform == 'darwin' else '/usr/bin/git'
    ignored = REAL_RUN([git, '-C', str(REPO_ROOT), 'check-ignore', '--quiet',
                        str(parent / 'custody-probe.json')], capture_output=True,
                       env={'PATH': '/usr/bin:/bin', 'HOME': '/var/empty'}, timeout=10)
    if ignored.returncode != 0:
        raise RuntimeError('operator fixture storage must be ignored')
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

    def test_only_verified_merged_main_can_use_empty_rest_pr_association(self):
        f = self.f
        f.candidate_verify['pull_requests'] = []
        closed = {**f.pr, 'state': 'closed', 'merged_at': 'fixture', 'merge_commit_sha': f.main}
        review = {'base_sha': 'b' * 40}
        with patch.object(external, 'github', side_effect=f.transport):
            result = external.ci_acceptance(f.config, 443, closed, review, 21, merged_main=f.main)
            self.assertEqual(result, f.config['local_acceptance']['443'])
            with self.assertRaisesRegex(ValueError, 'event PR/base/head'):
                external.ci_acceptance(f.config, 443, closed, review, 21)
            for update in ({'state': 'open'}, {'merged_at': None}, {'merge_commit_sha': 'f' * 40}):
                with self.subTest(update=update), self.assertRaisesRegex(ValueError, 'merged-main PR provenance'):
                    external.ci_acceptance(f.config, 443, {**closed, **update}, review, 21, merged_main=f.main)
            for association in (None, {}, [{'number': 99}], [{'number': 9, 'base': None}]):
                f.candidate_verify['pull_requests'] = association
                with self.subTest(association=association), self.assertRaises(ValueError):
                    external.ci_acceptance(f.config, 443, closed, review, 21, merged_main=f.main)

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


class AppRenewalTests(unittest.TestCase):
    """Actual CLI admission/publication with private synthetic operator custody."""
    def setUp(self):
        from types import SimpleNamespace
        self.fixture = PublishBoundaryTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.root, self.config = self.fixture.root, self.fixture.config
        self.fixture.identity['app']['slug'] = 'fitsy-delivery-approval'
        self.fixture.identity['repository_id'] = 1188934600
        self.fixture.actor['login'] = 'fitsy-delivery-approval[bot]'
        self.config['dispatch_actor_login'] = self.fixture.actor['login']
        self.fixture.identity['token']['expires_at'] = '2026-01-01T00:00:00Z'
        self.fixture.save_identity()
        self.install = self.root / 'external-approval.py'
        self.install.write_bytes(SCRIPT.read_bytes())
        self.gh = self.root / 'gh'
        self.gh.write_bytes(b'synthetic outbound transport')
        self.key = self.root / 'original-key.pem'
        self.key.write_bytes(b'synthetic private key - never real credential')
        self.key.chmod(0o600)
        self.config.update(candidate_uid=os.getuid() + 1, repository=external.REPO,
            adapter_sha256=external.digest(self.install.read_bytes()), gh_path=str(self.gh),
            gh_sha256=external.digest(self.gh.read_bytes()),
            app_key_custody={'private_key_file': str(self.key),
                'public_fingerprint': 'SHA256:qD7XvlHIile2flN5AEavSX+P6ZVrlIDddPVus9YLkQg=',
                'record': 'original-human-key-handoff-2026-10-14'})
        self.config_path = self.root / 'delivery-authority.json'
        self.save_config()
        self.lock = self.root / '.fitsy-dispatcher' / 'dispatcher.lock'
        self.lock.parent.mkdir()
        self.lock.write_bytes(b'')
        self.lock.chmod(0o600)
        for name, value in [('app-response.json', self.fixture.identity['app']),
                            ('installation-response.json', self.fixture.identity['installation'])]:
            path = self.root / name
            path.write_text(json.dumps(value))
            path.chmod(0o600)
        self.requests, self.tokens = [], []
        self.patchers = [patch.object(external, 'CONFIG', self.config_path),
            patch.object(external, 'INSTALL', self.install),
            patch.object(external, '__file__', str(self.install)),
            patch.object(external.pwd, 'getpwuid', return_value=SimpleNamespace(pw_dir=str(self.root))),
            patch.object(external.subprocess, 'run', side_effect=self.transport)]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

    def save_config(self):
        self.config_path.write_text(json.dumps(self.config))
        self.config_path.chmod(0o600)

    def issuer(self, jwt, endpoint, payload=None):
        import copy
        self.requests.append((endpoint, payload))
        if endpoint == '/app':
            return copy.deepcopy(self.fixture.identity['app'])
        if endpoint == '/repos/dgmolla/fitsy/installation':
            return copy.deepcopy(self.fixture.identity['installation'])
        self.assertEqual(endpoint, '/app/installations/170592990/access_tokens')
        self.assertEqual(payload, {'repository_ids': [1188934600],
                                  'permissions': self.fixture.identity['token']['permissions']})
        return {'token': 'renewed-synthetic-token', 'expires_at': '2099-01-01T00:00:00Z',
                'permissions': self.fixture.identity['token']['permissions'],
                'repository_selection': 'selected',
                'repositories': [{'id': 1188934600, 'full_name': external.REPO}]}

    def transport(self, argv, **kwargs):
        from types import SimpleNamespace
        if argv[0] == '/bin/ps':
            return SimpleNamespace(returncode=0, stdout='fixture-start\n')
        self.tokens.append(kwargs['env']['GH_TOKEN'])
        endpoint = argv[argv.index('Accept: application/vnd.github+json') + 1]
        payload = json.loads(kwargs['input']) if kwargs.get('input') is not None else None
        if endpoint == 'installation/repositories?per_page=100':
            value = {'total_count': 1, 'repositories': [{'id': 1188934600, 'full_name': external.REPO}]}
        elif endpoint == 'apps/fitsy-delivery-approval':
            value = self.fixture.identity['app']
        elif endpoint == 'users/fitsy-delivery-approval[bot]':
            value = self.fixture.actor
        else:
            value = self.fixture.transport(self.config, endpoint, payload)
        return SimpleNamespace(returncode=0, stdout=json.dumps(value))

    def cli(self, *arguments):
        import contextlib
        import io
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(sys, 'argv', [str(self.install), *arguments]), contextlib.redirect_stdout(
                stdout), contextlib.redirect_stderr(stderr):
            status = external.main()
        return status, stdout.getvalue(), stderr.getvalue()

    def test_expired_publisher_cli_renews_and_preserves_source(self):
        with patch.object(external, 'app_jwt', return_value='synthetic-jwt'), patch.object(
                external, 'app_request', side_effect=self.issuer):
            status, stdout, stderr = self.cli('publish-review', '--issue', '443', '--pr', '9')
        self.assertEqual(status, 0, stderr)
        self.assertEqual(json.loads(stdout)['source_sha'], self.fixture.source)
        self.assertEqual(len(self.fixture.writes), 1)
        self.assertEqual(self.tokens, ['renewed-synthetic-token'] * len(self.tokens))

    def local_review(self):
        canonical = CanonicalReviewTests()
        canonical.setUp()
        self.addCleanup(canonical.doCleanups)
        canonical.install.stop()
        config, _, _ = canonical.install_review_inputs()
        self.config.update(config)
        evidence = self.root / 'evidence' / 'issue-443' / self.fixture.source
        evidence.mkdir(parents=True)
        canonical.policy['canonical_review']['evidence_root'] = str(evidence)
        for name in ('review-round', 'review-gate'):
            (self.root / (name + '.py')).write_bytes(SCRIPT.with_name(name + '.py').read_bytes())
        self.save_config()
        return ['validate-review', '--issue', '443', '--source', self.fixture.source,
                '--base', canonical.base, '--domain', 'correctness']

    def test_expired_local_cli_renews_before_metadata_read(self):
        arguments = self.local_review()
        with patch.object(external, 'app_jwt', return_value='synthetic-jwt'), patch.object(
                external, 'app_request', side_effect=self.issuer):
            status, stdout, stderr = self.cli(*arguments)
        self.assertEqual(status, 0, stderr)
        self.assertEqual(json.loads(stdout)['canonical_review'], 'pass')
        self.assertFalse(self.fixture.writes)
        self.assertEqual(self.tokens, ['renewed-synthetic-token'] * len(self.tokens))

    def publish_cli(self, issuer=None):
        with patch.object(external, 'app_jwt', return_value='synthetic-jwt') as signer, patch.object(
                external, 'app_request', side_effect=issuer or self.issuer):
            result = self.cli('publish-review', '--issue', '443', '--pr', '9')
        return result, signer

    def generation(self):
        return {path: path.read_bytes() for path in (self.config_path,
            Path(self.config['app_token_file']), Path(self.config['app_identity_file']),
            self.root / 'app-response.json', self.root / 'installation-response.json')}

    def test_fresh_credential_keeps_exact_bytes_without_signing_or_writes(self):
        self.fixture.identity['token']['expires_at'] = '2099-01-01T00:00:00Z'
        self.fixture.save_identity()
        self.save_config()
        before = self.generation()
        (status, _, stderr), signer = self.publish_cli()
        self.assertEqual(status, 0, stderr)
        signer.assert_not_called()
        self.assertFalse(self.requests)
        self.assertEqual(self.generation(), before)
        self.assertEqual(set(self.tokens), {'synthetic-installation-token'})

    def test_successful_rotation_restarts_without_reissuing_or_changing_other_pins(self):
        before = dict(self.config)
        (status, _, stderr), _ = self.publish_cli()
        self.assertEqual(status, 0, stderr)
        after = json.loads(self.config_path.read_bytes())
        self.assertEqual({k for k in before if before[k] != after[k]}, {'app_identity_sha256'})
        self.assertEqual(after['app_identity_sha256'], external.digest(Path(after['app_identity_file']).read_bytes()))
        self.assertEqual(len(self.requests), 3)
        (status, _, stderr), signer = self.publish_cli()
        self.assertEqual(status, 0, stderr)
        signer.assert_not_called()
        self.assertEqual(len(self.requests), 3)

    def test_short_operation_lifetime_renews_without_sleep(self):
        from datetime import datetime, timedelta, timezone
        self.fixture.identity['token']['expires_at'] = (datetime.now(timezone.utc) + timedelta(seconds=45)).isoformat()
        self.fixture.save_identity()
        self.save_config()
        (status, _, stderr), _ = self.publish_cli()
        self.assertEqual(status, 0, stderr)
        self.assertEqual(len(self.requests), 3)

    def test_tampered_provenance_token_identity_and_scope_never_sign_or_publish(self):
        import copy
        original_identity = copy.deepcopy(self.fixture.identity)
        original = self.generation()
        for fault in ('provenance', 'token', 'app', 'installation', 'repository', 'permissions'):
            with self.subTest(fault=fault):
                for path, raw in original.items():
                    path.write_bytes(raw)
                self.fixture.identity = copy.deepcopy(original_identity)
                if fault == 'provenance':
                    Path(self.config['app_identity_file']).write_bytes(b'{"tampered":true}')
                elif fault == 'token':
                    Path(self.config['app_token_file']).write_bytes(b'wrong-secret')
                else:
                    if fault == 'app': self.fixture.identity['app']['id'] = 1
                    if fault == 'installation': self.fixture.identity['installation']['id'] = 1
                    if fault == 'repository': self.fixture.identity['repository_id'] = 1
                    if fault == 'permissions': self.fixture.identity['token']['permissions']['contents'] = 'write'
                    self.fixture.save_identity()
                    self.save_config()
                before = self.generation()
                (status, stdout, stderr), signer = self.publish_cli()
                self.assertEqual(status, 1)
                self.assertFalse(stdout)
                self.assertIn('refused', stderr)
                signer.assert_not_called()
                self.assertEqual(self.generation(), before)
        self.assertFalse(self.fixture.writes)

    def test_wrong_issued_identity_and_scope_are_not_committed(self):
        for fault in ('app', 'installation', 'permissions', 'repository', 'repository-name', 'expiry'):
            with self.subTest(fault=fault):
                receipt = self.root / 'app-renewal-recovery.json'
                receipt.unlink(missing_ok=True)
                before = self.generation()
                def wrong(jwt, endpoint, payload=None):
                    value = self.issuer(jwt, endpoint, payload)
                    if fault == 'app' and endpoint == '/app': value['id'] = 1
                    if fault == 'installation' and endpoint.endswith('/installation'): value['id'] = 1
                    if payload is not None:
                        if fault == 'permissions': value['permissions'] = {'contents': 'write'}
                        if fault == 'repository': value['repositories'][0]['id'] = 1
                        if fault == 'repository-name': value['repositories'][0]['full_name'] = 'elsewhere/repository'
                        if fault == 'expiry': value['expires_at'] = '2026-01-01T00:00:00Z'
                    return value
                (status, stdout, _), _ = self.publish_cli(wrong)
                self.assertEqual(status, 1)
                self.assertFalse(stdout)
                self.assertEqual(self.generation(), before)
                self.assertFalse(self.fixture.writes)

    def test_original_lock_contention_refuses_without_issuing(self):
        import fcntl
        before = self.generation()
        with self.lock.open('rb') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            (status, _, _), signer = self.publish_cli()
        self.assertEqual(status, 1)
        signer.assert_not_called()
        self.assertEqual(self.generation(), before)
        self.assertFalse(self.fixture.writes)

    def test_config_drift_during_issuance_is_preserved_and_requires_recovery(self):
        def drift(jwt, endpoint, payload=None):
            value = self.issuer(jwt, endpoint, payload)
            if payload is not None:
                current = json.loads(self.config_path.read_bytes())
                current['unrelated_pin'] = 'another-owner'
                self.config_path.write_text(json.dumps(current))
            return value
        (status, _, stderr), _ = self.publish_cli(drift)
        self.assertEqual(status, 1)
        self.assertIn('preimage changed', stderr)
        self.assertEqual(json.loads(self.config_path.read_bytes())['unrelated_pin'], 'another-owner')
        self.assertEqual(json.loads((self.root / 'app-renewal-recovery.json').read_bytes())['phase'], 'recovery-required')
        self.assertFalse(self.fixture.writes)

    def test_partial_file_failure_rolls_back_only_owned_bytes_and_restarts(self):
        before = self.generation()
        replace = external.private_replace
        failed = []
        def interrupt(path, raw):
            if Path(path) == Path(self.config['app_identity_file']) and not failed:
                failed.append(True)
                raise OSError('synthetic partial-file failure')
            replace(path, raw)
        with patch.object(external, 'private_replace', side_effect=interrupt):
            (status, _, stderr), _ = self.publish_cli()
        self.assertEqual(status, 1)
        self.assertIn('synthetic partial-file failure', stderr)
        self.assertEqual(self.generation(), before)
        self.assertEqual(json.loads((self.root / 'app-renewal-recovery.json').read_bytes())['phase'], 'rolled-back')
        (status, _, stderr), _ = self.publish_cli()
        self.assertEqual(status, 0, stderr)

    def test_uncertain_issuance_is_not_retried_and_errors_contain_no_secrets(self):
        def uncertain(jwt, endpoint, payload=None):
            if payload is not None:
                raise subprocess.TimeoutExpired('synthetic issuer', 20)
            return self.issuer(jwt, endpoint, payload)
        before = self.generation()
        (status, stdout, stderr), _ = self.publish_cli(uncertain)
        self.assertEqual(status, 1)
        self.assertEqual(self.generation(), before)
        (status, stdout2, stderr2), signer = self.publish_cli()
        self.assertEqual(status, 1)
        signer.assert_not_called()
        self.assertIn('reconcile retained renewal evidence', stderr2)
        for secret in ('synthetic-jwt', 'renewed-synthetic-token', self.key.read_text()):
            self.assertNotIn(secret, stdout + stderr + stdout2 + stderr2 +
                (self.root / 'app-renewal-recovery.json').read_text())

    def test_changed_source_during_issuance_still_refuses_publication(self):
        self.local_review()
        def changed(jwt, endpoint, payload=None):
            value = self.issuer(jwt, endpoint, payload)
            if payload is not None:
                self.fixture.pr['head']['sha'] = 'c' * 40
            return value
        (status, _, stderr), _ = self.publish_cli(changed)
        self.assertEqual(status, 1)
        self.assertIn('source mismatch', stderr)
        self.assertFalse(self.fixture.writes)

    def profile_claim(self):
        fixture = ProfileCustodyTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.boundary['issue'] = fixture.claim['issue'] = fixture.receipt['issue'] = 443
        fixture.save()
        self.config.update(fixture.config)
        self.save_config()
        return fixture

    def test_live_claim_survives_rotation_and_ended_claim_refuses_commit(self):
        claim = self.profile_claim()
        before = claim.paths['state'].read_bytes()
        with patch.object(external.os, 'getpgid', return_value=999998):
            (status, _, stderr), _ = self.publish_cli()
        self.assertEqual(status, 0, stderr)
        self.assertEqual(claim.paths['state'].read_bytes(), before)
        self.fixture.identity = json.loads(Path(self.config['app_identity_file']).read_bytes())
        self.fixture.identity['token']['expires_at'] = '2026-01-01T00:00:00Z'
        self.fixture.save_identity()
        self.save_config()
        self.fixture.writes.clear()
        original = self.generation()
        def ended(jwt, endpoint, payload=None):
            value = self.issuer(jwt, endpoint, payload)
            if payload is not None:
                claim.claim['stage'] = 'finished'
                claim.save()
            return value
        with patch.object(external.os, 'getpgid', return_value=999998):
            (status, _, stderr), _ = self.publish_cli(ended)
        self.assertEqual(status, 1)
        self.assertIn('boundary is inactive', stderr)
        self.assertEqual(self.generation(), original)
        self.assertFalse(self.fixture.writes)

    def test_abrupt_exit_between_files_refuses_restart_until_original_owner_recovers(self):
        original = self.generation()
        replace = external.private_replace
        child = os.fork()
        if child == 0:
            def crash(path, raw):
                replace(path, raw)
                if Path(path) == Path(self.config['app_token_file']):
                    os._exit(73)
            with patch.object(external, 'private_replace', side_effect=crash):
                self.publish_cli()
            os._exit(74)
        _, status = os.waitpid(child, 0)
        self.assertEqual(os.WEXITSTATUS(status), 73)
        self.assertNotEqual(self.generation(), original)
        (status, _, stderr), signer = self.publish_cli()
        self.assertEqual(status, 1)
        self.assertIn('renewal interrupted', stderr)
        signer.assert_not_called()
        self.assertFalse(self.fixture.writes)
        # Explicit original-owner recovery from retained exact fixture preimages.
        pending = self.root / 'app-renewal-recovery.json'
        pending.rename(self.root / 'retained-crash-receipt.json')
        for path, raw in original.items():
            path.write_bytes(raw)
        (status, _, stderr), _ = self.publish_cli()
        self.assertEqual(status, 0, stderr)

    def test_signer_rejects_wrong_key_binding_invalid_key_and_unsafe_custody(self):
        from types import SimpleNamespace
        for fault in ('binding', 'key', 'fingerprint', 'symlink'):
            with self.subTest(fault=fault):
                config = json.loads(self.config_path.read_bytes())
                if fault == 'binding': config['app_key_custody']['public_fingerprint'] = 'wrong'
                if fault == 'symlink':
                    alias = self.root / 'key-link'
                    alias.symlink_to(self.key)
                    config['app_key_custody']['private_key_file'] = str(alias)
                result = SimpleNamespace(returncode=1 if fault == 'key' else 0,
                                         stdout=b'wrong-public-key', stderr=b'sensitive-error-not-forwarded')
                with patch.object(external.subprocess, 'run', return_value=result):
                    with self.assertRaises(ValueError):
                        external.app_jwt(config)

    def test_uncertain_check_post_is_not_retried_by_renewal(self):
        transport = self.transport
        attempts = []
        def uncertain(argv, **kwargs):
            if '--method' in argv:
                attempts.append(argv)
                raise subprocess.TimeoutExpired('synthetic check transport', 60)
            return transport(argv, **kwargs)
        with patch.object(external.subprocess, 'run', side_effect=uncertain):
            (status, _, _), _ = self.publish_cli()
        self.assertEqual(status, 1)
        self.assertEqual(len(attempts), 1)
        self.assertEqual(len(self.requests), 3)

    def test_real_openssl_signer_binds_key_and_supported_jwt_claims(self):
        import base64
        import time
        public_file, signature_file = self.root / 'public.pem', self.root / 'signature'
        with patch.object(external.subprocess, 'run', side_effect=REAL_RUN):
            REAL_RUN(['/usr/bin/openssl', 'genrsa', '-out', str(self.key), '2048'],
                     capture_output=True, check=True, timeout=20, env={'PATH': '/usr/bin:/bin'})
            public = REAL_RUN(['/usr/bin/openssl', 'pkey', '-in', str(self.key), '-pubout', '-outform', 'DER'],
                              capture_output=True, check=True, timeout=20).stdout
            fingerprint = 'SHA256:' + base64.b64encode(hashlib.sha256(public).digest()).decode()
            config = {**self.config, 'app_key_custody': {**self.config['app_key_custody'],
                                                       'public_fingerprint': fingerprint}}
            # Synthetic key authority is confined to this fixture, never installation proof.
            with patch.object(external, 'APP_KEY_FINGERPRINT', fingerprint), patch.dict(
                    os.environ, {'OPENSSL_CONF': '/untrusted/candidate-config', 'PATH': '/untrusted/bin'}):
                jwt = external.app_jwt(config)
            header, claims, signature = jwt.split('.')
            decode = lambda value: base64.urlsafe_b64decode(value + '=' * (-len(value) % 4))
            self.assertEqual(json.loads(decode(header)), {'alg': 'RS256', 'typ': 'JWT'})
            body = json.loads(decode(claims))
            self.assertEqual(body['iss'], '5285837')
            self.assertLessEqual(body['iat'], int(time.time()))
            self.assertEqual(body['exp'] - body['iat'], 600)
            public_file.write_bytes(REAL_RUN(['/usr/bin/openssl', 'pkey', '-in', str(self.key), '-pubout'],
                                            capture_output=True, check=True, timeout=20).stdout)
            signature_file.write_bytes(decode(signature))
            result = REAL_RUN(['/usr/bin/openssl', 'dgst', '-sha256', '-verify', str(public_file),
                               '-signature', str(signature_file)], input=(header + '.' + claims).encode(),
                              capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0)

    def test_changed_acceptance_and_failed_review_remain_blocking_after_renewal(self):
        for fault in ('acceptance', 'failed-review'):
            with self.subTest(fault=fault):
                if fault == 'acceptance':
                    self.fixture.body += 'Changed essential requirement.\n'
                else:
                    self.fixture.body = self.fixture.body.replace('Changed essential requirement.\n', '')
                    execution = self.root / 'execution'
                    execution.write_text('{"kind":"timeout"}')
                (status, _, _), _ = self.publish_cli()
                self.assertEqual(status, 1)
                self.assertFalse(self.fixture.writes)


if __name__ == '__main__':
    unittest.main()
