"""Installed recovery controls and an isolated, DEV-only native execution boundary."""
from contextlib import contextmanager, nullcontext
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile

CONTROLS = Path(__file__).parent / 'controls'
SANDBOX = '/usr/bin/sandbox-exec'
CORE = {'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR'}
DEV = {'FITSY_XCTEST_SIM_UDID', 'FITSY_SIM_OWNER', 'FITSY_E2E_FIXTURES', 'MAESTRO_BIN',
       'JAVA_HOME', 'DEVELOPER_DIR'}


def control(name):
    path = CONTROLS / name
    if not path.is_file():
        raise ValueError('Install reviewed loop controls through install.py before host recovery')
    return str(path)


def backend_environment(wt, env):
    # The selector and every import live outside the candidate's writable roots.
    # Neither Node/shell startup selectors nor unrelated host credentials enter it.
    return {**{key: value for key, value in env.items() if key in CORE | {'VERCEL_TOKEN', 'EXPO_PUBLIC_API_URL'}},
            'FITSY_PRODUCT_ROOT': str(Path(wt).resolve())}


def dev_environment(wt, env):
    result = {key: value for key, value in env.items() if key in CORE | DEV or key.startswith('EXPO_PUBLIC_')}
    if 'zaxkmjqozvmbifiwbxps' in result.get('EXPO_PUBLIC_SUPABASE_URL', ''):
        raise ValueError('Production Supabase is forbidden in recovery')
    result.update(FITSY_PRODUCT_ROOT=str(Path(wt).resolve()), EXPO_NO_DOTENV='1', NODE_ENV='development')
    return result


def profile(wt, directory, env):
    """Permit native tools and this DEV workspace, never host credential stores.

    The policy also applies to Metro, Expo config, fixture adapters and all their
    children. There is deliberately no unsandboxed fallback.
    """
    wt, directory = Path(wt).resolve(), Path(directory).resolve()
    home = Path(env.get('HOME', str(directory))).resolve()
    simulator = home / 'Library/Developer/CoreSimulator'
    claim = [home / '.fitsy-sim-claim.json', home / '.fitsy-sim-claim.lock']
    reads = [Path(p) for p in ('/System', '/Library/Developer', '/Library/Apple', '/Library/Java', '/usr', '/bin',
                               '/sbin', '/opt/homebrew', '/Applications/Xcode.app', '/dev')]
    reads += [wt, directory, CONTROLS.resolve(), simulator, *claim,
              home / '.maestro/bin', home / '.maestro/lib']
    for key in ('JAVA_HOME', 'DEVELOPER_DIR', 'MAESTRO_BIN'):
        if env.get(key):
            reads.append(Path(env[key]).resolve())
    # Worktrees commonly share immutable dependencies and Git object storage.
    for path in (wt / 'node_modules', wt / 'apps/mobile/node_modules'):
        if path.exists():
            reads.append(path.resolve())
    git = subprocess.check_output(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                                  cwd=wt, env=env, text=True).strip()
    reads.append(Path(git).resolve())
    fixture = env.get('FITSY_E2E_FIXTURES')
    if fixture:
        path = Path(fixture).resolve()
        if path.is_relative_to(wt):
            raise ValueError('Recovery fixture configuration must be outside candidate writable roots')
        reads.append(path)
        config = json.loads(path.read_text())
        for entry in config.get('fixtures', {}).values():
            for value in [entry.get('envFile'), *(entry.get('prepare') or [])]:
                if value and Path(value).is_absolute():
                    reads.append(Path(value).resolve())
    # Only public client configuration is readable from candidate dotenv files.
    public = wt / 'apps/mobile/.env.development.local'
    if public.exists():
        for line in public.read_text().splitlines():
            if line.strip() and not line.lstrip().startswith('#') and not re.match(r'^(?:export\s+)?EXPO_PUBLIC_\w+\s*=', line.strip()):
                raise ValueError('Recovery mobile dotenv must contain only public DEV configuration')
    literal = lambda path: json.dumps(str(path))
    excluded = ' '.join(f'(require-not (subpath {literal(path)}))' for path in reads)
    # Atomic claim replacement stages only these names on HOME's filesystem.
    # Directory read access permits the parent's fsync, never its descendants.
    staging = '(regex #' + json.dumps('^' + re.escape(str(claim[0]) + '.') + r'[a-z0-9_]+\.tmp$') + ')'
    excluded += f' (require-not (literal {literal(home)})) (require-not {staging})'
    writable = [wt, directory, simulator, *claim]
    write_excluded = ' '.join(f'(require-not (subpath {literal(path)}))' for path in writable)
    write_excluded += f' (require-not {staging})'
    # deny rules take precedence over the broad workspace permission, including
    # symlink targets. Process environment inspection and Keychain IPC stay denied.
    return f'''(version 1)
(allow default)
(deny file-read-data (require-all {excluded}))
(deny file-read-data (require-all (regex #"(^|/)\\.env($|\\.)") (require-not (literal {literal(public)}))))
(deny file-write* (require-all {write_excluded}))
(deny process-info*)
(allow process-info* (target same-sandbox))
(deny job-creation)
(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.accountsd")
                  (global-name "com.apple.coreservices.launchservicesd"))
(deny appleevent-send)
'''


