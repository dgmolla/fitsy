#!/usr/bin/env python3
"""Supervise an owned DB command and its descendants under one OS lock."""
import fcntl
import hashlib
import json
import os
import pwd
import re
import shlex
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path


def private(path, directory=False):
    value = path.lstat()
    expected = 0o700 if directory else 0o600
    if (path.is_symlink() or path.resolve() != path or value.st_uid != os.getuid()
            or stat.S_IMODE(value.st_mode) != expected
            or not (stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode))
            or (not directory and value.st_nlink != 1)):
        raise RuntimeError('phase authority lacks canonical private custody')
    for parent in path.parents:
        observed = parent.lstat()
        if (parent.is_symlink() or observed.st_uid not in (0, os.getuid())
                or stat.S_IMODE(observed.st_mode) & 0o022):
            raise RuntimeError('phase custody has a writable or unowned ancestor')


def phase_authority(root):
    # Account data is the same authority used by installed review admission.
    # HOME and caller-selected alternate stores cannot select approval storage.
    account = Path(pwd.getpwuid(os.getuid()).pw_dir)
    if os.environ.get('HOME') != str(account):
        raise RuntimeError('phase request has a noncanonical account HOME')
    admin = account / '.fitsy-review'
    private(admin, True)
    private(admin / 'operators', True)
    binding = json.loads((root / '.evidence/delivery/binding.json').read_text())
    issue = binding.get('issue')
    if type(issue) is not int or issue < 1:
        raise RuntimeError('phase request has no actual delivery issue')
    authority = admin / 'operators' / f'issue-{issue}-phase-admission.json'
    private(authority)
    data = json.loads(authority.read_text())
    fields = {'version', 'issue', 'candidate_root', 'source_sha', 'base_sha', 'selected_package_path',
              'selected_package_sha', 'completed_manifest_sha256', 'review_ledger_sha256', 'review_control_sha',
              'native_peak_bytes', 'cold_required_bytes', 'receipt_directory', 'execution_id', 'files_sha256'}
    if (not isinstance(data, dict) or set(data) != fields or data.get('version') != 1
            or data.get('candidate_root') != str(root) or data.get('issue') != issue):
        raise RuntimeError('phase authority does not own this candidate root')
    if (any(not re.fullmatch(r'[0-9a-f]{40}', data.get(key, '')) for key in
            ('source_sha', 'base_sha', 'selected_package_sha', 'review_control_sha'))
            or not re.fullmatch(r'[0-9a-f-]{36}', data.get('execution_id', ''))
            or type(data['native_peak_bytes']) is not int or data['native_peak_bytes'] <= 0
            or type(data['cold_required_bytes']) is not int
            or data['cold_required_bytes'] < data['native_peak_bytes'] + 4294967296):
        raise RuntimeError('phase authority revisions or fixed budgets are invalid')
    git_env = {key: value for key, value in os.environ.items() if not key.startswith('GIT_')}
    def git(path, *args):
        return subprocess.check_output(['/Applications/Xcode.app/Contents/Developer/usr/bin/git', '-C',
                                        str(path), *args], env=git_env, text=True, timeout=15).strip()
    package = Path(data['selected_package_path'])
    if (not package.is_absolute() or package.resolve() != package or package == root
            or git(root, 'rev-parse', 'HEAD') != data['source_sha']
            or git(root, 'rev-parse', 'origin/main') != data['base_sha']
            or git(root, 'status', '--porcelain', '--untracked-files=all')
            or git(package, 'rev-parse', 'HEAD') != data['selected_package_sha']
            or git(package, 'status', '--porcelain', '--untracked-files=all')):
        raise RuntimeError('phase source or selected package changed before helper')
    completed = admin / 'completed' / f'issue-{issue}.json'
    ledger = account / '.cache/fitsy-review/budgets' / f'issue-{issue}.jsonl'
    private(admin / 'completed', True)
    for path, field in ((completed, 'completed_manifest_sha256'), (ledger, 'review_ledger_sha256')):
        private(path)
        if hashlib.sha256(path.read_bytes()).hexdigest() != data[field]:
            raise RuntimeError('canonical review evidence changed before helper')
    review = json.loads(completed.read_text())
    if any(review.get(key) != data[field] for key, field in
           (('source_sha', 'source_sha'), ('base_sha', 'base_sha'), ('control_sha', 'review_control_sha'))):
        raise RuntimeError('canonical review source/control distinction is invalid')
    packet = Path(data['receipt_directory'])
    private(packet, True)
    if any(packet == path or path in packet.parents for path in (root, package, admin)):
        raise RuntimeError('phase receipt destination overlaps protected or source custody')
    expected = [root / 'scripts/verify' / name for name in ('db-lock.py', 'resource-admission.mjs', 'local-db.mjs', 'local-db-control.mjs', 'docker-runtime.mjs')]
    expected += [packet / name for name in ('run.py', 'task.sh', 'db_observation.py')]
    if not isinstance(data['files_sha256'], dict) or set(data['files_sha256']) != {str(path) for path in expected}:
        raise RuntimeError('phase executable identities are incomplete')
    for path in expected:
        if path.resolve() != path or hashlib.sha256(path.read_bytes()).hexdigest() != data['files_sha256'][str(path)]:
            raise RuntimeError('phase executable bytes changed before helper')
    return data


