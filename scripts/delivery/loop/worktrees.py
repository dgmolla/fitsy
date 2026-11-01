"""Non-destructive branch preparation and terminal cleanup for the existing loop."""
from contextlib import contextmanager, nullcontext
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import threading
import host


MARKERS = {'.infra-blocked'}
_leases = threading.local()


def run(args, cwd, env, allowed=(0,)):
    # Worktree creation can run a candidate's post-checkout hook with host auth.
    # Reuse the installed owner's Git boundary for reads and mutations alike.
    boundary = host.git_environment(cwd, env) if args[0] == 'git' else nullcontext(env)
    with boundary as selected:
        result = subprocess.run(args, cwd=cwd, env=selected, capture_output=True, text=True,
                                errors='surrogateescape', timeout=120)
    if result.returncode not in allowed:
        raise RuntimeError(f'{args[:3]}: {(result.stderr or result.stdout)[-1500:]}')
    return result


@contextmanager
def lease(directory, branch):
    """Hold one logical branch across both lanes, including terminal cleanup."""
    held = getattr(_leases, 'held', set())
    key = (str(Path(directory).resolve()), branch)
    if key in held:
        yield
        return
    identity = hashlib.sha256(branch.encode()).hexdigest()
    with (Path(directory) / f'branch-{identity}.lock').open('a') as owner:
        try:
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError(f'Branch {branch} already has an active loop task') from None
        _leases.held = held
        held.add(key)
        try:
            yield
        finally:
            held.remove(key)


def registrations(repo, env):
    output = run(['git', 'worktree', 'list', '--porcelain', '-z'], repo, env).stdout
    return [dict(field.split(' ', 1) if ' ' in field else (field, '')
                 for field in entry.split('\0') if field)
            for entry in output.split('\0\0') if entry]


