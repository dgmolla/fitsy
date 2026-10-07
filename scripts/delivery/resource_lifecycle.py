"""Owned scratch release and source-preserving checkout reuse under dispatcher.lock."""
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import time


SCRATCH = ('Intermediates.noindex', 'ModuleCache.noindex', 'CompilationCache.noindex', 'SDKStatCaches.noindex', 'Index.noindex')


def execute(args, timeout=30):
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def read_claims(config, state):
    """Retain damaged legacy metadata without turning it into deletion authority."""
    claims, uncertain = [], False
    for receipt in (Path(config['state_dir']) / 'claims').glob('*/receipt.json'):
        try:
            claim = json.loads(receipt.read_text())
            if not isinstance(claim, dict):
                raise ValueError('durable receipt is not an object')
            if (claim.get('id') != receipt.parent.name or not isinstance(claim.get('issue'), int)
                    or isinstance(claim.get('issue'), bool) or claim['issue'] < 1):
                raise ValueError('durable claim lacks exact id and issue ownership')
            for field in ('id', 'worktree', 'branch', 'terminal', 'finished_at'):
                if claim.get(field) is not None and not isinstance(claim[field], str):
                    raise ValueError('durable receipt field is not text: ' + field)
            if claim.get('issue') is not None and (not isinstance(claim['issue'], int) or isinstance(claim['issue'], bool)):
                raise ValueError('durable receipt issue is not an integer')
            if 'worktree_origin_claim' in claim and not isinstance(claim['worktree_origin_claim'], str):
                raise ValueError('durable origin claim is not text')
            for field in ('pid', 'launcher_pid', 'worker_pgid'):
                value = claim.get(field)
                if value is not None and (not isinstance(value, int) or isinstance(value, bool) or value <= 0):
                    raise ValueError('durable process identity is not a positive integer: ' + field)
            if 'worktree_creation_intent' in claim and not isinstance(claim['worktree_creation_intent'], bool):
                raise ValueError('durable creation intent is not boolean')
        except (OSError, ValueError) as error:
            uncertain = True
            state.setdefault('cold_retention_legacy', {}).setdefault(str(receipt), {
                'state': 'deferred', 'reason': 'unreadable durable claim receipt: ' + str(error)[:160],
                'next_action': 'Backfill exact owner from original task evidence; preserve damaged receipt and skip destructive recovery'})
            continue
        claims.append((receipt, claim))
    return claims, uncertain


def owned_checkout(config, claim):
    identity = claim.get('worktree_origin_claim', claim.get('id', ''))
    if not isinstance(identity, str) or not re.fullmatch(r'[0-9a-f-]{36}', identity) or not isinstance(claim.get('issue'), int):
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


def latest_claim(candidates):
    latest = max(candidates, key=lambda claim: claim.get('finished_at') or '', default=None)
    if latest is None:
        return None
    tied = {claim.get('id') for claim in candidates
            if claim.get('finished_at') == latest.get('finished_at')}
    if len(tied) > 1:
        raise RuntimeError('tied latest completion timestamps require actual owner ordering')
    return latest


