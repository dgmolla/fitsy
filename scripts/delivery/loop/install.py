#!/usr/bin/env python3
"""Install this source into the existing loop only, preserving state and old entrypoints."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

SOURCE = Path(__file__).parent
FILES = ('driver.py', 'planner.py', 'progress.py', 'taskfiles.py', 'recovery.py', 'context.py', 'SKILL.md')


def running_legacy_owner(directory):
    processes = subprocess.run(['ps', '-axo', 'pid=,comm=,args='], capture_output=True, text=True, check=True)
    for line in processes.stdout.splitlines():
        match = re.match(r'\s*(\d+)\s+\S*python\S*\s+(.+)', line, re.I)
        if not match:
            continue
        pid, args = match.groups()
        if not re.search(r'(?:^|\s)(?:\S*/)?driver\.py(?:\s|$)', args):
            continue
        cwd = subprocess.run(['lsof', '-a', '-p', pid, '-d', 'cwd', '-Fn'], capture_output=True, text=True)
        paths = [Path(row[1:]).resolve() for row in cwd.stdout.splitlines() if row.startswith('n')]
        if not paths or directory in paths or str(directory / 'driver.py') in args:
            return True
    return False


def launcher(version, module, directory):
    return f'''#!/usr/bin/env python3
# Repository-managed loop compatibility entrypoint. State remains in the existing loop.
import os, runpy, sys
os.environ['FITSY_LOOP_DIR'] = {str(directory)!r}
sys.path.insert(0, {str(version)!r})
globals().update(runpy.run_path({str(version / (module + '.py'))!r}, run_name=__name__))
'''


def install(directory, apply=False):
    directory = Path(directory).resolve()
    if not (directory / 'driver.py').is_file() or not (directory / 'tasks').is_dir():
        raise ValueError('Select the existing loop directory, not a new dispatcher')
    state = directory / 'state.json'
    if state.exists() and not isinstance(json.loads(state.read_text()), dict):
        raise ValueError('Existing loop state is invalid')
    digest = hashlib.sha256(b''.join(name.encode() + (SOURCE / name).read_bytes() for name in FILES)).hexdigest()
    result = {'status': 'planned', 'directory': str(directory), 'source': digest,
              'entrypoints': ['driver.py', 'planner.py', 'progress.py']}
    if not apply:
        return result
    with (directory / 'driver.lock').open('a') as owner:
        try:
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Existing loop owner is active; install at its next idle restart') from None
        if running_legacy_owner(directory):
            raise ValueError('Existing legacy loop owner is active or uncertain; retain its custody')
        versions = directory / 'source'; versions.mkdir(exist_ok=True)
        version = versions / digest
        if not version.exists():
            stage = Path(tempfile.mkdtemp(prefix='.install-', dir=versions))
            try:
                for name in FILES:
                    shutil.copyfile(SOURCE / name, stage / name)
                stage.rename(version)
            finally:
                if stage.exists(): shutil.rmtree(stage)
        elif any((version / name).read_bytes() != (SOURCE / name).read_bytes() for name in FILES):
            raise ValueError('Installed source digest does not match its contents')
        for module in ('driver', 'planner', 'progress'):
            path = directory / (module + '.py')
            if path.exists():
                previous = path.read_bytes()
                backup = directory / (path.name + '.' + hashlib.sha256(previous).hexdigest()[:16] + '.bak')
                if not backup.exists(): backup.write_bytes(previous)
            temporary = path.with_suffix('.py.tmp')
            temporary.write_text(launcher(version, module, directory))
            os.replace(temporary, path)
        # Existing progress/evidence publishers and restart scripts still call the same paths.
        receipt = {**result, 'status': 'installed', 'version': str(version)}
        (directory / 'source-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', default=os.path.expanduser('~/fitsy-refactor/loop'))
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(install(args.directory, args.apply)))
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        parser.exit(1, str(error) + '\n')