def assert_phase_lock(root, lock_pid, descriptor, operation='--locked-run'):
    path = root / '.evidence/verify/db.lock'
    actual = os.fstat(descriptor)
    expected = path.lstat()
    if (path.is_symlink() or path.resolve() != path or actual.st_dev != expected.st_dev or actual.st_ino != expected.st_ino
            or actual.st_uid != os.getuid() or not stat.S_ISREG(actual.st_mode)
            or stat.S_IMODE(actual.st_mode) != 0o600 or actual.st_nlink != 1):
        raise RuntimeError('phase lock descriptor does not own the exact lock inode')
    probe = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pass
        else:
            fcntl.flock(probe, fcntl.LOCK_UN)
            raise RuntimeError('phase descriptor was not already holding the kernel lock')
        # A different holder cannot pass this second assertion.
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    finally:
        os.close(probe)
    raw = subprocess.check_output(['/bin/ps', '-p', str(lock_pid), '-o', 'command='], text=True).strip()
    argv = shlex.split(raw)
    arguments = argv[1:]
    if arguments[:1] == ['-I']:
        arguments = arguments[1:]
    if (len(arguments) < 5 or Path(arguments[0]).resolve() != Path(__file__).resolve()
            or arguments[1] != str(root) or Path(arguments[3]).resolve() != root / 'scripts/verify/local-db.mjs'
            or arguments[4] != operation):
        raise RuntimeError('phase lock supervisor is not the actual fixed DB launcher')


def bound_phase_receipt(root, data, lock_pid, live=True):
    directory = Path(data['receipt_directory'])
    receipt = directory / f'phase-admission-{lock_pid}.json'
    private(receipt)
    value = json.loads(receipt.read_text())
    account = Path(pwd.getpwuid(os.getuid()).pw_dir)
    authority = account / '.fitsy-review/operators' / f"issue-{data['issue']}-phase-admission.json"
    started = (' '.join(subprocess.check_output(
        ['/bin/ps', '-p', str(lock_pid), '-o', 'lstart='], text=True).split()) if live else None)
    expected = {'state': 'phase-ready', 'issue': data['issue'], 'source_sha': data['source_sha'],
                'selected_package_sha': data['selected_package_sha'], 'execution_id': data['execution_id'],
                'completed_manifest_sha256': data['completed_manifest_sha256'],
                'review_ledger_sha256': data['review_ledger_sha256'], 'lock_pid': lock_pid,
                'authority_sha256': hashlib.sha256(authority.read_bytes()).hexdigest(),
                'authority_path': str(authority), 'receipt_path': str(receipt)}
    if (any(value.get(key) != expected_value for key, expected_value in expected.items())
            or value.get('lock_identity', {}).get('pid') != lock_pid
            or not value.get('lock_identity', {}).get('lstart')
            or (live and (not started or value.get('lock_identity', {}).get('lstart') != started))):
        raise RuntimeError('phase receipt does not bind the current actual locked invocation')
    return value, receipt


def phase_context(root, lock_pid, fresh=True):
    data = phase_authority(root)
    value, receipt = bound_phase_receipt(root, data, lock_pid)
    acquired = Path(data['receipt_directory']) / f'phase-acquisition-{lock_pid}.json'
    if fresh and (os.path.lexists(acquired) or os.path.lexists(str(acquired) + '.tmp')):
        raise RuntimeError('phase acquisition already exists; preserve prior invocation')
    return {'receipt': value, 'admission_sha256': hashlib.sha256(receipt.read_bytes()).hexdigest(),
            'acquisition_path': str(acquired)}


