"""Private verified cold recovery for superseded, ended dispatcher checkouts."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time

from resource_lifecycle import elapsed, execute, owned_checkout, released, source_identity

DEPENDENCIES = ('node_modules', 'apps/api/node_modules', 'apps/mobile/node_modules',
                'packages/shared/node_modules', 'scripts/node_modules', 'apps/mobile/ios/Pods')


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()



def index_snapshot(config, path):
    conflicts = execute([config['git_bin'], '-C', str(path), 'ls-files', '--unmerged'])
    if conflicts.returncode or conflicts.stdout:
        raise RuntimeError('unresolved index stages require complete Git-state recovery; retain checkout')
    result = subprocess.run([config['git_bin'], '-C', str(path), 'diff', '--cached', '--binary',
                             '--full-index', '--no-ext-diff', '--no-textconv', '--no-renames', 'HEAD'],
                            capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError('staged source snapshot unavailable; retain checkout')
    return result.stdout


def incoming(config, target):
    budget = config.get('incoming_reference_scan_seconds', 30)
    if isinstance(budget, bool) or not isinstance(budget, (int, float)) or not 0 < budget <= 30:
        raise RuntimeError('invalid incoming-reference scan budget; retain checkout')
    deadline = time.monotonic() + budget
    if time.monotonic() >= deadline:
        raise RuntimeError('incoming-reference scan deadline; retain uncertain checkout')
    registered = execute([config['git_bin'], '-C', config['repo_root'], 'worktree', 'list', '--porcelain', '-z'], timeout=budget)
    if registered.returncode:
        raise RuntimeError('consumer worktree inventory unavailable; retain checkout')
    registered_roots = [Path(entry[9:]) for entry in registered.stdout.split('\0') if entry.startswith('worktree ')]
    for root in registered_roots:
        resolved = root.resolve()
        if resolved != target and resolved.is_relative_to(target):
            raise RuntimeError('registered nested worktree requires its own owner: ' + str(root))
    extra = config.get('resource_reference_roots', [])
    if not isinstance(extra, list) or any(not isinstance(root, str) or not Path(root).is_absolute() for root in extra):
        raise RuntimeError('invalid explicit consumer roots; retain checkout')
    declared = [Path(config['worktree_root']), *registered_roots,
                *(Path(root) for root in extra)]
    dependencies = Path(config['state_dir']) / 'dependencies'
    if dependencies.exists():
        declared.append(dependencies)
    roots = set()
    for root in declared:
        if time.monotonic() >= deadline:
            raise RuntimeError('incoming-reference scan deadline; retain uncertain checkout')
        resolved = root.resolve()
        if resolved.is_relative_to(target) and any(part.is_symlink() for part in (root, *root.parents)):
            return [str(root)]  # Preserve the declared alias before normalization hides its incoming reference.
        roots.add(resolved)
    if any(not root.is_dir() for root in roots):
        raise RuntimeError('registered or declared consumer root unavailable; retain checkout')
    pending = [str(root) for root in roots if not any(other != root and root.is_relative_to(other) for other in roots)]
    while pending:
        if time.monotonic() >= deadline:
            raise RuntimeError('incoming-reference scan deadline; retain uncertain checkout')
        directory = pending.pop()
        if directory == str(target):
            continue  # Internal references disappear together; only external consumers matter.
        with os.scandir(directory) as entries:
            for entry in entries:
                if time.monotonic() >= deadline:
                    raise RuntimeError('incoming-reference scan deadline; retain uncertain checkout')
                if entry.is_symlink():
                    path = Path(entry.path)
                    if path.resolve().is_relative_to(target):
                        return [str(path)]
                elif entry.name != '.git' and entry.is_dir(follow_symlinks=False):
                    pending.append(entry.path)
    return []


def guard(config, state, claim):
    path = owned_checkout(config, claim)
    registered = execute([config['git_bin'], '-C', config['repo_root'], 'worktree', 'list', '--porcelain'])
    block = next((entry for entry in registered.stdout.split('\n\n') if entry.startswith('worktree ' + str(path) + '\n')), '')
    if registered.returncode or not block or any(line.startswith('locked') for line in block.splitlines()):
        raise RuntimeError('Git ownership lock or uncertain registration; retain checkout')
    if (state.get('active') or {}).get('worktree') == str(path):
        raise RuntimeError('active execution owner')
    if path == Path(config['repo_root']).resolve():
        raise RuntimeError('configured runtime source checkout')
    pins = config.get('resource_pinned_checkouts', [])
    if not isinstance(pins, list) or any(not isinstance(pin, str) or not Path(pin).is_absolute() for pin in pins):
        raise RuntimeError('explicit source/app pins are malformed; retain checkout')
    if any(Path(pin).resolve() == path for pin in pins):
        raise RuntimeError('explicit retained source/app pin')
    if incoming(config, path):
        raise RuntimeError('incoming dependency or artifact reference')
    released(config, claim, [path])
    processes = execute(['ps', '-axo', 'pid=,command='])
    if processes.returncode:
        raise RuntimeError('process ownership unavailable')
    for line in processes.stdout.splitlines():
        fields = line.strip().split(maxsplit=1)
        if len(fields) == 2 and str(path) in fields[1] and int(fields[0]) != os.getpid():
            raise RuntimeError('checkout referenced by running command')
    return path


def shared_bundle(config, path, head, directory):
    """One immutable source pack serves every covered recovery, avoiding full-history copies."""
    store = Path(config['state_dir']) / 'recovery/source-bundles'
    store.mkdir(parents=True, exist_ok=True); store.chmod(0o700)
    shared = None
    for candidate in store.glob('*.bundle'):
        if sha(candidate) != candidate.stem:
            raise RuntimeError('shared source recovery pack identity changed')
        heads = execute([config['git_bin'], 'bundle', 'list-heads', str(candidate)])
        if heads.returncode == 0 and head in [line.split()[0] for line in heads.stdout.splitlines()]:
            shared = candidate; break
    if shared is None:
        temporary = store / ('source-pack-' + str(time.time_ns()) + '.tmp')
        try:
            result = execute([config['git_bin'], '-C', str(path), 'bundle', 'create', str(temporary), '--all'], timeout=180)
            if result.returncode:
                raise RuntimeError('source bundle creation failed')
            temporary.chmod(0o600)
            shared = store / (sha(temporary) + '.bundle'); os.replace(temporary, shared)
        finally:
            temporary.unlink(missing_ok=True)  # Only this unpublished attempt, never a shared verified pack.
    bundle = directory / 'source.bundle'
    os.link(shared, bundle)
    return bundle


def object_identity(file):
    h = hashlib.sha256()
    with gzip.open(file, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def app_object(config, file, digest):
    """A retained large app file has one immutable compressed recovery object."""
    store = Path(config['state_dir']) / 'recovery/file-objects'
    store.mkdir(parents=True, exist_ok=True); store.chmod(0o700)
    target = store / (digest + '.gz')
    if target.is_symlink():
        raise RuntimeError('recovery app object is a redirected link')
    if not target.exists():
        temporary = store / ('object-' + str(time.time_ns()) + '.tmp')
        try:
            with temporary.open('xb') as raw:
                temporary.chmod(0o600)
                with gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as compressed, file.open('rb') as source:
                    shutil.copyfileobj(source, compressed, 1024 * 1024)
            if object_identity(temporary) != digest:
                raise RuntimeError('app recovery bytes changed during preservation')
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
    if object_identity(target) != digest:
        raise RuntimeError('retained app recovery object changed')
    return {'object': str(target), 'object_sha256': sha(target), 'object_bytes': target.stat().st_size}


def verify_objects(manifest):
    for row in manifest['files']:
        if 'object' in row:
            file = Path(row['object'])
            if file.is_symlink() or sha(file) != row['object_sha256'] or object_identity(file) != row['sha256']:
                raise RuntimeError('retained app recovery object identity changed')


def reserve_recovery_space(config, path, index_data):
    """Plan for incompressible retained files and Git recovery before allocating any attempt bytes."""
    files = members = 0
    excluded = {path / relative for relative in DEPENDENCIES}
    for current, dirs, names in os.walk(path, followlinks=False):
        dirs[:] = [name for name in dirs if Path(current) / name not in excluded or (Path(current) / name).is_symlink()]
        members += len(dirs) + len(names)
        files += sum((Path(current) / name).lstat().st_size for name in names if not (Path(current) / name).is_symlink())
    objects = execute([config['git_bin'], '-C', str(path), 'rev-list', '--objects', '--all'])
    if objects.returncode:
        raise RuntimeError('Git recovery capacity inventory unavailable')
    sizes = subprocess.run([config['git_bin'], '-C', str(path), 'cat-file', '--batch-check=%(objectsize)'],
                           input='\n'.join(line.split()[0] for line in objects.stdout.splitlines()),
                           capture_output=True, text=True, timeout=60)
    if sizes.returncode or any(not line.isdigit() for line in sizes.stdout.splitlines()):
        raise RuntimeError('Git recovery capacity sizes unavailable')
    # Three copies allow bundle staging, recovery clone and pack/index overhead; compression is not assumed.
    needed = files + files // 100 + members * 2048 + 3 * sum(map(int, sizes.stdout.splitlines())) + 2 * len(index_data) + 64 * 1024**2
    available = shutil.disk_usage(config['state_dir']).free
    if available < needed:
        raise RuntimeError(f'archive capacity needs {needed} bytes, available {available}; retain source and recover a smaller candidate first')


def preserve(config, path, claim, directory):
    """Verify every source/env/app/raw-evidence member and a recoverable branch bundle."""
    head = source_identity(config, path)['head']
    index_data = index_snapshot(config, path)
    reserve_recovery_space(config, path, index_data)
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o700)
    index_patch = directory / 'index.patch'; index_patch.write_bytes(index_data); index_patch.chmod(0o600)
    bundle = shared_bundle(config, path, head, directory)
    recovered = directory / 'recovery-test.git'
    result = execute([config['git_bin'], 'clone', '--bare', str(bundle), str(recovered)], timeout=180)
    if result.returncode:
        raise RuntimeError('source recovery clone failed')
    head = source_identity(config, path)['head']
    result = execute([config['git_bin'], '--git-dir', str(recovered), 'cat-file', '-e', head + '^{commit}'])
    if result.returncode:
        raise RuntimeError('source commit missing from recovery')
    result = execute([config['git_bin'], '--git-dir', str(recovered), 'read-tree', head])
    if result.returncode:
        raise RuntimeError('staged source recovery base unavailable')
    if index_data and execute([config['git_bin'], '--git-dir', str(recovered), 'apply', '--cached',
                               '--whitespace=nowarn', str(index_patch)]).returncode:
        raise RuntimeError('staged source recovery patch failed')
    restored = subprocess.run([config['git_bin'], '--git-dir', str(recovered), 'diff', '--cached', '--binary',
                               '--full-index', '--no-ext-diff', '--no-textconv', '--no-renames', head],
                              capture_output=True, timeout=120)
    if restored.returncode or restored.stdout != index_data:
        raise RuntimeError('staged source recovery identity mismatch')
    shutil.rmtree(recovered)
    archive = directory / 'files.tar.gz'
    files, excluded = [], []
    with tarfile.open(archive, 'w:gz', compresslevel=6, dereference=False) as target:
        for current, dirs, names in os.walk(path, followlinks=False):
            dirs.sort(); names.sort()
            for name in list(dirs):
                file = Path(current) / name
                rebuildable = file in {path / relative for relative in DEPENDENCIES}
                if rebuildable and not file.is_symlink():
                    # Only rebuildable dependency directories, never source, apps or raw proof.
                    if any(file.rglob('*.app')):
                        raise RuntimeError('dependency directory contains a retained app')
                    excluded.append(str(file)); dirs.remove(name)
                elif file.is_symlink():
                    target.add(file, arcname=str(file.relative_to(path)), recursive=False)
                    files.append({'path': str(file.relative_to(path)), 'link': os.readlink(file)})
                    dirs.remove(name)
            relative = Path(current).relative_to(path)
            if str(relative) != '.':
                target.add(current, arcname=str(relative), recursive=False)
            for name in names:
                file = Path(current) / name
                if file.is_symlink():
                    record = {'path': str(file.relative_to(path)), 'link': os.readlink(file)}
                elif file.is_file():
                    record = {'path': str(file.relative_to(path)), 'sha256': sha(file),
                              'bytes': file.stat().st_size, 'mode': file.stat().st_mode & 0o777}
                else:
                    raise RuntimeError('unsupported filesystem object; retain checkout')
                if 'sha256' in record and record['bytes'] >= 8 * 1024**2 and '.app/' in record['path']:
                    record.update(app_object(config, file, record['sha256']))
                else:
                    target.add(file, arcname=record['path'], recursive=False)
                files.append(record)
    archive.chmod(0o600)
    verify_objects({'files': files})
    expected, seen = {row['path']: row for row in files if 'object' not in row}, set()
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            if member.isdir():
                continue
            record = expected.get(member.name)
            if record is None:
                raise RuntimeError('unexpected recovery member')
            if 'link' in record:
                if not member.issym() or member.linkname != record['link']:
                    raise RuntimeError('recovery link mismatch')
            else:
                h = hashlib.sha256()
                with source.extractfile(member) as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b''):
                        h.update(block)
                if h.hexdigest() != record['sha256'] or member.size != record['bytes'] or member.mode != record['mode']:
                    raise RuntimeError('recovery bytes mismatch')
            seen.add(member.name)
    if seen != set(expected):
        raise RuntimeError('recovery omitted source or evidence')
    manifest = directory / 'manifest.json'
    manifest.write_text(json.dumps({'files': files, 'excluded_rebuildable_dependencies': excluded}, indent=2) + '\n')
    manifest.chmod(0o600)
    return {'path': str(archive), 'sha256': sha(archive), 'bytes': archive.stat().st_size,
            'manifest': str(manifest), 'manifest_sha256': sha(manifest), 'verified_members': len(files),
            'bundle': str(bundle), 'bundle_sha256': sha(bundle), 'source_head': head,
            'index_patch': str(index_patch), 'index_patch_sha256': sha(index_patch)}


def sync_recovery(config, archive):
    """Make verified bytes and their recovery directory entries durable before source removal."""
    manifest = json.loads(Path(archive['manifest']).read_text())
    files = [Path(archive[name]) for name in ('path', 'manifest', 'index_patch', 'bundle')]
    files.extend(Path(row['object']) for row in manifest['files'] if 'object' in row)
    root = Path(config['state_dir'])
    directories = {root / 'recovery/source-bundles'}
    for file in files:
        with file.open('rb') as stream:
            os.fsync(stream.fileno())
        parent = file.parent
        while parent.is_relative_to(root):
            directories.add(parent)
            parent = parent.parent
    for directory in sorted(directories, key=lambda path: len(path.parts), reverse=True):
        descriptor = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def retain_attempts(config, claim, previous):
    """Keep raw prior outcomes outside bounded dispatcher state, including legacy nested attempts."""
    history = Path(config['state_dir']) / 'recovery' / claim['id'] / 'attempts.jsonl'
    history.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    rows, current = [], previous
    while current:
        rows.append({key: value for key, value in current.items() if key != 'previous_attempt'})
        current = current.get('previous_attempt')
    with history.open('a') as stream:
        os.fchmod(stream.fileno(), 0o600)
        for row in reversed(rows):
            stream.write(json.dumps(row, sort_keys=True) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    for directory in (history.parent, history.parent.parent):
        descriptor = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    return str(history)


def retire(config, state, claim, save):
    records = state.setdefault('cold_retention', {})
    previous = records.get(claim['id'])
    record = {'issue': claim['issue'], 'claim': claim['id'], 'worktree': claim['worktree'],
              'state': 'preservation-intent', 'free_before': shutil.disk_usage(config['worktree_root']).free}
    if previous:
        record['attempt_history'] = retain_attempts(config, claim, previous)
        record['attempt_count'] = previous.get('attempt_count', 1) + 1
    records[claim['id']] = record; save()
    directory = None
    try:
        path = guard(config, state, claim)
        identity = source_identity(config, path)
        directory = Path(config['state_dir']) / 'recovery' / claim['id'] / str(time.time_ns())
        archive = preserve(config, path, claim, directory)
        sync_recovery(config, archive)
        record['archive'] = archive
        record['source_identity'] = identity
        record['state'] = 'recovery-verified'; save()
        guard(config, state, claim)
        if source_identity(config, path) != identity:
            raise RuntimeError('source changed before retirement')
        # Bind ignored environments/apps/evidence again immediately before retirement.
        manifest = json.loads(Path(record['archive']['manifest']).read_text())
        verify_objects(manifest)
        for row in manifest['files']:
            file = path / row['path']
            if 'link' in row:
                if not file.is_symlink() or os.readlink(file) != row['link']:
                    raise RuntimeError('ignored link changed before retirement')
            elif (not file.is_file() or sha(file) != row['sha256'] or
                  file.stat().st_mode & 0o777 != row['mode']):
                raise RuntimeError('ignored file changed before retirement')
        seen = set()
        excluded = set(manifest['excluded_rebuildable_dependencies'])
        for current, dirs, names in os.walk(path, followlinks=False):
            for name in list(dirs):
                file = Path(current) / name
                if str(file) in excluded:
                    dirs.remove(name)
                elif file.is_symlink():
                    seen.add(str(file.relative_to(path))); dirs.remove(name)
            seen.update(str((Path(current) / name).relative_to(path)) for name in names)
        if seen != {row['path'] for row in manifest['files']}:
            raise RuntimeError('new source/evidence appeared after recovery snapshot')
        if hashlib.sha256(index_snapshot(config, path)).hexdigest() != record['archive']['index_patch_sha256']:
            raise RuntimeError('staged source changed after recovery snapshot')
        record['state'] = 'removal-intent'; save()
        command = [config['git_bin'], '-C', config['repo_root'], 'worktree', 'remove']
        # Dirty work is explicitly cold-retained, byte-verified and recoverable, never discarded unarchived.
        if execute([config['git_bin'], '-C', str(path), 'status', '--porcelain']).stdout:
            command.append('--force')
        result = execute([*command, str(path)], timeout=120)
        if result.returncode or path.exists():
            raise RuntimeError('Git retirement failed; reconcile persisted recovery intent')
        record.update(state='cold-retired', free_after=shutil.disk_usage(config['worktree_root']).free,
                      finished_at=time.time(), restore='Clone source.bundle at source_head, apply private index.patch with git apply --cached at source_head, restore files.tar.gz excluding historical .git pointer, decompress manifest file objects to their exact relative paths, restore recorded modes and verify decoded hashes, rebuild dependencies from retained locks only under a new authorized owner. Preserve private environment secrecy.')
    except (OSError, EOFError, RuntimeError, ValueError, subprocess.SubprocessError, tarfile.TarError) as error:
        if record.get('state') == 'removal-intent':
            # Keep the intent even when Git failed after removing the path; never delete again on that uncertainty.
            record.update(reason=str(error)[:240], next_action='Reconcile absent path against verified recovery before reopening; if source remains, recheck ownership before another removal')
        else:
            if directory and directory.exists() and 'archive' not in record and Path(claim['worktree']).is_dir():
                before = shutil.disk_usage(config['state_dir']).free
                shutil.rmtree(directory)  # Unpublished partial attempt only; source and shared verified objects remain.
                record['partial_attempt_cleanup'] = {'path': str(directory), 'free_before': before,
                                                     'free_after': shutil.disk_usage(config['state_dir']).free}
            record.update(state='deferred', reason=str(error)[:240], retry_after=time.time() + 1800,
                          next_action='Resolve exact owner/reference/source/recovery uncertainty before retry; source and original receipts remain retained')
    save()
    return record


def recover(config, state, save, now, completed_verified=None):
    """One owner-bound candidate per existing idle tick, before admission can hold."""
    if state.get('active'):
        return
    high = config.get('cleanup_high_watermark_bytes', 20 * 1024**3)
    minimum = config.get('min_free_bytes', 8 * 1024**3) + config.get('scratch_reserve_bytes', 4 * 1024**3)
    if not isinstance(high, int) or isinstance(high, bool) or high < 0:
        raise RuntimeError('cleanup high watermark must be nonnegative bytes')
    high = max(high, minimum)
    pressure = shutil.disk_usage(config['worktree_root']).free < high
    grace = config.get('superseded_checkout_grace_seconds', 3600 if pressure else 86400)
    if not isinstance(grace, int) or isinstance(grace, bool) or grace < 0:
        raise RuntimeError('superseded checkout grace must be nonnegative seconds')
    from resource_lifecycle import read_claims
    receipts, uncertain = read_claims(config, state)
    if uncertain:
        save(); return  # Unknown ownership disables destructive recovery, not admission of ready work.
    claims, uncertain_paths = {}, set()
    for receipt, c in receipts:
        if not c.get('worktree'):
            continue  # Legacy shipping receipts without a resource path cannot authorize cleanup.
        if (not c.get('finished_at') or not c.get('terminal') or
                receipt.parent.name != c.get('id') or not isinstance(c.get('issue'), int)):
            uncertain_paths.add(c['worktree'])
            state.setdefault('cold_retention_legacy', {}).setdefault(str(receipt), {
                'state': 'deferred', 'worktree': c['worktree'],
                'reason': 'durable resource claim identity incomplete or mismatched',
                'next_action': 'Backfill exact terminal owner identity; preserve original receipt and resources'})
            continue
        if c.get('worktree') and c.get('finished_at') and c.get('terminal'):
            previous = claims.get(c['worktree'])
            if previous is None or c['finished_at'] > previous['finished_at']:
                claims[c['worktree']] = c
    newest = {}
    for c in claims.values():
        if c['finished_at'] > newest.get(c['issue'], {}).get('finished_at', ''):
            newest[c['issue']] = c
    records = state.setdefault('cold_retention', {})
    for c in sorted(claims.values(), key=lambda row: row['finished_at']):
        if c['worktree'] in uncertain_paths:
            continue
        prior = records.get(c['id'], {})
        age = elapsed(c['finished_at'], now)
        latest_unfinished = c == newest[c['issue']] and c.get('terminal') != 'verified'
        minimum_age = config.get('resource_ttl_seconds', {}).get('integrated_checkout', 86400) if c == newest[c['issue']] and c.get('terminal') == 'verified' else grace
        if not isinstance(minimum_age, int) or isinstance(minimum_age, bool) or minimum_age < 0:
            raise RuntimeError('checkout TTL must be nonnegative seconds')
        if latest_unfinished or age is None or age < minimum_age or prior.get('state') == 'cold-retired' or prior.get('retry_after', 0) > now:
            continue
        if prior.get('state') == 'removal-intent' and not Path(c['worktree']).exists():
            archive = prior.get('archive', {})
            if not archive.get('index_patch') or not archive.get('index_patch_sha256'):
                prior.update(reason='legacy staged-source recovery is unproven',
                             next_action='Recover and verify original index state or explicit original clean-index proof; preserve removal intent and raw archive')
                save(); return
            if any(not Path(archive.get(key, '')).is_file() or sha(Path(archive[key])) != archive.get(digest)
                   for key, digest in ([('path', 'sha256'), ('manifest', 'manifest_sha256'), ('bundle', 'bundle_sha256')] +
                                       [('index_patch', 'index_patch_sha256')])):
                prior.update(reason='missing or changed cold recovery after uncertain removal',
                             next_action='Restore verified recovery identity for absent source; keep removal intent, no successful retirement claim')
                save(); return
            try:
                verify_objects(json.loads(Path(archive['manifest']).read_text()))
            except (OSError, ValueError, RuntimeError, EOFError) as error:
                prior.update(reason=str(error)[:240], next_action='Restore verified archived objects; keep absent-path removal intent and do not remove again')
                save(); return
            prior.update(state='cold-retired', reconciliation='verified recovery retained; absent checkout reconciled without new deletion or byte-gain claim')
            save(); return
        if c == newest[c['issue']]:
            # Local terminal labels alone cannot prove current shipping acceptance.
            if completed_verified is None or not completed_verified(c):
                continue
        if c.get('terminal') == 'verified':
            evidence = Path(c['worktree']) / '.evidence'
            product = evidence / 'product-build/receipt.json'
            if product.is_file() or any((evidence / name).exists() for name in ('product-build', 'product-flow')):
                try:
                    build = json.loads(product.read_text())
                    device = build.get('simulator') if isinstance(build, dict) else None
                except (OSError, ValueError):
                    device = None
                retired = (state.get('simulator_retirement', {}).get(device) or {}) if isinstance(device, str) else {}
                if (not isinstance(device, str) or not device or retired.get('status') != 'retired' or
                        retired.get('issue') != c['issue']):
                    # Missing or unusable mobile proof is uncertainty, never absence of a device.
                    record = records.setdefault(c['id'], {'issue': c['issue'], 'claim': c['id'], 'worktree': c['worktree']})
                    record.update(state='deferred', reason='unresolved device proof; preserve required hot paths',
                                  next_action='Reconcile source-bound build receipt and complete existing issue-bound device retirement before checkout archival')
                    save(); continue
        if Path(c['worktree']).is_dir():
            retire(config, state, c, save)
            return
