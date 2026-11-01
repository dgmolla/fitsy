"""Real Git remote/worktree journeys; only GitHub and worker discovery are faked."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

SOURCE = Path(__file__).parent
sys.path.insert(0, str(SOURCE))
import driver
import install
import worktrees
from recovery import park


class WorktreesTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='fitsy-loop-guard-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.repo = self.root / 'wt3'
        self.loop = self.root / 'loop'; self.loop.mkdir()
        self.remote = self.root / 'origin.git'
        subprocess.run(['git', 'init', '--bare', '-q', str(self.remote)], check=True)
        subprocess.run(['git', 'init', '-q', '-b', 'main', str(self.repo)], check=True)
        self.git(self.repo, 'config', 'user.name', 'Fixture')
        self.git(self.repo, 'config', 'user.email', 'fixture@example.test')
        (self.repo / 'main.txt').write_text('main\n')
        self.commit(self.repo, 'baseline')
        self.git(self.repo, 'remote', 'add', 'origin', str(self.remote))
        self.git(self.repo, 'push', '-q', 'origin', 'main')
        self.branch = 'fix/followup'
        self.target = self.loop / 'wt-new'
        self.old = self.loop / 'wt-old task'
        self.service = self.root / 'services.json'
        self.service.write_text(json.dumps({'prs': [], 'calls': [], 'worker': 1}))
        tools = self.root / 'bin'; tools.mkdir()
        for name in ('gh', 'pgrep'):
            path = tools / name
            path.write_text('#!' + sys.executable + '\n' + '''
import json, os, sys
from pathlib import Path
p=Path(os.environ['GUARD_SERVICES']); s=json.loads(p.read_text())
name=Path(sys.argv[0]).name
s['calls'].append([name,*sys.argv[1:]]); p.write_text(json.dumps(s))
if name=='pgrep': sys.exit(s['worker'])
if s.get('gh_error'): print('GitHub unavailable',file=sys.stderr); sys.exit(1)
print(json.dumps(s['prs']))
''')
            path.chmod(0o700)
        self.env = {**os.environ, 'PATH': str(tools) + ':' + os.environ['PATH'],
                    'GUARD_SERVICES': str(self.service)}
        self.logs = []

    def git(self, path, *args):
        return subprocess.check_output(['git', '-C', str(path), *args], text=True, stderr=subprocess.PIPE).strip()

    def commit(self, path, message):
        self.git(path, 'add', '-A'); self.git(path, 'commit', '-qm', message)
        return self.git(path, 'rev-parse', 'HEAD')

    def services(self, **updates):
        state = json.loads(self.service.read_text()); state.update(updates)
        self.service.write_text(json.dumps(state))
        return state

    def branch_worktree(self, push=True, pr=True):
        self.git(self.repo, 'worktree', 'add', '-qb', self.branch, str(self.old), 'main')
        (self.old / 'pr.txt').write_text('Preserve open PR work\n')
        head = self.commit(self.old, 'open PR work')
        if push:
            self.git(self.old, 'push', '-q', 'origin', self.branch)
        if pr:
            self.git(self.old, 'push', '-q', 'origin', 'HEAD:refs/pull/684/head')
            self.services(prs=[{'number': 684, 'headRefName': self.branch,
                                'headRefOid': head, 'isCrossRepository': False}])
        return head

    def prepare(self, meta=None):
        meta = meta if meta is not None else {'branch': self.branch}
        worktrees.prepare(self.repo, self.loop, self.target, meta, self.env,
                          lambda *args: self.logs.append(args),
                          lambda path, ref: self.git(path, 'merge', '-q', '--no-edit', ref))
        return meta

    def cleanup(self):
        return worktrees.cleanup(self.repo, self.loop, self.branch, self.env,
                                 lambda *args: self.logs.append(args))

    def test_missing_headers_adopts_open_pr_removes_stale_marker_and_merges_main(self):
        head = self.branch_worktree()
        (self.old / '.infra-blocked').write_text('stale loop diagnosis')
        (self.repo / 'new-main.txt').write_text('main advanced\n')
        main = self.commit(self.repo, 'advance main'); self.git(self.repo, 'push', '-q', 'origin', 'main')
        meta = self.prepare()
        self.assertEqual(meta, {'branch': self.branch, 'existing': 'true', 'pr': '684'})
        self.assertFalse(self.old.exists())
        self.assertEqual((self.target / 'pr.txt').read_text(), 'Preserve open PR work\n')
        self.assertTrue((self.target / 'new-main.txt').is_file())
        self.git(self.target, 'merge-base', '--is-ancestor', head, 'HEAD')
        self.git(self.target, 'merge-base', '--is-ancestor', main, 'HEAD')
        self.assertEqual(self.git(self.repo, 'ls-remote', 'origin', f'refs/heads/{self.branch}').split()[0], head)
        self.assertIn('existing task: preserving branch', str(self.logs))

    def test_remote_branch_without_pr_is_existing(self):
        head = self.branch_worktree(pr=False)
        meta = self.prepare()
        self.assertEqual(meta['existing'], 'true')
        self.assertNotIn('pr', meta)
        self.assertEqual(self.git(self.target, 'rev-parse', 'HEAD'), head)

    def test_open_pr_without_origin_head_recovers_pull_ref(self):
        head = self.branch_worktree(push=False)
        self.git(self.repo, 'worktree', 'remove', str(self.old))
        self.git(self.repo, 'branch', '-D', self.branch)
        meta = self.prepare()
        self.assertEqual(meta['pr'], '684')
        self.assertEqual(self.git(self.target, 'rev-parse', 'HEAD'), head)

    def test_new_branch_starts_at_origin_main(self):
        meta = self.prepare()
        self.assertNotIn('existing', meta)
        self.assertEqual(self.git(self.target, 'rev-parse', 'HEAD'), self.git(self.repo, 'rev-parse', 'origin/main'))
        self.assertEqual(self.git(self.target, 'branch', '--show-current'), self.branch)

    def test_local_only_unpublished_branch_is_preserved(self):
        head = self.branch_worktree(push=False, pr=False)
        self.prepare()
        self.assertEqual(self.git(self.target, 'rev-parse', 'HEAD'), head)

    def test_divergent_local_and_remote_commits_both_survive(self):
        head = self.branch_worktree()
        (self.old / 'local.txt').write_text('unpublished\n')
        local = self.commit(self.old, 'local-only change')
        self.git(self.repo, 'worktree', 'add', '--detach', str(self.root / 'remote-edit'), head)
        edit = self.root / 'remote-edit'
        (edit / 'remote.txt').write_text('published by another owner\n')
        remote = self.commit(edit, 'remote change')
        self.git(edit, 'push', '-q', 'origin', f'HEAD:{self.branch}', 'HEAD:refs/pull/684/head')
        self.services(prs=[{'number': 684, 'headRefName': self.branch,
                            'headRefOid': remote, 'isCrossRepository': False}])
        self.prepare()
        for commit in (local, remote):
            self.git(self.target, 'merge-base', '--is-ancestor', commit, 'HEAD')
        self.assertTrue((self.target / 'local.txt').is_file())
        self.assertTrue((self.target / 'remote.txt').is_file())

    def test_unavailable_github_stops_without_creating_or_resetting_branch(self):
        self.services(gh_error=True)
        with self.assertRaisesRegex(RuntimeError, 'GitHub unavailable'):
            self.prepare()
        self.assertFalse(self.target.exists())
        self.assertEqual(self.git(self.repo, 'branch', '--list', self.branch), '')

    def test_pr_head_race_and_conflicting_header_stop_without_reset(self):
        head = self.branch_worktree()
        for changes, meta, reason in (({'headRefOid': '0' * 40}, {}, 'head changed'),
                                       ({}, {'pr': '123'}, 'header disagrees')):
            with self.subTest(reason=reason):
                self.services(prs=[{'number': 684, 'headRefName': self.branch,
                                    'headRefOid': head, 'isCrossRepository': False, **changes}])
                with self.assertRaisesRegex(RuntimeError, reason):
                    self.prepare({'branch': self.branch, **meta})
                self.assertEqual(self.git(self.repo, 'rev-parse', self.branch), head)
                self.assertFalse(self.target.exists())

    def test_real_edits_untracked_and_ignored_data_stop_cleanup(self):
        self.branch_worktree()
        for name, staged in (('pr.txt', False), ('new \nfile.txt', False), ('new.txt', True), ('.env.local', False)):
            with self.subTest(name=name):
                path = self.old / name
                if name == '.env.local':
                    exclude = Path(self.git(self.old, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'))
                    exclude.write_text('.env.local\n')
                original = path.read_bytes() if path.exists() else None
                path.write_text('unfinished work')
                if staged:
                    self.git(self.old, 'add', name)
                with self.assertRaisesRegex(RuntimeError, 'uncommitted work'):
                    self.prepare()
                self.assertEqual(path.read_text(), 'unfinished work')
                self.assertFalse(self.target.exists())
                if staged:
                    self.git(self.old, 'restore', '--staged', name)
                if original is None: path.unlink()
                else: path.write_bytes(original)

    def test_marker_is_narrow_and_never_authorizes_a_directory_or_link(self):
        self.branch_worktree()
        marker = self.old / '.infra-blocked'
        private = self.root / 'private.txt'; private.write_text('keep')
        for kind in ('directory', 'symlink', 'hardlink'):
            with self.subTest(kind=kind):
                if kind == 'directory': marker.mkdir(); (marker / 'work.txt').write_text('keep')
                elif kind == 'symlink': marker.symlink_to(private)
                else: os.link(private, marker)
                with self.assertRaises(RuntimeError): self.cleanup()
                self.assertTrue(self.old.exists())
                if kind == 'directory': (marker / 'work.txt').unlink(); marker.rmdir()
                else: marker.unlink()
        self.assertEqual(private.read_text(), 'keep')

    def test_active_locked_and_foreign_worktrees_are_retained(self):
        self.branch_worktree()
        self.services(worker=0)
        with self.assertRaisesRegex(RuntimeError, 'active Codex'): self.cleanup()
        self.services(worker=2)
        with self.assertRaises(RuntimeError): self.cleanup()
        self.services(worker=1)
        self.git(self.repo, 'worktree', 'lock', str(self.old))
        with self.assertRaisesRegex(RuntimeError, 'unlocked loop-owned'): self.cleanup()
        self.git(self.repo, 'worktree', 'unlock', str(self.old))
        self.git(self.repo, 'worktree', 'move', str(self.old), str(self.root / 'user-checkout'))
        with self.assertRaisesRegex(RuntimeError, 'loop-owned'): self.prepare()
        self.assertTrue((self.root / 'user-checkout/pr.txt').exists())

    def test_unfinished_merge_is_retained(self):
        self.branch_worktree()
        merge_head = Path(self.git(self.old, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD'))
        merge_head.write_text(self.git(self.repo, 'rev-parse', 'main') + '\n')
        with self.assertRaisesRegex(RuntimeError, 'unfinished Git operation'): self.cleanup()
        self.assertTrue(self.old.exists())

    def test_legacy_loop_alias_is_removed_without_moving_its_ref(self):
        head = self.branch_worktree()
        self.git(self.old, 'branch', '-m', 'loop/' + self.branch)
        (self.old / 'unpublished.txt').write_text('legacy local work\n')
        legacy = self.commit(self.old, 'legacy unpublished change')
        self.prepare()
        self.assertFalse(self.old.exists())
        self.assertEqual(self.git(self.repo, 'rev-parse', 'loop/' + self.branch), legacy)
        self.assertEqual(self.git(self.target, 'rev-parse', 'HEAD'), legacy)
        self.git(self.target, 'merge-base', '--is-ancestor', head, 'HEAD')

    def test_branch_lease_is_exclusive_but_other_lane_can_run(self):
        def claim(branch):
            with worktrees.lease(self.loop, branch): return True
        with worktrees.lease(self.loop, self.branch):
            with worktrees.lease(self.loop, self.branch): pass  # Preparation reenters its owner.
            with ThreadPoolExecutor(max_workers=1) as pool:
                with self.assertRaisesRegex(RuntimeError, 'active loop task'):
                    pool.submit(claim, self.branch).result()
                self.assertTrue(pool.submit(claim, 'data/independent').result())
        with worktrees.lease(self.loop, self.branch): pass

    def test_cleanup_preflights_all_holders_before_removing_any(self):
        self.branch_worktree()
        other = self.loop / 'wt-duplicate'
        self.git(self.repo, 'worktree', 'add', '--force', str(other), self.branch)
        (other / 'unfinished.txt').write_text('keep')
        with self.assertRaisesRegex(RuntimeError, 'uncommitted work'): self.cleanup()
        self.assertTrue(self.old.exists())
        self.assertTrue(other.exists())

    def test_new_edits_during_removal_are_protected_by_git(self):
        self.branch_worktree()
        original = worktrees.run
        def changed(args, *rest, **kwargs):
            if args[:3] == ['git', 'worktree', 'remove']:
                (self.old / 'new-edit.txt').write_text('edit after inspection')
            return original(args, *rest, **kwargs)
        with mock.patch.object(worktrees, 'run', side_effect=changed):
            with self.assertRaises(RuntimeError): self.cleanup()
        self.assertEqual((self.old / 'new-edit.txt').read_text(), 'edit after inspection')

    def test_worktree_checkout_cannot_run_candidate_hooks_with_host_credentials(self):
        self.branch_worktree()
        sentinel = self.root / 'candidate-hook-ran'
        hook = self.old / '.githooks/post-checkout'; hook.parent.mkdir()
        hook.write_text('#!/bin/sh\ntouch "' + str(sentinel) + '"\n')
        hook.chmod(0o700)
        head = self.commit(self.old, 'candidate checkout hook')
        self.git(self.old, 'push', '-q', 'origin', self.branch, 'HEAD:refs/pull/684/head')
        self.git(self.repo, 'config', 'core.hooksPath', '.githooks')
        self.services(prs=[{'number': 684, 'headRefName': self.branch,
                            'headRefOid': head, 'isCrossRepository': False}])
        self.prepare()
        self.assertTrue((self.target / '.githooks/post-checkout').exists())
        self.assertFalse(sentinel.exists())

    def test_driver_cleans_each_terminal_outcome_then_accepts_followup(self):
        tasks = self.loop / 'tasks'; tasks.mkdir()
        task = tasks / 'new.md'; task.write_text(f'branch: {self.branch}\ntitle: Followup\n---\nContinue work\n')
        for outcome in ('merged', 'already-merged', 'blocked', 'error'):
            with self.subTest(outcome=outcome):
                self.prepare()
                (self.target / '.infra-blocked').write_text('terminal marker')
                state = {'new': {}}
                def finish(*args):
                    state['new']['done' if 'merged' in outcome else 'blocked'] = outcome
                    if outcome == 'error': raise RuntimeError('worker failed')
                    return 'blocked' if outcome == 'blocked' else None
                with mock.patch.multiple(driver, ROOT=str(self.root), L=str(self.loop), ENV=self.env), mock.patch.object(driver, 'run_task', side_effect=finish):
                    if outcome == 'error':
                        with self.assertRaisesRegex(RuntimeError, 'worker failed'): driver.execute_task(str(task), state)
                    else: driver.execute_task(str(task), state)
                self.assertFalse(self.target.exists())
                self.assertTrue(state['new']['checkout_removed'])
                self.assertEqual(len([entry for entry in worktrees.registrations(self.repo, self.env)
                                      if entry.get('branch') == 'refs/heads/' + self.branch]), 0)

    def test_driver_reports_dirty_terminal_checkout_without_deleting_it(self):
        self.prepare()
        (self.target / 'main.txt').write_text('unfinished')
        task = self.loop / 'new.md'; task.write_text(f'branch: {self.branch}\ntitle: Followup\n---\nContinue\n')
        state = {'new': {}}
        with mock.patch.multiple(driver, ROOT=str(self.root), L=str(self.loop), ENV=self.env), mock.patch.object(driver, 'run_task', return_value='blocked'):
            with self.assertRaisesRegex(RuntimeError, 'uncommitted work'): driver.execute_task(str(task), state)
        self.assertEqual((self.target / 'main.txt').read_text(), 'unfinished')
        self.assertIn('uncommitted work', state['new']['cleanup_error'])
        self.assertIn('STOPPED worktree cleanup', (self.loop / 'driver.log').read_text())

    def test_installed_compatibility_driver_consumes_frozen_helper_and_terminal_hook(self):
        self.branch_worktree()
        (self.loop / 'tasks').mkdir()
        (self.loop / 'driver.py').write_text('# legacy driver\n')
        (self.loop / 'state.json').write_text(json.dumps({'_planner_off': True}))
        task = self.loop / 'tasks/new.md'
        task.write_text(f'branch: {self.branch}\ntitle: Followup\n---\nContinue\n')
        with mock.patch.object(install, 'running_legacy_owner', return_value=False):
            receipt = install.install(self.loop, apply=True)
        self.assertEqual((Path(receipt['version']) / 'worktrees.py').read_bytes(), (SOURCE / 'worktrees.py').read_bytes())
        # A candidate's same-named module cannot replace the reviewed host helper.
        hostile = self.repo / 'scripts/delivery/loop/worktrees.py'
        hostile.parent.mkdir(parents=True)
        hostile.write_text('raise RuntimeError("candidate helper executed")\n')
        code = '''
import json, os, runpy, sys
from pathlib import Path
loaded=runpy.run_path(sys.argv[1],run_name='fixture')
loaded['prepare_task'].__globals__['ENV']=dict(os.environ)
meta={'branch':'fix/followup'}
loaded['prepare_task'](sys.argv[2],meta)
def finish(f,state):
    state.setdefault('new',{})['done']=True; loaded['save'](state)
    Path(loaded['L'],'STOP').touch()
loaded['execute_task'].__globals__['run_task']=finish
loaded['main'](idle_seconds=0.005,active_seconds=0.005)
print(json.dumps({'meta':meta,'state':loaded['state'](),'helper':loaded['worktrees'].__file__}))
'''
        result = subprocess.run([sys.executable, '-B', '-c', code, str(self.loop / 'driver.py'),
                                 str(self.target), str(task)], env={**self.env, 'FITSY_LOOP_ROOT': str(self.root)},
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output['meta']['pr'], '684')
        self.assertTrue(output['state']['new']['checkout_removed'])
        self.assertEqual(Path(output['helper']).parent, Path(receipt['version']))
        self.assertFalse(self.old.exists())
        self.assertFalse(self.target.exists())
        self.assertIn('STOPPED stop file:', (self.loop / 'driver.log').read_text())

    def test_clean_blocked_checkout_is_recreated_before_current_head_retriage(self):
        head = self.branch_worktree()
        self.prepare()
        tasks = self.loop / 'tasks'; tasks.mkdir()
        task = tasks / 'new.md'; task.write_text(f'branch: {self.branch}\ntitle: Followup\n---\nContinue\n')
        state = {'new': {'pr': 684}}
        old = {'api_status': 503, 'sim_state': 'error'}
        current = {'head': head, 'api_status': 200, 'sim_state': 'error', 'main': head}
        def stopped(*args):
            park(state['new'], 'API unavailable', old, 'env:api-config', head, now=1)
            state['new']['blocked_evidence'] = old
            return 'blocked'
        with mock.patch.multiple(driver, ROOT=str(self.root), L=str(self.loop), ENV=self.env):
            with mock.patch.object(driver, 'run_task', side_effect=stopped):
                driver.execute_task(str(task), state)
            self.assertFalse(self.target.exists())
            with mock.patch.object(driver, 'checks', return_value=({'headRefOid': head}, {})), \
                    mock.patch.object(driver, 'evidence', return_value=current), \
                    mock.patch.object(driver, 'notify_park'), \
                    mock.patch.object(driver.context, 'host_replay', return_value={'status': 'pass', 'head': head, 'source': 'fixture'}):
                driver.retriage([str(task)], state)
        self.assertTrue(self.target.exists())
        self.assertEqual(self.git(self.target, 'rev-parse', 'HEAD'), head)
        self.assertNotIn('blocked', state['new'])
        self.assertNotIn('checkout_removed', state['new'])


if __name__ == '__main__':
    unittest.main()
