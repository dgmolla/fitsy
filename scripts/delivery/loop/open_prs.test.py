#!/usr/bin/env python3
"""Exercise the sweep against task files and an isolated GitHub CLI boundary."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import driver
import open_prs
from taskfiles import read_task


GH = '''
import json, os, sys
from pathlib import Path
p=Path(os.environ['SWEEP_SERVICE']); s=json.loads(p.read_text()); args=sys.argv[1:]
s['calls'].append(args); p.write_text(json.dumps(s))
if args[:1]==['api'] and '/pulls?' in args[1]:
    page=int(args[1].split('page=')[-1]); print(json.dumps(s['pages'][page-1]))
elif args[:2]==['pr','view']:
    if s.get('view_error')==int(args[2]): print('temporary GitHub error',file=sys.stderr); sys.exit(1)
    print(json.dumps(s['views'][args[2]]))
elif args[:1]==['api'] and '/statuses' in args[1]: print(json.dumps(s['statuses']))
elif args[:2] in (['pr','merge'],['pr','update-branch']):
    if s.get('mutation_error'): print('branch protection refused',file=sys.stderr); sys.exit(1)
else: print('unexpected gh call: '+repr(args),file=sys.stderr); sys.exit(2)
'''


class Clock:
    def __init__(self):
        self.now = 1000
        self.waits = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.waits.append(seconds)
        self.now += seconds


def check(name, result='SUCCESS', status='COMPLETED'):
    return {'name': name, 'conclusion': result, 'status': status}


class SweepTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='fitsy-open-prs-')
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        (self.root / 'tasks').mkdir()
        tools = self.root / 'bin'; tools.mkdir()
        gh = tools / 'gh'; gh.write_text('#!' + sys.executable + '\n' + GH); gh.chmod(0o700)
        self.service = self.root / 'service.json'
        self.service.write_text(json.dumps({'pages': [[]], 'views': {}, 'statuses': [
            {'context': 'Sim scope', 'state': 'success', 'description': 'scope=none'}], 'calls': []}))
        self.env = {**os.environ, 'PATH': str(tools) + ':' + os.environ['PATH'],
                    'SWEEP_SERVICE': str(self.service)}
        self.state = {}
        self.logs = []
        self.clock = Clock()
        self.install_requests = []
        clock = mock.patch.object(open_prs, 'time', self.clock)
        clock.start(); self.addCleanup(clock.stop)
        environment = mock.patch.object(driver, 'ENV', self.env)
        environment.start(); self.addCleanup(environment.stop)
        self.sweep = open_prs.OpenPRSweep(self.root, env=self.env, gate=driver.sim_gate,
                                         merge_lock=threading.Lock(), log=lambda *args: self.logs.append(args),
                                         on_merge=lambda: self.install_requests.append('merged'))

    def service_data(self):
        return json.loads(self.service.read_text())

    def change(self, **changes):
        self.service.write_text(json.dumps({**self.service_data(), **changes}))

    def task(self, name, branch, headers=''):
        path = self.root / 'tasks' / (name + '.md')
        path.write_text(f'branch: {branch}\ntitle: Preserve the task\nlane: pipeline\n{headers}---\nOriginal work.\n')
        return path

    def pr(self, number=700, status='BEHIND', *, loop=True, branch=None):
        branch = branch or f'codex/issue-{number}'
        task = f'task-{number}'
        if loop:
            self.task(task, branch)
            self.state[task] = {'pr': number, 'done': 1}
            with (self.root / 'driver.log').open('a') as history:
                history.write(f'12:00:00 {task} PR https://github.com/dgmolla/fitsy/pull/{number}\n')
        data = self.service_data()
        data['pages'][0].append({'number': number, 'head': {'ref': branch, 'repo': {'full_name': 'dgmolla/fitsy'}}})
        data['views'][str(number)] = {
            'number': number, 'headRefName': branch, 'headRefOid': 'a' * 40,
            'isCrossRepository': False, 'isDraft': False, 'state': 'OPEN',
            'mergeStateStatus': status, 'statusCheckRollup': [check('Verify'), check('AI review')]}
        self.change(**data)
        return task

    def mutations(self):
        return [args for args in self.service_data()['calls'] if args[:2] in
                (['pr', 'merge'], ['pr', 'update-branch'])]

    def queued(self):
        return [p for p in (self.root / 'tasks').glob('*.md') if 'existing' in read_task(p)[0]]

    def test_behind_updates_even_after_original_task_ended_and_never_merges_stale_checks(self):
        self.pr()
        self.sweep(self.state)
        self.assertEqual(self.mutations(), [['pr', 'update-branch', '700', '-R', 'dgmolla/fitsy']])
        self.assertEqual(self.queued(), [])

    def test_clean_squash_merges_exact_head_after_existing_simulator_gate(self):
        name = self.pr(status='CLEAN')
        self.state[name] = {'pr': 700, 'blocked': 'old simulator error'}
        self.sweep(self.state)
        self.assertEqual(self.mutations(), [['pr', 'merge', '700', '-R', 'dgmolla/fitsy',
                                            '--squash', '--match-head-commit', 'a' * 40]])
        self.assertTrue(any('/statuses' in args[1] for args in self.service_data()['calls'] if args[0] == 'api'))
        self.assertEqual(self.install_requests, ['merged'])

    def test_dirty_queues_one_existing_branch_task_and_inherits_lane(self):
        name = self.pr(status='DIRTY')
        self.state[name].pop('done')
        self.state[name]['blocked'] = 'old worker failure'
        unrelated = self.task('z-unrelated', 'fix/app-work')
        unrelated.write_text(unrelated.read_text().replace('lane: pipeline', 'lane: mobile'))
        self.sweep(self.state)
        self.clock.now += 180
        self.sweep(self.state)
        self.assertEqual(len(self.queued()), 1)
        meta, body = read_task(self.queued()[0])
        self.assertEqual({k: meta[k] for k in ('existing', 'pr', 'branch', 'lane')},
                         {'existing': '1', 'pr': '700', 'branch': 'codex/issue-700', 'lane': 'pipeline'})
        self.assertIn('origin/main', body)
        self.assertEqual(self.mutations(), [])

    def test_queued_or_blocked_followup_prevents_duplicate_even_with_a_different_name(self):
        for blocked in (False, True):
            with self.subTest(blocked=blocked):
                if not self.state: self.pr(status='DIRTY')
                self.task('manual-rebase', 'codex/issue-700', 'existing: 1\npr: 700\n')
                self.state['manual-rebase'] = {'blocked': 'needs attention'} if blocked else {}
                self.sweep(self.state)
                self.assertEqual(len(self.queued()), 1)
                self.clock.now += 180

    def test_later_conflict_can_queue_a_successor_without_resetting_finished_task_history(self):
        self.pr(status='DIRTY'); self.sweep(self.state)
        previous = self.queued()[0]
        self.state[previous.stem] = {'done': 1, 'attempts': ['retained']}
        self.clock.now += 180; self.sweep(self.state)
        self.assertEqual(len(self.queued()), 2)
        self.assertEqual(self.state[previous.stem], {'done': 1, 'attempts': ['retained']})

    def test_non_loop_prs_and_reused_or_adopted_branches_are_untouched(self):
        self.pr(701, 'CLEAN', loop=False)
        self.task('prefix-only', 'codex/issue-701')
        self.pr(702, 'BEHIND')
        self.state['task-702']['pr'] = 999
        self.pr(703, 'DIRTY')
        self.task('task-703', 'codex/issue-703', 'existing: 1\npr: 703\n')
        self.sweep(self.state)
        self.assertEqual(self.mutations(), [])
        self.assertFalse(any(args[:2] == ['pr', 'view'] for args in self.service_data()['calls']))

    def test_legacy_adoption_needs_creation_history_and_new_creation_records_work_without_logs(self):
        self.pr()
        (self.root / 'driver.log').unlink()
        self.sweep(self.state)
        self.assertEqual(self.service_data()['calls'], [])
        self.state['task-700']['opened_by_loop'] = True
        self.clock.now += 180; self.sweep(self.state)
        self.assertEqual(len(self.mutations()), 1)

    def test_active_branch_is_left_to_worker_and_queued_original_is_not_duplicated(self):
        name = self.pr(status='DIRTY')
        self.state[name].pop('done')
        self.sweep(self.state, running={name})
        self.assertEqual(self.service_data()['calls'], [])
        self.clock.now += 180; self.sweep(self.state)
        self.assertEqual(self.queued(), [])

    def test_branch_lease_prevents_competing_owner_from_mutating_pr(self):
        self.pr()
        # flock ownership is process scoped on the host; use another process as owner.
        script = "import sys; sys.path.insert(0,sys.argv[1]); import worktrees; "
        script += "\nwith worktrees.lease(sys.argv[2],sys.argv[3]):\n print('held',flush=True); input()"
        owner = subprocess.Popen([sys.executable, '-B', '-c', script, str(Path(__file__).parent),
                                  str(self.root), 'codex/issue-700'],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(owner.stdout.readline().strip(), 'held')
            self.sweep(self.state)
            self.assertEqual(self.mutations(), [])
        finally:
            owner.communicate('\n', timeout=3)

    def test_failed_pending_missing_or_duplicate_required_checks_cannot_merge(self):
        for rollup in ([check('Verify')], [check('Verify'), check('AI review', 'FAILURE')],
                       [check('Verify', status='IN_PROGRESS'), check('AI review')],
                       [check('Verify', 'FAILURE'), check('Verify'), check('AI review')],
                       [check('Verify'), check('AI review'), check('Other existing gate', 'FAILURE')]):
            with self.subTest(rollup=rollup):
                if not self.state: self.pr(status='CLEAN')
                data = self.service_data(); data['views']['700']['statusCheckRollup'] = rollup; self.change(**data)
                self.sweep(self.state); self.clock.now += 180
                self.assertEqual(self.mutations(), [])
                self.assertEqual(self.install_requests, [])

    def test_existing_simulator_gate_still_blocks_missing_scope_pending_failure_and_error(self):
        self.pr(status='CLEAN')
        for statuses in ([], [{'context': 'Sim scope', 'state': 'pending', 'description': 'scope=none'}],
                         *[[{'context': 'Sim scope', 'state': 'success', 'description': 'scope=flow'},
                            {'context': 'Simulator', 'state': value}] for value in ('pending', 'failure', 'error')]):
            with self.subTest(statuses=statuses):
                self.change(statuses=statuses); self.sweep(self.state); self.clock.now += 180
                self.assertEqual(self.mutations(), [])
        self.change(statuses=[{'context': 'Sim scope', 'state': 'success', 'description': 'scope=flow'},
                              {'context': 'Simulator', 'state': 'success'}])
        self.sweep(self.state); self.assertEqual(len(self.mutations()), 1)

    def test_skip_forks_drafts_closed_and_changed_branch(self):
        self.pr(status='CLEAN')
        baseline = self.service_data()['views']['700']
        for fields in ({'isDraft': True}, {'state': 'CLOSED'}, {'isCrossRepository': True},
                       {'headRefName': 'someone-elses-branch'}, {'mergeStateStatus': 'UNKNOWN'}):
            with self.subTest(fields=fields):
                self.change(views={'700': {**baseline, **fields}})
                self.sweep(self.state); self.clock.now += 180
                self.assertEqual(self.mutations(), [])
        data = self.service_data(); data['pages'][0][0]['head']['repo']['full_name'] = 'other/fitsy'
        self.change(**data); before = len(data['calls']); self.sweep(self.state)
        self.assertEqual(len(self.service_data()['calls']), before + 1)

    def test_pagination_finds_loop_pr_after_first_hundred_unrelated_prs(self):
        self.pr()
        data = self.service_data()
        data['pages'] = [[{'number': n, 'head': {'ref': f'manual-{n}', 'repo': {'full_name': 'dgmolla/fitsy'}}}
                          for n in range(100)], data['pages'][0]]
        self.change(**data); self.sweep(self.state)
        self.assertEqual(len(self.mutations()), 1)

    def test_sweep_and_each_github_call_are_rate_limited_and_failure_does_not_spin(self):
        self.pr(); self.sweep(self.state)
        before = self.service_data()['calls']
        self.sweep(self.state); self.clock.now += 100; self.sweep(self.state)
        self.assertEqual(self.service_data()['calls'], before)
        self.assertTrue(self.clock.waits)
        self.assertTrue(all(value >= 1 for value in self.clock.waits))
        self.clock.now += 180; self.change(mutation_error=True)
        self.sweep(self.state); before = self.service_data()['calls']; self.sweep(self.state)
        self.assertEqual(self.service_data()['calls'], before)
        self.assertTrue(any('refused' in str(row) for row in self.logs))

    def test_one_pr_failure_does_not_prevent_other_loop_pr_progress(self):
        self.pr(700); self.pr(701); self.change(view_error=700)
        self.sweep(self.state)
        self.assertEqual(self.mutations(), [['pr', 'update-branch', '701', '-R', 'dgmolla/fitsy']])


if __name__ == '__main__':
    unittest.main()
