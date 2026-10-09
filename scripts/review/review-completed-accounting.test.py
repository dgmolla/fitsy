import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('budget', Path(__file__).with_name('review-budget.py'))
budget = importlib.util.module_from_spec(spec)
spec.loader.exec_module(budget)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


class CompletedAccounting(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.ledger = self.root / 'issue-443.jsonl'
        source = 'f' * 40
        base = '2' * 40
        self.args = SimpleNamespace(authorization_file=self.root / 'operator.json', issue=443,
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
                     per_round_timeout_seconds_max=300)]
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
            completed_seconds_stop_at=16811.788122877158, completed_at='2026-10-09T15:56:44+00:00', artifacts={})
        for key, raw in dict(verdict=verdict, execution=execution, prompt=b'Original source review prompt', stderr=stderr).items():
            path = self.root / key
            path.write_bytes(raw)
            self.approval['artifacts'][key] = dict(path=str(path), sha256=sha(raw))
        self.save()

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        self.args.authorization_file.write_text(json.dumps(self.approval))
        self.args.authorization_file.chmod(0o600)

    def call(self):
        with self.ledger.open('a+') as handle:
            return budget.account_completed(handle, self.ledger, self.args, budget.read_events(handle))

    def test_additive_idempotent_without_admission_or_limit_reset(self):
        first = self.call()
        self.assertAlmostEqual(first['completed_seconds'], 16759.932041544147)
        self.assertEqual(first['cap_seconds'], 16511.78812287716)
        self.assertEqual(first['remaining_seconds'], 0)
        saved = self.ledger.read_text()
        self.assertTrue(saved.startswith(self.original))
        self.assertTrue(self.call()['idempotent'])
        self.assertEqual(saved, self.ledger.read_text())

    def test_real_cli_accounts_without_changing_bound_limits(self):
        command = ['python3', str(Path(__file__).with_name('review-budget.py')),
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


if __name__ == '__main__':
    unittest.main()
