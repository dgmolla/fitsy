#!/usr/bin/env python3
"""On-demand cleanup of explicitly recorded disposable task resources; dry-run by default."""
import argparse
from contextlib import ExitStack
from datetime import datetime
import fcntl
import json
import math
import os
from pathlib import Path
import re
import subprocess
import time


def run(*argv):
    return subprocess.check_output(argv, text=True, stderr=subprocess.PIPE, timeout=30).strip()


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def old(stamp):
    require(type(stamp) in (int, float) and math.isfinite(stamp)
            and 0 < stamp < time.time() - 14400, 'unknown or recent use/release')


def unopened(path):
    require(path.is_absolute() and path == path.resolve() and path.is_dir(), 'uncertain resource path')
    result = subprocess.run(['lsof', '-nP', '+D', str(path)], capture_output=True, text=True, timeout=30)
    require(result.returncode == 1 and not result.stdout and not result.stderr, 'open files or unavailable inventory')
    return (path.stat().st_dev, path.stat().st_ino)


def action(record, repo, state_dir):
    state = state_dir / 'state.json'
    require(not state.exists() or json.loads(state.read_text()).get('active', 'unknown') is None,
            'dispatcher owner active or uncertain')
    task, kind, identity = record['task'], record['kind'], record['id']
    require(re.fullmatch(r'fitsy-issue-[1-9][0-9]*-[0-9a-f]{8}', task), 'unknown task owner')
    require(record['inactive'] is True and record['shared'] is False and record['disposable'] is True
            and record['dependencies'] == [] and isinstance(record['pids'], list), 'active, shared or needed resource')
    old(record['last_used']); old(record['released_at'])
    require(record['last_used'] <= record['released_at'], 'use after release')
    for pid in record['pids']:
        require(type(pid) is int and pid > 0, 'unknown process identity')
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            continue
        raise ValueError('owner process remains live')
    require(re.fullmatch(r'[0-9a-f]{40}', record['head']), 'unknown source')
    run('git', '-C', str(repo), 'merge-base', '--is-ancestor', record['head'], 'origin/main')
    if kind == 'worktree':
        path = Path(identity)
        require(path.name == task and path.resolve() != repo.resolve(), 'unknown checkout owner')
        entries = run('git', '-C', str(repo), 'worktree', 'list', '--porcelain').split('\n\n')
        entry = next(item for item in entries if item.splitlines()[0] == 'worktree ' + identity)
        require(not any(line.startswith(('locked', 'prunable')) for line in entry.splitlines()), 'locked checkout')
        require(run('git', '-C', identity, 'rev-parse', 'HEAD') == record['head'], 'source changed')
        issue, suffix = task.removeprefix('fitsy-issue-').rsplit('-', 1)
        require(run('git', '-C', identity, 'branch', '--show-current') == f'codex/issue-{issue}-{suffix}', 'branch changed')
        require(not run('git', '-C', identity, 'status', '--porcelain', '--untracked-files=all', '--ignored'), 'dirty checkout or retained files')
        return ['git', '-C', str(repo), 'worktree', 'remove', identity], unopened(path)
    if kind == 'container':
        require(re.fullmatch(r'[0-9a-f]{64}', identity), 'unknown container identity')
        require(isinstance(record['context'], str) and record['context'] and isinstance(record['daemon'], str) and record['daemon'], 'unknown Docker owner')
        docker = ['docker', '--context', record['context']]
        require(run(*docker, 'info', '--format', '{{.ID}}') == record['daemon'], 'Docker daemon changed')
        template = '{"id":{{json .Id}},"labels":{{json .Config.Labels}},"state":{{json .State}},"mounts":{{json .Mounts}}}'
        current = json.loads(run(*docker, 'container', 'inspect', '--format', template, identity))
        labels, state = current['labels'], current['state']
        require(current['id'] == identity and labels.get('com.fitsy.task') == task
                and labels.get('com.fitsy.shared') == 'false' and labels.get('com.fitsy.disposable') == 'true'
                and state['Status'] == 'exited' and state['Running'] is False
                and current['mounts'] == [], 'active, shared or uncertain container')
        old(datetime.fromisoformat(state['FinishedAt'].replace('Z', '+00:00')).timestamp())
        require(not run(*docker, 'container', 'diff', identity), 'container has retained writable files')
        return [*docker, 'container', 'rm', identity], current
    require(kind == 'simulator' and re.fullmatch(r'[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}', identity), 'unknown resource kind/identity')
    require(not (Path.home() / '.fitsy-sim-claim.json').exists(), 'simulator owner claim present')
    devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', '--json'))['devices']
    device = next(d for group in devices.values() for d in group if d['udid'] == identity)
    require(device['name'] == 'Fitsy ' + task and device['state'] == 'Shutdown', 'active or shared simulator')
    path = Path.home() / 'Library/Developer/CoreSimulator/Devices' / identity
    old((path / 'device.plist').stat().st_mtime)  # A veto, never the ownership/last-use authority.
    return ['xcrun', 'simctl', 'delete', identity], unopened(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('records', type=Path, help='private JSON list of exact ownership/use records')
    parser.add_argument('--repo', type=Path, default=Path.cwd())
    parser.add_argument('--state-dir', type=Path, default=Path.home() / '.fitsy-dispatcher')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--dry-run', action='store_true', help='report only (default)')
    mode.add_argument('--apply', action='store_true', help='remove eligible exact resources')
    args = parser.parse_args()
    with ExitStack() as stack:
        for path in (args.state_dir / 'dispatcher.lock', Path.home() / '.fitsy-sim-claim.lock'):
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            lock = stack.enter_context(path.open('a'))
            fcntl.flock(lock, fcntl.LOCK_EX)
        require(args.records.resolve() == args.records.absolute(), 'symlinked ownership records')
        require(args.records.stat().st_uid == os.getuid() and not args.records.stat().st_mode & 0o077, 'records must be private')
        original = args.records.read_bytes()
        records = json.loads(original)
        require(isinstance(records, list), 'records must be a list')
        for record in records:
            try:
                command, identity = action(record, args.repo, args.state_dir)
                require(args.records.read_bytes() == original, 'ownership records changed')
                if args.apply:
                    require(action(record, args.repo, args.state_dir) == (command, identity), 'resource identity changed')
                    run(*command)
                print(json.dumps({'id': record['id'], 'status': 'deleted' if args.apply else 'would-delete'}))
            except (OSError, ValueError, KeyError, TypeError, AttributeError, OverflowError, StopIteration, subprocess.SubprocessError) as error:
                print(json.dumps({'id': record.get('id') if isinstance(record, dict) else None,
                                  'status': 'skipped', 'reason': str(error)}))


if __name__ == '__main__':
    main()
