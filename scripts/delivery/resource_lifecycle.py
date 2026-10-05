"""Owned scratch release and source-preserving checkout reuse under dispatcher.lock."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


SCRATCH = ('Intermediates.noindex', 'ModuleCache.noindex', 'CompilationCache.noindex', 'SDKStatCaches.noindex')


def execute(args, timeout=30):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def owned_checkout(config, claim):
    identity = claim.get('worktree_origin_claim', claim.get('id', ''))
    if not re.fullmatch(r'[0-9a-f-]{36}', identity) or not isinstance(claim.get('issue'), int):
        raise RuntimeError('missing creation claim identity')
    root = Path(config['worktree_root']).resolve()
    expected = root / f"fitsy-issue-{claim['issue']}-{identity[:8]}"
    path = Path(claim.get('worktree', ''))
    if path.is_symlink() or not path.is_dir() or path.resolve() != expected:
        raise RuntimeError('checkout ownership path mismatch')
    registered = execute([config['git_bin'], '-C', config['repo_root'], 'worktree', 'list', '--porcelain'])
    if registered.returncode or f'worktree {expected}\n' not in registered.stdout:
        raise RuntimeError('checkout is not registered')
    branch = execute([config['git_bin'], '-C', str(path), 'branch', '--show-current'])
    if branch.returncode or branch.stdout.strip() != claim.get('branch'):
        raise RuntimeError('checkout branch changed')
    return path.resolve()


def released(config, claim, paths):
    if not claim.get('finished_at') or not claim.get('terminal'):
        raise RuntimeError('claim has not released execution')
    receipt_path = Path(config['state_dir']) / 'claims' / claim['id'] / 'receipt.json'
    receipt = json.loads(receipt_path.read_text())
    fields = ('id', 'issue', 'terminal', 'finished_at', 'worktree', 'branch', 'pid', 'launcher_pid', 'worker_pgid')
    if any(receipt.get(key) != claim.get(key) for key in fields):
        raise RuntimeError('terminal receipt changed')
    for key in ('pid', 'launcher_pid'):
        if claim.get(key) and execute(['ps', '-p', str(claim[key]), '-o', 'command=']).returncode == 0:
            raise RuntimeError('claim process remains live or PID was reused')
    if claim.get('worker_pgid'):
        groups = execute(['ps', '-eo', 'pgid='])
        if groups.returncode or str(claim['worker_pgid']) in groups.stdout.split():
            raise RuntimeError('released worker group still exists')
    lsof = config.get('lsof_bin') or shutil.which('lsof')
    if not lsof:
        raise RuntimeError('open-file ownership tool unavailable')
    for path in paths:
        opened = execute([lsof, '-nP', '+D', str(path)])
        if opened.returncode != 1 or opened.stdout or opened.stderr:
            raise RuntimeError('open files or uncertain file ownership')


def source_identity(config, path):
    head = execute([config['git_bin'], '-C', str(path), 'rev-parse', 'HEAD'])
    status = execute([config['git_bin'], '-C', str(path), 'status', '--porcelain', '-z'])
    diff = execute([config['git_bin'], '-C', str(path), 'diff', 'HEAD', '--binary'])
    if head.returncode or status.returncode or diff.returncode:
        raise RuntimeError('source identity unavailable')
    # Untracked source is retained in place; bind its content as well as tracked edits.
    untracked = execute([config['git_bin'], '-C', str(path), 'ls-files', '--others', '--exclude-standard', '-z'])
    if untracked.returncode:
        raise RuntimeError('untracked identity unavailable')
    digest = hashlib.sha256((status.stdout + diff.stdout).encode())
    for name in sorted(filter(None, untracked.stdout.split('\0'))):
        file = path / name
        digest.update(name.encode())
        if file.is_symlink():
            digest.update(os.readlink(file).encode())
        elif file.is_file():
            with file.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(block)
        else:
            raise RuntimeError('source changed during identity check')
    return {'head': head.stdout.strip(), 'working_sha256': digest.hexdigest()}


def resume_checkout(config, state, issue):
    candidates = [entry for entry in state.get('history', []) if entry.get('issue') == issue
                  and entry.get('worktree') and entry.get('terminal') and entry.get('finished_at')]
    # Compact in-memory history is not the durable ownership record.
    for receipt_path in (Path(config['state_dir']) / 'claims').glob('*/receipt.json'):
        entry = json.loads(receipt_path.read_text())
        if entry.get('issue') == issue and entry.get('worktree') and entry.get('terminal') and entry.get('finished_at'):
            if receipt_path.parent.name != entry.get('id'):
                raise RuntimeError('durable claim receipt identity mismatch')
            candidates.append(entry)
    previous = max(candidates, key=lambda entry: entry.get('finished_at') or '', default=None)
    if not previous:
        return None
    path = owned_checkout(config, previous)
    receipt_path = Path(config['state_dir']) / 'claims' / previous['id'] / 'receipt.json'
    receipt = json.loads(receipt_path.read_text())
    if any(receipt.get(key) != previous.get(key) for key in ('id', 'issue', 'terminal', 'finished_at', 'worktree', 'branch')):
        raise RuntimeError('terminal receipt changed')
    released(config, previous, [path])
    before = source_identity(config, path)
    owned_checkout(config, previous)
    if source_identity(config, path) != before:
        raise RuntimeError('resume source changed during ownership check')
    return {'worktree': str(path), 'branch': previous['branch'],
            'worktree_origin_claim': previous.get('worktree_origin_claim', previous['id']),
            'resumed_from_claim': previous['id'], 'resume_source': before}


def owned_scratch(path, entry):
    if not entry.is_absolute() or not entry.is_relative_to(path) or entry.is_symlink():
        return False
    if not ((entry.is_relative_to(path / '.evidence') and entry.name in SCRATCH) or
            entry == path / 'apps/api/.next/cache'):
        return False
    if any(parent.suffix == '.app' or parent.name == 'Products' for parent in entry.parents):
        return False
    return not any(parent.is_symlink() for parent in entry.parents
                   if parent != path and parent.is_relative_to(path))


def safe_scratch(path):
    candidates = [entry for name in SCRATCH for entry in (path / '.evidence').glob(f'**/{name}')]
    candidates += [path / 'apps/api/.next/cache']
    owned = set(entry for entry in candidates if entry.is_dir() and owned_scratch(path, entry))
    return sorted(entry for entry in owned if not any(parent in owned for parent in entry.parents))


def cleanup_released(config, state, save):
    """Assess one ended claim per tick, preserving original claim and failure receipts."""
    if state.get('active'):
        return
    assessed = state.setdefault('resource_releases', {})
    previous = next((entry for entry in reversed(state.get('history', []))
                     if entry.get('finished_at') and entry.get('terminal') and entry.get('worktree')
                     and (entry.get('id') not in assessed or assessed[entry['id']].get('removal_intent'))), None)
    if not previous:
        return
    result = dict(assessed.get(previous['id']) or
                  {'issue': previous['issue'], 'claim': previous['id'], 'removed': []})
    try:
        path = owned_checkout(config, previous)
        intent = Path(result['removal_intent']) if result.get('removal_intent') else None
        if intent:
            if not owned_scratch(path, intent):
                raise RuntimeError('persisted scratch intent is not owned')
            released(config, previous, [intent] if intent.exists() else [path])
            if not intent.exists():
                # Absence reconciles uncertainty, not a newly measured deletion or reclaimed-byte claim.
                result.setdefault('reconciled_absent', []).append(str(intent))
                result.pop('removal_intent')
                assessed[previous['id']] = result
                save()
        candidates = safe_scratch(path)
        released(config, previous, candidates)
        result.setdefault('free_before', shutil.disk_usage(path).free)
        for candidate in candidates:
            owned_checkout(config, previous)
            released(config, previous, [candidate])
            if candidate not in safe_scratch(path):
                raise RuntimeError('scratch ownership changed')
            # Intent and exact path persist before deletion, allowing uncertain recovery without fake receipts.
            result['removal_intent'] = str(candidate)
            assessed[previous['id']] = result
            save()
            shutil.rmtree(candidate)
            result['removed'].append(str(candidate))
            result.pop('removal_intent', None)
        result['free_after'] = shutil.disk_usage(path).free
        result['state'] = 'released'
    except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
        result.update({'state': 'deferred', 'reason': str(error)[:240],
                       'next_action': 'Recheck exact ended owner, terminal receipt and open-file ownership before retry'})
    assessed[previous['id']] = result
    save()


TTL_DEFAULTS = {'integrated_checkout': 86400, 'unfinished_checkout': 259200,
                'dependency_donor': 604800, 'booted_simulator': 1800,
                'near_term_lease': 86400, 'task_simulator': 604800,
                'build_cache': 604800, 'durable_evidence': 2592000}


def elapsed(timestamp, now):
    from datetime import datetime
    try:
        value = datetime.fromisoformat(timestamp.replace('Z', '+00:00')).timestamp()
        return max(0, now - value)
    except (AttributeError, TypeError, ValueError):
        return None


def retention(config, kind, record, now):
    """Expiration requests a guarded assessment, never authority to discard source/evidence."""
    seconds = config.get('resource_ttl_seconds', {}).get(kind, TTL_DEFAULTS[kind])
    if not isinstance(seconds, int) or isinstance(seconds, bool) or seconds < 0:
        raise RuntimeError('resource TTL must be nonnegative seconds')
    if record.get('live_owner') or record.get('consumer_live') or record.get('pinned'):
        return {'state': 'retained', 'reason': 'live owner, live consumer or explicit artifact pin'}
    lease = record.get('near_term_lease') or {}
    if lease:
        age = elapsed(lease.get('last_owner_use'), now)
        maximum = config.get('resource_ttl_seconds', {}).get('near_term_lease', TTL_DEFAULTS['near_term_lease'])
        if lease.get('owner') and lease.get('next_action') and age is not None and age < maximum:
            return {'state': 'retained', 'reason': 'bounded owner/action lease'}
    basis = record.get('last_consumer_release') if kind == 'dependency_donor' else record.get('released_at')
    if kind in ('build_cache', 'durable_evidence'):
        basis = record.get('last_owner_use')
    age = elapsed(basis, now)
    if age is None:
        return {'state': 'unknown', 'reason': 'missing trusted owner-use/release timestamp; backfill required'}
    budget = config.get('build_cache_max_bytes', 4 * 1024**3)
    over_budget = kind == 'build_cache' and isinstance(record.get('bytes'), int) and record['bytes'] > budget
    if age < seconds and not over_budget:
        return {'state': 'retained', 'reason': 'within retention grace', 'age_seconds': int(age)}
    action = {'integrated_checkout': 'verify ownership/integration/references then preserve evidence and retire',
              'unfinished_checkout': 'assess cold retention; preserve branch, source and dirty work',
              'dependency_donor': 'verify transitive live consumers before removing rebuildable dependencies',
              'booted_simulator': 'recheck owner/commands/lease then shutdown without erase',
              'task_simulator': 'existing source-bound evidence-preserving retirement policy',
              'build_cache': 'recheck compatible-use pins and archive evidence before budgeted eviction',
              'durable_evidence': 'verified retrievable cold archive; never TTL purge'}[kind]
    return {'state': 'assessment-due', 'next_action': action, 'age_seconds': int(age)}


def assess_retention(config, state, now):
    """Bounded history view; polling does not renew any resource use timestamp."""
    latest = {}
    for claim in state.get('history', []):
        if claim.get('worktree'):
            latest[claim['worktree']] = claim
    result = {}
    for path, claim in latest.items():
        kind = 'integrated_checkout' if claim.get('terminal') == 'verified' else 'unfinished_checkout'
        record = {'released_at': claim.get('finished_at'),
                  'live_owner': (state.get('active') or {}).get('worktree') == path}
        result[path] = {'issue': claim.get('issue'), 'claim': claim.get('id'), 'kind': kind,
                        **retention(config, kind, record, now)}
    state['resource_retention'] = result


def live_donors(edges, live_consumers):
    """Protect donors only through a transitive chain ending in a known live consumer."""
    live = set(live_consumers)
    changed = True
    while changed:
        changed = False
        for consumer, donor in edges:
            if consumer in live and donor not in live:
                live.add(donor)
                changed = True
    return live - set(live_consumers)