def removable(entry, directory, env):
    path = Path(entry['worktree'])
    # Branch names are not permission to delete another checkout or follow links.
    if (path.parent != Path(directory).resolve() or not path.name.startswith('wt-') or
            path.resolve() != path or not path.is_dir() or 'locked' in entry or
            Path.cwd().resolve().is_relative_to(path)):
        raise RuntimeError(f'Retain worktree {path}: not an unlocked loop-owned checkout')
    worker = run(['pgrep', '-f', r'codex exec .*-C ' + re.escape(str(path)) + r'( |$)'],
                 directory, env, allowed=(0, 1))
    if worker.returncode == 0:
        raise RuntimeError(f'Retain worktree {path}: active Codex worker')
    for operation in ('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer'):
        location = run(['git', 'rev-parse', '--path-format=absolute', '--git-path', operation], path, env).stdout.strip()
        if Path(location).exists():
            raise RuntimeError(f'Retain worktree {path}: unfinished Git operation {operation}')
    output = run(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'], path, env).stdout
    markers = []
    for record in filter(None, output.split('\0')):
        code, name = record[:2], record[3:]
        marker = path / name
        if code not in ('??', '!!') or name not in MARKERS:
            raise RuntimeError(f'Retain worktree {path}: uncommitted work {record!r}')
        metadata = marker.lstat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise RuntimeError(f'Retain worktree {path}: unsafe loop marker {name}')
        markers.append(marker)
    return markers


def cleanup(repo, directory, branch, env, log, keep=None):
    """Remove only clean holders, preserving branch refs and every real edit."""
    refs = {f'refs/heads/{branch}', f'refs/heads/loop/{branch}'}
    entries = [entry for entry in registrations(repo, env)
               if entry.get('branch') in refs and
               (keep is None or Path(entry['worktree']).resolve() != Path(keep).resolve())]
    # Inspect every holder before changing any of them.
    for entry in entries:
        removable(entry, directory, env)
    removed = []
    for entry in entries:
        path = entry['worktree']
        if entry not in registrations(repo, env):
            raise RuntimeError(f'Worktree registration changed before cleanup: {path}')
        for marker in removable(entry, directory, env):
            marker.unlink()
        # No force: Git independently refuses new dirty changes or locks.
        run(['git', 'worktree', 'remove', path], repo, env)
        removed.append(path)
        log('removed clean loop worktree', path, 'branch', entry['branch'])
    return removed


def prepare(repo, directory, wt, meta, env, log, merge, merge_main=True):
    """An origin branch, open PR or local branch can never enter a reset path."""
    branch = meta['branch']
    run(['git', 'check-ref-format', '--branch', branch], repo, env)
    run(['git', 'fetch', '-q', '--prune', 'origin'], repo, env)
    cleanup(repo, directory, branch, env, log, keep=wt)
    prs = json.loads(run(['gh', 'pr', 'list', '--repo', 'dgmolla/fitsy', '--head', branch,
                          '--state', 'open', '--json', 'number,headRefName,headRefOid,isCrossRepository'], repo, env).stdout)
    if not isinstance(prs, list):
        raise RuntimeError('Cannot establish open PR state')
    prs = [pr for pr in prs if pr['headRefName'] == branch and not pr['isCrossRepository']]
    if len(prs) > 1:
        raise RuntimeError(f'Multiple open PRs for {branch}; retain branch for owner reconciliation')
    remote = run(['git', 'show-ref', '--verify', '--quiet', f'refs/remotes/origin/{branch}'],
                 repo, env, allowed=(0, 1)).returncode == 0
    local = run(['git', 'show-ref', '--verify', '--quiet', f'refs/heads/{branch}'],
                repo, env, allowed=(0, 1)).returncode == 0
    legacy = run(['git', 'show-ref', '--verify', '--quiet', f'refs/heads/loop/{branch}'],
                 repo, env, allowed=(0, 1)).returncode == 0
    existing = remote or local or legacy or bool(prs) or bool(meta.get('existing')) or bool(meta.get('pr'))
    if prs:
        if meta.get('pr') and int(meta['pr']) != prs[0]['number']:
            raise RuntimeError(f'PR header disagrees with open PR for {branch}')
        meta['pr'] = str(prs[0]['number'])
        # Fetch the PR ref even if the origin head was deleted or hidden.
        run(['git', 'fetch', '-q', 'origin', f"refs/pull/{prs[0]['number']}/head"], repo, env)
        pr_head = run(['git', 'rev-parse', 'FETCH_HEAD'], repo, env).stdout.strip()
        if pr_head != prs[0]['headRefOid']:
            raise RuntimeError(f'PR head changed while preparing {branch}; retry discovery')
    else:
        pr_head = None
    if existing:
        meta['existing'] = 'true'
        log(branch, 'existing task: preserving branch', f'origin={remote}',
            f"open_pr={meta.get('pr', 'none')}", f'local={local}')
        if Path(wt).is_dir():
            current = run(['git', 'branch', '--show-current'], wt, env).stdout.strip()
            if current not in (branch, 'loop/' + branch):
                raise RuntimeError(f'Retain worktree {wt}: expected {branch}, found {current}')
            return
        source = f'origin/{branch}' if remote else pr_head
        if not local and not source and not legacy:
            raise RuntimeError(f'Existing branch {branch} has no recoverable origin or PR head')
        args = ['git', 'worktree', 'add', str(wt), branch] if local else [
            'git', 'worktree', 'add', '-b', branch, str(wt), 'loop/' + branch if legacy else source]
        run(args, repo, env)
        if legacy:
            merge(str(wt), 'loop/' + branch)
        if source:
            merge(str(wt), source)
        if pr_head and pr_head != source:
            merge(str(wt), pr_head)
        if merge_main:
            merge(str(wt), 'origin/main')
    else:
        if Path(wt).exists():
            raise RuntimeError(f'Retain existing path {wt}: it does not hold {branch}')
        run(['git', 'worktree', 'add', '-b', branch, str(wt), 'origin/main'], repo, env)
        log(branch, 'new task from origin/main')
