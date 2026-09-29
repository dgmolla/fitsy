"""Retire one verified task simulator while preserving its app and raw evidence."""

import hashlib
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time


UDID = re.compile(r'^[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}$')


def command(*args):
    return subprocess.run(args, text=True, capture_output=True, timeout=20, check=True).stdout


def digest(path):
    hash_ = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            hash_.update(block)
    return hash_.hexdigest()


def durable_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('w') as output:
        json.dump(value, output, indent=2)
        output.write('\n')
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def archive_proof(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + '.tmp')
    with source.open('rb') as original, temporary.open('wb') as output:
        shutil.copyfileobj(original, output)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, destination)
    directory = os.open(destination.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    if digest(source) != digest(destination):
        raise ValueError('archived product proof differs from source')
    return {'archive': str(destination), 'sha256': digest(destination)}


def archive_raw(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_symlink():
        raise ValueError('raw archive destination is linked')
    source_hash = digest(source)
    if destination.is_file() and digest(destination) == source_hash:
        return source_hash
    temporary = destination.with_name(destination.name + '.pending')
    if temporary.exists() or temporary.is_symlink():
        temporary.unlink()
    command('cp', '-c', '-p', str(source), str(temporary))
    with temporary.open('rb') as copied:
        os.fsync(copied.fileno())
    if digest(temporary) != source_hash:
        raise ValueError('raw archive copy differs from source')
    os.replace(temporary, destination)
    directory = os.open(destination.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    return source_hash


def app_hash(directory):
    hash_ = hashlib.sha256()
    # Node's product-flow treeHash sorts full path strings, not Path components.
    for path in sorted(directory.rglob('*'), key=str):
        if path.is_symlink():
            raise ValueError('app contains a symlink')
        if path.is_file():
            hash_.update(str(path.relative_to(directory)).encode() + b'\0')
            with path.open('rb') as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    hash_.update(block)
    return hash_.hexdigest()


def input_hash(worktree, mobile_only=False):
    """Match the product-flow inputHash over current tracked and untracked inputs."""
    env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    paths = subprocess.check_output(['git', '-C', str(worktree), 'ls-files', '-z', '--cached',
                                     '--others', '--exclude-standard'], env=env).decode().split('\0')
    hash_ = hashlib.sha256()
    for relative in sorted(set(paths)):
        if not relative or relative.startswith('.evidence/') or relative.endswith('.md'):
            continue
        if mobile_only and not re.match(r'^(apps/mobile/(?!e2e/)|packages/shared/|package(-lock)?\.json$)', relative):
            continue
        hash_.update(relative.encode() + b'\0')
        path = worktree / relative
        hash_.update(path.read_bytes() if path.exists() else b'<deleted>')
        hash_.update(b'\0')
    return hash_.hexdigest()


def recipe_hash(worktree):
    files = ('product-flow.mjs', 'build-profile.mjs')
    return hashlib.sha256(b'\0'.join((worktree / 'scripts/sim' / name).read_bytes()
                                      for name in files)).hexdigest()


def checked_file(root, relative, expected):
    if not isinstance(relative, str) or not re.fullmatch(r'[0-9a-f]{64}', expected or ''):
        raise ValueError('receipt file or digest missing')
    file = (root / relative).resolve()
    if not file.is_relative_to(root.resolve()) or not file.is_file() or digest(file) != expected:
        raise ValueError(f'receipt file missing or changed: {relative}')
    return file


def evidence(worktree, udid):
    build = worktree / '.evidence/product-build/receipt.json'
    report_file = worktree / '.evidence/product-flow/report.json'
    receipt, report = json.loads(build.read_text()), json.loads(report_file.read_text())
    if (receipt.get('simulator') != udid or report.get('simulator') != udid or
            report.get('result') != 'pass' or report.get('appHash') != receipt.get('appHash') or
            report.get('evidenceMode') != 'final-candidate' or not report.get('finishedAt') or
            not report.get('flows')):
        raise ValueError('build and passing product-flow identities do not match device')
    if (receipt.get('buildMode') != 'embedded-release' or receipt.get('configuration') != 'Release' or
            report.get('buildMode') != receipt.get('buildMode')):
        raise ValueError('Metro-dependent app is not a compatible retained export')
    for field in ('configHash', 'nativeSourceHash', 'buildRecipeHash', 'bundleHash', 'storeMode'):
        if not receipt.get(field) or report.get(field) != receipt[field]:
            raise ValueError(f'build and report {field} identities differ')
    if (report.get('inputHash') != input_hash(worktree) or
            receipt['nativeSourceHash'] != input_hash(worktree, mobile_only=True) or
            receipt['buildRecipeHash'] != recipe_hash(worktree)):
        raise ValueError('product-flow source or build identity is stale')
    app = Path(receipt['app']).resolve()
    if not app.is_relative_to((worktree / '.evidence/product-build').resolve()) or not app.is_dir():
        raise ValueError('exported app is missing or outside claim checkout')
    if app_hash(app) != receipt['appHash']:
        raise ValueError('exported app digest changed')
    if not (app / 'main.jsbundle').is_file() or digest(app / 'main.jsbundle') != receipt['bundleHash']:
        raise ValueError('embedded app bundle digest changed')
    root = report_file.parent
    names = set()
    for flow in report['flows']:
        for field, hash_field in (('commands', 'sha256'), ('screenshot', 'screenshotHash'),
                                  ('captureReceipt', 'captureReceiptHash'),
                                  ('attachmentCloseout', 'attachmentCloseoutHash'),
                                  ('video', 'videoHash')):
            if field in flow:
                checked_file(root, flow[field], flow.get(hash_field))
        if not flow.get('commands') or not flow.get('captureReceipt') or not flow.get('attachmentCloseout'):
            raise ValueError('product-flow assertion is incomplete')
        name = flow.get('name')
        if not isinstance(name, str) or name in names:
            raise ValueError('product-flow name is missing or duplicated')
        names.add(name)
        source = flow.get('source')
        if not isinstance(source, str) or not re.fullmatch(r'apps/mobile/e2e/flows/[a-z0-9-]+\.yaml', source):
            raise ValueError('product-flow source path is invalid')
        checked_file(worktree, source, flow.get('sourceHash'))
        commands = json.loads((root / flow['commands']).read_text())
        if not isinstance(commands, list) or not commands:
            raise ValueError('empty product-flow command report')
        applied = [row['command']['applyConfigurationCommand'].get('config', {}) for row in commands
                   if 'applyConfigurationCommand' in row.get('command', {})]
        assertions = [row for row in commands if 'assertConditionCommand' in row.get('command', {}) and
                      row['command']['assertConditionCommand'].get('optional') is not True]
        if (not any(config.get('appId') == 'com.fitsy.mobile' and config.get('name', name) == name for config in applied) or
                not assertions or any(row.get('metadata', {}).get('status') != 'COMPLETED' for row in assertions) or
                any(row.get('metadata', {}).get('status') == 'FAILED' for row in commands)):
            raise ValueError('required product-flow assertions did not pass')
        if not (root / flow['screenshot']).read_bytes().startswith(bytes.fromhex('89504e470d0a1a0a')):
            raise ValueError('product-flow screenshot is not PNG')
        captures = [json.loads(line) for line in (root / flow['captureReceipt']).read_text().splitlines() if line]
        if not captures or any(row.get('udid') != udid or row.get('preferredScreenCaptureFormat') != 'screenshots' for row in captures):
            raise ValueError('XCTest capture receipt is incomplete')
        closeout = json.loads((root / flow['attachmentCloseout']).read_text())
        if closeout.get('udid') != udid or closeout.get('generated', {}).get('videos') != 0 or closeout.get('deleted') != []:
            raise ValueError('XCTest attachment closeout is incomplete')
    if not {'cold-start-welcome', 'signin-options'}.issubset(names):
        raise ValueError('baseline product-flow proof is missing')
    for entry in report.get('exploration', []):
        if entry.get('trace'):
            checked_file(root, entry['trace'], entry.get('sha256'))
    return build, report_file, app


def device(udid, issue, device_root):
    devices = json.loads(command('xcrun', 'simctl', 'list', 'devices', '--json'))['devices']
    matches = [entry for entries in devices.values() for entry in entries if entry.get('udid') == udid]
    if not matches:
        raise ValueError('device is absent')
    if len(matches) != 1 or matches[0].get('state') != 'Shutdown':
        raise ValueError('device is ambiguous or not shut down')
    if not re.fullmatch(rf'Fitsy-Issue-{issue}(?:-(?:Normal|Small))?', matches[0].get('name', '')):
        raise ValueError('device name does not match verified issue')
    path = (device_root / udid).resolve()
    if not path.is_dir() or path.is_symlink():
        raise ValueError('device storage missing or linked')
    return path


def idle(udid, worktree, device_path, claim_file):
    if claim_file.exists():
        claim = json.loads(claim_file.read_text())
        if claim.get('expires', 0) > time.time():
            raise ValueError('simulator has an active owner claim')
    processes = command('ps', '-axo', 'command=')
    if any(udid in line or str(worktree) in line for line in processes.splitlines()
           if 'retire_task_device.py' not in line):
        raise ValueError('simulator or checkout is referenced by a live process')
    opened = subprocess.run(['lsof', '+D', str(device_path)], text=True, capture_output=True, timeout=20)
    if opened.returncode not in (0, 1) or opened.stdout.strip() or opened.stderr.strip():
        raise ValueError('device has open files or ownership scan failed')
    checkout_opened = subprocess.run(['lsof', '+D', str(worktree)], text=True,
                                     capture_output=True, timeout=20)
    if (checkout_opened.returncode not in (0, 1) or checkout_opened.stdout.strip() or
            checkout_opened.stderr.strip()):
        raise ValueError('claim checkout has an active process or ownership scan failed')


def reconcile_absent(target, issue, udid, worktree, device_root):
    """Complete only a durable delete intent whose archive still verifies."""
    if (device_root / udid).exists() or (device_root / udid).is_symlink():
        raise ValueError('device directory still exists despite absent simulator listing')
    intent_file, mapping_file = target / 'delete-intent.json', target / 'mapping.json'
    if not intent_file.is_file() or not mapping_file.is_file():
        raise ValueError('device is absent')
    intent = json.loads(intent_file.read_text())
    if (intent.get('issue') != issue or intent.get('udid') != udid or
            intent.get('worktree') != str(worktree) or intent.get('mappingSha256') != digest(mapping_file)):
        raise ValueError('absent device has no matching durable delete intent')
    mapping = json.loads(mapping_file.read_text())
    if (mapping.get('issue') != issue or mapping.get('udid') != udid or
            mapping.get('worktree') != str(worktree)):
        raise ValueError('absent device archive identity differs')
    for entry in mapping['attachments']:
        archive = Path(entry['archive']).resolve()
        if not archive.is_relative_to(target.resolve()) or digest(archive) != entry['sha256']:
            raise ValueError('absent device archive digest differs')
    proof = mapping.get('proof', [])
    if len(proof) != 2:
        raise ValueError('absent device archived proof is incomplete')
    for entry in proof:
        archive = Path(entry['archive']).resolve()
        if not archive.is_relative_to(target.resolve()) or digest(archive) != entry['sha256']:
            raise ValueError('absent device archived proof digest differs')
    build, report = (json.loads(Path(entry['archive']).read_text()) for entry in proof)
    if (build.get('simulator') != udid or report.get('simulator') != udid or
            report.get('result') != 'pass' or report.get('appHash') != mapping.get('appHash')):
        raise ValueError('absent device archived proof identity differs')
    retired = target / 'retired.json'
    if retired.is_file():
        return json.loads(retired.read_text())
    mapping.update({'deleted': True, 'deletionOutcome': 'observed absent after durable intent',
                    'freeAfterBytes': shutil.disk_usage(device_root).free})
    durable_json(retired, mapping)
    return mapping


def raw_files(source_root):
    entries = list(source_root.glob('*/Attachments/**/*'))
    if any(path.is_symlink() for path in entries):
        raise ValueError('raw attachment tree contains a symlink')
    return sorted(path for path in entries if path.is_file())


def retire(*, issue, udid, worktree, archive_root, device_root, claim_file,
           confirm_verified=lambda: True):
    """Serialize the final owner scan and delete with simulator commands."""
    lock_file = Path(claim_file).with_suffix('.lock')
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(lock_file, os.O_CREAT | os.O_RDWR, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _retire_locked(issue=issue, udid=udid, worktree=worktree,
                              archive_root=archive_root, device_root=device_root,
                              claim_file=claim_file, confirm_verified=confirm_verified)


def _retire_locked(*, issue, udid, worktree, archive_root, device_root, claim_file,
                   confirm_verified):
    """Called under dispatcher.lock and the shared simulator claim lock."""
    if not isinstance(issue, int) or issue < 1 or not UDID.fullmatch(udid or ''):
        raise ValueError('issue or device identity invalid')
    worktree, archive_root, device_root = (Path(path).resolve() for path in (worktree, archive_root, device_root))
    claim_file = Path(claim_file)
    target = archive_root / udid
    try:
        device_path = device(udid, issue, device_root)
    except ValueError as error:
        if str(error) == 'device is absent':
            return reconcile_absent(target, issue, udid, worktree, device_root)
        raise
    build, report, app = evidence(worktree, udid)
    idle(udid, worktree, device_path, claim_file)
    source_root = device_path / 'data/Containers/Data/InternalDaemon'
    if not source_root.is_dir() or source_root.is_symlink():
        raise ValueError('raw attachment inventory is unavailable')
    sources = raw_files(source_root)
    mapping = []
    for source in sources:
        if source.is_symlink() or not source.resolve().is_relative_to(device_path):
            raise ValueError('raw attachment has unsafe path')
        relative = source.relative_to(device_path)
        destination = target / relative
        source_hash = archive_raw(source, destination)
        mapping.append({'source': str(source), 'archive': str(destination),
                        'sha256': source_hash, 'bytes': source.stat().st_size})
    manifest = {'schema': 'fitsy.simulator-retirement.v1', 'issue': issue, 'udid': udid,
                'worktree': str(worktree), 'buildReceipt': str(build), 'report': str(report),
                'app': str(app), 'appHash': app_hash(app), 'attachments': mapping,
                'freeBeforeBytes': shutil.disk_usage(device_root).free}
    manifest['proof'] = [archive_proof(build, target / 'proof/build-receipt.json'),
                         archive_proof(report, target / 'proof/product-flow-report.json')]
    durable_json(target / 'mapping.json', manifest)
    # The source may change while copies are made. Check ownership and every byte again.
    device(udid, issue, device_root)
    evidence(worktree, udid)
    idle(udid, worktree, device_path, claim_file)
    if raw_files(source_root) != sources:
        raise ValueError('raw attachment inventory changed before deletion')
    for entry in mapping:
        if digest(Path(entry['source'])) != entry['sha256'] or digest(Path(entry['archive'])) != entry['sha256']:
            raise ValueError('raw attachment changed before deletion')
    if (digest(build) != manifest['proof'][0]['sha256'] or
            digest(report) != manifest['proof'][1]['sha256']):
        raise ValueError('product proof changed before deletion')
    if not confirm_verified():
        raise ValueError('issue is no longer terminal-verified before deletion')
    durable_json(target / 'delete-intent.json', {'issue': issue, 'udid': udid,
        'worktree': str(worktree), 'mappingSha256': digest(target / 'mapping.json')})
    command('xcrun', 'simctl', 'delete', udid)
    manifest['freeAfterBytes'] = shutil.disk_usage(device_root).free
    manifest['deleted'] = True
    manifest['deletionOutcome'] = 'simctl delete returned successfully'
    durable_json(target / 'retired.json', manifest)
    return manifest