def bound_phase_acquisition(ready, receipt, acquired):
    private(acquired)
    value = json.loads(acquired.read_text())
    container = value.get('container')
    if (value.get('state') != 'phase-acquired'
            or value.get('admission_sha256') != hashlib.sha256(receipt.read_bytes()).hexdigest()
            or any(value.get(key) != item for key, item in ready.items() if key not in ('state', 'at'))
            or value.get('at', 0) < ready['at']
            or not isinstance(container, dict) or set(container) != {'id', 'image_id'}
            or any(not isinstance(item, str) or not item for item in container.values())):
        raise RuntimeError('phase acquisition is not bound to canonical admission')
    return container


def phase_reader_context(root):
    rows = {}
    for line in subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,lstart=,command='], text=True).splitlines():
        match = re.fullmatch(r'\s*(\d+)\s+(\d+)\s+(.{24})\s+(.+)', line)
        if match:
            rows[int(match[1])] = {'pid': int(match[1]), 'ppid': int(match[2]),
                                   'lstart': match[3].strip(), 'command': match[4]}
    ancestors = []
    pid = os.getppid()
    while pid in rows and len(ancestors) < 64:
        if any(row['pid'] == pid for row in ancestors):
            raise RuntimeError('phase reader process ancestry is cyclic')
        ancestors.append(rows[pid])
        pid = rows[pid]['ppid']
    for parent in ancestors:
        arguments = shlex.split(parent['command'])[1:]
        if arguments[:1] == ['-I']:
            arguments = arguments[1:]
        if (len(arguments) >= 5 and arguments[0] == str(Path(__file__).resolve())
                and arguments[1] == str(root) and arguments[3] == str(root / 'scripts/verify/local-db.mjs')
                and arguments[4] == '--locked-run'):
            context = phase_context(root, parent['pid'], fresh=False)
            shipping = context['receipt'].get('shipping_identity', {})
            if not any(row['pid'] == shipping.get('pid') and row['lstart'] == shipping.get('lstart') for row in ancestors):
                raise RuntimeError('phase reader lacks the actual admitted shipping ancestry')
            # The actual admitted supervisor is an ancestor and still holds the
            # exact canonical kernel lock; no caller-selected PID grants this.
            lock = root / '.evidence/verify/db.lock'
            private(lock)
            descriptor = os.open(lock, os.O_RDWR | os.O_NOFOLLOW)
            try:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    pass
                else:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
                    raise RuntimeError('phase reader lock is not held')
            finally:
                os.close(descriptor)
            result = subprocess.run([str(root / 'scripts/verify/shipping-session.mjs'), '--check'],
                                    cwd=root, stdin=subprocess.DEVNULL, capture_output=True, timeout=15)
            if result.returncode:
                raise RuntimeError('phase reader shipping session is unverified')
            acquired = Path(context['acquisition_path'])
            container = bound_phase_acquisition(context['receipt'],
                                               Path(context['receipt']['receipt_path']), acquired)
            return {'identity': context['receipt']['readiness']['identity'], 'container': container}
    raise RuntimeError('phase reader is not descended from the actual fixed DB supervisor')


def phase_cleanup_context(root):
    data = phase_authority(root)
    directory = Path(data['receipt_directory'])
    expected_id = os.environ.get('FITSY_VERIFY_OWNED_DB')
    expected_image = os.environ.get('FITSY_VERIFY_DB_IMAGE')
    if not expected_id or not expected_image:
        raise RuntimeError('phase cleanup requires both acquired container identities')
    for acquired in directory.glob('phase-acquisition-*.json'):
        private(acquired)
        value = json.loads(acquired.read_text())
        if value.get('container') != {'id': expected_id, 'image_id': expected_image}:
            continue
        lock_pid = value.get('lock_pid')
        if type(lock_pid) is not int or acquired.name != f'phase-acquisition-{lock_pid}.json':
            raise RuntimeError('phase cleanup acquisition identity is malformed')
        ready, receipt = bound_phase_receipt(root, data, lock_pid, live=False)
        container = bound_phase_acquisition(ready, receipt, acquired)
        return {'identity': ready['readiness']['identity'], 'container': container}
    raise RuntimeError('phase cleanup lacks a canonical actual acquisition')


