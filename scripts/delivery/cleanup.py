#!/usr/bin/env python3
"""On-demand cleanup of explicitly recorded disposable task resources; dry-run by default."""
import argparse
from contextlib import ExitStack
from datetime import datetime
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time

# One independently granted exception, not a general attachment retention policy.
ATTACHMENT_APPROVAL = '6716597294'
ATTACHMENT_APPROVAL_SHA = '4a7c397987e38c1e2e30152aab1862661ef4f2f99946fae09c2c2f60509856fb'
ATTACHMENT_PROPOSAL_SHA = 'aabf2e5d48ae01c9124263384a1c93efd345aa156d15736dfcb17385b3c17245'
ATTACHMENT_COUNT, ATTACHMENT_BYTES = 16119, 10361606936
ATTACHMENT_REPRESENTATIVES, ATTACHMENT_RETAINED_BYTES = 851, 657140483
ATTACHMENT_DEVICE = '98638215-7437-4A09-BF9F-C9E699E303B6'
ATTACHMENT_DEVICE_NAME = 'Fitsy issue753 PID18174 normal'
ATTACHMENT_CONTAINER = 'C3858678-AEE6-40F7-B38F-C380441CA3BE'
# This successor is only a proposal until a separate exact owner grant exists.
NEXT_ATTACHMENT_PROPOSAL_SHA = '8d478c4e54a1edf6541a6567cc253be32284ec07bbf170e391e7e8223f0bc237'
NEXT_ATTACHMENT_COUNT, NEXT_ATTACHMENT_BYTES = 12201, 7920250995
NEXT_ATTACHMENT_REPRESENTATIVES, NEXT_ATTACHMENT_RETAINED_BYTES = 714, 542655061


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


