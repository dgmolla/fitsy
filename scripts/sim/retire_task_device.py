"""Retire one verified task simulator while preserving its app and raw evidence."""

import hashlib
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
            not report.get('flows')):
        raise ValueError('build and passing product-flow identities do not match device')
    app = Path(receipt['app']).resolve()
    if not app.is_relative_to((worktree / '.evidence/product-build').resolve()) or not app.is_dir():
        raise ValueError('exported app is missing or outside claim checkout')
    if app_hash(app) != receipt['appHash']:
        raise ValueError('exported app digest changed')
    root = report_file.parent
    for flow in report['flows']:
        for field, hash_field in (('commands', 'sha256'), ('screenshot', 'screenshotHash'),
                                  ('captureReceipt', 'captureReceiptHash'),
                                  ('attachmentCloseout', 'attachmentCloseoutHash'),
                                  ('video', 'videoHash')):
            if field in flow:
                checked_file(root, flow[field], flow.get(hash_field))
        if not flow.get('commands') or not flow.get('captureReceipt') or not flow.get('attachmentCloseout'):
            raise ValueError('product-flow assertion is incomplete')
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


def reconcile_absent(target, issue, udid, worktree, device_root):
    """Complete only a durable delete intent whose archive still verifies."""
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
    evidence(worktree, udid)
    for entry in mapping['attachments']:
        archive = Path(entry['archive']).resolve()
        if not archive.is_relative_to(target.resolve()) or digest(archive) != entry['sha256']:
            raise ValueError('absent device archive digest differs')
    retired = target / 'retired.json'
    if retired.is_file():
        return json.loads(retired.read_text())
    mapping.update({'deleted': True, 'deletionOutcome': 'observed absent after durable intent',
                    'freeAfterBytes': shutil.disk_usage(device_root).free})
    durable_json(retired, mapping)
    return mapping


def retire(*, issue, udid, worktree, archive_root, device_root, claim_file):
    """Called under dispatcher.lock only for an exact terminal-verified claim."""
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
    if target.exists() and not (target / 'mapping.json').exists():
        raise ValueError('incomplete prior archive; inspect before retrying')
    source_root = device_path / 'data/Containers/Data/InternalDaemon'
    if any(path.is_symlink() for path in source_root.glob('*/Attachments/**/*')):
        raise ValueError('raw attachment tree contains a symlink')
    sources = sorted(path for path in source_root.glob('*/Attachments/**/*') if path.is_file())
    if not sources:
        raise ValueError('raw attachment inventory is empty or unavailable')
    mapping = []
    for source in sources:
        if source.is_symlink() or not source.resolve().is_relative_to(device_path):
            raise ValueError('raw attachment has unsafe path')
        relative = source.relative_to(device_path)
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            command('cp', '-c', '-p', str(source), str(destination))
        source_hash = digest(source)
        if digest(destination) != source_hash:
            raise ValueError('raw archive digest differs')
        mapping.append({'source': str(source), 'archive': str(destination),
                        'sha256': source_hash, 'bytes': source.stat().st_size})
    manifest = {'schema': 'fitsy.simulator-retirement.v1', 'issue': issue, 'udid': udid,
                'worktree': str(worktree), 'buildReceipt': str(build), 'report': str(report),
                'app': str(app), 'appHash': app_hash(app), 'attachments': mapping,
                'freeBeforeBytes': shutil.disk_usage(device_root).free}
    durable_json(target / 'mapping.json', manifest)
    # The source may change while copies are made. Check ownership and every byte again.
    device(udid, issue, device_root)
    evidence(worktree, udid)
    idle(udid, worktree, device_path, claim_file)
    for entry in mapping:
        if digest(Path(entry['source'])) != entry['sha256'] or digest(Path(entry['archive'])) != entry['sha256']:
            raise ValueError('raw attachment changed before deletion')
    durable_json(target / 'delete-intent.json', {'issue': issue, 'udid': udid,
        'worktree': str(worktree), 'mappingSha256': digest(target / 'mapping.json')})
    command('xcrun', 'simctl', 'delete', udid)
    manifest['freeAfterBytes'] = shutil.disk_usage(device_root).free
    manifest['deleted'] = True
    manifest['deletionOutcome'] = 'simctl delete returned successfully'
    durable_json(target / 'retired.json', manifest)
    return manifest