def resume_checkout(config, state, issue):
    candidates = [entry for entry in state.get('history', []) if entry.get('issue') == issue
                  and entry.get('worktree') and entry.get('terminal') and entry.get('finished_at')]
    # Compact in-memory history is not the durable ownership record.
    durable = {}
    receipts, uncertain = read_claims(config, state)
    if uncertain:
        registered = execute([config['git_bin'], '-C', config['repo_root'], 'worktree', 'list', '--porcelain', '-z'])
        if registered.returncode:
            raise RuntimeError('uncertain ownership cannot inventory retained same-issue checkouts')
        root = Path(config['worktree_root']).resolve()
        for line in registered.stdout.split('\0'):
            if not line.startswith('worktree '):
                continue
            path = Path(line[9:]).resolve()
            if path.parent == root and re.fullmatch(r'fitsy-issue-' + str(issue) + r'-[0-9a-f]{8}', path.name):
                raise RuntimeError('unreadable durable ownership for retained same-issue checkout: ' + str(path))
    for receipt_path, entry in receipts:
        if entry.get('issue') == issue and entry.get('worktree') and entry.get('terminal') and entry.get('finished_at'):
            if receipt_path.parent.name != entry.get('id'):
                raise RuntimeError('durable claim receipt identity mismatch')
            durable[entry['id']] = entry
            candidates.append(entry)
    previous = latest_claim(candidates)
    if not previous:
        return None
    receipt = durable.get(previous.get('id'))
    fields = ('id', 'issue', 'terminal', 'finished_at', 'worktree', 'branch',
              'worktree_origin_claim', 'worktree_creation_intent', 'pid', 'launcher_pid', 'worker_pgid')
    if receipt is None or any(receipt.get(key) != previous.get(key) for key in fields):
        raise RuntimeError('latest predecessor lacks matching valid durable ownership receipt')
    previous = receipt
    intended = Path(previous.get('worktree', ''))
    if previous.get('worktree_creation_intent') and not intended.exists():
        origin = previous.get('worktree_origin_claim', previous['id'])
        expected = Path(config['worktree_root']).resolve() / f"fitsy-issue-{issue}-{origin[:8]}"
        registered = execute([config['git_bin'], '-C', config['repo_root'], 'worktree', 'list', '--porcelain'])
        branch = execute([config['git_bin'], '-C', config['repo_root'], 'show-ref', '--verify', '--quiet',
                          'refs/heads/' + previous.get('branch', '')])
        if intended.resolve() == expected and not intended.is_symlink() and registered.returncode == 0 and \
                f'worktree {expected}\n' not in registered.stdout and branch.returncode == 1:
            released(config, previous, [])
            return None  # The durable creation intent never produced any source checkout.
    cold = state.get('cold_retention', {}).get(previous['id'], {})
    if previous.get('terminal') == 'verified' and cold.get('state') == 'cold-retired' and not intended.exists():
        archive = cold.get('archive', {})
        from cold_retention import sha
        if not archive.get('index_patch') or not archive.get('index_patch_sha256'):
            raise RuntimeError('completed-source staged recovery is unproven; reconcile legacy archive first')
        archive_hashes = [('path', 'sha256'), ('manifest', 'manifest_sha256'), ('bundle', 'bundle_sha256')]
        archive_hashes.append(('index_patch', 'index_patch_sha256'))
        if cold.get('worktree') != str(intended) or cold.get('claim') != previous['id'] or any(
                not Path(archive.get(key, '')).is_file() or sha(Path(archive[key])) != archive.get(digest)
                for key, digest in archive_hashes):
            raise RuntimeError('completed-source cold recovery is unavailable or changed')
        from cold_retention import verify_objects
        verify_objects(json.loads(Path(archive['manifest']).read_text()))
        # A completed, verified issue reopened later starts on current main; its old source/evidence stays recoverable.
        return None
    path = owned_checkout(config, previous)
    receipt_path = Path(config['state_dir']) / 'claims' / previous['id'] / 'receipt.json'
    receipt = json.loads(receipt_path.read_text())
    if any(receipt.get(key) != previous.get(key) for key in ('id', 'issue', 'terminal', 'finished_at', 'worktree', 'branch')):
        raise RuntimeError('terminal receipt changed')
    if previous.get('terminal') == 'verified':
        # Exact terminal receipt is trusted; this no-op preserves old files and starts separately on main.
        return None
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
    compiler_root = path / '.evidence/product-build'
    if not ((entry.name in SCRATCH and entry.parent in (compiler_root, compiler_root / 'Build')) or
            entry == path / 'apps/api/.next/cache'):
        return False
    if any(parent.suffix == '.app' or parent.name == 'Products' for parent in entry.parents):
        return False
    return not any(parent.is_symlink() for parent in entry.parents
                   if parent != path and parent.is_relative_to(path))


def safe_scratch(path):
    root = path / '.evidence/product-build'
    candidates = [parent / name for parent in (root, root / 'Build') for name in SCRATCH]
    candidates += [path / 'apps/api/.next/cache']
    owned = set(entry for entry in candidates if entry.is_dir() and owned_scratch(path, entry))
    return sorted(entry for entry in owned if not any(parent in owned for parent in entry.parents))


def assessment_due(assessment, now):
    if assessment is None:
        return True
    if assessment.get('state') != 'deferred':
        return bool(assessment.get('removal_intent'))
    deadline = assessment.get('retry_after')
    # Legacy failures get one guarded assessment, not a fabricated old-use timestamp.
    return deadline is None or (isinstance(deadline, (int, float)) and
                                not isinstance(deadline, bool) and math.isfinite(deadline) and deadline <= now)


def release_due(entry, assessment, now):
    return bool(entry.get('finished_at') and entry.get('terminal') and entry.get('worktree')
                and assessment_due(assessment, now))


