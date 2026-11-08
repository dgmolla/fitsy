#!/usr/bin/env python3
"""Real CLI/worktree regressions, with disposable Docker and simctl services."""
import importlib.util
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest import mock

SCRIPT = Path(__file__).with_name('cleanup.py')
TASK = 'fitsy-issue-123-abcdef01'
UDID = '9EC11FCA-B224-4380-A91D-235ED2BBF7C4'
CONTAINER = 'a' * 64
SERVICE = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
path = Path(os.environ['CLEANUP_SERVICE'])
state = json.loads(path.read_text())
args = sys.argv[1:]
state['calls'].append(args)
path.write_text(json.dumps(state))
if os.environ.get('SERVICE_FAIL'):
    raise SystemExit(2)
if 'info' in args:
    print(state['daemon'])
elif 'inspect' in args:
    if os.environ.get('CHANGE_RECORDS'):
        Path(os.environ['CHANGE_RECORDS']).write_text('[]')
    print(json.dumps(state['container']))
elif 'diff' in args:
    print(state.get('diff', ''))
elif 'devices' in args:
    devices = state['devices']
    if os.environ.get('REPLACE_DEVICE') and sum('devices' in call for call in state['calls']) > 1:
        devices[0]['name'] = 'Personal iPhone'
    print(json.dumps({'devices': {'runtime': devices}}))
elif 'rm' in args:
    assert args[-1] == state['container']['id']
    state['container'] = None
    path.write_text(json.dumps(state))
elif 'delete' in args:
    state['devices'] = [device for device in state['devices'] if device['udid'] != args[-1]]
    path.write_text(json.dumps(state))
else:
    raise SystemExit(3)
