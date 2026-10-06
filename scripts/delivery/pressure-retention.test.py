"""Actual idle dispatcher process fixtures for owner-bound cold recovery."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import unittest

spec = importlib.util.spec_from_file_location('dispatcher_process_fixture', Path(__file__).with_name('local-dispatcher.test.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class PressureRetentionProcessTest(unittest.TestCase):
    def setUp(self):
        self.c = fixture.DispatcherProcessTest()
        self.c.setUp()
        self.addCleanup(self.c.doCleanups)
        self.c.set_board([])
        self.old = self.claim('12345678-1234-1234-1234-123456789abc', '2026-09-01T00:00:00Z')
        self.new = self.claim('abcdefab-1234-1234-1234-123456789abc', '2026-09-02T00:00:00Z')
        self.path = Path(self.old['worktree'])
        (self.path / 'unfinished.txt').write_text('retained unfinished source\n')
        (self.path / '.env.local').write_text('fixture secret must remain private\n')
        app = self.path / '.evidence/product-build/Build/Products/Fitsy.app'
        app.mkdir(parents=True)
        (app / 'binary').write_bytes(b'fixture retained app')
        raw = self.path / '.evidence/raw-review.txt'
        raw.write_text('original failed review retained\n')
        deps = self.path / 'node_modules'; deps.mkdir(); (deps / 'rebuildable').write_text('scratch environment')
        self.state = {'active': None, 'history': [self.old, self.new], 'resource_releases': {
            x['id']: {'state': 'released'} for x in (self.old, self.new)}}
        (self.c.state / 'state.json').write_text(json.dumps(self.state))
        config = json.loads(self.c.config.read_text())
        config.update({'cleanup_high_watermark_bytes': 10**18, 'superseded_checkout_grace_seconds': 0})
        self.c.config.write_text(json.dumps(config))

    def claim(self, identity, finished):
        p = self.c.worktrees / f'fitsy-issue-385-{identity[:8]}'
        branch = f'codex/issue-385-{identity[:8]}'
        fixture.run('git', 'worktree', 'add', '-b', branch, str(p), 'main', cwd=self.c.repo)
        c = {'id': identity, 'issue': 385, 'worktree': str(p), 'branch': branch,
             'terminal': 'parked-after-exit', 'finished_at': finished, 'pid': None,
             'launcher_pid': None, 'worker_pgid': None}
        directory = self.c.state / 'claims' / identity; directory.mkdir(parents=True)
        (directory / 'receipt.json').write_text(json.dumps(c))
        return c

    def test_idle_pressure_archives_dirty_superseded_source_app_and_raw_evidence(self):
        self.c.tick()
        self.assertFalse(self.path.exists(), 'idle pressure currently leaves every superseded hot checkout retained')
        self.assertTrue(Path(self.new['worktree']).exists())
        r = self.c.state_data()['cold_retention'][self.old['id']]
        self.assertEqual(r['state'], 'cold-retired')
        archive = Path(r['archive']['path'])
        self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
        with tarfile.open(archive) as t:
            self.assertEqual(t.extractfile('unfinished.txt').read(), b'retained unfinished source\n')
            self.assertEqual(t.extractfile('.env.local').read(), b'fixture secret must remain private\n')
            self.assertEqual(t.extractfile('.evidence/product-build/Build/Products/Fitsy.app/binary').read(), b'fixture retained app')
            self.assertEqual(t.extractfile('.evidence/raw-review.txt').read(), b'original failed review retained\n')
            self.assertFalse(any(m.name.startswith('node_modules/') for m in t.getmembers()))
        self.assertIn(self.old['branch'], fixture.run('git', 'branch', '--list', cwd=self.c.repo).stdout)
        self.assertEqual(self.c.workers(), [])

    def test_local_verified_label_without_current_acceptance_retains_latest(self):
        self.new['terminal'] = 'verified'
        (self.c.state / 'claims' / self.new['id'] / 'receipt.json').write_text(json.dumps(self.new))
        (self.c.state / 'state.json').write_text(json.dumps(self.state))
        self.c.tick(); self.c.tick()
        self.assertTrue(Path(self.new['worktree']).exists())
        self.assertNotIn(self.new['id'], self.c.state_data()['cold_retention'])

    def test_current_verified_device_proof_stays_hot_until_device_retired(self):
        self.new['terminal'] = 'verified'
        (self.c.state / 'claims' / self.new['id'] / 'receipt.json').write_text(json.dumps(self.new))
        product = Path(self.new['worktree']) / '.evidence/product-build'
        product.mkdir(parents=True)
        (product / 'receipt.json').write_text(json.dumps({'simulator': 'fixture-device'}))
        from cold_retention import recover
        config = json.loads(self.c.config.read_text())
        self.state['cold_retention'] = {self.old['id']: {'state': 'cold-retired'}}
        recover(config, self.state, lambda: None, 1900000000, lambda _: True)
        self.assertTrue(Path(self.new['worktree']).exists())
        self.state['simulator_retirement'] = {'fixture-device': {'status': 'retired'}}
        recover(config, self.state, lambda: None, 1900000000, lambda _: True)
        self.assertFalse(Path(self.new['worktree']).exists())
        from resource_lifecycle import resume_checkout
        self.assertIsNone(resume_checkout(config, self.state, self.new['issue']))

    def large_app_pair(self):
        self.third = self.claim('fedcbafe-1234-1234-1234-123456789abc', '2026-09-03T00:00:00Z')
        self.state['history'].append(self.third)
        self.state['resource_releases'][self.third['id']] = {'state': 'released'}
        (self.c.state / 'state.json').write_text(json.dumps(self.state))
        for claim in (self.old, self.new):
            app = Path(claim['worktree']) / '.evidence/product-build/Build/Products/Fitsy.app'
            app.mkdir(parents=True, exist_ok=True)
            (app / 'binary').write_bytes(b'A' * (8 * 1024**2))
            (app / 'binary').chmod(0o755)

    def test_large_identical_apps_share_verified_private_recovery_object(self):
        self.large_app_pair(); self.c.tick(); self.c.tick()
        records = self.c.state_data()['cold_retention']
        objects = []
        for claim in (self.old, self.new):
            manifest = json.loads(Path(records[claim['id']]['archive']['manifest']).read_text())
            row = next(row for row in manifest['files'] if row['path'].endswith('.app/binary'))
            objects.append(row['object'])
            self.assertEqual(row['mode'], 0o755)
            import gzip
            with gzip.open(row['object']) as f:
                self.assertEqual(f.read(), b'A' * (8 * 1024**2))
            self.assertEqual(Path(row['object']).stat().st_mode & 0o777, 0o600)
        self.assertEqual(objects[0], objects[1])
        self.assertEqual(len(list((self.c.state / 'recovery/file-objects').glob('*.gz'))), 1)

    def test_changed_app_object_retains_next_hot_source(self):
        self.large_app_pair(); self.c.tick()
        obj = next((self.c.state / 'recovery/file-objects').glob('*.gz'))
        obj.write_bytes(b'corrupted fixture object'); self.c.tick()
        self.assertTrue(Path(self.new['worktree']).exists())
        self.assertEqual(self.c.state_data()['cold_retention'][self.new['id']]['state'], 'deferred')

    def test_end_release_removes_compiler_index_and_preserves_app_and_raw(self):
        index = self.path / '.evidence/product-build/Index.noindex'
        index.mkdir(); (index / 'symbols').write_text('rebuildable index')
        self.state['resource_releases'].pop(self.old['id'])
        (self.c.state / 'state.json').write_text(json.dumps(self.state))
        config = json.loads(self.c.config.read_text()); config['superseded_checkout_grace_seconds'] = 10**20
        self.c.config.write_text(json.dumps(config)); self.c.tick()
        self.assertFalse(index.exists())
        self.assertTrue((self.path / '.evidence/product-build/Build/Products/Fitsy.app/binary').is_file())
        self.assertTrue((self.path / '.evidence/raw-review.txt').is_file())
        self.assertIn(str(index.resolve()), self.c.state_data()['resource_releases'][self.old['id']]['removed'])

    def test_actual_open_file_retains_superseded_checkout(self):
        p = subprocess.Popen([sys.executable, '-c',
            'import sys,time; f=open(sys.argv[1]); print("ready",flush=True); time.sleep(30)',
            str(self.path / 'unfinished.txt')], stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(p.stdout.readline().strip(), 'ready')
            config = json.loads(self.c.config.read_text()); config['lsof_bin'] = shutil.which('lsof')
            self.c.config.write_text(json.dumps(config)); self.c.tick()
            self.assertTrue(self.path.exists())
            self.assertEqual(self.c.state_data()['cold_retention'][self.old['id']]['state'], 'deferred')
        finally:
            p.terminate(); p.wait(); p.stdout.close()

    def test_explicit_queued_compatible_app_pin_stays_hot(self):
        config = json.loads(self.c.config.read_text())
        config['resource_pinned_checkouts'] = [str(self.path.resolve())]
        self.c.config.write_text(json.dumps(config)); self.c.tick()
        self.assertTrue((self.path / '.evidence/product-build/Build/Products/Fitsy.app/binary').is_file())
        self.assertIn('pin', self.c.state_data()['cold_retention'][self.old['id']]['reason'])

    def test_source_directory_named_pods_is_preserved(self):
        source = self.path / 'Pods'; source.mkdir(); (source / 'source.txt').write_text('real source')
        self.c.tick()
        record = self.c.state_data()['cold_retention'][self.old['id']]
        with tarfile.open(record['archive']['path']) as archive:
            self.assertEqual(archive.extractfile('Pods/source.txt').read(), b'real source')

    def test_incoming_dependency_consumer_protects_old_checkout(self):
        consumer = self.c.worktrees / 'known-consumer'; consumer.mkdir()
        (consumer / 'node_modules').symlink_to(self.path / 'node_modules')
        self.c.tick()
        self.assertTrue(self.path.exists())
        self.assertIn('reference', self.c.state_data()['cold_retention'][self.old['id']]['reason'])

    def test_nested_dependency_consumer_protects_old_checkout(self):
        consumer = self.c.worktrees / 'known-nested-consumer'; consumer.mkdir()
        for name in ('node_modules', 'Pods'):
            directory = consumer / name; directory.mkdir()
            (directory / 'package').symlink_to(self.path / 'node_modules')
        self.c.tick()
        self.assertTrue(self.path.exists())
        self.assertIn('reference', self.c.state_data()['cold_retention'][self.old['id']]['reason'])

    def test_evidence_directory_named_node_modules_is_preserved(self):
        evidence = self.path / '.evidence/raw/node_modules'; evidence.mkdir(parents=True)
        (evidence / 'trace.json').write_text('original raw proof')
        self.c.tick()
        record = self.c.state_data()['cold_retention'][self.old['id']]
        with tarfile.open(record['archive']['path']) as archive:
            self.assertEqual(archive.extractfile('.evidence/raw/node_modules/trace.json').read(), b'original raw proof')

    def test_reference_scan_deadline_preserves_source_and_records_next_action(self):
        config = json.loads(self.c.config.read_text())
        config['incoming_reference_scan_seconds'] = 1e-9
        self.c.config.write_text(json.dumps(config))
        self.c.tick()
        self.assertTrue(self.path.exists())
        record = self.c.state_data()['cold_retention'][self.old['id']]
        self.assertEqual(record['state'], 'deferred')
        self.assertIn('deadline', record['reason'])
        self.assertIn('retry_after', record)
        self.assertIn('next_action', record)

    def test_mismatched_legacy_resource_receipt_retains_its_exact_path(self):
        directory = self.c.state / 'claims' / 'legacy-mismatched'; directory.mkdir()
        bad = {**self.old, 'id': 'wrong-identity'}
        (directory / 'receipt.json').write_text(json.dumps(bad))
        self.c.tick()
        self.assertTrue(self.path.exists())
        assessment = self.c.state_data()['cold_retention_legacy'][str(directory / 'receipt.json')]
        self.assertEqual(assessment['state'], 'deferred')
        self.assertEqual(json.loads((directory / 'receipt.json').read_text()), bad)

    def test_git_locked_owner_is_deferred_before_creating_an_archive(self):
        fixture.run('git', 'worktree', 'lock', str(self.path), cwd=self.c.repo)
        self.c.tick()
        self.assertTrue(self.path.exists())
        record = self.c.state_data()['cold_retention'][self.old['id']]
        self.assertEqual(record['state'], 'deferred')
        self.assertNotIn('archive', record)
        self.assertIn('lock', record['reason'])

    def test_no_poll_timestamp_renews_terminal_resource(self):
        self.c.tick()
        self.assertEqual(json.loads((self.c.state / 'claims' / self.old['id'] / 'receipt.json').read_text()), self.old)
        self.assertEqual(self.c.state_data()['history'], self.state['history'])

    def test_owner_bound_pressure_recovery_also_runs_before_floor_hold(self):
        config = json.loads(self.c.config.read_text()); config['min_free_bytes'] = 10**17
        self.c.config.write_text(json.dumps(config)); result = self.c.tick()
        self.assertEqual(result['state'], 'resource-hold')
        self.assertFalse(self.path.exists())
        self.assertEqual(self.c.workers(), [])


if __name__ == '__main__':
    unittest.main()