def cleanup_released(config, state, save):
    """Assess one ended claim per tick, preserving original claim and failure receipts."""
    if state.get('active'):
        return
    assessed = state.setdefault('resource_releases', {})
    now = time.time()
    candidates = list(reversed(state.get('history', [])))
    retained = {entry.get('id') for entry in candidates}
    # Durable ownership covers unassessed releases, retries and interrupted intents alike.
    receipts, uncertain = read_claims(config, state)
    durable = {entry['id']: entry for _, entry in receipts}
    candidates.extend(entry for _, entry in receipts if entry['id'] not in retained)
    eligible = [entry for entry in candidates
                if release_due(entry, assessed.get(entry.get('id')), now)]
    # New releases and uncertain deletion intents precede due retries; then oldest due first.
    eligible.sort(key=lambda entry: (0 if entry['id'] not in assessed or
                                     assessed[entry['id']].get('removal_intent') else 1,
                                     assessed.get(entry['id'], {}).get('retry_after') or 0))
    previous = eligible[0] if eligible else None
    if not previous:
        if uncertain:
            save()
        return
    result = json.loads(json.dumps(assessed.get(previous['id']) or
                                  {'issue': previous['issue'], 'claim': previous['id'], 'removed': []}))
    prior = assessed.get(previous['id'])
    if prior:
        result.setdefault('attempts', []).append({key: value for key, value in prior.items()
                                                 if key != 'attempts'})
    count = result.get('attempt_count', 0)
    result['attempt_count'] = (count if isinstance(count, int) and not isinstance(count, bool) and count >= 0 else 0) + 1
    result['attempted_at'] = now
    try:
        if uncertain:
            raise RuntimeError('durable ownership is uncertain; backfill damaged receipts before release')
        path = owned_checkout(config, previous)
        origin = previous.get('worktree_origin_claim', previous['id'])
        fields = ('id', 'issue', 'terminal', 'finished_at', 'worktree', 'branch',
                  'worktree_origin_claim', 'worktree_creation_intent', 'pid', 'launcher_pid', 'worker_pgid')
        for known in candidates:
            same_generation = (known.get('issue') == previous['issue'] and
                               known.get('worktree_origin_claim', known.get('id')) == origin)
            if not known.get('worktree'):
                if same_generation:
                    raise RuntimeError('known checkout generation owner lacks a resource path')
                continue
            if not isinstance(known['worktree'], str):
                raise RuntimeError('known checkout owner has an unreadable resource path')
            same_path = Path(known['worktree']).resolve() == path
            if same_generation and not same_path:
                raise RuntimeError('known checkout generation owner has a mismatched resource path')
            if same_path:
                receipt = durable.get(known.get('id'))
                if receipt is None or any(receipt.get(key) != known.get(key) for key in fields):
                    raise RuntimeError('known checkout owner terminal receipt is missing or changed')
        owners = [entry for _, entry in receipts if entry.get('worktree')
                  and Path(entry['worktree']).resolve() == path]
        if any(not entry.get('finished_at') or not entry.get('terminal') for entry in owners):
            raise RuntimeError('checkout successor lacks terminal release proof')
        latest = latest_claim(owners)
        if latest is None or latest['id'] != previous['id']:
            raise RuntimeError('checkout release requires its latest durable owner')
        intent = Path(result['removal_intent']) if result.get('removal_intent') else None
        if intent:
            if not owned_scratch(path, intent):
                raise RuntimeError('persisted scratch intent is not owned')
            released(config, previous, [path, intent] if intent.exists() else [path])
            if not intent.exists():
                # Absence reconciles uncertainty, not a newly measured deletion or reclaimed-byte claim.
                result.setdefault('reconciled_absent', []).append(str(intent))
                result.pop('removal_intent')
                assessed[previous['id']] = result
                save()
        candidates = safe_scratch(path)
        released(config, previous, [path, *candidates])
        result['free_before'] = shutil.disk_usage(path).free
        for candidate in candidates:
            owned_checkout(config, previous)
            released(config, previous, [path, candidate])
            if candidate not in safe_scratch(path):
                raise RuntimeError('scratch ownership changed')
            # Intent and exact path persist before deletion, allowing uncertain recovery without fake receipts.
            result['removal_intent'] = str(candidate)
            assessed[previous['id']] = result
            save()
            released(config, previous, [path, candidate])
            shutil.rmtree(candidate)
            result['removed'].append(str(candidate))
            result.pop('removal_intent', None)
        result['free_after'] = shutil.disk_usage(path).free
        result['state'] = 'released'
        for field in ('reason', 'next_action', 'retry_after'):
            result.pop(field, None)
    except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
        delay = min(21600, 900 * (2 ** min(result['attempt_count'] - 1, 5)))
        result.update({'state': 'deferred', 'reason': str(error)[:240], 'retry_after': now + delay,
                       'next_action': 'Retry after backoff with fresh terminal, process and open-file ownership guards'})
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
    if kind == 'task_simulator':
        released_age, used_age = elapsed(record.get('released_at'), now), elapsed(record.get('last_owner_use'), now)
        if released_age is None or used_age is None or released_age > used_age:
            return {'state': 'unknown', 'reason': 'missing trusted device owner-use/release clock; backfill required'}
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
