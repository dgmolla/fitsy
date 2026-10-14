import os
import shutil
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
import sys
from types import SimpleNamespace

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('budget', Path(__file__).with_name('review-budget.py'))
budget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(budget)


def fixture_env():
    # Nested fixtures own their source, budget, comparison and live session.
    return {key: value for key, value in os.environ.items()
            if not key.startswith(('GIT_', 'FITSY_VERIFY_', 'FITSY_DIFF_', 'FITSY_SHIPPING_',
                                   'FITSY_REVIEW_', 'FITSY_PRODUCT_ROOT', 'GITHUB_'))
            and key not in ('CI', 'FITSY_RUNS', 'FITSY_VERIFY_OWNED_DB')}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def install_fixture_admin(repo, home):
    # Isolated installation substitutes administrator custody in fixture code,
    # never through production environment paths or real operator approval.
    p = repo / 'scripts/review/review-budget.py'
    p.write_text(p.read_text().replace('ADMIN_HOME = Path(pwd.getpwuid(os.getuid()).pw_dir)',
                                     'ADMIN_HOME = Path(' + repr(str(home)) + ')'))
    operator = home / '.fitsy-review/operators/review-budget.py'
    operator.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(p, operator)
    operator.chmod(0o600)
    p = repo / 'scripts/review/run-review.sh'
    if p.exists():
        p.write_text(p.read_text().replace('ADMIN_HOME="$(python3 -I -c \'import os,pwd; print(pwd.getpwuid(os.getuid()).pw_dir)\')"',
                                         'ADMIN_HOME=' + repr(str(home))))
    p = repo / 'scripts/verify/review-admission.sh'
    if p.exists():
        p.write_text(p.read_text().replace('ADMIN_HOME="$(python3 -I -c \'import os,pwd; print(pwd.getpwuid(os.getuid()).pw_dir)\')"',
                                         'ADMIN_HOME=' + repr(str(home))))
    p = repo / 'scripts/verify/shipping-session.mjs'
    if p.exists():
        p.write_text(p.read_text().replace('userInfo().homedir', json.dumps(str(home))))


class GitChangedPaths(unittest.TestCase):
    """Real Git comparisons runnable without an external authority fixture."""
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@example.test')
        self.git('config', 'user.name', 'Fixture')
        # NUL separation must preserve a product path with whitespace/newlines.
        self.product = ' app\nfile.ts'
        (self.repo / self.product).write_text('original product')
        self.git('add', '.')
        self.git('commit', '-qm', 'base')
        self.base = self.git('rev-parse', 'HEAD')
        (self.repo / 'scripts/review').mkdir(parents=True)
        self.destination = 'scripts/review/moved.py'
        self.git('mv', self.product, self.destination)

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args],
                                       env=fixture_env()).decode().strip()

    def paths(self, *comparison):
        return budget.git_changed_paths(self.repo, *comparison, env=fixture_env())

    def test_history_rename_retains_both_paths_regardless_of_configuration(self):
        self.git('commit', '-qm', 'move product into controls')
        for setting in ('true', 'false', 'copies'):
            with self.subTest(renames=setting):
                self.git('config', 'diff.renames', setting)
                self.assertEqual(set(self.paths(self.base, 'HEAD')),
                                 {self.product, self.destination})

    def test_staged_rename_and_worktree_restoration_retain_product_removal(self):
        for setting in ('true', 'false', 'copies'):
            with self.subTest(renames=setting):
                self.git('config', 'diff.renames', setting)
                self.assertEqual(set(self.paths('--cached', 'HEAD')),
                                 {self.product, self.destination})
                self.assertEqual(set(self.paths('HEAD')),
                                 {self.product, self.destination})
        # Restoring the old path only in the worktree leaves it untracked;
        # neither comparison may lose the staged product removal.
        self.git('restore', '--source=HEAD', '--worktree', '--', self.product)
        self.assertIn(self.product, self.paths('HEAD'))
        self.assertIn(self.product, self.paths('--cached', 'HEAD'))


class CompletedHistoryPrefix(unittest.TestCase):
    """Byte-boundary and full-history behavior without external custody fixtures."""
    def setUp(self):
        self.prior = b'{"event":"start","attempt_id":"old","epoch":1}\r\n' + b'\n' + (
            b'{"event":"finish","attempt_id":"old","elapsed_seconds":2}\n')
        self.rows = [dict(event='start', attempt_id='adopted', epoch=3, adoption='a' * 64),
                     dict(event='finish', attempt_id='adopted', elapsed_seconds=4, adoption='a' * 64)]
        self.imported = dict(event='import', source='/private/operator.json', sha256='a' * 64,
                             events=self.rows)

    def encode(self, event):
        return json.dumps(event).encode() + b'\n'

    def prefix(self, raw, accounted=True):
        return budget.completed_history_prefix(raw, 'adopted', self.rows,
            '/private/operator.json', 'a' * 64, accounted)

    def test_repeat_retains_exact_original_prefix_after_later_review(self):
        raw = self.prior + self.encode(self.imported)
        self.assertEqual(self.prefix(raw), self.prior)
        raw += self.encode(dict(event='start', attempt_id='later', epoch=5))
        raw += self.encode(dict(event='finish', attempt_id='later', elapsed_seconds=1))
        self.assertEqual(self.prefix(raw), self.prior)
        events = budget.read_events(io.StringIO(raw.decode()))
        self.assertEqual(budget.usage(events)[2]['completed_seconds'], 7)
        prior = budget.read_events(io.StringIO(self.prefix(raw).decode()))
        self.assertEqual(budget.usage(prior)[2]['completed_seconds'], 2)

    def test_first_time_preserves_entire_current_history(self):
        self.assertEqual(self.prefix(self.prior, accounted=False), self.prior)
        with self.assertRaises(ValueError):
            self.prefix(self.prior + self.encode(self.imported), accounted=False)

    def test_missing_duplicate_or_changed_import_rejected(self):
        raw = self.prior + self.encode(self.imported)
        for invalid in (self.prior, raw + self.encode(self.imported),
                        self.prior + self.encode(dict(self.imported, sha256='b' * 64)),
                        self.prior + self.encode(dict(self.imported, source='/caller/copy')),
                        self.prior + self.encode(dict(self.imported, events=self.rows[:1]))):
            with self.subTest(raw=sha(invalid)):
                with self.assertRaises(ValueError):
                    self.prefix(invalid)


