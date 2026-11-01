"""Keep recorded loop PRs moving through the existing owner's scheduling loop."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

from recovery import gating_failures, redact
from taskfiles import read_task
import worktrees

REPO = 'dgmolla/fitsy'
SWEEP_SECONDS = 180
REQUEST_SECONDS = 1


class OpenPRSweep:
    def __init__(self, directory, *, env, gate, merge_lock, log):
        self.directory = Path(directory)
        self.env, self.gate, self.merge_lock, self.log = env, gate, merge_lock, log
        self.next_run = 0
        self.last_request = None

    def pace(self):
        if self.last_request is not None:
            remaining = REQUEST_SECONDS - (time.monotonic() - self.last_request)
            if remaining > 0:
                time.sleep(remaining)
        self.last_request = time.monotonic()

    def gh(self, *args, parse=False):
        self.pace()
        result = subprocess.run(['gh', *args], env=self.env, capture_output=True, text=True,
                                timeout=30, check=True)
        return json.loads(result.stdout) if parse else result.stdout

    def tasks(self):
        return {path.stem: task for path in sorted((self.directory / 'tasks').glob('*.md'))
                if (task := read_task(path))}

    def legacy_creations(self):
        # The old driver logged this exact event only after `gh pr create`.
        # Adoption also stores state.pr, so that field alone is insufficient.
        try:
            with (self.directory / 'driver.log').open() as history:
                return {(match[1], int(match[2])) for line in history
                        if (match := re.fullmatch(
                            r'\d{2}:\d{2}:\d{2} (\S+) PR https://github\.com/dgmolla/fitsy/pull/([1-9]\d*)\s*', line))}
        except FileNotFoundError:
            return set()

    def open_prs(self):
        # Explicit pages keep both pagination and per-request pacing under our control.
        page = 1
        while True:
            prs = self.gh('api', f'repos/{REPO}/pulls?state=open&per_page=100&page={page}', parse=True)
            if not isinstance(prs, list):
                raise ValueError('Open PR response must be an array')
            yield from prs
            if len(prs) < 100:
                return
            page += 1

    def queue_rebase(self, pr, original, state):
        number, branch = pr['number'], pr['headRefName']
        origin_name, meta, prompt = original
        records = self.tasks()
        for name, (candidate, _) in records.items():
            if candidate['branch'] != branch and candidate.get('pr') != str(number):
                continue
            st = state.get(name, {})
            # A parked original may need its first conflict follow-up. A queued
            # original or any unfinished follow-up already owns that work.
            if not st.get('done') and (name != origin_name or not st.get('blocked')):
                return
        index = 1
        while (self.directory / 'tasks' / f'rebase-pr-{number}-{index}.md').exists():
            index += 1
        target = self.directory / 'tasks' / f'rebase-pr-{number}-{index}.md'
        text = (f'branch: {branch}\ntitle: Rebase PR #{number} onto main\n'
                f'lane: {meta.get("lane", "infra")}\nexisting: 1\npr: {number}\n'
                'reason: Open loop PR has conflicts with main.\n---\n'
                f'Resolve PR #{number} conflicts with origin/main on the existing branch.\n'
                'Preserve the branch commits and both changes; never recreate or reset the branch.\n'
                'Run affected tests and retain all existing review, CI and simulator merge gates.\n'
                f'Original task acceptance and context:\n{prompt}\n')
        # A scanner never observes partial frontmatter. Exclusive publication
        # also preserves a task concurrently queued by the existing host owner.
        with tempfile.NamedTemporaryFile(mode='w', dir=target.parent, suffix='.tmp', delete=False) as staged:
            staging = Path(staged.name)
            try:
                staged.write(text)
                staged.flush()
                os.fsync(staged.fileno())
                os.link(staging, target)
            finally:
                staging.unlink()
        self.log('OPEN-PR SWEEP queued', target.name, 'PR', number)

    @staticmethod
    def checks_pass(pr):
        rollup = pr.get('statusCheckRollup') or []
        if any(gating_failures({check.get('name') or check.get('context') or 'unknown':
                               (check.get('conclusion') or check.get('state') or '').upper()}, 'unknown')
               for check in rollup):
            return False
        for name in ('Verify', 'AI review'):
            checks = [check for check in rollup if (check.get('name') or check.get('context')) == name]
            if not checks or any(
                    (check.get('conclusion') or check.get('state') or '').upper() != 'SUCCESS' or
                    check.get('status', 'COMPLETED') != 'COMPLETED' for check in checks):
                return False
        return True

    def __call__(self, state, running=()):
        if time.monotonic() < self.next_run:
            return
        # Failures wait for the same cooldown; they cannot cause a hot retry loop.
        self.next_run = time.monotonic() + SWEEP_SECONDS
        try:
            records = self.tasks()
            created = self.legacy_creations()
            active = {records[name][0]['branch'] for name in running if name in records}
            origins = {}
            for name, (meta, prompt) in records.items():
                st = state.get(name, {})
                number = st.get('pr')
                # Prefixes and follow-up headers are not proof we opened a PR.
                # Require the original creation task plus its persisted PR link.
                if (isinstance(number, int) and not isinstance(number, bool) and number > 0 and
                        not meta.get('existing') and not meta.get('pr') and meta['branch'] not in active and
                        (st.get('opened_by_loop') is True or (name, number) in created)):
                    origins[(number, meta['branch'])] = (name, meta, prompt)
            if not origins:
                return
            for listed in self.open_prs():
                branch = listed.get('head', {}).get('ref')
                original = origins.get((listed.get('number'), branch))
                repo = listed.get('head', {}).get('repo') or {}
                if not original or repo.get('full_name') != REPO:
                    continue
                number = listed['number']
                try:
                    with worktrees.lease(self.directory, branch):
                        pr = self.gh('pr', 'view', str(number), '-R', REPO, '--json',
                                     'number,headRefName,headRefOid,isCrossRepository,isDraft,state,mergeStateStatus,statusCheckRollup',
                                     parse=True)
                        if (pr['number'] != number or pr['headRefName'] != branch or
                                pr['isCrossRepository'] or pr['isDraft'] or pr['state'] != 'OPEN'):
                            continue
                        status = pr['mergeStateStatus']
                        if status == 'BEHIND':
                            with self.merge_lock:
                                self.gh('pr', 'update-branch', str(number), '-R', REPO)
                            self.log('OPEN-PR SWEEP updated BEHIND PR', number)
                        elif status == 'DIRTY':
                            self.queue_rebase(pr, original, state)
                        elif status == 'CLEAN' and self.checks_pass(pr):
                            with self.merge_lock:
                                # Reuse the driver's trusted Sim scope/Simulator
                                # gate, and pin the merge to the checked head.
                                self.pace()
                                verdict, _ = self.gate(number, pr['headRefOid'])
                                if verdict == 'ok':
                                    self.gh('pr', 'merge', str(number), '-R', REPO, '--squash',
                                            '--match-head-commit', pr['headRefOid'])
                                    self.log('OPEN-PR SWEEP merged PR', number)
                except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
                    detail = getattr(error, 'stderr', None) or str(error)
                    self.log('OPEN-PR SWEEP PR', number, 'deferred:', redact(detail)[-800:])
        except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
            detail = getattr(error, 'stderr', None) or str(error)
            self.log('OPEN-PR SWEEP deferred:', redact(detail)[-800:])
