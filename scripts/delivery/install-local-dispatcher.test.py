#!/usr/bin/env python3
"""Disposable install and provider-switch checks; no real LaunchAgent is touched."""

import json
import fcntl
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest


INSTALLER = Path(__file__).with_name('install-local-dispatcher.sh')
RUNTIME = Path(__file__).with_name('local-dispatcher.py')


class InstallTest(unittest.TestCase):
    def test_paused_install_enable_and_claude_only_reinstall(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            home, repo, tools, roots = (base / name for name in ('home', 'repo', 'bin', 'worktrees'))
            for path in (home / 'Desktop', home / 'firstmate/config', home / '.fitsy-delivery',
                         repo / 'scripts/delivery', tools, roots):
                path.mkdir(parents=True, exist_ok=True)
            shutil.copy2(INSTALLER, repo / 'scripts/delivery/install-local-dispatcher.sh')
            shutil.copy2(RUNTIME, repo / 'scripts/delivery/local-dispatcher.py')
            (home / 'firstmate/config/slack-notifications.json').write_text(json.dumps({
                'channel': 'CCHANNEL', 'user': 'UHUMAN', 'bridge_path': str(base / 'bridge')}))
            (home / '.fitsy-delivery/config.json').write_text(json.dumps({
                'channel': 'CCHANNEL', 'user': 'USENDER', 'bridge_path': str(base / 'bridge')}))
            gh = tools / 'gh'
            gh.write_text('#!/bin/sh\nif [ "$1" = api ]; then git rev-parse HEAD; '
                          'else sha=$(git rev-parse HEAD); printf \'[{"workflowName":"Verify","headSha":"%s","status":"completed","conclusion":"success"},{"workflowName":"Deploy","headSha":"%s","status":"completed","conclusion":"success"}]\\n\' "$sha" "$sha"; fi\n')
            for name in ('gh', 'codex', 'launchctl'):
                path = tools / name
                if name == 'launchctl':
                    path.write_text('#!/bin/sh\nif [ "$1" = print ] && [ "${FAKE_LAUNCH_LOADED:-0}" != 1 ]; '
                                    'then exit 1; fi\nexit 0\n')
                elif name != 'gh': path.write_text('#!/bin/sh\nexit 0\n')
                path.chmod(0o700)
            env = {**os.environ, 'HOME': str(home), 'PATH': f'{tools}:/usr/bin:/bin',
                   'FITSY_DISPATCH_HOME': str(home / '.fitsy-dispatcher')}
            def command(*args):
                result = subprocess.run(args, cwd=repo, env=env, text=True, capture_output=True,
                                        timeout=15)
                if result.returncode:
                    self.fail(f'{args[0]} failed: {result.stderr[-400:]}')
                return result.stdout
            command('git', 'init', '-b', 'main')
            command('git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
                    'add', 'scripts/delivery')
            command('git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test',
                    'commit', '-m', 'fixture')
            installed = command('bash', 'scripts/delivery/install-local-dispatcher.sh', '--install',
                                '--worktree-root', str(roots))
            self.assertIn('installed_paused', installed)
            config_path = home / '.fitsy-dispatcher/config.json'
            config = json.loads(config_path.read_text())
            self.assertFalse(config['enabled'])
            self.assertFalse(config['jev_enabled'])
            self.assertIsNone(config['jev_key_file'])
            self.assertEqual(config['worker_timeout_seconds'], 90 * 60)
            self.assertEqual(config['slack']['recipient'], 'UHUMAN')
            self.assertFalse((home / '.fitsy-dispatcher/credentials/jev.env').exists())
            (home / 'Desktop/secrets.env').write_text('jev=fixture-only-not-a-real-key\n')
            config['jev_enabled'] = True
            config_path.write_text(json.dumps(config))
            command('bash', 'scripts/delivery/install-local-dispatcher.sh', '--install',
                    '--worktree-root', str(roots))
            opt_in = json.loads(config_path.read_text())
            self.assertTrue(opt_in['jev_enabled'])
            self.assertEqual((home / '.fitsy-dispatcher/credentials/jev.env').stat().st_mode & 0o077, 0)
            opt_in['jev_enabled'] = False
            config_path.write_text(json.dumps(opt_in))
            command('bash', 'scripts/delivery/install-local-dispatcher.sh', '--install',
                    '--worktree-root', str(roots))
            self.assertFalse(json.loads(config_path.read_text())['jev_enabled'])
            command('bash', 'scripts/delivery/install-local-dispatcher.sh', '--enable')
            self.assertTrue(json.loads(config_path.read_text())['enabled'])
            claude = tools / 'claude'; claude.write_text('#!/bin/sh\nexit 0\n'); claude.chmod(0o700)
            for profile in config['profiles'].values():
                profile.update({'provider': 'claude', 'model': 'fixture-claude', 'executable': str(claude)})
            config_path.write_text(json.dumps(config))
            (tools / 'codex').unlink()
            command('bash', 'scripts/delivery/install-local-dispatcher.sh', '--install',
                    '--worktree-root', str(roots))
            reinstalled = json.loads(config_path.read_text())
            self.assertFalse(reinstalled['enabled'])
            self.assertEqual(reinstalled['profiles']['standard']['provider'], 'claude')
            lock = (home / '.fitsy-dispatcher/dispatcher.lock').open('a')
            try:
                fcntl.flock(lock, fcntl.LOCK_EX)
                pending = subprocess.Popen(['bash', 'scripts/delivery/install-local-dispatcher.sh', '--uninstall'],
                                           cwd=repo, env=env, text=True, stdout=subprocess.PIPE,
                                           stderr=subprocess.PIPE)
                time.sleep(0.2)
                self.assertIsNone(pending.poll(), 'uninstall bypassed dispatcher lock')
                (home / '.fitsy-dispatcher/state.json').write_text(json.dumps({'active': {'id': 'claim'}}))
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)
                lock.close()
            _, error = pending.communicate(timeout=5)
            self.assertNotEqual(pending.returncode, 0)
            self.assertIn('active claim', error)
            self.assertTrue((home / 'Library/LaunchAgents/com.fitsy.local-dispatcher.plist').exists())
            (home / '.fitsy-dispatcher/state.json').write_text(json.dumps({'active': None}))
            env['FAKE_LAUNCH_LOADED'] = '1'
            retained = subprocess.run(['bash', 'scripts/delivery/install-local-dispatcher.sh', '--uninstall'],
                                      cwd=repo, env=env, text=True, capture_output=True, timeout=5)
            self.assertNotEqual(retained.returncode, 0)
            self.assertTrue((home / 'Library/LaunchAgents/com.fitsy.local-dispatcher.plist').exists())
            env.pop('FAKE_LAUNCH_LOADED')
            command('bash', 'scripts/delivery/install-local-dispatcher.sh', '--uninstall')
            self.assertFalse((home / 'Library/LaunchAgents/com.fitsy.local-dispatcher.plist').exists())


if __name__ == '__main__':
    unittest.main()