class CompletedAccounting(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.old_admin = (budget.ADMIN_HOME, budget.ADMIN_REVIEW, budget.ADMIN_CACHE, budget.ADMIN_BUDGET)
        self.old_operator_file = budget.__file__
        budget.ADMIN_HOME = self.root / 'admin'
        budget.ADMIN_REVIEW = budget.ADMIN_HOME / '.fitsy-review'
        budget.ADMIN_CACHE = budget.ADMIN_HOME / '.cache/fitsy-review'
        budget.ADMIN_BUDGET = budget.ADMIN_CACHE / 'budgets'
        (budget.ADMIN_REVIEW / 'completed').mkdir(parents=True)
        (budget.ADMIN_CACHE / 'budgets').mkdir(parents=True)
        operator = budget.ADMIN_REVIEW / 'operators/review-budget.py'
        operator.parent.mkdir(parents=True)
        operator.write_bytes(Path(self.old_operator_file).read_bytes())
        operator.chmod(0o600)
        shutil.copyfile(Path(__file__).with_name('review-round.py'), operator.with_name('review-round.py'))
        budget.__file__ = str(operator)
        self.ledger = budget.ADMIN_CACHE / 'budgets/issue-443.jsonl'
        source = 'f' * 40
        base = '2' * 40
        self.args = SimpleNamespace(authorization_file=budget.ADMIN_REVIEW / 'completed/issue-443.json', ledger=self.ledger, issue=443,
            candidate='root:branch', source_sha=source, base_sha=base,
            required_domain=['correctness', 'danger-zone'], acceptance_sha256='a' * 64)
        rows = [dict(event='authorized-grant', attempt_id='historical-grant', issue=443, seconds=14400,
                     provenance='https://github.com/dgmolla/fitsy/issues/443#issuecomment-12345'),
                dict(event='extension', attempt_id='issue-extension', issue=443, seconds=900, risk='high', required=True),
                dict(event='start', attempt_id='original', epoch=1),
                dict(event='finish', attempt_id='original', elapsed_seconds=16507.12014900209),
                dict(event='execution-limit', attempt_id='issue-execution-limit', issue=443,
                     baseline_attempts=['original'], baseline_completed_seconds=16507.12014900209,
                     completed_seconds_stop_at=16511.78812287716, new_rounds_max=1,
                     per_round_timeout_seconds_max=300),
                dict(event='review-allocation', attempt_id='approved-stop', issue=443,
                     previous_cap_seconds=16511.78812287716, additional_seconds=300,
                     cumulative_stop_seconds=16811.78812287716, source_sha=source,
                     authorization_sha256='a'*64)]
        self.original = ''.join(json.dumps(row) + '\n' for row in rows)
        self.ledger.write_text(self.original)
        verdict = json.dumps(dict(source_sha=source, base_sha=base,
            domains={key: dict(verdict='pass', findings=[]) for key in self.args.required_domain},
            summary='Complete review', limitations=['Read only'])).encode()
        stderr = b'real provider trace'
        execution = json.dumps(dict(kind='completed', returncode=0,
            elapsed_seconds=252.81189254205674, stdout_bytes=len(verdict), stderr_bytes=len(stderr))).encode()
        self.approval = dict(issue=443, candidate='root:branch', source_sha=source, base_sha=base,
            domains=self.args.required_domain, acceptance_sha256='a' * 64,
            provider='codex', model='gpt-6-sol', reasoning_effort='high',
            provenance='https://github.com/dgmolla/fitsy/issues/443#issuecomment-6084442263',
            original_ledger_sha256=sha(self.original.encode()), prior_completed_seconds=16507.12014900209,
            control_sha=base, operator_sha256=sha(Path(budget.__file__).read_bytes()),
            completed_seconds_stop_at=16811.788122877158, completed_at='2026-10-09T15:56:44+00:00', artifacts={})
        for key, raw in dict(verdict=verdict, execution=execution, prompt=b'Original source review prompt', stderr=stderr).items():
            path = self.root / key
            path.write_bytes(raw)
            self.approval['artifacts'][key] = dict(path=str(path), sha256=sha(raw))
        self.save()

    def tearDown(self):
        budget.ADMIN_HOME, budget.ADMIN_REVIEW, budget.ADMIN_CACHE, budget.ADMIN_BUDGET = self.old_admin
        budget.__file__ = self.old_operator_file
        self.temp.cleanup()

    def save(self):
        if hasattr(self.args, "control_sha"):
            self.approval["control_sha"] = self.args.control_sha
        self.args.authorization_file.write_text(json.dumps(self.approval))
        self.args.authorization_file.chmod(0o600)

    def call(self):
        with self.ledger.open('a+') as handle:
            return budget.account_completed(handle, self.ledger, self.args, budget.read_events(handle))

    def test_additive_idempotent_without_admission_or_limit_reset(self):
        first = self.call()
        self.assertAlmostEqual(first['completed_seconds'], 16759.932041544147)
        self.assertAlmostEqual(first['cap_seconds'], 16811.788122877158)
        self.assertGreater(first['remaining_seconds'], 0)
        saved = self.ledger.read_text()
        self.assertTrue(saved.startswith(self.original))
        self.assertTrue(self.call()['idempotent'])
        self.assertEqual(saved, self.ledger.read_text())

    def test_real_cli_accounts_without_changing_bound_limits(self):
        operator = budget.ADMIN_REVIEW / 'operators/review-budget.py'
        operator.parent.mkdir(exist_ok=True)
        operator.write_text(Path(budget.__file__).read_text().replace(
            'ADMIN_HOME = Path(pwd.getpwuid(os.getuid()).pw_dir)',
            'ADMIN_HOME = Path(' + repr(str(budget.ADMIN_HOME)) + ')'))
        self.approval['operator_sha256'] = sha(operator.read_bytes())
        self.save()
        command = ['python3', str(operator),
                   'account-completed', '--ledger', str(self.ledger), '--issue', '443',
                   '--candidate', self.args.candidate, '--source-sha', self.args.source_sha,
                   '--base-sha', self.args.base_sha, '--acceptance-sha256', self.args.acceptance_sha256,
                   '--authorization-file', str(self.args.authorization_file)]
        for domain in self.args.required_domain:
            command.extend(['--required-domain', domain])
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        value = json.loads(result.stdout)
        self.assertAlmostEqual(value['completed_seconds'], 16759.932041544147)
        saved = self.ledger.read_text()
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(json.loads(result.stdout)['idempotent'])
        self.assertEqual(saved, self.ledger.read_text())
        incoming = self.root / 'caller-history.jsonl'
        incoming.write_text(json.dumps(dict(event='start', attempt_id='forged-import', epoch=1))+'\n')
        result = subprocess.run(command + ['--import-ledger', str(incoming)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(saved, self.ledger.read_text())

    def test_direct_accounting_cannot_select_its_own_approval(self):
        caller = self.root / 'caller-approved.json'
        caller.write_bytes(self.args.authorization_file.read_bytes())
        caller.chmod(0o600)
        self.args.authorization_file = caller
        with self.assertRaisesRegex(ValueError, 'canonical coordinator authority'):
            self.call()
        self.assertEqual(self.original, self.ledger.read_text())

    def test_manifest_stop_must_match_effective_retained_cap(self):
        self.approval['completed_seconds_stop_at'] += 1
        self.save()
        with self.assertRaisesRegex(ValueError, 'authorized stop mismatch'):
            self.call()
        self.assertEqual(self.original, self.ledger.read_text())

    def append_rows(self, *rows):
        with self.ledger.open('a') as handle:
            for row in rows:
                handle.write(json.dumps(row) + '\n')

    def accounting(self):
        value = self.call()
        return value.get('accounting', value)

    def later_review(self, seconds=1):
        self.append_rows(dict(event='start', attempt_id='later', epoch=2),
                         dict(event='finish', attempt_id='later', elapsed_seconds=seconds))

    def upgrade(self):
        original = budget.ADMIN_REVIEW / 'completed/original-443.json'
        original.write_bytes(self.args.authorization_file.read_bytes())
        original.chmod(0o600)
        self.approval['original_manifest'] = dict(path=str(original), sha256=sha(original.read_bytes()))
        operator = Path(budget.__file__)
        operator.write_bytes(operator.read_bytes() + b'\n# independently approved fixture upgrade\n')
        self.approval['operator_sha256'] = sha(operator.read_bytes())
        if hasattr(self, 'repo'):
            self.git('checkout', '-qf', 'controls')
            shutil.copyfile(operator, self.repo / 'scripts/review/review-budget.py')
            self.git('commit', '-qam', 'approved operator upgrade')
            self.args.control_sha = self.git('rev-parse', 'HEAD')
            self.git('checkout', '-qf', 'product')
            self.git('restore', '--source=' + self.args.control_sha, '--staged', '--worktree', '--', 'scripts/review')
        else:
            self.approval['control_sha'] = '4' * 40
        self.save()
        return original

    def test_later_review_is_counted_without_rewriting_original_adoption(self):
        initial = self.accounting()
        self.later_review()
        saved = self.ledger.read_bytes()
        value = self.accounting()
        self.assertTrue(value['idempotent'])
        self.assertAlmostEqual(value['completed_seconds'], initial['completed_seconds'] + 1)
        self.assertAlmostEqual(value['remaining_seconds'], initial['remaining_seconds'] - 1)
        self.assertEqual(saved, self.ledger.read_bytes())

    def test_additive_allocation_is_counted_without_refreshing_attestation(self):
        initial = self.accounting()
        self.append_rows(dict(event='review-allocation', attempt_id='later-allocation', issue=443,
            previous_cap_seconds=initial['cap_seconds'], additional_seconds=45,
            cumulative_stop_seconds=initial['cap_seconds'] + 45,
            source_sha=self.args.source_sha, authorization_sha256='b' * 64))
        saved = self.ledger.read_bytes()
        value = self.accounting()
        self.assertAlmostEqual(value['cap_seconds'], initial['cap_seconds'] + 45)
        self.assertAlmostEqual(value['completed_seconds'], initial['completed_seconds'])
        self.assertAlmostEqual(value['remaining_seconds'], initial['remaining_seconds'] + 45)
        self.assertEqual(saved, self.ledger.read_bytes())

    def test_operator_upgrade_preserves_original_rows_with_later_usage(self):
        initial = self.accounting()
        original_rows = self.ledger.read_bytes()
        self.upgrade()
        self.later_review()
        saved = self.ledger.read_bytes()
        value = self.accounting()
        self.assertTrue(value['idempotent'])
        self.assertAlmostEqual(value['completed_seconds'], initial['completed_seconds'] + 1)
        self.assertTrue(saved.startswith(original_rows))
        self.assertEqual(saved, self.ledger.read_bytes())

    def test_upgrade_cannot_start_first_time_accounting(self):
        self.upgrade()
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(self.original.encode(), self.ledger.read_bytes())

    def test_first_time_accounting_still_requires_full_current_history(self):
        self.later_review()
        saved = self.ledger.read_bytes()
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(saved, self.ledger.read_bytes())

    def test_current_unfinished_or_over_cap_history_rejects_repeat(self):
        self.accounting()
        saved = self.ledger.read_bytes()
        for seconds in (None, 100):
            with self.subTest(seconds=seconds):
                self.ledger.write_bytes(saved)
                if seconds is None:
                    self.append_rows(dict(event='start', attempt_id='later', epoch=2))
                else:
                    self.later_review(seconds)
                before = self.ledger.read_bytes()
                with self.assertRaises(ValueError):
                    self.call()
                self.assertEqual(before, self.ledger.read_bytes())

    def test_unique_import_and_exact_prefix_required_on_repeat(self):
        self.accounting()
        saved = self.ledger.read_bytes()
        imported = saved.splitlines(keepends=True)[-1]
        changed = json.loads(imported)
        changed['sha256'] = '0' * 64
        for raw in (saved + imported, b' ' + saved,
                    saved[:-len(imported)] + json.dumps(changed).encode() + b'\n'):
            with self.subTest(raw=sha(raw)):
                self.ledger.write_bytes(raw)
                with self.assertRaises(ValueError):
                    self.call()
                self.assertEqual(raw, self.ledger.read_bytes())

    def test_changed_import_source_or_rows_rejects_repeat(self):
        self.accounting()
        saved = self.ledger.read_bytes()
        lines = saved.splitlines(keepends=True)
        for field in ('source', 'adoption', 'extra-row'):
            with self.subTest(field=field):
                imported = json.loads(lines[-1])
                if field == 'source': imported['source'] += '.copy'
                elif field == 'adoption': imported['events'][0]['adoption'] = '0' * 64
                else: imported['events'].append(dict(event='start', attempt_id='extra', epoch=2))
                raw = b''.join(lines[:-1]) + json.dumps(imported).encode() + b'\n'
                self.ledger.write_bytes(raw)
                with self.assertRaises(ValueError):
                    self.call()
                self.assertEqual(raw, self.ledger.read_bytes())

    def test_original_authority_missing_unsafe_or_changed_rejects_upgrade(self):
        self.accounting()
        original = self.upgrade()
        raw = original.read_bytes()
        saved = self.ledger.read_bytes()
        for fault in ('missing', 'public', 'changed', 'symlink', 'hash', 'checkout'):
            with self.subTest(fault=fault):
                original.write_bytes(raw)
                original.chmod(0o600)
                reference = dict(self.approval['original_manifest'])
                if fault == 'missing': original.unlink()
                elif fault == 'public': original.chmod(0o644)
                elif fault == 'changed': original.write_bytes(raw + b'\n')
                elif fault == 'symlink':
                    target = original.with_name('copy.json')
                    target.write_bytes(raw)
                    target.chmod(0o600)
                    original.unlink()
                    original.symlink_to(target)
                elif fault == 'hash': self.approval['original_manifest']['sha256'] = '0' * 64
                elif fault == 'checkout':
                    self.approval['original_manifest']['path'] = str(Path(__file__).resolve())
                self.save()
                with self.assertRaises((ValueError, OSError)):
                    self.call()
                self.assertEqual(saved, self.ledger.read_bytes())
                if original.is_symlink(): original.unlink()
                self.approval['original_manifest'] = reference

    def test_upgrade_cannot_change_any_immutable_attestation_field(self):
        self.accounting()
        self.upgrade()
        saved = self.ledger.read_bytes()
        # Even coordinated caller changes cannot turn a current installation
        # approval into a new execution, source, accounting or artifact identity.
        for field in self.approval.keys() - {'control_sha', 'operator_sha256', 'original_manifest'}:
            with self.subTest(field=field):
                original = self.approval[field]
                if isinstance(original, str): changed = original + 'changed'
                elif isinstance(original, list): changed = original + ['changed']
                elif isinstance(original, dict): changed = dict(original, changed={})
                else: changed = original + 1
                self.approval[field] = changed
                self.save()
                with self.assertRaises(ValueError):
                    self.call()
                self.assertEqual(saved, self.ledger.read_bytes())
                self.approval[field] = original

    def test_upgrade_still_requires_current_installation_approval(self):
        self.accounting()
        self.upgrade()
        # Bind the caller to the approved control before testing a mismatch.
        self.args.control_sha = self.approval["control_sha"]
        saved = self.ledger.read_bytes()
        for key in ('control_sha', 'operator_sha256'):
            with self.subTest(field=key):
                original = self.approval[key]
                self.approval[key] = '0' * len(original)
                self.args.authorization_file.write_text(json.dumps(self.approval))
                with self.assertRaises(ValueError):
                    self.call()
                self.assertEqual(saved, self.ledger.read_bytes())
                self.approval[key] = original

    def test_changed_source_base_domain_issue_acceptance_policy_fail_without_writes(self):
        for field, bad in dict(source_sha='e'*40, base_sha='3'*40, domains=['correctness'],
                               issue=463, acceptance_sha256='b'*64, model='other').items():
            with self.subTest(field=field):
                original = self.approval[field]
                self.approval[field] = bad
                self.save()
                with self.assertRaises(ValueError):
                    self.call()
                self.assertEqual(self.original, self.ledger.read_text())
                self.approval[field] = original

    def test_altered_raw_artifact_and_incomplete_verdict_fail(self):
        path = self.root / 'verdict'
        value = json.loads(path.read_text())
        value['domains']['danger-zone']['verdict'] = 'incomplete'
        path.write_text(json.dumps(value))
        with self.assertRaises(ValueError):
            self.call()
        self.approval['artifacts']['verdict']['sha256'] = sha(path.read_bytes())
        self.save()
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(self.original, self.ledger.read_text())

    def test_conflicting_duplicate_accounting_fails(self):
        self.call()
        saved = self.ledger.read_text()
        self.approval['completed_at'] = '2026-10-09T15:56:45+00:00'
        self.save()
        with self.assertRaises(ValueError):
            self.call()
        self.assertEqual(saved, self.ledger.read_text())

    def test_completed_failed_review_is_accounted_but_cannot_admit(self):
        path = self.root / 'verdict'
        value = json.loads(path.read_text())
        value['domains']['correctness'] = dict(verdict='fail', findings=[dict(priority='P1', summary='Real defect')])
        path.write_text(json.dumps(value))
        self.approval['artifacts']['verdict']['sha256'] = sha(path.read_bytes())
        execution = json.loads((self.root / 'execution').read_text())
        execution['stdout_bytes'] = path.stat().st_size
        (self.root / 'execution').write_text(json.dumps(execution))
        self.approval['artifacts']['execution']['sha256'] = sha((self.root / 'execution').read_bytes())
        self.save()
        with self.ledger.open('a+') as handle:
            result = budget.account_completed(handle, self.ledger, self.args, budget.read_events(handle))
        self.assertAlmostEqual(result['completed_seconds'], 16759.932041544147)
        with self.ledger.open() as handle:
            self.assertEqual(budget.read_events(handle)[-1]['verdict'], 'fail')

    def test_changed_retained_history_fails(self):
        self.ledger.write_text(self.original + '\n')
        with self.assertRaises(ValueError):
            self.call()

    def test_timeout_and_excess_execution_fail(self):
        for patch in [dict(kind='timeout'), dict(elapsed_seconds=301), dict(returncode=1)]:
            with self.subTest(patch=patch):
                path = self.root / 'execution'
                value = json.loads(path.read_text())
                value.update(patch)
                path.write_text(json.dumps(value))
                self.approval['artifacts']['execution']['sha256'] = sha(path.read_bytes())
                self.save()
                with self.assertRaises(ValueError):
                    self.call()
        self.assertEqual(self.original, self.ledger.read_text())


class CompletedAdmission(CompletedAccounting):
    def setUp(self):
        super().setUp()
        self.repo = self.root / 'source'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@example.test')
        self.git('config', 'user.name', 'Fixture')
        (self.repo / 'scripts/review').mkdir(parents=True)
        (self.repo / 'scripts/review/control.py').write_text('old controls')
        (self.repo / 'app.ts').write_text('original product')
        self.git('add', '.')
        self.git('commit', '-qm', 'base')
        base = self.git('rev-parse', 'HEAD')
        self.git('checkout', '-qb', 'product')
        (self.repo / 'app.ts').write_text('frozen product')
        self.git('commit', '-qam', 'product')
        source = self.git('rev-parse', 'HEAD')
        self.git('checkout', '-qb', 'controls', base)
        (self.repo / 'scripts/review/control.py').write_text('trusted correction')
        shutil.copyfile(Path(budget.__file__), self.repo / 'scripts/review/review-budget.py')
        self.git('add', 'scripts/review/review-budget.py')
        self.git('commit', '-qam', 'controls')
        control = self.git('rev-parse', 'HEAD')
        self.git('checkout', '-q', 'product')
        self.git('restore', '--source=' + control, '--staged', '--worktree', '--', 'scripts/review')
        self.args.candidate_root = self.repo
        self.args.source_sha = source
        self.args.base_sha = base
        self.args.control_sha = control
        self.approval.update(source_sha=source, base_sha=base)
        verdict = json.loads((self.root / 'verdict').read_text())
        verdict.update(source_sha=source, base_sha=base)
        self.replace_artifact('verdict', json.dumps(verdict))
        self.replace_artifact('prompt', f'Review issue443 {source} against {base}, correctness danger-zone')
        self.replace_artifact('stderr', 'model: gpt-6-sol\napproval: never\nsandbox: read-only\nreasoning effort: high\n')
        execution = json.loads((self.root / 'execution').read_text())
        execution.update(stdout_bytes=(self.root / 'verdict').stat().st_size,
                         stderr_bytes=(self.root / 'stderr').stat().st_size)
        self.replace_artifact('execution', json.dumps(execution))
        self.save()

    def replace_artifact(self, key, value):
        (self.root / key).write_text(value)
        self.approval['artifacts'][key]['sha256'] = sha(value.encode())

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], env=fixture_env()).decode().strip()

    def call(self):
        with self.ledger.open('a+') as handle:
            return budget.admit_completed(handle, self.ledger, self.args, budget.read_events(handle))

    def test_validate_completed_is_read_only_before_and_after_accounting_and_upgrade(self):
        self.args.action = 'validate-completed'
        saved = self.ledger.read_bytes()
        self.assertEqual(self.call()['verdict'], 'pass')
        self.assertEqual(saved, self.ledger.read_bytes())
        self.args.action = 'admit-completed'
        self.call()
        self.upgrade()
        self.later_review()
        saved = self.ledger.read_bytes()
        self.args.action = 'validate-completed'
        self.assertTrue(self.call()['accounting']['idempotent'])
        self.assertEqual(saved, self.ledger.read_bytes())

    def test_cache_requires_coordinator_custody_and_exact_evidence(self):
        key = 'a' * 64
        raw = json.dumps(dict(verdict='pass', domains={'correctness': 'pass'}, findings=[]))
        receipt = json.dumps(dict(kind='completed', returncode=0))
        proof = {}
        for name, data in [('raw', raw), ('receipt', receipt)]:
            path = self.root / name
            path.write_text(data)
            proof[name] = dict(path=str(path), sha256=sha(data.encode()))
        result = dict(verdict='pass', domains={'correctness': 'pass'}, findings=[],
                      execution=dict(attempt_id='cache-execution', cache_key=key,
                                     base_sha=self.args.base_sha, artifacts=proof))
        path = budget.ADMIN_CACHE / (key + '.json')
        path.write_text(json.dumps(result))
        rows = [dict(event='start', attempt_id='cache-execution', epoch=1, source_sha=self.args.source_sha),
                dict(event='finish', attempt_id='cache-execution', elapsed_seconds=1,
                     source_sha=self.args.source_sha, outcome='pass', failure_kind='completed',
                     verdict='pass', result_sha256=sha(path.read_bytes()))]
        with self.ledger.open('a') as handle:
            for row in rows: handle.write(json.dumps(row) + '\n')
        args = SimpleNamespace(ledger=self.ledger, issue=443, result_file=path, cache_key=key,
                               base_sha=self.args.base_sha, source_sha=self.args.source_sha,
                               required_domain=['correctness'])
        def admit():
            with self.ledger.open() as handle:
                return budget.admit_cache(args, budget.read_events(handle))
        # Self-authored internally consistent rows and artifacts cannot approve reuse.
        with self.assertRaises(OSError): admit()
        operators = budget.ADMIN_REVIEW / 'operators'
        operators.mkdir(exist_ok=True)
        authority = operators / ('issue-443-cache-' + key + '.json')
        approval = dict(issue=443, source_sha=args.source_sha, base_sha=args.base_sha,
                        domains=['correctness'], cache_key=key,
                        result_sha256=sha(path.read_bytes()), ledger_sha256=sha(self.ledger.read_bytes()))
        authority.write_text(json.dumps(approval))
        authority.chmod(0o600)
        self.assertEqual(admit()['verdict'], 'pass')
        saved = self.ledger.read_bytes()
        for field, wrong in dict(issue=463, source_sha='e'*40, base_sha='3'*40,
                                 domains=['danger-zone'], result_sha256='0'*64,
                                 ledger_sha256='0'*64).items():
            with self.subTest(field=field):
                authority.write_text(json.dumps(dict(approval, **{field: wrong})))
                with self.assertRaisesRegex(ValueError, 'coordinator-verified'): admit()
                self.assertEqual(saved, self.ledger.read_bytes())
        authority.write_text(json.dumps(approval))
        caller_copy = self.root / 'caller-cache.json'
        caller_copy.write_bytes(path.read_bytes())
        args.result_file = caller_copy
        with self.assertRaisesRegex(ValueError, 'canonical administrator-managed'): admit()

    def test_candidate_selected_copy_cannot_approve_operator(self):
        forged = self.root / 'forged.json'
        forged.write_bytes(self.args.authorization_file.read_bytes())
        forged.chmod(0o600)
        self.args.authorization_file = forged
        with self.assertRaisesRegex(ValueError, 'canonical coordinator authority'):
            self.call()
        self.assertEqual(self.original, self.ledger.read_text())

    def test_unapproved_operator_or_source_cannot_admit(self):
        for key in ('control_sha', 'operator_sha256'):
            saved = self.approval[key]
            self.approval[key] = '0' * len(saved)
            self.args.authorization_file.write_text(json.dumps(self.approval))
            with self.assertRaisesRegex(ValueError, 'exact independently reviewed operator'):
                self.call()
            self.assertEqual(self.original, self.ledger.read_text())
            self.approval[key] = saved

    # Accounting cases above remain tested through the original class.
    def test_additive_idempotent_without_admission_or_limit_reset(self):
        value = self.call()
        self.assertEqual(value['domains'], {'correctness': 'pass', 'danger-zone': 'pass'})
        self.assertAlmostEqual(value['accounting']['completed_seconds'], 16759.932041544147)
        saved = self.ledger.read_bytes()
        self.assertTrue(self.call()['accounting']['idempotent'])
        self.assertEqual(saved, self.ledger.read_bytes())
        self.assertFalse(list(self.root.glob('*.cache')))

    def test_real_cli_accounts_without_changing_bound_limits(self):
        # The accounting CLI has its own real-command regression above.
        self.assertEqual(self.call()['verdict'], 'pass')

    def test_supported_runner_consumes_raw_result_without_provider_or_cache(self):
        # Exercise the actual entry point with fixture external boundaries only.
        source_root = Path(__file__).resolve().parents[2]
        self.git('checkout', '-qf', 'controls')
        shutil.copytree(source_root / 'scripts/review', self.repo / 'scripts/review', dirs_exist_ok=True)
        shutil.copytree(source_root / '.claude/lenses', self.repo / '.claude/lenses')
        shutil.copyfile(source_root / 'REVIEW.md', self.repo / 'REVIEW.md')
        (self.repo / 'scripts/verify').mkdir(parents=True)
        shutil.copyfile(source_root / 'scripts/verify/risk-tiers.yml', self.repo / 'scripts/verify/risk-tiers.yml')
        install_fixture_admin(self.repo, budget.ADMIN_HOME)
        self.git('add', '.')
        self.git('commit', '-qm', 'trusted controls')
        control = self.git('rev-parse', 'HEAD')
        self.args.control_sha = control
        self.git('checkout', '-qf', 'product')
        self.git('restore', '--source=' + control, '--staged', '--worktree', '--',
                 'scripts/review', '.claude/lenses', 'REVIEW.md', 'scripts/verify/risk-tiers.yml')
        self.git('update-ref', 'refs/remotes/origin/main', control)
        # Mandatory domain routing comes from the trusted tree, not the manifest.
        (self.repo / '.evidence/delivery').mkdir(parents=True)
        (self.repo / '.git/info/exclude').write_text('.evidence/\n')
        (self.repo / '.evidence/delivery/binding.json').write_text('{"issue":443}')
        brief = 'Frozen acceptance'
        self.approval['acceptance_sha256'] = sha(brief.encode())
        self.approval['candidate'] = self.git('rev-list', '--max-parents=0', 'HEAD') + ':product'
        self.approval['domains'] = ['correctness']
        verdict = json.loads((self.root / 'verdict').read_text())
        verdict['domains'] = {'correctness': {'verdict': 'pass', 'findings': []}}
        self.replace_artifact('verdict', json.dumps(verdict))
        execution = json.loads((self.root / 'execution').read_text())
        execution['stdout_bytes'] = (self.root / 'verdict').stat().st_size
        self.replace_artifact('execution', json.dumps(execution))
        auth_home = budget.ADMIN_REVIEW / 'completed'
        self.args.authorization_file = auth_home / 'issue-443.json'
        self.save()
        tools = self.root / 'bin'
        tools.mkdir()
        for name, text in {'gh': '#!/bin/sh\nprintf "Frozen acceptance\\n"\n',
                           'codex': '#!/bin/sh\n[ "$1" = --version ] || { echo unexpected-review >&2; exit 90; }\necho fixture-cli\n'}.items():
            (tools / name).write_text(text)
            (tools / name).chmod(0o700)
        budget_home = budget.ADMIN_BUDGET
        self.approval['operator_sha256'] = sha((self.repo / 'scripts/review/review-budget.py').read_bytes())
        self.save()
        env = dict(fixture_env(), PATH=str(tools) + os.pathsep + os.environ['PATH'],
                   FITSY_REVIEW_FRESH_EXECUTION='1', FITSY_REVIEW_COMPLETED_HOME=str(auth_home),
                   FITSY_REVIEW_BUDGET_HOME=str(budget_home), FITSY_REVIEW_CACHE=str(self.root / 'cache'),
                   FITSY_GH_BIN=str(tools / 'gh'), FITSY_REVIEW_PROVIDER='codex',
                   FITSY_REVIEW_MODEL='gpt-6-sol', FITSY_REVIEW_REASONING_EFFORT='high')
        command = ['bash', 'scripts/review/run-review.sh', '--local']
        result = subprocess.run(command, cwd=self.repo, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['verdict'], 'pass')
        self.assertFalse(list((self.root / 'cache').glob('*.json')))
        saved = (budget_home / 'issue-443.jsonl').read_bytes()
        result = subprocess.run(command, cwd=self.repo, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(saved, (budget_home / 'issue-443.jsonl').read_bytes())
        # The same original evidence reaches actual GitHub projection code.
        (tools / 'gh').write_text("#!/usr/bin/env python3\nimport sys\na=sys.argv\n"
            "if a[1]=='issue': print('Frozen acceptance')\n"
            "elif a[1]=='pr':\n"
            " field=a[a.index('--jq')+1]\n"
            + f" print({{'.title':'Fixture','.body':'Delivery-Issue: #443', '.headRefOid':{self.args.source_sha!r}, '.baseRefOid':{control!r}, '.headRefName':'product'}}[field])\n"
            + f"elif a[1]=='api':\n with open({str(self.root / 'statuses')!r},'a') as out: out.write(' '.join(a[2:])+'\\n')\n")
        projected = subprocess.run(['bash', 'scripts/review/run-review.sh', '123', '--cached-only'],
            cwd=self.repo, env=dict(env, FITSY_REVIEW_FRESH_EXECUTION='0'), capture_output=True, text=True)
        self.assertEqual(projected.returncode, 0, projected.stderr)
        statuses = (self.root / 'statuses').read_text()
        self.assertIn('context=lens/correctness', statuses)
        self.assertIn('context=review/round', statuses)
        self.assertNotIn('state=failure', statuses)
        self.assertFalse(list((self.root / 'cache').glob('*.json')))
        probed = subprocess.run(['bash', 'scripts/review/run-review.sh', '123', '--identity'],
            cwd=self.repo, env=dict(env, FITSY_REVIEW_FRESH_EXECUTION='0'), capture_output=True, text=True)
        self.assertEqual(probed.returncode, 0, probed.stderr)
        self.assertEqual(saved, (budget_home / 'issue-443.jsonl').read_bytes())
        self.replace_artifact('verdict', '{}')
        self.save()
        result = subprocess.run(command, cwd=self.repo, env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('unexpected-review', result.stderr)
        probed = subprocess.run(['bash', 'scripts/review/run-review.sh', '123', '--identity'],
            cwd=self.repo, env=dict(env, FITSY_REVIEW_FRESH_EXECUTION='0'), capture_output=True, text=True)
        self.assertNotEqual(probed.returncode, 0)
        self.assertIn('state=error', (self.root / 'statuses').read_text())

    def test_external_session_owns_native_gate_acceptance_hook_and_authority(self):
        self.external_session()

    def test_bootstrap_refuses_stale_managed_main(self):
        self.external_session(bootstrap=True)

    def external_session(self, bootstrap=False):
        issue = 463 if bootstrap else 443
        domains = ['correctness', 'workflow-security'] if bootstrap else ['correctness']
        if bootstrap:
            original = self.ledger.read_text().replace('443', '463')
            self.ledger = budget.ADMIN_BUDGET / 'issue-463.jsonl'
            self.ledger.write_text(original)
            self.approval['original_ledger_sha256'] = sha(original.encode())
        source = Path(__file__).resolve().parents[2]
        product = self.root / 'session-product'
        product.mkdir()
        def git(*args, cwd=product):
            return subprocess.check_output(['git', '-C', str(cwd), *args], env=fixture_env()).decode().strip()
        git('init', '-qb', 'main')
        git('config', 'user.email', 'fixture@example.test')
        git('config', 'user.name', 'Fixture')
        shutil.copytree(source / 'scripts/review', product / 'scripts/review')
        shutil.copytree(source / 'scripts/sim', product / 'scripts/sim')
        shutil.copytree(source / '.claude/lenses', product / '.claude/lenses')
        (product / 'scripts/verify').mkdir(parents=True)
        for name in ('run.mjs', 'impact-plan.mjs', 'receipt-cache.mjs', 'review-admission.sh',
                     'shipping-session.mjs', 'risk-tiers.yml', 'product-flow.mjs', 'media-integration.mjs'):
            shutil.copy2(source / 'scripts/verify' / name, product / 'scripts/verify' / name)
        (product / 'scripts/delivery').mkdir()
        shutil.copyfile(source / 'scripts/delivery/phase-events.mjs', product / 'scripts/delivery/phase-events.mjs')
        shutil.copyfile(source / 'REVIEW.md', product / 'REVIEW.md')
        (product / '.gitignore').write_text('.evidence/\nnode_modules\n')
        (product / 'app.ts').write_text('base product')
        (product / 'package.json').write_text(json.dumps({'scripts': {'verify': 'node scripts/verify/run.mjs --layer=0-2'}}))
        (product / 'scripts/verify/registry.yml').write_text("""checks:
  - name: structural
    script: cheap.sh
    layer: 0
    blocking: true
  - name: review-admission
    script: review-admission.sh
    layer: 0
    stage: acceptance
    preflight: true
    blocking: true
  - name: test
    script: full.sh
    layer: 2
    blocking: true
""")
        for name in ('cheap', 'full'):
            (product / f'scripts/verify/{name}.sh').write_text(f'echo {name} >> .evidence/order\necho ' + "'{\"summary\":\"fixture acceptance\"}'\n")
        for name in ('size-check', 'domain-check'):
            (product / f'scripts/verify/{name}.sh').write_text('exit 2\n')
        install_fixture_admin(product, budget.ADMIN_HOME)
        admission = product / 'scripts/verify/review-admission.sh'
        admission.write_text(admission.read_text().replace('TRUSTED_GH=/opt/homebrew/bin/gh',
            'TRUSTED_GH=' + str(self.root / 'session-bin/gh')))
        fixed_path = str(self.root / 'session-bin') + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
        admission.write_text(admission.read_text().replace('PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', 'PATH=' + fixed_path))
        session_path = product / 'scripts/verify/shipping-session.mjs'
        session_path.write_text(session_path.read_text().replace("const administratorPath = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';", 'const administratorPath = ' + json.dumps(fixed_path) + ';'))
        git('add', '.')
        git('commit', '-qm', 'fixture trusted runtime')
        base = git('rev-parse', 'HEAD')
        git('update-ref', 'refs/remotes/origin/main', base)
        home = budget.ADMIN_REVIEW
        git('clone', '-q', str(product), str(home / 'repo'))
        runtime = home / 'repo'
        git('update-ref', 'refs/remotes/origin/main', base, cwd=runtime)
        (runtime / 'node_modules').symlink_to(source / 'node_modules')
        git('checkout', '-qb', 'frozen')
        if bootstrap:
            path = product / 'scripts/review/review-budget.py'
            path.write_text(path.read_text() + '\n# Isolated approved bootstrap control fixture.\n')
        else:
            (product / 'app.ts').write_text('frozen product')
        git('commit', '-qam', 'fixture candidate')
        head = git('rev-parse', 'HEAD')
        (product / 'node_modules').symlink_to(source / 'node_modules')
        git('remote', 'add', 'origin', str(runtime))
        (product / '.evidence').mkdir()
        subprocess.check_call(['node', 'scripts/delivery/phase-events.mjs', 'bind', '--issue', str(issue)], cwd=product, env=fixture_env(), stdout=subprocess.DEVNULL)
        approval = dict(self.approval, issue=issue, source_sha=head, base_sha=base, domains=domains,
                        provenance=f'https://github.com/dgmolla/fitsy/issues/{issue}#issuecomment-6084442263',
                        candidate=git('rev-list', '--max-parents=0', 'HEAD') + ':frozen',
                        acceptance_sha256=sha(b'Frozen acceptance'))
        auth_home = budget.ADMIN_REVIEW / 'completed'
        approval.update(control_sha=head if bootstrap else base, operator_sha256=sha(((product if bootstrap else runtime) / 'scripts/review/review-budget.py').read_bytes()))
        # Synthetic artifacts establish only this isolated protocol regression.
        raws = {'prompt': f'Review issue{issue} {head} against {base} ' + ' '.join(domains),
                'stderr': 'model: gpt-6-sol\napproval: never\nsandbox: read-only\nreasoning effort: high\n',
                'verdict': json.dumps(dict(source_sha=head, base_sha=base,
                    domains={domain: {'verdict': 'pass', 'findings': []} for domain in domains}, summary='Fixture', limitations=[]))}
        raws['execution'] = json.dumps(dict(kind='completed', returncode=0, elapsed_seconds=252.81189254205674,
            stdout_bytes=len(raws['verdict'].encode()), stderr_bytes=len(raws['stderr'].encode())))
        approval['artifacts'] = {}
        for key, raw in raws.items():
            path = auth_home / key
            path.write_text(raw)
            approval['artifacts'][key] = dict(path=str(path), sha256=sha(raw.encode()))
        auth = auth_home / f'issue-{issue}.json'
        auth.write_text(json.dumps(approval))
        auth.chmod(0o600)
        tools = self.root / 'session-bin'
        tools.mkdir()
        for name, raw in {'gh': '#!/bin/sh\n[ "$1" = issue ] && { echo "Frozen acceptance"; exit 0; }\nexit 1\n',
                          'codex': '#!/bin/sh\n[ "$1" = --version ] || { echo unexpected-review >&2; exit 90; }\necho fixture-cli\n'}.items():
            (tools / name).write_text(raw)
            (tools / name).chmod(0o700)
        (tools / 'gh').write_text("#!/usr/bin/env python3\nimport json,sys\na=sys.argv\n"
            "if a[1]=='issue': print('Frozen acceptance')\n"
            "elif a[1]=='pr' and '--jq' in a: print('Delivery-Issue: #443')\n"
            + f"elif a[1]=='pr': print(json.dumps(dict(headRefOid={head!r},baseRefName='main',headRepositoryOwner=dict(login='dgmolla'),state='OPEN',url='https://fixture.invalid/pr/443')))\n"
            + f"elif a[1]=='api':\n with open({str(self.root / 'published')!r},'a') as out: out.write(sys.stdin.read()+'\\n')\n")
        budgets = budget.ADMIN_BUDGET
        env = dict(fixture_env(), PATH=str(tools) + os.pathsep + os.environ['PATH'],
            HOME=str(budget.ADMIN_HOME), FITSY_REVIEW_PROVIDER='codex',
            FITSY_REVIEW_MODEL='gpt-6-sol', FITSY_REVIEW_REASONING_EFFORT='high')
        if bootstrap:
            operator = budget.ADMIN_REVIEW / 'operators/review-budget.py'
            operator.parent.mkdir(exist_ok=True)
            shutil.copyfile(product / 'scripts/review/review-budget.py', operator)
            operator.chmod(0o600)
            env['FITSY_REVIEW_BOOTSTRAP_OPERATOR'] = str(operator)
        shutil.copyfile(source / '.githooks/pre-push', product / '.evidence/hook')
        (product / '.evidence/native.mjs').write_text(
            "import {admitFinalCandidate} from '../scripts/sim/product-flow.mjs';\n"
            "admitFinalCandidate({publishable:true});\n")
        command = ['node', str(runtime / 'scripts/verify/shipping-session.mjs'), '--root', str(product),
                   '--', 'bash', '-c', 'set -e; node .evidence/native.mjs; npm run verify; bash .evidence/hook; FITSY_PRODUCT_ROOT="$PWD" node ' + str(runtime / 'scripts/sim/publish-product-flow.mjs') + ' 443']
        if bootstrap:
            command = ['node', str(product / 'scripts/verify/shipping-session.mjs'), '--root', str(product), '--', 'npm', 'run', 'verify']
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=40)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('full', (product / '.evidence/order').read_text())
        self.assertNotIn('unexpected-review', result.stderr)
        if bootstrap:
            before = (budgets / f'issue-{issue}.jsonl').read_bytes()
            git('config', 'user.email', 'fixture@example.test', cwd=runtime)
            git('config', 'user.name', 'Fixture', cwd=runtime)
            (runtime / 'app.ts').write_text('new managed main product')
            git('commit', '-qam', 'managed main product advance', cwd=runtime)
            advanced = git('rev-parse', 'HEAD', cwd=runtime)
            live = command[:-3] + ['bash', '-c',
                'git -C ' + str(runtime) + ' update-ref refs/remotes/origin/main ' + advanced + '; npm run verify']
            changed = subprocess.run(live, env=env, capture_output=True, text=True, timeout=40)
            self.assertNotEqual(changed.returncode, 0, changed.stdout + changed.stderr)
            self.assertEqual(before, (budgets / f'issue-{issue}.jsonl').read_bytes())
            stale = subprocess.run(command, env=env, capture_output=True, text=True, timeout=40)
            self.assertNotEqual(stale.returncode, 0, stale.stdout + stale.stderr)
            self.assertEqual(before, (budgets / f'issue-{issue}.jsonl').read_bytes())
            return
        self.assertIn('not_applicable', result.stdout)
        self.assertIn('product-flow/local', (self.root / 'published').read_text())
        before = (budgets / 'issue-443.jsonl').read_bytes()
        # Changing authorization during the owned session cannot admit acceptance.
        drift = command[:-1] + ['echo " " >> ' + str(auth) + '; npm run verify']
        result = subprocess.run(drift, env=env, capture_output=True, text=True, timeout=40)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(before, (budgets / 'issue-443.jsonl').read_bytes())

    def test_product_worktree_or_index_drift_refused(self):
        (self.repo / 'app.ts').write_text('changed after review')
        with self.assertRaisesRegex(ValueError, 'frozen source'):
            self.call()
        self.git('add', 'app.ts')
        (self.repo / 'app.ts').write_text('frozen product')
        with self.assertRaisesRegex(ValueError, 'frozen source'):
            self.call()
        self.assertEqual(self.original, self.ledger.read_text())

    def test_product_rename_into_trusted_main_controls_refused_before_accounting(self):
        self.git('checkout', '-qf', 'controls')
        (self.repo / '.github/workflows').mkdir(parents=True)
        self.git('mv', 'app.ts', '.github/workflows/deploy.yml')
        self.git('commit', '-qm', 'rename product into accepted control path')
        self.args.control_sha = self.git('rev-parse', 'HEAD')
        self.assertIn('R100\tapp.ts\t.github/workflows/deploy.yml',
                      self.git('diff', '--find-renames', '--name-status',
                               self.args.base_sha, self.args.control_sha))
        self.git('checkout', '-qf', 'product')
        self.git('restore', '--source=' + self.args.control_sha,
                 '--staged', '--worktree', '--', 'scripts/review')
        self.save()
        before = self.ledger.read_bytes()
        with self.assertRaisesRegex(ValueError, 'changed product'):
            self.call()
        self.assertEqual(before, self.ledger.read_bytes())

    def test_product_rename_into_staged_controls_refused_before_accounting(self):
        self.git('mv', 'app.ts', 'scripts/review/moved.py')
        before = self.ledger.read_bytes()
        with self.assertRaisesRegex(ValueError, 'frozen source'):
            self.call()
        self.assertEqual(before, self.ledger.read_bytes())
        # Restoring the product in the worktree cannot legitimize the staged move.
        self.git('restore', '--source=HEAD', '--worktree', '--', 'app.ts')
        with self.assertRaisesRegex(ValueError, 'frozen source'):
            self.call()
        self.assertEqual(before, self.ledger.read_bytes())

    def test_untracked_missing_source_and_wrong_controls_refused(self):
        (self.repo / 'extra.ts').write_text('unreviewed')
        with self.assertRaisesRegex(ValueError, 'frozen source'):
            self.call()
        (self.repo / 'extra.ts').unlink()
        (self.repo / 'app.ts').unlink()
        with self.assertRaisesRegex(ValueError, 'frozen source'):
            self.call()
        self.git('restore', 'app.ts')
        (self.repo / 'scripts/review/control.py').write_text('candidate controls')
        with self.assertRaisesRegex(ValueError, 'runtime controls'):
            self.call()

    def test_main_product_advance_invalidates_comparison(self):
        original_control = self.args.control_sha
        for name in ('app.ts', 'apps/mobile/app/nutrition.tsx',
                     'scripts/delivery/unrelated.py', 'scripts/verify/unrelated.mjs',
                     'docs/engineering/devops/unrelated.md',
                     'scripts/delivery/resource_lifecycle.py.backup',
                     'scripts/verify/impact-plan.mjs.backup'):
            with self.subTest(path=name):
                self.git('checkout', '-qf', '-B', 'controls', original_control)
                path = self.repo / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('new product or unrelated input')
                self.git('add', '.')
                self.git('commit', '-qm', 'unrelated main advance')
                self.args.control_sha = self.git('rev-parse', 'HEAD')
                self.git('checkout', '-qf', 'product')
                self.git('restore', '--source=' + self.args.control_sha,
                         '--staged', '--worktree', '--', 'scripts/review')
                self.save()
                with self.assertRaisesRegex(ValueError, 'changed product'):
                    self.call()
                self.assertEqual(self.original, self.ledger.read_text())

    def test_raw_prompt_and_provider_identity_refused(self):
        for key in ('prompt', 'stderr'):
            original = (self.root / key).read_text()
            self.replace_artifact(key, 'wrong context')
            self.save()
            with self.assertRaisesRegex(ValueError, 'raw execution/provider'):
                self.call()
            self.replace_artifact(key, original)
            self.save()


    def test_complete_instruction_and_dispatcher_advance_preserves_product_comparison(self):
        self.git('checkout', '-qf', 'controls')
        for name in ['AGENTS.md', 'docs/engineering/devops/shipping.md',
                     'docs/engineering/devops/task-management.md',
                     'docs/engineering/devops/review-dispositions.md',
                     'docs/engineering/devops/agent-model-routing.md',
                     'docs/engineering/devops/shipping-control-cutover.md',
                     'docs/engineering/devops/shipping-control-setup/README.md',
                     '.github/workflows/deploy.yml', '.github/workflows/eas-build.yml', 'vercel.json',
                     'scripts/delivery/local-dispatcher.py', 'scripts/delivery/local-dispatcher.test.py',
                     'docs/engineering/devops/resource-control-continuation.md',
                     'scripts/delivery/cold_retention.py',
                     'scripts/delivery/pressure-retention.test.py',
                     'scripts/delivery/resource-controls.test.py',
                     'scripts/delivery/resource_lifecycle.py',
                     'scripts/verify/hook-fixture.ts', 'scripts/verify/impact-plan.mjs',
                     'scripts/verify/impact-plan.test.ts',
                     'scripts/verify/product-flow-impact.test.ts',
                     'scripts/verify/product-flow-public-env.test.ts']:
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('Reviewed admission routing correction\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'complete trusted control delta')
        self.args.control_sha = self.git('rev-parse', 'HEAD')
        self.git('checkout', '-qf', 'product')
        self.git('restore', '--source=' + self.args.control_sha, '--staged', '--worktree', '--', 'scripts/review')
        self.save()
        self.assertEqual(self.call()['verdict'], 'pass')


class PermanentAllocation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.old_admin = (budget.ADMIN_HOME, budget.ADMIN_REVIEW, budget.ADMIN_CACHE, budget.ADMIN_BUDGET)
        self.old_operator_file = budget.__file__
        budget.ADMIN_HOME = self.root
        budget.ADMIN_REVIEW = self.root / '.fitsy-review'
        budget.ADMIN_CACHE = self.root / '.cache/fitsy-review'
        budget.ADMIN_BUDGET = budget.ADMIN_CACHE / 'budgets'
        budget.ADMIN_BUDGET.mkdir(parents=True)
        (budget.ADMIN_REVIEW / 'operators').mkdir(parents=True)
        operator = budget.ADMIN_REVIEW / 'operators/review-budget.py'
        operator.write_bytes(Path(self.old_operator_file).read_bytes())
        operator.chmod(0o600)
        budget.__file__ = str(operator)
        self.ledger = budget.ADMIN_BUDGET / 'issue-463.jsonl'
        self.authority = self.root / 'human.json'
        self.authority.write_text(json.dumps(dict(human_instruction='Add global exception permanently')))
        self.authority.chmod(0o600)
        self.path = budget.ADMIN_REVIEW / 'operators/issue-463-allocation.json'
        self.args = SimpleNamespace(issue=463, ledger=self.ledger, source_sha='f'*40, authorization_file=self.path)

    def tearDown(self):
        budget.ADMIN_HOME, budget.ADMIN_REVIEW, budget.ADMIN_CACHE, budget.ADMIN_BUDGET = self.old_admin
        budget.__file__ = self.old_operator_file
        self.temp.cleanup()

    def approval(self, cap, completed):
        value = dict(issue=463, candidate_source='f'*40, authority_file=str(self.authority),
            human_instruction='Add global exception permanently', provider='codex', model='gpt-6-sol', effort='high',
            original_cap_seconds=cap, original_completed_seconds=completed, additional_seconds=300,
            cumulative_stop_seconds=cap+300, per_execution_timeout_seconds=300,
            control_sha='2'*40, operator_sha256=sha(Path(budget.__file__).read_bytes()),
            reason='Diagnosed installed admission mismatch')
        self.path.write_text(json.dumps(value)); self.path.chmod(0o600)

    def call(self):
        with self.ledger.open('a+') as handle:
            rows = budget.read_events(handle)
            return budget.reconcile_allocation(handle, self.args, rows, budget.usage(rows)[2])

    def test_additive_idempotent_authority_and_changed_source_refusal(self):
        events = [dict(event='execution-limit', attempt_id='issue-execution-limit', issue=463,
            baseline_attempts=[], baseline_completed_seconds=0, completed_seconds_stop_at=300,
            new_rounds_max=1, per_round_timeout_seconds_max=295)]
        original = json.dumps(events[0]) + '\n'
        self.ledger.write_text(original); self.approval(300, 0)
        self.assertEqual(self.call()['cap_seconds'], 600)
        self.assertTrue(self.ledger.read_text().startswith(original))
        saved = self.ledger.read_bytes()
        self.assertTrue(self.call()['idempotent'])
        self.assertEqual(saved, self.ledger.read_bytes())
        self.args.source_sha = 'e'*40
        with self.assertRaises(ValueError): self.call()
        self.assertEqual(saved, self.ledger.read_bytes())

    def test_malformed_history_recovers_only_with_later_source_bound_allocation(self):
        limit = dict(event='execution-limit', attempt_id='issue-execution-limit', issue=463,
            baseline_attempts=[], baseline_completed_seconds=0, completed_seconds_stop_at=300,
            new_rounds_max=1, per_round_timeout_seconds_max=295)
        rows = [dict(event='start', attempt_id='malformed', epoch=1, source_sha='a'*40),
            dict(event='finish', attempt_id='malformed', elapsed_seconds=1,
                 outcome='fail', verdict='incomplete', failure_kind='invalid_output'), limit,
            dict(event='count-reconciliation', attempt_id='issue-count-reconciliation', issue=463,
                 new_rounds_max=None, limit_sha256=sha(json.dumps(limit, sort_keys=True).encode()),
                 authorization_sha256='b'*64)]
        original = ''.join(json.dumps(e)+'\n' for e in rows)
        self.ledger.write_text(original)
        # Exercise the real installed CLI in an isolated administrator namespace.
        operator = Path(budget.__file__)
        operator.write_text(operator.read_text().replace(
            'ADMIN_HOME = Path(pwd.getpwuid(os.getuid()).pw_dir)',
            'ADMIN_HOME = Path(' + repr(str(budget.ADMIN_HOME)) + ')'))
        self.approval(300, 1)
        self.call()
        authorized = self.ledger.read_bytes()
        command = ['python3', '-I', str(operator), 'begin', '--ledger', str(self.ledger),
            '--issue', '463', '--source-sha', self.args.source_sha,
            '--round-id', 'recovery', '--lens', 'round', '--attempt-id', 'recovery',
            '--timeout-seconds', '50']
        result = subprocess.run(command, capture_output=True, text=True, env=fixture_env())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(self.ledger.read_text().startswith(original))
        self.assertEqual(json.loads(result.stdout)['completed_seconds'], 1)
        for invalid in ('wrong-source', 'forged-allocation', 'later-incomplete'):
            with self.subTest(invalid=invalid):
                self.ledger.write_bytes(authorized)
                rejected_command = list(command)
                if invalid == 'wrong-source':
                    rejected_command[rejected_command.index('--source-sha') + 1] = 'e'*40
                elif invalid == 'forged-allocation':
                    events = [json.loads(line) for line in authorized.decode().splitlines()]
                    events[-1]['authorization_sha256'] = '0'*64
                    self.ledger.write_text(''.join(json.dumps(event)+'\n' for event in events))
                else:
                    with self.ledger.open('a') as handle:
                        handle.write(json.dumps(dict(event='start', attempt_id='later', epoch=2))+'\n')
                        handle.write(json.dumps(dict(event='finish', attempt_id='later', elapsed_seconds=1,
                            outcome='fail', verdict='incomplete', failure_kind='invalid_output'))+'\n')
                saved = self.ledger.read_bytes()
                rejected = subprocess.run(rejected_command, capture_output=True, text=True, env=fixture_env())
                self.assertEqual(rejected.returncode, 1, rejected.stdout + rejected.stderr)
                self.assertEqual(saved, self.ledger.read_bytes())

    def test_effective_cap_conflict_refuses_before_append(self):
        events = [dict(event='start', attempt_id='old', epoch=1),
            dict(event='finish', attempt_id='old', elapsed_seconds=100),
            dict(event='execution-limit', attempt_id='issue-execution-limit', issue=463,
                 baseline_attempts=['old'], baseline_completed_seconds=100,
                 completed_seconds_stop_at=1900, new_rounds_max=1, per_round_timeout_seconds_max=300)]
        original = ''.join(json.dumps(e)+'\n' for e in events)
        self.ledger.write_text(original); self.approval(1800, 100)
        with self.assertRaisesRegex(ValueError, 'extend the retained authority additively'): self.call()
        self.assertEqual(original, self.ledger.read_text())
        with self.ledger.open() as handle:
            self.assertEqual(budget.usage(budget.read_events(handle))[2]['cap_seconds'], 1800)

    def test_authorized_bounded_allocation_beyond_generic_cap(self):
        self.ledger.write_text(json.dumps(dict(event='execution-limit', attempt_id='issue-execution-limit', issue=463,
            baseline_attempts=[], baseline_completed_seconds=0, completed_seconds_stop_at=1800,
            new_rounds_max=1, per_round_timeout_seconds_max=300))+'\n')
        self.approval(1800, 0)
        original = self.ledger.read_bytes()
        self.assertEqual(self.call()['cap_seconds'], 2100)
        self.assertTrue(self.ledger.read_bytes().startswith(original))
        saved = self.ledger.read_bytes()
        self.assertTrue(self.call()['idempotent'])
        self.assertEqual(saved, self.ledger.read_bytes())
        self.approval(2100, 0)
        value = json.loads(self.path.read_text())
        value['cumulative_stop_seconds'] += 1
        self.path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'invalid bounded permanent review allocation'): self.call()
        self.assertEqual(saved, self.ledger.read_bytes())

    def test_caller_selected_authority_and_unapproved_operator_refuse(self):
        self.ledger.write_text(json.dumps(dict(event='execution-limit', attempt_id='issue-execution-limit', issue=463,
            baseline_attempts=[], baseline_completed_seconds=0, completed_seconds_stop_at=300,
            new_rounds_max=1, per_round_timeout_seconds_max=295))+'\n')
        self.approval(300, 0)
        saved = self.ledger.read_bytes()
        caller = self.root / 'caller.json'; caller.write_bytes(self.path.read_bytes()); caller.chmod(0o600)
        self.args.authorization_file = caller
        with self.assertRaisesRegex(ValueError, 'canonical coordinator authority'): self.call()
        self.args.authorization_file = self.path
        value = json.loads(self.path.read_text()); value['operator_sha256']='0'*64
        self.path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'exact independently reviewed operator'): self.call()
        self.assertEqual(saved, self.ledger.read_bytes())

    def test_approved_operator_copy_cannot_act_before_canonical_installation(self):
        self.ledger.write_text(json.dumps(dict(event='execution-limit', attempt_id='issue-execution-limit', issue=463,
            baseline_attempts=[], baseline_completed_seconds=0, completed_seconds_stop_at=300,
            new_rounds_max=1, per_round_timeout_seconds_max=300))+'\n')
        self.approval(300, 0)
        saved = self.ledger.read_bytes()
        original_file = budget.__file__
        copied = self.root / 'copied-approved-operator.py'
        copied.write_text(Path(original_file).read_text().replace(
            'ADMIN_HOME = Path(pwd.getpwuid(os.getuid()).pw_dir)',
            'ADMIN_HOME = Path(' + repr(str(budget.ADMIN_HOME)) + ')'))
        approval = json.loads(self.path.read_text())
        approval['operator_sha256'] = sha(copied.read_bytes())
        self.path.write_text(json.dumps(approval))
        Path(original_file).unlink()
        result = subprocess.run(['python3', '-I', str(copied), 'reconcile-allocation',
            '--ledger', str(self.ledger), '--issue', '463', '--source-sha', self.args.source_sha,
            '--authorization-file', str(self.path)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('canonical operator installation', result.stdout + result.stderr)
        self.assertEqual(saved, self.ledger.read_bytes())


if __name__ == '__main__':
    unittest.main()
