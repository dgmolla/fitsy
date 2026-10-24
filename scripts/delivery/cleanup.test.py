#!/usr/bin/env python3
"""Real CLI/worktree regressions, with disposable Docker and simctl services."""
import importlib.util
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
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


if __name__ == '__main__':
    unittest.main()