if sys.argv[1:2] == ['--phase-reader-runtime']:
    try:
        print(json.dumps(phase_reader_context(Path(sys.argv[2]))))
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
    sys.exit(0)


if sys.argv[1:2] == ['--phase-cleanup-runtime']:
    try:
        root = Path(sys.argv[2])
        assert_phase_lock(root, int(sys.argv[3]), 3, '--locked-stop')
        print(json.dumps(phase_cleanup_context(root)))
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
    sys.exit(0)


if sys.argv[1:2] in (['--assert-phase-lock'], ['--phase-context']):
    try:
        root = Path(sys.argv[2])
        assert_phase_lock(root, int(sys.argv[3]), 3)
        if sys.argv[1] == '--phase-context':
            print(json.dumps(phase_context(root, int(sys.argv[3]))))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
    sys.exit(0)

if sys.argv[1:2] == ["--watch"]:
    # A worker killed with SIGKILL can leave test descendants alive. The
    # detached guardian keeps the shared lock until their group exits.
    group = int(sys.argv[2])
    while True:
        try:
            os.killpg(group, 0)
        except ProcessLookupError:
            break
        time.sleep(0.05)
    sys.exit(0)

root, executable, *command = sys.argv[1:]
directory = os.path.join(root, ".evidence", "verify")
os.makedirs(directory, mode=0o700, exist_ok=True)
fd = os.open(os.path.join(directory, "db.lock"), os.O_CREAT | os.O_RDWR, 0o600)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit(75)
environment = dict(os.environ, FITSY_VERIFY_DB_LOCKED="1", FITSY_VERIFY_DB_LOCK_FD=str(fd))
if environment.get("FITSY_VERIFY_DB_PHASE"):
    # This opt-in phase uses only a fixed source-controlled admission command.
    # The flock is already held; an arbitrary caller-selected command or path
    # never becomes authority to wake Docker or reset a database.
    actual_root = Path(root)
    expected = actual_root / "scripts/verify/local-db.mjs"
    if (environment["FITSY_VERIFY_DB_PHASE"] != "1" or len(command) < 2
            or actual_root.resolve() != actual_root or Path(command[0]) != expected
            or command[1] != "--locked-run"
            or Path(executable).resolve() != Path('/opt/homebrew/bin/node').resolve()
            or any(environment.get(key) for key in ('NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'ENV'))):
        sys.exit(1)
    try:
        phase_authority(actual_root)
        assert_phase_lock(actual_root, os.getpid(), fd)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
    # Metadata and an environment token never replace the real consumer.
    session = subprocess.run([str(actual_root / 'scripts/verify/shipping-session.mjs'), '--check'],
                             cwd=actual_root, env=environment, stdin=subprocess.DEVNULL)
    if session.returncode:
        sys.exit(session.returncode or 1)
    environment['FITSY_VERIFY_DB_LOCK_FD'] = str(fd)
    phase = Path(root, "scripts/verify/resource-admission.mjs").resolve()
    admitted = subprocess.run([executable, str(phase), "--owned-db-phase"], env=environment,
                              cwd=actual_root, pass_fds=(fd,), stdin=subprocess.DEVNULL)
    if admitted.returncode != 0:
        sys.exit(admitted.returncode or 1)
# The verification worker holds the same kernel lock. If this coordinator is
# killed, a live worker still prevents the next run from resetting its DB.
child = subprocess.Popen([executable, *command], env=environment, start_new_session=True, pass_fds=(fd,))
subprocess.Popen([sys.executable, __file__, "--watch", str(child.pid)], pass_fds=(fd,),
                 start_new_session=True, stdin=subprocess.DEVNULL,
                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def stop_group(sig):
    try:
        os.killpg(child.pid, sig)
    except ProcessLookupError:
        pass


def interrupt(sig, _frame):
    stop_group(sig)


signal.signal(signal.SIGINT, interrupt)
signal.signal(signal.SIGTERM, interrupt)
status = child.wait()
# A crashed coordinator can leave migrations or tests running in its process
# group. Stop them before releasing the lock, so the next run cannot reset DB.
stop_group(signal.SIGTERM)
time.sleep(0.05)
stop_group(signal.SIGKILL)
sys.exit(status if status >= 0 else 128 - status)
