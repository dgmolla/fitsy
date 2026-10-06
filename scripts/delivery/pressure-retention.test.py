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
        self.state['simulator_retirement'] = {'fixture-device': {'status': 'retired', 'issue': 385}}
        recover(config, self.state, lambda: None, 1900000000, lambda _: True)
        self.assertFalse(Path(self.new['worktree']).exists())
        from resource_lifecycle import resume_checkout
        self.assertIsNone(resume_checkout(config, self.state, self.new['issue']))

    def test_superseded_verified_mobile_proof_waits_for_matching_device_retirement(self):
        self.old['terminal'] = 'verified'
        (self.c.state / 'claims' / self.old['id'] / 'receipt.json').write_text(json.dumps(self.old))
        receipt = self.path / '.evidence/product-build/receipt.json'
        receipt.write_text(json.dumps({'simulator': 'fixture-device'}))
        self.state['simulator_retirement'] = {'fixture-device': {'status': 'held', 'issue': 385}}
        (self.c.state / 'state.json').write_text(json.dumps(self.state))
        self.c.tick()
        self.assertTrue(self.path.exists(), 'superseded completed claim still needs its hot device proof')
        record = self.c.state_data()['cold_retention'][self.old['id']]
        self.assertEqual(record['state'], 'deferred')
        self.state = self.c.state_data()
        self.state['simulator_retirement']['fixture-device'] = {'status': 'retired', 'issue': 999}
        (self.c.state / 'state.json').write_text(json.dumps(self.state))
        self.c.tick()
        self.assertTrue(self.path.exists(), 'another issue retirement cannot release this proof')
        self.state = self.c.state_data()
        self.state['simulator_retirement']['fixture-device'] = {'status': 'retired', 'issue': 385}
        (self.c.state / 'state.json').write_text(json.dumps(self.state))
        self.c.tick()
        self.assertFalse(self.path.exists())
        self.assertEqual(self.c.workers(), [])

    def test_pressure_uses_one_hour_grace_for_superseded_verified_checkout(self):
        from datetime import datetime, timedelta, timezone
        config = json.loads(self.c.config.read_text()); config.pop('superseded_checkout_grace_seconds')
        self.c.config.write_text(json.dumps(config))
        self.old['terminal'] = 'verified'
        self.old['finished_at'] = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        self.new['finished_at'] = datetime.now(timezone.utc).isoformat()
        for claim in (self.old, self.new):
            (self.c.state / 'claims' / claim['id'] / 'receipt.json').write_text(json.dumps(claim))
        (self.path / '.evidence/product-build/receipt.json').write_text(json.dumps({'simulator': 'ended-device'}))
        self.state['simulator_retirement'] = {'ended-device': {'status': 'retired', 'issue': 385}}
        (self.c.state / 'state.json').write_text(json.dumps(self.state))
        self.c.tick()
        self.assertFalse(self.path.exists(), 'pressure grace should recover a superseded verified checkout after one hour')
        self.assertTrue(Path(self.new['worktree']).exists())

    def test_reverified_issue_keeps_old_durable_device_retirement_route(self):
        self.c.env['HOME'] = str(self.c.base / 'isolated-home')
        gh = self.c.gh.read_text().replace("if item.get('terminal'): bodies.append({'id':1,'body':item['terminal']})",
            "bodies.extend({'id':i,'body':body} for i,body in enumerate(item.get('terminal_history',[])))")
        self.c.gh.write_text(gh)
        terminals = []
        for claim in (self.old, self.new):
            claim.update(terminal='verified', branch='same-reopened-branch')
            (self.c.state / 'claims' / claim['id'] / 'receipt.json').write_text(json.dumps(claim))
            terminals.append('<!-- fitsy-dispatch-terminal:v1 -->' + json.dumps({'issue':385,
                'claim_id':claim['id'], 'branch':claim['branch'], 'pr':389, 'head_sha':'a'*40,
                'merge_sha':'b'*40, 'verify_run':11, 'deploy_run':12, 'acceptance':'verified'}))
        item = fixture.item(385, status='Done')
        item.update(issue_state='CLOSED', **{'verified at':'2026-09-02T00:00:00Z'},
                    branch='same-reopened-branch', terminal=terminals[-1], terminal_history=terminals)
        self.c.set_board([item])
        for claim, device in ((self.old, 'fixture-old-device'), (self.new, 'fixture-new-device')):
            p = Path(claim['worktree']) / '.evidence/product-build'; p.mkdir(parents=True, exist_ok=True)
            (p / 'receipt.json').write_text(json.dumps({'simulator':device}))
        self.state['verified'] = {'385':self.new}
        self.state['simulator_retirement'] = {'fixture-new-device': {'status':'retired', 'issue':385}}
        (self.c.state / 'device-owner-uses.json').write_text(json.dumps({'version':1, 'devices':{
            'fixture-old-device':{'owner':'ended-fixture','last_owner_use':'2026-09-01T00:00:00Z',
                                  'released_at':'2026-09-01T00:01:00Z'}}}))
        (self.c.state / 'state.json').write_text(json.dumps(self.state))
        self.c.tick()
        result = self.c.state_data().get('simulator_retirement', {}).get('fixture-old-device')
        self.assertIsNotNone(result, 'overwriting latest verified identity must not orphan old durable device proof')
        self.assertEqual(result['status'], 'held')
        self.assertIn('identity invalid', result['reason'])
        self.assertTrue(self.path.exists(), 'malformed device identity stays protected')
        self.c.env['FAKE_BAD_CI'] = '1'
        self.c.tick()
        result = self.c.state_data()['simulator_retirement']['fixture-old-device']
        self.assertEqual(result['status'], 'held')
        self.assertIn('no longer terminal-verified', result['reason'])
        self.assertTrue(self.path.exists(), 'failed canonical main evidence still protects the older claim')

    def test_missing_mobile_build_receipt_retains_hot_device_proof(self):
        self.new['terminal'] = 'verified'
        (self.c.state / 'claims' / self.new['id'] / 'receipt.json').write_text(json.dumps(self.new))
        flow = Path(self.new['worktree']) / '.evidence/product-flow'; flow.mkdir(parents=True)
        (flow / 'report.json').write_text(json.dumps({'simulator': 'fixture-device'}))
        from cold_retention import recover
        config = json.loads(self.c.config.read_text())
        self.state['cold_retention'] = {self.old['id']: {'state': 'cold-retired'}}
        recover(config, self.state, lambda: None, 1900000000, lambda _: True)
        self.assertTrue(Path(self.new['worktree']).exists())
        record = self.state['cold_retention'][self.new['id']]
        self.assertEqual(record['state'], 'deferred')
        self.assertIn('device proof', record['reason'])
        self.assertIn('next_action', record)
        product = Path(self.new['worktree']) / '.evidence/product-build'; product.mkdir()
        for content in ('not json', '{}', '[]'):
            (product / 'receipt.json').write_text(content)
            recover(config, self.state, lambda: None, 1900000000, lambda _: True)
            self.assertTrue(Path(self.new['worktree']).exists())
        (product / 'receipt.json').write_text(json.dumps({'simulator': 'fixture-device'}))
        self.state['simulator_retirement'] = {'fixture-device': {'status': 'retired', 'issue': 385}}
        recover(config, self.state, lambda: None, 1900000000, lambda _: True)
        self.assertFalse(Path(self.new['worktree']).exists())

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

    def test_alias_form_pin_preserves_its_exact_hot_target(self):
        alias = self.c.base / 'retained-source-alias'; alias.symlink_to(self.path, target_is_directory=True)
        config = json.loads(self.c.config.read_text()); config['resource_pinned_checkouts'] = [str(alias)]
        self.c.config.write_text(json.dumps(config)); self.c.tick()
        self.assertTrue((self.path / 'unfinished.txt').is_file(), 'alias pin must retain the hot checkout')
        self.assertIn('pin', self.c.state_data()['cold_retention'][self.old['id']]['reason'])

    def test_malformed_old_receipt_does_not_stall_ready_dispatch(self):
        bad = self.c.state / 'claims' / 'unknown-legacy' / 'receipt.json'; bad.parent.mkdir(); bad.write_text('{broken')
        self.c.set_board([fixture.item(386)]); self.c.tick()
        self.assertIsNotNone(self.c.state_data()['active'], 'damaged legacy metadata must not stall unrelated ready work')
        self.assertTrue(self.path.exists(), 'unknown legacy ownership disables destructive recovery this tick')
        record = self.c.state_data()['cold_retention_legacy'][str(bad)]
        self.assertEqual(record['state'], 'deferred')
        self.assertEqual(bad.read_text(), '{broken', 'original failed receipt must remain unchanged')

    def test_nonobject_old_receipt_does_not_stall_ready_dispatch(self):
        bad = self.c.state / 'claims' / 'unknown-legacy' / 'receipt.json'; bad.parent.mkdir(); bad.write_text('[]')
        self.c.set_board([fixture.item(386)]); self.c.tick()
        self.assertIsNotNone(self.c.state_data()['active'])
        self.assertEqual(self.c.state_data()['active']['issue'], 386)
        self.assertTrue(self.path.exists())
        self.assertEqual(self.c.state_data()['cold_retention_legacy'][str(bad)]['state'], 'deferred')
        self.assertEqual(bad.read_text(), '[]')

    def test_invalid_owner_path_type_does_not_stall_ready_dispatch(self):
        bad = self.c.state / 'claims' / 'unknown-legacy' / 'receipt.json'; bad.parent.mkdir()
        raw = json.dumps({'worktree':['unknown-owner']}); bad.write_text(raw)
        self.c.set_board([fixture.item(386)]); self.c.tick()
        self.assertIsNotNone(self.c.state_data()['active'])
        self.assertEqual(self.c.state_data()['active']['issue'], 386)
        self.assertTrue(self.path.exists())
        self.assertEqual(self.c.state_data()['cold_retention_legacy'][str(bad)]['state'], 'deferred')
        self.assertEqual(bad.read_text(), raw)

    def test_reopened_completed_checkout_keeps_earlier_device_proof_hot(self):
        self.new['terminal'] = 'verified'
        (self.c.state / 'claims' / self.new['id'] / 'receipt.json').write_text(json.dumps(self.new))
        completed = Path(self.new['worktree'])
        proof = completed / '.evidence/product-build/receipt.json'; proof.parent.mkdir(parents=True)
        proof.write_text(json.dumps({'simulator':'earlier-accepted-device'}))
        (self.c.state / 'state.json').write_text(json.dumps(self.state)); self.c.set_board([fixture.item(385)])
        self.c.tick(); active = self.c.state_data()['active']
        self.assertNotEqual(Path(active['worktree']).resolve(), completed.resolve(), 'reopened verified source must not be reused and overwrite older device proof')
        self.assertEqual(json.loads(proof.read_text())['simulator'], 'earlier-accepted-device')
        self.assertEqual(fixture.run('git', 'rev-parse', 'HEAD', cwd=active['worktree']).stdout,
                         fixture.run('git', 'rev-parse', 'origin/main', cwd=self.c.repo).stdout)

    def test_reopened_completed_task_starts_main_while_old_proof_is_open(self):
        self.new['terminal'] = 'verified'
        (self.c.state / 'claims' / self.new['id'] / 'receipt.json').write_text(json.dumps(self.new))
        completed = Path(self.new['worktree'])
        proof = completed / '.evidence/accepted-proof.txt'; proof.parent.mkdir(parents=True)
        proof.write_text('retained accepted evidence')
        owner = subprocess.Popen([sys.executable, '-c',
            'import sys,time; f=open(sys.argv[1]); print("ready",flush=True); time.sleep(30)',
            str(proof)], stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(owner.stdout.readline().strip(), 'ready')
            config = json.loads(self.c.config.read_text()); config['lsof_bin'] = shutil.which('lsof')
            self.c.config.write_text(json.dumps(config))
            (self.c.state / 'state.json').write_text(json.dumps(self.state))
            self.c.set_board([fixture.item(385)]); self.c.tick()
            active = self.c.state_data()['active']
            self.assertIsNotNone(active, 'an unrelated reader of retained proof must not hold a new checkout')
            self.assertNotEqual(Path(active['worktree']).resolve(), completed.resolve())
            self.assertEqual(proof.read_text(), 'retained accepted evidence')
            self.assertEqual(fixture.run('git', 'rev-parse', 'HEAD', cwd=active['worktree']).stdout,
                             fixture.run('git', 'rev-parse', 'origin/main', cwd=self.c.repo).stdout)
        finally:
            owner.terminate(); owner.wait(); owner.stdout.close()

    def test_completed_noop_reopen_is_not_blocked_by_reused_worker_ids(self):
        self.new.update(pid=os.getpid(), launcher_pid=os.getpid(), worker_pgid=os.getpgrp(),
                        pid_started='obsolete-worker-identity', launcher_started='obsolete-launcher-identity')
        self.test_reopened_completed_task_starts_main_while_old_proof_is_open()

    def test_malformed_origin_claim_retains_receipt_and_admits_independent_work(self):
        damaged = {**self.old, 'worktree_origin_claim': []}
        receipt = self.c.state / 'claims' / self.old['id'] / 'receipt.json'
        raw = json.dumps(damaged); receipt.write_text(raw)
        self.c.set_board([fixture.item(386)]); self.c.tick()
        active = self.c.state_data()['active']
        self.assertIsNotNone(active, 'bad historical origin must not crash independent admission')
        self.assertEqual(active['issue'], 386)
        self.assertEqual(receipt.read_text(), raw)
        self.assertTrue(self.path.exists())
        self.assertEqual(self.c.state_data()['cold_retention_legacy'][str(receipt)]['state'], 'deferred')

    def rollover_uncertain_tick(self, issue):
        for claim in (self.old, self.new):
            (self.c.state / 'claims' / claim['id'] / 'receipt.json').write_text('{broken')
        self.state['history'] = []
        (self.c.state / 'state.json').write_text(json.dumps(self.state))
        self.c.set_board([fixture.item(issue)])
        self.c.tick()
        self.assertTrue((self.path / 'unfinished.txt').is_file())
        return self.c.state_data()['active']

    def test_older_valid_shared_checkout_receipt_cannot_hide_unreadable_successor(self):
        fixture.run('git', 'worktree', 'remove', self.new['worktree'], cwd=self.c.repo)
        successor = {**self.new, 'worktree': self.old['worktree'], 'branch': self.old['branch'],
                     'worktree_origin_claim': self.old['id'], 'terminal': 'verified'}
        receipt = self.c.state / 'claims' / self.new['id'] / 'receipt.json'
        receipt.write_text(json.dumps(successor))
        proof = self.path / '.evidence/accepted-proof.txt'
        proof.write_text('synthetic completed successor proof must not be reopened')
        receipt.write_text('{broken')
        self.state['history'] = []
        (self.c.state / 'state.json').write_text(json.dumps(self.state))
        self.c.set_board([fixture.item(385)])
        self.c.tick()
        self.assertIsNone(self.c.state_data()['active'],
                          'older valid same-path owner must not hide unreadable successor')
        self.assertEqual(proof.read_text(), 'synthetic completed successor proof must not be reopened')

    def test_rolled_out_unreadable_same_issue_owner_blocks_fresh_main_checkout(self):
        self.assertIsNone(self.rollover_uncertain_tick(385),
                          'unreadable retained same-issue ownership must not start from main')

    def test_rolled_out_unreadable_other_issue_owner_does_not_block_independent_work(self):
        active = self.rollover_uncertain_tick(386)
        self.assertIsNotNone(active, 'uncertain issue385 must not stall independent issue386')
        self.assertEqual(active['issue'], 386)

    def test_same_issue_compact_history_cannot_bypass_malformed_durable_origin(self):
        damaged = {**self.new, 'worktree_origin_claim': []}
        receipt = self.c.state / 'claims' / self.new['id'] / 'receipt.json'
        raw = json.dumps(damaged)
        receipt.write_text(raw)
        self.c.set_board([fixture.item(385)])
        self.c.tick()
        self.assertIsNone(self.c.state_data()['active'], 'history must not authorize reuse rejected by durable receipt validation')
        self.assertTrue(Path(self.new['worktree']).exists())
        self.assertEqual(receipt.read_text(), raw)

    def test_repeated_unchanged_recovery_deferrals_do_not_block_admission(self):
        config = json.loads(self.c.config.read_text())
        config['resource_pinned_checkouts'] = [str(self.path)]
        self.c.config.write_text(json.dumps(config))
        self.c.tick()  # Establish the real pinned ownership failure before compressing the unchanged retry clock.
        script = str(fixture.SCRIPT)
        code = f"""
import importlib.util, json, sys
from pathlib import Path
sys.path.insert(0, {str(Path(script).parent)!r})
import cold_retention as cold
spec=importlib.util.spec_from_file_location('retry_dispatcher', {script!r})
dispatcher=importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatcher)
config=json.loads(Path({str(self.c.config)!r}).read_text())
state=json.loads(Path({str(self.c.state / 'state.json')!r}).read_text())
claim=json.loads(Path({str(self.c.state / 'claims' / self.old['id'] / 'receipt.json')!r}).read_text())
def unchanged_pin(*args):
    raise RuntimeError('explicit retained source/app pin')
cold.guard=unchanged_pin
sys.setrecursionlimit(100)
for attempt in range(120):
    cold.retire(config, state, claim, lambda: dispatcher.write_json(Path({str(self.c.state / 'state.json')!r}), state))
"""
        result = subprocess.run([sys.executable, '-c', code], cwd=self.c.base, env=self.c.env,
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])
        self.c.set_board([fixture.item(386)])
        self.c.tick()
        self.assertEqual(self.c.state_data()['active']['issue'], 386)
        self.assertTrue((self.path / 'unfinished.txt').exists())
        record = self.c.state_data()['cold_retention'][self.old['id']]
        self.assertNotIn('previous_attempt', record)
        archive = Path(record['attempt_history'])
        rows = [json.loads(line) for line in archive.read_text().splitlines()]
        self.assertGreaterEqual(len(rows), 120)
        self.assertEqual(rows[0]['reason'], 'explicit retained source/app pin')

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

    def test_cold_recovery_retains_staged_version_separate_from_working_version(self):
        readme = self.path / 'README.md'
        readme.write_text('staged version\n')
        fixture.run('git', 'add', 'README.md', cwd=self.path)
        readme.write_text('latest working version\n')
        self.c.tick()
        record = self.c.state_data()['cold_retention'][self.old['id']]
        self.assertEqual(record['state'], 'cold-retired')
        restored = self.c.base / 'restore-staged-work'
        fixture.run('git', 'clone', record['archive']['bundle'], str(restored))
        fixture.run('git', 'checkout', record['archive']['source_head'], cwd=restored)
        patch = record['archive'].get('index_patch')
        if patch:
            fixture.run('git', 'apply', '--cached', patch, cwd=restored)
        with tarfile.open(record['archive']['path']) as archive:
            (restored / 'README.md').write_bytes(archive.extractfile('README.md').read())
        self.assertEqual(fixture.run('git', 'show', ':README.md', cwd=restored).stdout, 'staged version\n')
        self.assertEqual((restored / 'README.md').read_text(), 'latest working version\n')

    def test_legacy_absent_archive_without_staged_proof_stays_unreconciled(self):
        from cold_retention import recover
        from resource_lifecycle import resume_checkout
        self.new['terminal'] = 'verified'
        (self.c.state / 'claims' / self.new['id'] / 'receipt.json').write_text(json.dumps(self.new))
        source = Path(self.new['worktree']) / 'README.md'
        source.write_text('legacy staged version\n')
        fixture.run('git', 'add', 'README.md', cwd=source.parent)
        source.write_text('legacy working version\n')
        config = json.loads(self.c.config.read_text())
        self.state['cold_retention'] = {self.old['id']: {'state': 'cold-retired'}}
        recover(config, self.state, lambda: None, 1900000000, lambda _: True)
        record = self.state['cold_retention'][self.new['id']]
        self.assertFalse(source.parent.exists())
        # The previous archive format retained only HEAD and working files, not its independently staged version.
        Path(record['archive'].pop('index_patch')).unlink()
        record['archive'].pop('index_patch_sha256')
        with self.assertRaisesRegex(RuntimeError, 'recovery|staged'):
            resume_checkout(config, self.state, self.new['issue'])
        record['state'] = 'removal-intent'
        recover(config, self.state, lambda: None, 1900000000, lambda _: True)
        self.assertEqual(record['state'], 'removal-intent')
        self.assertIn('staged', record['reason'])

    def durable_archive_tick(self, fail_sync=False):
        # Run the actual idle dispatcher and refuse Git deletion until every recovery inode is synced.
        script = str(fixture.SCRIPT)
        code = f"""
import os, sys, runpy
from pathlib import Path
sys.path.insert(0, {str(Path(script).parent)!r})
import cold_retention as cold
synced = set()
original_sync, original_execute = os.fsync, cold.execute
failed_once = False
def sync(fd):
    global failed_once
    st = os.fstat(fd)
    synced.add((st.st_dev, st.st_ino))
    if {fail_sync!r} and not failed_once and list(Path({str(self.c.state / 'recovery')!r}).rglob('files.tar.gz')):
        failed_once = True
        raise OSError(5, 'fixture recovery sync failed')
    return original_sync(fd)
os.fsync = sync
def execute(args, **kwargs):
    if 'worktree' in args and 'remove' in args:
        recovery = Path({str(self.c.state / 'recovery')!r})
        required = list(recovery.rglob('files.tar.gz')) + list(recovery.rglob('manifest.json'))
        required += list(recovery.rglob('index.patch')) + list(recovery.rglob('*.bundle')) + list(recovery.rglob('*.gz'))
        for path in list(required):
            parent = path.parent
            while parent.is_relative_to(recovery):
                required.append(parent)
                parent = parent.parent
        for path in required:
            st = path.stat()
            if (st.st_dev, st.st_ino) not in synced:
                raise RuntimeError('recovery not durable before source deletion: ' + str(path))
    return original_execute(args, **kwargs)
cold.execute = execute
sys.argv = [{script!r}, 'tick', '--config', {str(self.c.config)!r}]
runpy.run_path({script!r}, run_name='__main__')
"""
        return fixture.run(sys.executable, '-c', code, cwd=self.c.base, env=self.c.env)

    def test_recovery_artifacts_and_directories_are_synced_before_actual_git_removal(self):
        large = self.path / '.evidence/product-build/Build/Products/Fitsy.app/large-binary'
        large.write_bytes(b'fixture-large-app' * (1024 * 1024))
        self.durable_archive_tick()
        self.assertEqual(self.c.state_data()['cold_retention'][self.old['id']]['state'], 'cold-retired')
        self.assertFalse(self.path.exists())

    def test_failed_recovery_sync_keeps_original_source_and_raw_proof(self):
        self.durable_archive_tick(fail_sync=True)
        self.assertTrue((self.path / 'unfinished.txt').exists())
        self.assertTrue((self.path / '.evidence/raw-review.txt').exists())
        self.assertEqual(self.c.state_data()['cold_retention'][self.old['id']]['state'], 'deferred')

    def limited_archive_tick(self, available=None):
        # Exercise the actual dispatcher against a kernel-enforced file quota, without filling the user's disk.
        script = str(fixture.SCRIPT)
        code = ("import resource,signal,runpy,sys;"
                "resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536));"
                "signal.signal(signal.SIGXFSZ,signal.SIG_IGN);"
                f"sys.path.insert(0,{str(Path(script).parent)!r});"
                f"sys.argv=[{script!r},'tick','--config',{str(self.c.config)!r}];"
                + (f"import shutil,collections;shutil.disk_usage=lambda p:collections.namedtuple('usage','total used free')(999999999,0,{available});" if available is not None else '')
                + f"runpy.run_path({script!r},run_name='__main__')")
        return fixture.run(sys.executable, '-c', code, cwd=self.c.base, env=self.c.env)

    def test_failed_archive_write_keeps_source_and_removes_partial_attempt(self):
        raw = self.path / '.evidence/incompressible.raw'
        raw.write_bytes(os.urandom(1024 * 1024))
        self.limited_archive_tick()
        self.assertTrue(raw.exists())
        self.assertEqual(self.c.state_data()['cold_retention'][self.old['id']]['state'], 'deferred')
        self.assertEqual(list((self.c.state / 'recovery' / self.old['id']).glob('*/files.tar.gz')), [])

    def test_failed_app_object_write_removes_only_unpublished_temporary_object(self):
        raw = self.path / '.evidence/product-build/Build/Products/Fitsy.app/large-binary'
        raw.write_bytes(os.urandom(9 * 1024 * 1024))
        self.limited_archive_tick()
        self.assertTrue(raw.exists())
        self.assertEqual(self.c.state_data()['cold_retention'][self.old['id']]['state'], 'deferred')
        self.assertEqual(list((self.c.state / 'recovery/file-objects').glob('*.tmp')), [])

    def test_insufficient_archive_capacity_defers_before_allocating_attempt(self):
        (self.path / '.evidence/incompressible.raw').write_bytes(os.urandom(2 * 1024 * 1024))
        self.limited_archive_tick(1024 * 1024)
        self.assertTrue(self.path.exists())
        record = self.c.state_data()['cold_retention'][self.old['id']]
        self.assertEqual(record['state'], 'deferred')
        self.assertIn('archive capacity needs', record['reason'])
        self.assertFalse((self.c.state / 'recovery' / self.old['id']).exists())

    def test_separately_registered_nested_checkout_keeps_parent_and_child(self):
        (self.path / '.gitignore').write_text('.evidence/\n')
        nested = self.path / '.evidence/repair-checkout'
        fixture.run('git', 'worktree', 'add', '-b', 'nested-repair', str(nested), 'main', cwd=self.c.repo)
        (nested / 'pending-repair.txt').write_text('unfinished child task must remain hot\n')
        self.c.tick()
        self.assertTrue(self.path.exists(), 'parent retirement must not remove a separate registered task')
        self.assertEqual((nested / 'pending-repair.txt').read_text(), 'unfinished child task must remain hot\n')
        record = self.c.state_data()['cold_retention'][self.old['id']]
        self.assertEqual(record['state'], 'deferred')
        self.assertIn('nested', record['reason'])
        self.assertIn(str(nested), fixture.run('git', 'worktree', 'list', '--porcelain', cwd=self.c.repo).stdout)

    def test_registered_consumer_outside_worker_root_keeps_donor(self):
        consumer = self.c.base / 'external-consumer'
        fixture.run('git', 'worktree', 'add', '-b', 'external-consumer', str(consumer), 'main', cwd=self.c.repo)
        (consumer / 'node_modules').symlink_to(self.path / 'node_modules')
        self.c.tick()
        self.assertTrue(self.path.exists(), 'registered external consumer cannot lose its donor')
        self.assertTrue((consumer / 'node_modules').exists())
        self.assertEqual(self.c.state_data()['cold_retention'][self.old['id']]['state'], 'deferred')

    def test_external_declared_alias_root_keeps_its_checkout_target(self):
        alias = self.c.base / 'external-reference-alias'
        alias.symlink_to(self.path, target_is_directory=True)
        config = json.loads(self.c.config.read_text()); config['resource_reference_roots'] = [str(alias)]
        self.c.config.write_text(json.dumps(config))
        self.c.tick()
        self.assertTrue(self.path.exists(), 'a declared external alias must not be resolved away before owner retirement')
        self.assertEqual((alias / 'unfinished.txt').read_text(), 'retained unfinished source\n')
        self.assertEqual(self.c.state_data()['cold_retention'][self.old['id']]['state'], 'deferred')

    def test_declared_root_below_external_alias_keeps_its_checkout_target(self):
        child = self.path / 'retained-source'; child.mkdir(); (child / 'data').write_text('source under alias')
        alias = self.c.base / 'external-reference-parent'; alias.symlink_to(self.path, target_is_directory=True)
        config = json.loads(self.c.config.read_text()); config['resource_reference_roots'] = [str(alias / 'retained-source')]
        self.c.config.write_text(json.dumps(config))
        self.c.tick()
        self.assertTrue(self.path.exists())
        self.assertEqual((alias / 'retained-source/data').read_text(), 'source under alias')

    def test_ambiguous_git_removal_keeps_intent_and_reconciles_reopened_work(self):
        from cold_retention import recover
        from resource_lifecycle import resume_checkout
        import shlex
        self.new['terminal'] = 'verified'
        (self.c.state / 'claims' / self.new['id'] / 'receipt.json').write_text(json.dumps(self.new))
        self.state['cold_retention'] = {self.old['id']: {'state': 'cold-retired'}}
        config = json.loads(self.c.config.read_text())
        real_git = config['git_bin']
        wrapper = self.c.base / 'git-removal-uncertainty'
        wrapper.write_text('#!/bin/bash\nreal=' + shlex.quote(real_git) +
                           '\nif [[ "$3" == worktree && "$4" == remove ]]; then "$real" "$@"; exit 17; fi\nexec "$real" "$@"\n')
        wrapper.chmod(0o700)
        config['git_bin'] = str(wrapper)
        recover(config, self.state, lambda: None, 1900000000, lambda _: True)
        self.assertFalse(Path(self.new['worktree']).exists())
        record = self.state['cold_retention'][self.new['id']]
        self.assertEqual(record['state'], 'removal-intent', 'ambiguous removal must retain reconciliation intent')
        recover(config, self.state, lambda: None, 1900000000, lambda _: True)
        self.assertEqual(record['state'], 'cold-retired')
        self.assertIn('reconciliation', record)
        self.assertNotIn('free_after', record, 'absence reconciliation is not measured reclamation')
        self.assertIsNone(resume_checkout(config, self.state, self.new['issue']))

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