def stable_file_attributes(value):
    # Reading can update access time without changing content or ownership.
    return (value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid,
            value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def verified_png(path, record, identity=False):
    require(path.is_absolute() and path == path.resolve(), 'symlinked attachment or representative')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
                and before.st_nlink == 1 and before.st_size == record['bytes'], 'file type, owner or size changed')
        if identity:
            # Node's snapshot converts each timespec part before adding them.
            # Multiplying Python's already-rounded seconds loses different bits.
            modified_ms = (before.st_mtime_ns // 1_000_000_000) * 1000 + (before.st_mtime_ns % 1_000_000_000) / 1_000_000
            require((before.st_dev, before.st_ino, modified_ms) ==
                    (record['device'], record['inode'], record['modifiedMs']), 'attachment identity changed')
        require(stream.read(8) == b'\x89PNG\r\n\x1a\n', 'not a PNG')
        stream.seek(0)
        require(hashlib.file_digest(stream, 'sha256').hexdigest() == record['sha256'], 'PNG hash changed')
        require(stable_file_attributes(os.fstat(stream.fileno())) == stable_file_attributes(before)
                and stable_file_attributes(path.stat()) == stable_file_attributes(before), 'PNG changed while reading')
        return before


def prepare_attachments(args):
    """Stage only duplicate groups for review; this never authorizes or deletes originals."""
    home = Path.home()
    root = home / 'fitsy-wt/issue-755-evidence/private'
    output = args.output_dir
    require(not args.apply and output is not None and output.parent == root
            and re.fullmatch(r'repair[1-9][0-9]*', output.name)
            and output == output.resolve() and output.is_dir(), 'uncertain preparation destination')
    require(args.records == args.records.resolve() and args.records.stat().st_uid == os.getuid()
            and not args.records.stat().st_mode & 0o077, 'snapshot must be private and not symlinked')
    original = args.records.read_bytes()
    snapshot = json.loads(original)
    directory = home / 'Library/Developer/CoreSimulator/Devices' / ATTACHMENT_DEVICE / \
        'data/Containers/Data/InternalDaemon' / ATTACHMENT_CONTAINER / 'Attachments'
    require(snapshot['udid'] == ATTACHMENT_DEVICE and snapshot['directories'] == [str(directory)],
            'snapshot is not the owned attachment directory')
    rows = snapshot['entries']
    require(rows and len({row['path'] for row in rows}) == len(rows), 'empty or duplicate snapshot entries')
    with ExitStack() as stack:
        lock = stack.enter_context((home / 'fitsy-refactor/loop/sim.lock').open('a'))
        fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        claim = stack.enter_context((home / '.fitsy-sim-claim.lock').open('a'))
        fcntl.flock(claim, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(not any((home / path).exists() for path in
                ('.fitsy-sim-claim.json', 'fitsy-wt/simulator.lock', 'fitsy-wt/native-build.lock')),
                'native owner or consumer lease remains')
        devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', '--json'))['devices']
        inventory = [device for group in devices.values() for device in group]
        require(any(device['udid'] == ATTACHMENT_DEVICE and device['name'] == ATTACHMENT_DEVICE_NAME
                    and device['state'] == 'Shutdown' for device in inventory)
                and not any(device['state'] == 'Booted' for device in inventory), 'device owner/state changed')
        identity = unopened(directory)
        require({str(path) for path in directory.iterdir()} == {row['path'] for row in rows},
                'attachment inventory changed')
        groups = {}
        for row in rows:
            path = Path(row['path'])
            require(path.parent == directory and row['video'] is False, 'non-PNG or escaped snapshot entry')
            digest = row.get('sha256')
            if digest is None:
                with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
                    digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            record = {**row, 'sha256': digest}
            verified_png(path, record, identity=True)
            groups.setdefault(digest, []).append(record)
        duplicates = {digest: group for digest, group in groups.items() if len(group) > 1}
        representatives = output / 'attachment-representatives'
        if representatives.exists():
            unopened(representatives)
            require({path.name for path in representatives.iterdir()} <= {digest + '.png' for digest in duplicates},
                    'unselected staging copies must be reconciled first')
        needed = sum(group[0]['bytes'] for digest, group in duplicates.items()
                     if not (representatives / (digest + '.png')).exists())
        before = shutil.disk_usage(output).free
        require(before - needed >= 8 * 2**30, 'insufficient staging capacity before copying')
        representatives.mkdir(mode=0o700, exist_ok=True)
        selected, retained = [], []
        for digest, group in sorted(duplicates.items()):
            path = representatives / (digest + '.png')
            if not path.exists():
                run('/usr/bin/ditto', '--clone', group[0]['path'], str(path))
                path.chmod(0o600)
            record = {'path': str(path), 'bytes': group[0]['bytes'], 'sha256': digest}
            verified_png(path, record)
            require(not path.stat().st_mode & 0o077, 'representative must be private')
            retained.append(record)
            selected.extend({**row, 'retained': str(path)} for row in group[1:])
        require(args.records.read_bytes() == original and unopened(directory) == identity,
                'snapshot or directory changed during preparation')
        after = shutil.disk_usage(output).free
        require(after >= 8 * 2**30, 'staging consumed the required disk floor')
        return {'status': 'proposal-only-not-approved', 'owner': {'issue': 755, 'device': ATTACHMENT_DEVICE},
                'source': run('git', '-C', str(args.repo), 'rev-parse', 'HEAD'),
                'snapshotSha256': hashlib.sha256(original).hexdigest(),
                'selectedFiles': len(selected), 'selectedBytes': sum(row['bytes'] for row in selected),
                'selected': selected, 'retainedRepresentatives': retained,
                'staging': {'requiredBytes': needed, 'freeBefore': before, 'freeAfter': after,
                            'untouchedSingletons': len(groups) - len(duplicates)},
                'projection': {'conservativeNextFullGiB': 23, 'requiredFloorGiB': 8}}


def successor_approval_body(source):
    # Root may publish this only after genuine owner approval and independent
    # review of this exact control source. A proposal or old grant cannot match.
    return f'''**TL;DR:** Owner approves the exact #755 duplicate cleanup below.

Control source: `{source}`.
Proposal SHA256: `{NEXT_ATTACHMENT_PROPOSAL_SHA}`.
Delete only {NEXT_ATTACHMENT_COUNT} duplicate PNGs totaling {NEXT_ATTACHMENT_BYTES} bytes from the owned normal986/C385 attachment directory.
Retain all {NEXT_ATTACHMENT_REPRESENTATIVES} representatives totaling {NEXT_ATTACHMENT_RETAINED_BYTES} bytes, every unselected original and every canonical recovery input.
The outside-path and younger-than-four-hours exceptions apply only to this sealed list.
Use reviewed scripts/delivery/cleanup.py dry-run, then --apply, after fresh identity, hash, no-consumer and capacity checks.'''


def approved_attachments(args):
    """Retire only the sealed owner-approved duplicates, keeping every unique byte."""
    home = Path.home()
    comment = getattr(args, 'approval_comment', None)
    successor = comment is not None
    require(not successor or type(comment) is int and comment > 0, 'invalid owner comment ID')
    evidence = home / 'fitsy-wt/issue-755-evidence/private' / ('repair25' if successor else 'repair15')
    proposal_sha = NEXT_ATTACHMENT_PROPOSAL_SHA if successor else ATTACHMENT_PROPOSAL_SHA
    count, total = (NEXT_ATTACHMENT_COUNT, NEXT_ATTACHMENT_BYTES) if successor else (ATTACHMENT_COUNT, ATTACHMENT_BYTES)
    representative_count, retained_bytes = (NEXT_ATTACHMENT_REPRESENTATIVES, NEXT_ATTACHMENT_RETAINED_BYTES) \
        if successor else (ATTACHMENT_REPRESENTATIVES, ATTACHMENT_RETAINED_BYTES)
    approval_id = str(comment) if successor else ATTACHMENT_APPROVAL
    directory = home / 'Library/Developer/CoreSimulator/Devices' / ATTACHMENT_DEVICE / \
        'data/Containers/Data/InternalDaemon' / ATTACHMENT_CONTAINER / 'Attachments'
    require(args.records == evidence / 'attachment-duplicate-proposal.json'
            and args.records.resolve() == args.records, 'not the approved proposal path')
    require(args.records.stat().st_uid == os.getuid() and not args.records.stat().st_mode & 0o077,
            'proposal must be private')
    original = args.records.read_bytes()
    require(hashlib.sha256(original).hexdigest() == proposal_sha, 'not the sealed approved proposal')
    source = run('git', '-C', str(args.repo), 'rev-parse', 'HEAD')
    require(not run('git', '-C', str(args.repo), 'status', '--porcelain'), 'cleanup requires a frozen reviewed checkout')
    if successor:
        control = Path(__file__).resolve()
        require(control == args.repo.resolve() / 'scripts/delivery/cleanup.py'
                and control.read_text().strip() == run('git', '-C', str(args.repo), 'show', 'HEAD:scripts/delivery/cleanup.py'),
                'executing control does not match the approved source')
    approval = json.loads(run('gh', 'api', 'repos/dgmolla/fitsy/issues/comments/' + approval_id))
    require(str(approval['id']) == approval_id and approval['user']['login'] == 'dgmolla', 'owner approval unavailable')
    approval_sha = hashlib.sha256(approval['body'].encode()).hexdigest()
    if successor:
        require(approval.get('issue_url') == 'https://api.github.com/repos/dgmolla/fitsy/issues/755'
                and approval['body'].rstrip('\n') == successor_approval_body(source),
                'new proposal needs its exact owner grant for this reviewed control source')
    else:
        require(approval_sha == ATTACHMENT_APPROVAL_SHA, 'owner approval changed or unavailable')
    proposal = json.loads(original)
    selected, representatives = proposal['selected'], proposal['retainedRepresentatives']
    require(proposal['owner']['issue'] == 755 and proposal['owner']['device'] == ATTACHMENT_DEVICE
            and len(selected) == proposal['selectedFiles'] == count
            and sum(row['bytes'] for row in selected) == proposal['selectedBytes'] == total
            and len(representatives) == representative_count
            and sum(row['bytes'] for row in representatives) == retained_bytes,
            'approved scope/counts changed')
    retained = {row['path']: row for row in representatives}
    require(len(retained) == len(representatives) and len({row['path'] for row in selected}) == len(selected),
            'duplicate manifest entries')
    for row in representatives:
        require(Path(row['path']) == evidence / 'attachment-representatives' / (row['sha256'] + '.png'),
                'representative escaped preservation directory')
    for row in selected:
        path = Path(row['path'])
        require(path.parent == directory and re.fullmatch(r'[A-F0-9-]{36}', path.name) and row['video'] is False,
                'selection escaped approved attachment directory')
        require(row['retained'] in retained and
                (row['sha256'], row['bytes']) == (retained[row['retained']]['sha256'], retained[row['retained']]['bytes']),
                'missing exact-byte representative')
    binding = {'proposal': proposal_sha, 'approval': approval_id,
               'approval_sha256': approval_sha, 'source': source,
               'files': len(selected), 'bytes': total}
    if args.apply:
        require(args.dry_run_receipt is not None, 'apply requires the preceding dry-run receipt')
        receipt = json.loads(args.dry_run_receipt.read_text())
        require(receipt.get('status') == 'would-delete' and all(receipt.get(k) == v for k, v in binding.items()),
                'dry-run receipt does not match this approved source and proposal')
    with ExitStack() as stack:
        # Use the current native locks, never initialize the retired dispatcher.
        lockpath = home / 'fitsy-refactor/loop/sim.lock'
        require(lockpath.parent.is_dir(), 'canonical native lock directory unavailable')
        lock = stack.enter_context(lockpath.open('a'))
        fcntl.lockf(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        claim = stack.enter_context((home / '.fitsy-sim-claim.lock').open('a'))
        fcntl.flock(claim, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for path in (home / '.fitsy-sim-claim.json', home / 'fitsy-wt/simulator.lock', home / 'fitsy-wt/native-build.lock'):
            require(not path.exists(), 'native owner or consumer lease remains')
        devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', '--json'))['devices']
        inventory = [device for group in devices.values() for device in group]
        device = next(device for device in inventory if device['udid'] == ATTACHMENT_DEVICE)
        require(device['name'] == ATTACHMENT_DEVICE_NAME and device['state'] == 'Shutdown'
                and not any(device['state'] == 'Booted' for device in inventory), 'device owner/state changed')
        directory_identity = unopened(directory)
        unopened(evidence / 'attachment-representatives')
        for row in representatives:
            verified_png(Path(row['path']), row)
        for row in selected:
            verified_png(Path(row['path']), row, identity=True)
        free_before = shutil.disk_usage(directory).free
        projection = proposal['projection']
        require(projection['conservativeNextFullGiB'] == 23 and projection['requiredFloorGiB'] == 8,
                'approved run projection changed')
        require(args.records.read_bytes() == original and unopened(directory) == directory_identity,
                'proposal or directory changed during validation')
        removed = 0
        # Pin the checked directory; no recursive removal or caller-selected path.
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            require((os.fstat(fd).st_dev, os.fstat(fd).st_ino) == directory_identity, 'attachment directory replaced')
            if args.apply:
                for row in selected:
                    verified_png(Path(row['retained']), retained[row['retained']])
                    before = verified_png(Path(row['path']), row, identity=True)
                    require(stable_file_attributes(os.stat(Path(row['path']).name, dir_fd=fd, follow_symlinks=False))
                            == stable_file_attributes(before),
                            'attachment replaced before removal')
                    os.unlink(Path(row['path']).name, dir_fd=fd)
                    removed += 1
        finally:
            os.close(fd)
        for row in representatives:
            verified_png(Path(row['path']), row)
        missing = sum(not Path(row['path']).exists() for row in selected)
        require(missing == removed, 'unexpected removed/missing count')
        free_after = shutil.disk_usage(directory).free
        projected_free = (free_after if args.apply else free_before + total) - 23 * 2**30
        return {**binding, 'status': 'deleted' if args.apply else 'would-delete', 'removed': removed,
                'missing': missing, 'changed': 0, 'representatives': len(representatives),
                'free_before': free_before, 'free_after': free_after,
                'projected_remaining_bytes': projected_free, 'full_run_admitted': projected_free >= 8 * 2**30,
                'projected_full_bytes': 23 * 2**30, 'required_floor_bytes': 8 * 2**30}


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
    parser.add_argument('--approved-attachments', action='store_true', help='only the sealed #755 owner exception')
    parser.add_argument('--approval-comment', type=int, help='new exact #755 owner grant for the sealed successor proposal and this reviewed source')
    parser.add_argument('--prepare-attachments', action='store_true', help='stage duplicate-only proposal; no deletion authority')
    parser.add_argument('--output-dir', type=Path, help='existing private #755 repair evidence directory for preparation')
    parser.add_argument('--dry-run-receipt', type=Path, help='exact preceding attachment dry-run JSON output')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--dry-run', action='store_true', help='report only (default)')
    mode.add_argument('--apply', action='store_true', help='remove eligible exact resources')
    args = parser.parse_args()
    if args.prepare_attachments:
        require(not args.approved_attachments and args.dry_run_receipt is None and args.approval_comment is None,
                'preparation is separate from approved cleanup')
        try:
            print(json.dumps(prepare_attachments(args)))
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            raise SystemExit('Attachment preparation refused; source, ownership, preservation or staging capacity guard failed') from None
        return
    require(args.output_dir is None, 'output directory applies only to preparation')
    if args.approved_attachments:
        try:
            print(json.dumps(approved_attachments(args)))
        except ValueError as error:
            raise SystemExit('Approved attachment cleanup refused: ' + str(error)) from None
        except (OSError, KeyError, TypeError, StopIteration, subprocess.SubprocessError):
            # External command errors may contain private metadata; never echo it.
            raise SystemExit('Approved attachment cleanup refused; approval, source, identity, preservation, ownership or capacity guard failed')
        return
    require(args.dry_run_receipt is None and args.approval_comment is None,
            'dry-run receipt and owner grant apply only to approved attachments')
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
