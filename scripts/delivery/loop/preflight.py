"""One settings file and one startup check for the loop driver.

Settings live in a single untracked KEY=VALUE file (default
~/.config/fitsy-loop/loop.env, chosen by FITSY_LOOP_SETTINGS in the LaunchAgent),
so a reboot keeps them. Before any task runs, check() confirms every host
prerequisite the gates need; the driver runs nothing while anything is missing.
"""
import json
import os
from pathlib import Path
import subprocess

DEFAULT_SETTINGS = '~/.config/fitsy-loop/loop.env'
REQUIRED = ('FITSY_XCTEST_SIM_UDID', 'FITSY_SIM_OWNER', 'MAESTRO_BIN', 'JAVA_HOME',
            'EXPO_PUBLIC_API_URL', 'FITSY_E2E_FIXTURES')
DEV_API = 'https://dev.fitsy.org'
BASELINES = ('scripts/deploy/ios-binary-baseline.json', 'scripts/deploy/ios-production-binary-baseline.json')


def settings_path(env=None):
    env = os.environ if env is None else env
    return Path(os.path.expanduser(env.get('FITSY_LOOP_SETTINGS') or DEFAULT_SETTINGS))


def read_settings(path):
    """Parse KEY=VALUE lines; blank lines and # comments are ignored."""
    values = {}
    for number, line in enumerate(Path(path).read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:].strip()
        key, sep, value = line.partition('=')
        if not sep or not key.strip().isidentifier():
            raise ValueError(f'{path}:{number}: expected KEY=VALUE')
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
            value = value[1:-1]
        values[key.strip()] = os.path.expanduser(value)
    return values


def load_settings(env=None):
    """Apply the settings file to env (os.environ by default). File values win."""
    env = os.environ if env is None else env
    path = settings_path(env)
    if not path.is_file():
        return None
    env.update(read_settings(path))
    return path


def _sandbox_check(root, env):
    import host
    with host.isolated(root, env) as (isolation, selected):
        result = subprocess.run([*isolation, '/bin/bash', '-p', '-c', ': > /dev/null && ls / > /dev/null'],
                                env=selected, capture_output=True, text=True, timeout=60)
    if result.returncode:
        return 'sandbox cannot start a shell that writes /dev/null: ' + (result.stderr or '').strip()[-300:]
    return None


def check(root, env=None, *, run=subprocess.run, sandbox=_sandbox_check):
    """Return a list of plain problems; empty means every gate can run."""
    env = os.environ if env is None else env
    root = Path(root)
    problems = []
    path = settings_path(env)
    if not path.is_file():
        problems.append(f'settings file {path} is missing')
    for key in REQUIRED:
        if not env.get(key):
            problems.append(f'{key} is not set (add it to {path})')
    udid = env.get('FITSY_XCTEST_SIM_UDID')
    if udid:
        try:
            listed = run(['xcrun', 'simctl', 'list', 'devices'], capture_output=True, text=True, timeout=60).stdout
        except (OSError, subprocess.SubprocessError) as error:
            listed = ''; problems.append(f'cannot list simulators: {error}')
        else:
            if udid not in listed:
                problems.append(f'simulator {udid} does not exist')
    java = env.get('JAVA_HOME')
    if java and not os.access(Path(java) / 'bin/java', os.X_OK):
        problems.append(f'JAVA_HOME {java} has no bin/java')
    maestro = env.get('MAESTRO_BIN')
    if maestro and not os.access(maestro, os.X_OK):
        problems.append(f'MAESTRO_BIN {maestro} is not executable')
    api = env.get('EXPO_PUBLIC_API_URL')
    if api and api.rstrip('/') != DEV_API:
        problems.append(f'EXPO_PUBLIC_API_URL must be {DEV_API}, not {api}')
    fixtures = env.get('FITSY_E2E_FIXTURES')
    if fixtures:
        fixture = Path(fixtures)
        if fixture.resolve().parent != Path(os.path.expanduser('~/.config/fitsy-e2e')).resolve():
            problems.append(f'FITSY_E2E_FIXTURES must live in ~/.config/fitsy-e2e/, not {fixture}')
        try:
            if not isinstance(json.loads(fixture.read_text()).get('fixtures'), dict):
                problems.append(f'FITSY_E2E_FIXTURES {fixture} has no fixtures')
        except (OSError, ValueError, AttributeError):
            problems.append(f'FITSY_E2E_FIXTURES {fixture} is missing or not valid JSON')
    for name in ('node_modules', 'apps/mobile/node_modules'):
        if not (root / name).is_dir():
            problems.append(f'{root / name} is missing; run npm ci in {root}')
    for name in BASELINES:
        try:
            if not json.loads((root / name).read_text()).get('build_number'):
                problems.append(f'{name} has no build_number')
        except (OSError, ValueError, AttributeError):
            problems.append(f'fingerprint baseline {name} is missing or not valid JSON')
    if not problems:
        try:
            failure = sandbox(root, env)
        except Exception as error:
            failure = f'sandbox check failed: {error}'
        if failure:
            problems.append(failure)
    return problems


def message(problems):
    return 'PREFLIGHT FAILED, no tasks will run until fixed: ' + '; '.join(problems)