'''


class CleanupTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.home = self.root / 'home'; self.home.mkdir()
        self.repo = self.root / 'repo'; self.repo.mkdir()
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Fixture')
        self.git('config', 'user.email', 'fixture@example.test')
        (self.repo / '.gitignore').write_text('ignored\n.evidence/\n')
        (self.repo / 'source.txt').write_text('source\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'initial')
        self.head = self.git('rev-parse', 'HEAD')
        self.git('update-ref', 'refs/remotes/origin/main', self.head)
        self.worktree = self.root / TASK
        self.git('worktree', 'add', '-qb', 'codex/issue-123-abcdef01', str(self.worktree))
        self.records = self.root / 'records.json'
        self.service = self.root / 'service.json'
        self.inventory = {'daemon': 'fixture-daemon', 'calls': [], 'devices': [
            {'udid': UDID, 'name': 'Fitsy ' + TASK, 'state': 'Shutdown'}], 'container': {
                'id': CONTAINER, 'labels': {'com.fitsy.task': TASK, 'com.fitsy.shared': 'false',
                                          'com.fitsy.disposable': 'true'},
                'state': {'Status': 'exited', 'Running': False, 'FinishedAt': '2020-01-01T00:00:00Z'},
                'mounts': []}}
        self.device = self.home / 'Library/Developer/CoreSimulator/Devices' / UDID
        self.device.mkdir(parents=True)
        (self.device / 'device.plist').write_text('fixture')
        os.utime(self.device / 'device.plist', (1, 1))
        tools = self.root / 'bin'; tools.mkdir()
        for name in ('docker', 'xcrun'):
            executable = tools / name
            executable.write_text(SERVICE.replace('#!/usr/bin/env python3', '#!' + sys.executable))
            executable.chmod(0o700)
        lsof = tools / 'lsof'
        lsof.write_text('#!/bin/sh\nif [ -n "$OPEN_FILES" ]; then echo open; exit 0; fi\n'
                        'if [ -n "$LSOF_WARNING" ]; then echo uncertain >&2; fi\nexit 1\n')
        lsof.chmod(0o700)
        self.env = {**os.environ, 'HOME': str(self.home), 'CLEANUP_SERVICE': str(self.service),
                    'PATH': str(tools) + ':' + os.environ['PATH'], 'PYTHONDONTWRITEBYTECODE': '1'}

    def git(self, *args, cwd=None):
        return subprocess.check_output(['git', '-C', str(cwd or self.repo), *args],
                                       text=True, stderr=subprocess.PIPE).strip()

    def record(self, kind='worktree', **changes):
        return {'task': TASK, 'kind': kind, 'id': {'worktree': str(self.worktree),
                'container': CONTAINER, 'simulator': UDID}[kind], 'head': self.head,
                'inactive': True, 'shared': False, 'disposable': True, 'pids': [], 'dependencies': [],
                'last_used': time.time() - 18001, 'released_at': time.time() - 18000,
                'context': 'fixture', 'daemon': 'fixture-daemon', **changes}

    def cleanup(self, records, *args, **env):
        self.records.write_text(json.dumps(records)); self.records.chmod(0o600)
        self.service.write_text(json.dumps(self.inventory))
        result = subprocess.run([sys.executable, str(SCRIPT), str(self.records), '--repo', str(self.repo), *args],
                                env={**self.env, **env}, text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def test_default_and_explicit_dry_run_preserve_every_resource(self):
        records = [self.record(kind) for kind in ('worktree', 'container', 'simulator')]
        for args in ((), ('--dry-run',)):
            self.assertEqual([row['status'] for row in self.cleanup(records, *args)], ['would-delete'] * 3)
            self.assertTrue(self.worktree.is_dir())
            state = json.loads(self.service.read_text())
            self.assertEqual(len(state['devices']), 1)
            self.assertIsNotNone(state['container'])
            self.assertFalse(any('rm' in call or 'delete' in call for call in state['calls']))

    def test_apply_removes_only_clean_merged_recorded_worktree(self):
        self.assertEqual(self.cleanup([self.record()], '--apply')[0]['status'], 'deleted')
        self.assertFalse(self.worktree.exists())
        self.assertEqual((self.repo / 'source.txt').read_text(), 'source\n')
        self.assertNotIn(str(self.worktree), self.git('worktree', 'list', '--porcelain'))

    def test_active_shared_recent_unknown_and_needed_resources_survive(self):
        changes = [{'inactive': False}, {'shared': True}, {'shared': None}, {'disposable': False},
                   {'task': 'unknown'}, {'dependencies': ['unfinished-evidence']}, {'pids': [os.getpid()]},
                   {'pids': None}, {'last_used': None}, {'last_used': True}, {'last_used': float('nan')},
                   {'released_at': float('inf')}, {'last_used': time.time()}, {'released_at': time.time()},
                   {'released_at': time.time() + 100000}, {'head': 'unknown'}]
        for kind in ('worktree', 'container', 'simulator'):
            for change in changes:
                with self.subTest(kind=kind, change=change):
                    self.assertEqual(self.cleanup([self.record(kind, **change)], '--apply')[0]['status'], 'skipped')
        record = self.record(); del record['shared']
        self.assertEqual(self.cleanup([record, None, {}], '--apply')[0]['status'], 'skipped')
        self.assertTrue(self.worktree.is_dir())

    def test_dirty_untracked_ignored_and_evidence_files_survive(self):
        for name in ('source.txt', 'untracked.txt', 'ignored', '.evidence/needed.json'):
            with self.subTest(name=name):
                path = self.worktree / name; path.parent.mkdir(exist_ok=True)
                path.write_text('must survive')
                self.assertEqual(self.cleanup([self.record()], '--apply')[0]['status'], 'skipped')
                self.assertEqual(path.read_text(), 'must survive')
                if name == 'source.txt':
                    self.git('restore', name, cwd=self.worktree)
                else:
                    path.unlink()

    def test_unmerged_head_and_changed_branch_survive(self):
        self.git('checkout', '-qb', 'personal', cwd=self.worktree)
        self.assertEqual(self.cleanup([self.record()], '--apply')[0]['status'], 'skipped')
        self.git('checkout', '-q', 'codex/issue-123-abcdef01', cwd=self.worktree)
        (self.worktree / 'source.txt').write_text('unfinished\n')
        self.git('commit', '-qam', 'unmerged', cwd=self.worktree)
        head = self.git('rev-parse', 'HEAD', cwd=self.worktree)
        self.assertEqual(self.cleanup([self.record(head=head)], '--apply')[0]['status'], 'skipped')
        self.assertEqual((self.worktree / 'source.txt').read_text(), 'unfinished\n')

    def test_locked_symlinked_open_and_uncertain_worktrees_survive(self):
        self.git('worktree', 'lock', str(self.worktree))
        self.assertEqual(self.cleanup([self.record()], '--apply')[0]['status'], 'skipped')
        self.git('worktree', 'unlock', str(self.worktree))
        alias = self.root / 'alias'; alias.symlink_to(self.worktree, target_is_directory=True)
        self.assertEqual(self.cleanup([self.record(id=str(alias))], '--apply')[0]['status'], 'skipped')
        for env in ({'OPEN_FILES': '1'}, {'LSOF_WARNING': '1'}):
            self.assertEqual(self.cleanup([self.record()], '--apply', **env)[0]['status'], 'skipped')
        self.assertTrue(self.worktree.is_dir())

    def test_containers_require_exact_owner_daemon_stopped_state_and_no_writable_data(self):
        for key, value in (('Status', 'running'), ('Running', True), ('FinishedAt', 'unknown')):
            original = self.inventory['container']['state'][key]
            self.inventory['container']['state'][key] = value
            self.assertEqual(self.cleanup([self.record('container')], '--apply')[0]['status'], 'skipped')
            self.inventory['container']['state'][key] = original
        for key in ('com.fitsy.task', 'com.fitsy.shared', 'com.fitsy.disposable'):
            original = self.inventory['container']['labels'].pop(key)
            self.assertEqual(self.cleanup([self.record('container')], '--apply')[0]['status'], 'skipped')
            self.inventory['container']['labels'][key] = original
        self.inventory['diff'] = 'C /needed-file'
        self.assertEqual(self.cleanup([self.record('container')], '--apply')[0]['status'], 'skipped')
        self.inventory['diff'] = ''
        self.inventory['container']['mounts'] = [{'Name': 'shared-data'}]
        self.assertEqual(self.cleanup([self.record('container')], '--apply')[0]['status'], 'skipped')
        self.inventory['container']['mounts'] = []
        self.assertEqual(self.cleanup([self.record('container', daemon='replacement')], '--apply')[0]['status'], 'skipped')
        self.assertEqual(self.cleanup([self.record('container', daemon='')], '--apply')[0]['status'], 'skipped')
        self.assertEqual(self.cleanup([self.record('container')], '--apply')[0]['status'], 'deleted')
        self.assertIsNone(json.loads(self.service.read_text())['container'])

    def test_simulators_require_shutdown_exact_owner_no_claim_and_old_live_metadata(self):
        for key, value in (('state', 'Booted'), ('name', 'Personal iPhone')):
            original = self.inventory['devices'][0][key]
            self.inventory['devices'][0][key] = value
            self.assertEqual(self.cleanup([self.record('simulator')], '--apply')[0]['status'], 'skipped')
            self.inventory['devices'][0][key] = original
        claim = self.home / '.fitsy-sim-claim.json'; claim.write_text('unreadable owner')
        self.assertEqual(self.cleanup([self.record('simulator')], '--apply')[0]['status'], 'skipped')
        claim.unlink()
        os.utime(self.device / 'device.plist', None)
        self.assertEqual(self.cleanup([self.record('simulator')], '--apply')[0]['status'], 'skipped')
        os.utime(self.device / 'device.plist', (1, 1))
        self.assertEqual(self.cleanup([self.record('simulator')], '--apply', REPLACE_DEVICE='1')[0]['status'], 'skipped')
        self.assertEqual(self.cleanup([self.record('simulator')], '--apply')[0]['status'], 'deleted')
        self.assertEqual(json.loads(self.service.read_text())['devices'], [])

    def test_changed_records_and_failed_inventory_never_authorize_deletion(self):
        self.assertEqual(self.cleanup([self.record('container')], '--apply', CHANGE_RECORDS=str(self.records))[0]['status'], 'skipped')
        for kind in ('container', 'simulator'):
            self.assertEqual(self.cleanup([self.record(kind)], '--apply', SERVICE_FAIL='1')[0]['status'], 'skipped')

    def test_existing_dispatcher_owner_prevents_cleanup(self):
        state = self.home / '.fitsy-dispatcher/state.json'; state.parent.mkdir()
        state.write_text(json.dumps({'active': {'id': 'current-owner'}}))
        records = [self.record(kind) for kind in ('worktree', 'container', 'simulator')]
        self.assertEqual([row['status'] for row in self.cleanup(records, '--apply')], ['skipped'] * 3)
        self.assertTrue(self.worktree.is_dir())

    def test_configured_owner_lock_is_held_before_reading_cleanup_records(self):
        state = self.home / 'custom-state'; state.mkdir()
        self.records.write_text(json.dumps([self.record()])); self.records.chmod(0o600)
        with (state / 'dispatcher.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            child = subprocess.Popen([sys.executable, str(SCRIPT), str(self.records), '--repo', str(self.repo),
                                      '--state-dir', str(state), '--apply'], env=self.env,
                                     text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                time.sleep(0.1)
                self.assertIsNone(child.poll())
                (state / 'state.json').write_text(json.dumps({'active': {'id': 'new-owner'}}))
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)
                output, error = child.communicate(timeout=10)
        self.assertEqual(child.returncode, 0, error)
        self.assertEqual(json.loads(output)['status'], 'skipped')
        self.assertTrue(self.worktree.is_dir())

    def test_strict_four_hour_boundary(self):
        spec = importlib.util.spec_from_file_location('cleanup', SCRIPT)
        cleanup = importlib.util.module_from_spec(spec); spec.loader.exec_module(cleanup)
        with mock.patch('time.time', return_value=100000):
            for stamp in (85601, 85600, 0, -1, True, None, float('nan'), float('inf')):
                with self.subTest(stamp=stamp), self.assertRaises(ValueError):
                    cleanup.old(stamp)
            cleanup.old(85599)


class ApprovedAttachmentsTest(unittest.TestCase):
    def node_ms(self, path):
        child = subprocess.Popen(['node', '-e',
            'console.log(JSON.stringify(require("node:fs").statSync(process.argv[1]).mtimeMs))', str(path)],
            stdout=subprocess.PIPE, text=True)
        output, _ = child.communicate(timeout=10)
        self.assertEqual(child.returncode, 0)
        return json.loads(output)

    def setUp(self):
        spec = importlib.util.spec_from_file_location('cleanup', SCRIPT)
        self.cleanup = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.cleanup)
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.home = Path(temporary.name).resolve()
        self.evidence = self.home / 'fitsy-wt/issue-755-evidence/private/repair15'
        representatives = self.evidence / 'attachment-representatives'; representatives.mkdir(parents=True)
        (self.home / 'fitsy-refactor/loop').mkdir(parents=True)
        self.directory = self.home / 'Library/Developer/CoreSimulator/Devices' / self.cleanup.ATTACHMENT_DEVICE / \
            'data/Containers/Data/InternalDaemon' / self.cleanup.ATTACHMENT_CONTAINER / 'Attachments'
        self.directory.mkdir(parents=True)
        data = b'\x89PNG\r\n\x1a\nunique preserved pixels'
        digest = hashlib.sha256(data).hexdigest()
        representative = representatives / (digest + '.png'); representative.write_bytes(data)
        self.representative = representative
        self.selected = []
        for index in range(2):
            path = self.directory / f'00000000-0000-0000-0000-{index:012d}'; path.write_bytes(data)
            s = path.stat()
            self.selected.append({'path': str(path), 'device': s.st_dev, 'inode': s.st_ino,
                                  'bytes': len(data), 'modifiedMs': self.node_ms(path), 'video': False,
                                  'sha256': digest, 'retained': str(representative)})
        self.unique = self.directory / 'unselected'; self.unique.write_bytes(b'required unique evidence')
        self.args = SimpleNamespace(records=self.evidence / 'attachment-duplicate-proposal.json', repo=self.home,
                                    apply=False, dry_run_receipt=self.home / 'dry-run.json')
        self.proposal = {'owner': {'issue': 755, 'device': self.cleanup.ATTACHMENT_DEVICE},
                         'selectedFiles': 2, 'selectedBytes': 2 * len(data), 'selected': self.selected,
                         'retainedRepresentatives': [{'path': str(representative), 'sha256': digest, 'bytes': len(data)}],
                         'projection': {'conservativeNextFullGiB': 23, 'requiredFloorGiB': 8}}
        self.write_proposal()
        self.approval = {'id': int(self.cleanup.ATTACHMENT_APPROVAL), 'user': {'login': 'dgmolla'}, 'body': 'explicit fixture grant'}
        self.device = {'udid': self.cleanup.ATTACHMENT_DEVICE, 'name': self.cleanup.ATTACHMENT_DEVICE_NAME, 'state': 'Shutdown'}
        for target, value in [('ATTACHMENT_COUNT', 2), ('ATTACHMENT_BYTES', len(data) * 2),
                              ('ATTACHMENT_REPRESENTATIVES', 1), ('ATTACHMENT_RETAINED_BYTES', len(data)),
                              ('ATTACHMENT_APPROVAL_SHA', hashlib.sha256(self.approval['body'].encode()).hexdigest())]:
            patch = mock.patch.object(self.cleanup, target, value); patch.start(); self.addCleanup(patch.stop)
        self.opened = False; self.inventory_denied = False
        def external(*args):
            if args[0] == 'git': return 'a' * 40 if 'rev-parse' in args else ''
            if args[0] == 'gh': return json.dumps(self.approval)
            if args[0] == 'xcrun': return json.dumps({'devices': {'runtime': [self.device]}})
            raise AssertionError(args)
        for patch in [mock.patch.object(self.cleanup, 'run', side_effect=external),
                      mock.patch.object(self.cleanup.Path, 'home', return_value=self.home),
                      mock.patch.object(self.cleanup.shutil, 'disk_usage', return_value=SimpleNamespace(free=40 * 2**30)),
                      mock.patch.object(self.cleanup.subprocess, 'run', side_effect=lambda *a, **kw: SimpleNamespace(
                          returncode=0 if self.opened else 1, stdout='open' if self.opened else '',
                          stderr='denied' if self.inventory_denied else ''))]:
            patch.start(); self.addCleanup(patch.stop)

    def write_proposal(self):
        self.args.records.write_text(json.dumps(self.proposal)); self.args.records.chmod(0o600)
        self.cleanup.ATTACHMENT_PROPOSAL_SHA = hashlib.sha256(self.args.records.read_bytes()).hexdigest()

    def test_young_unmerged_exception_requires_dry_run_and_preserves_unique_bytes(self):
        self.args.apply = True
        with self.assertRaises(FileNotFoundError): self.cleanup.approved_attachments(self.args)
        self.args.apply = False
        receipt = self.cleanup.approved_attachments(self.args)
        self.assertEqual((receipt['status'], receipt['removed']), ('would-delete', 0))
        self.assertTrue(all(Path(row['path']).exists() for row in self.selected))
        self.args.dry_run_receipt.write_text(json.dumps(receipt)); self.args.apply = True
        result = self.cleanup.approved_attachments(self.args)
        self.assertEqual((result['removed'], result['missing'], result['changed']), (2, 2, 0))
        self.assertEqual(self.unique.read_bytes(), b'required unique evidence')
        self.assertTrue(self.representative.exists())
        self.assertFalse((self.home / '.fitsy-dispatcher').exists())

    def test_changed_or_unpreserved_duplicate_fails_before_any_removal(self):
        for mutation in ('replacement', 'hash', 'representative', 'symlink', 'path', 'manifest'):
            with self.subTest(mutation=mutation):
                path = Path(self.selected[-1]['path']); original = path.read_bytes(); stamp = path.stat()
                rep = self.representative.read_bytes()
                if mutation == 'replacement': path.unlink(); path.write_bytes(original)
                if mutation == 'hash': path.write_bytes(b'x' * len(original)); os.utime(path, ns=(stamp.st_atime_ns, stamp.st_mtime_ns))
                if mutation == 'representative': self.representative.write_bytes(b'bad')
                if mutation == 'symlink': path.unlink(); path.symlink_to(self.representative)
                if mutation == 'path': self.selected[-1]['path'] = str(self.unique); self.write_proposal()
                if mutation == 'manifest': self.args.records.write_text('{}')
                with self.assertRaises((ValueError, OSError, KeyError)): self.cleanup.approved_attachments(self.args)
                self.assertTrue(Path(self.selected[0]['path']).exists())
                self.representative.write_bytes(rep)
                if mutation == 'path': self.selected[-1]['path'] = str(path)
                if path.is_symlink(): path.unlink()
                path.write_bytes(original); s = path.stat()
                self.selected[-1].update(device=s.st_dev, inode=s.st_ino, modifiedMs=self.node_ms(path))
                self.write_proposal()

    def test_live_owner_writer_uncertain_inventory_and_changed_approval_are_rejected(self):
        for condition in ('claim', 'simple-lock', 'booted', 'owner', 'writer', 'inventory', 'approval'):
            with self.subTest(condition=condition):
                path = self.home / ('.fitsy-sim-claim.json' if condition == 'claim' else 'fitsy-wt/simulator.lock')
                if condition in ('claim', 'simple-lock'): path.write_text('live')
                if condition == 'booted': self.device['state'] = 'Booted'
                if condition == 'owner': self.device['name'] = 'User iPhone'
                if condition == 'writer': self.opened = True
                if condition == 'inventory': self.inventory_denied = True
                if condition == 'approval': self.approval['body'] = 'revoked'
                with self.assertRaises(ValueError): self.cleanup.approved_attachments(self.args)
                self.assertTrue(all(Path(row['path']).exists() for row in self.selected))
                if path.exists(): path.unlink()
                self.device.update(state='Shutdown', name=self.cleanup.ATTACHMENT_DEVICE_NAME)
                self.opened = self.inventory_denied = False
                self.approval['body'] = 'explicit fixture grant'

    def test_canonical_os_lock_blocks_cleanup_but_low_projection_remains_a_native_admission_boundary(self):
        with mock.patch.object(self.cleanup.fcntl, 'lockf', side_effect=BlockingIOError):
            with self.assertRaises(BlockingIOError): self.cleanup.approved_attachments(self.args)
        with mock.patch.object(self.cleanup.shutil, 'disk_usage', return_value=SimpleNamespace(free=20 * 2**30)):
            result = self.cleanup.approved_attachments(self.args)
            self.assertFalse(result['full_run_admitted'])
            self.assertLess(result['projected_remaining_bytes'], result['required_floor_bytes'])
        self.assertTrue(all(Path(row['path']).exists() for row in self.selected))

    def test_node_snapshot_timestamp_survives_python_stat_float_rounding(self):
        path = Path(self.selected[1]['path'])
        stamp = 1794099623907534782
        os.utime(path, ns=(stamp, stamp))
        node_ms = self.node_ms(path)
        self.assertNotEqual(path.stat().st_mtime * 1000, node_ms, 'fixture must exercise the actual cross-language boundary')
        self.selected[1]['modifiedMs'] = node_ms
        self.write_proposal()
        self.assertEqual(self.cleanup.approved_attachments(self.args)['status'], 'would-delete')
        self.assertTrue(path.exists())


if __name__ == '__main__':
    unittest.main()