@contextmanager
def isolated(wt, env, backend=None):
    """Yield a fixed sandbox prefix and allowlisted environment for native tools."""
    with tempfile.TemporaryDirectory(prefix='fitsy-loop-native-') as temporary:
        directory = Path(temporary)
        selected = dev_environment(wt, env)
        if backend:
            selected['EXPO_PUBLIC_API_URL'] = backend['backend']
            # Native identity checks need deployment metadata, never a Vercel
            # token or CLI auth store. Serve only the already verified response.
            binary = directory / 'vercel'
            argv = ['api', '/v13/deployments/' + backend['backend'].split('://', 1)[1], '--raw']
            binary.write_text(f'#!{sys.executable}\nimport json, sys\n'
                              f'if sys.argv[1:] != {argv!r}: sys.exit("Recovery Vercel command is not read-only metadata")\n'
                              f'print({json.dumps(backend["deployment"])!r})\n')
            binary.chmod(0o700)
            selected['PATH'] = str(directory) + os.pathsep + selected.get('PATH', os.defpath)
        policy = directory / 'native.sb'
        policy.write_text(profile(wt, directory, selected))
        selected['TMPDIR'] = str(directory)
        # Maestro's JVM stores its per-user state here, away from host cloud auth.
        (directory / 'java-home').mkdir()
        selected['JAVA_TOOL_OPTIONS'] = '-Duser.home=' + str(directory / 'java-home')
        yield [SANDBOX, '-f', str(policy)], selected


@contextmanager
def git_environment(wt, env, verify=False):
    """Keep candidate hooks out of every host Git operation, including staging."""
    wt = Path(wt).resolve()
    # Git must never invoke the candidate's hook with host authentication. The
    # installed owner supplies a private hook outside all candidate write roots.
    with tempfile.TemporaryDirectory(prefix='fitsy-loop-publish-') as hooks:
        with isolated(wt, env) if verify else nullcontext(None) as boundary:
            hook = Path(hooks) / 'pre-push'
            script = '#!/bin/bash -p\necho "Use installed host.publish for isolated pre-push verification" >&2\nexit 1\n'
            # Retain both canonical .githooks/pre-push selections even if the
            # candidate changes its own hook. The caller fixture compares them.
            if boundary:
                isolation, selected = boundary
                commands = '\n'.join(shlex.join(['node', str(wt / 'scripts/verify/run.mjs'), *flags]) for flags in (
                    ['--only=size-check,domain-check', '--scope=changed', '--runs=local'],
                    ['--layer=0-1', '--stage=cheap', '--scope=changed', '--runs=local']))
                command = ['/usr/bin/env', '-i', *(f'{key}={value}' for key, value in selected.items()),
                           *isolation, '/bin/bash', '-p', '-c', 'set -euo pipefail\n' + commands]
                script = '#!/bin/bash -p\nexec ' + shlex.join(command) + '\n'
            hook.write_text(script)
            hook.chmod(0o700)
            count = int(env.get('GIT_CONFIG_COUNT', '0'))
            yield {**env, 'GIT_CONFIG_COUNT': str(count + 1),
                   f'GIT_CONFIG_KEY_{count}': 'core.hooksPath', f'GIT_CONFIG_VALUE_{count}': hooks}


def git(wt, args, env):
    with git_environment(wt, env, verify=args[:1] == ['push']) as selected:
        return subprocess.run(['git', *args], cwd=wt, env=selected,
                              capture_output=True, text=True, timeout=1800)


def publish(wt, branch, env):
    """Authenticate Git on the host; run candidate verification only in isolation."""
    return git(wt, ['push', '-q', '-u', 'origin', 'HEAD:' + branch], env)
