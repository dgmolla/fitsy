#!/usr/bin/python3 -I
"""Fixed dev metadata reader. No caller configuration or acceptance authority."""
import errno
import hashlib
import json
import os
import re
import select
import selectors
import signal
import subprocess
import sys
import time

NODE = '/opt/homebrew/Cellar/node/24.3.0/bin/node'
CLI = '/opt/homebrew/lib/node_modules/vercel/dist/vc.js'
PINS = {
    NODE: 'e5cd70d175e9480658ef5a948ff1bdd7a181a77f2c51f0a0e866b826fca17e05',
    CLI: '24a660d5013c2066a2637431519bda38a3c71c60a65566d86121362f27696576',
}
PROJECT = 'prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4'
TEAM = 'team_VVc52BrZfx5IT2B1mDI5AuPT'
ACTOR = 'Uo2NGWKANEuMvtTYZdjbE3BO'
USERNAME = 'dgmolla-6646'
USER_PATH = '/v2/user'
DEPLOYMENT_PATH = '/v13/deployments/dev.fitsy.org'
LIMIT = 256 * 1024
TIMEOUT = 30


def check_environment(env):
    # HOME/PATH are never consumed. Reject credential and executable/config injection.
    for key, value in env.items():
        # Neutral native-caller npm settings are ignored, never forwarded to the CLI.
        if (key == 'NPM_CONFIG_CACHE'
                or (key, value) in (('NPM_CONFIG_USERCONFIG', '/dev/null'),
                                    ('NPM_CONFIG_UPDATE_NOTIFIER', 'false'))):
            continue
        if (key.startswith(('VERCEL_', 'VC_', 'NODE_', 'NPM_', 'npm_', 'XDG_', 'DYLD_', 'LD_'))
                or key in ('BASH_ENV', 'ENV')):
            raise ValueError('Caller configuration is forbidden')


def await_exit(pid, deadline):
    # Observe exit without reaping: keep the group leader's PID reserved until
    # descendants have been signaled. EOF alone does not imply parent exit.
    if sys.platform == 'darwin':
        queue = select.kqueue()
        try:
            event = select.kevent(pid, filter=select.KQ_FILTER_PROC,
                                  flags=select.KQ_EV_ADD, fflags=select.KQ_NOTE_EXIT)
            remaining = deadline - time.monotonic()
            events = queue.control([event], 1, max(0, remaining))
            if remaining <= 0 or not events:
                raise ValueError('Metadata command timed out')
            if events[0].flags & select.KQ_EV_ERROR:
                # This own unreaped child's PID is still reserved. Darwin
                # reports ESRCH when it exited before NOTE_EXIT registration.
                if events[0].data != errno.ESRCH:
                    raise ValueError('Metadata process observation failed')
            elif not events[0].fflags & select.KQ_NOTE_EXIT:
                raise ValueError('Metadata process observation failed')
        finally:
            queue.close()
    else:
        while os.waitid(os.P_PID, pid, os.WEXITED | os.WNOWAIT | os.WNOHANG) is None:
            if time.monotonic() >= deadline:
                raise ValueError('Metadata command timed out')
            time.sleep(0.01)


def cli_read(path):
    if path not in (USER_PATH, DEPLOYMENT_PATH):
        raise ValueError('Unknown metadata endpoint')
    # Deliberately not based on os.environ, including caller HOME and token values.
    env = {'HOME': '/Users/dawitmolla', 'PATH': '/usr/bin:/bin', 'LANG': 'en_US.UTF-8',
           'NO_COLOR': '1', 'VERCEL_TELEMETRY_DISABLED': '1'}
    args = [NODE, CLI, 'api', path, '--raw']
    child = subprocess.Popen(args, cwd='/', env=env, stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             start_new_session=True)
    try:
        output = bytearray()
        deadline = time.monotonic() + TIMEOUT
        with selectors.DefaultSelector() as poll:
            poll.register(child.stdout, selectors.EVENT_READ)
            while poll.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not poll.select(remaining):
                    raise ValueError('Metadata command timed out')
                chunk = os.read(child.stdout.fileno(), 8192)
                if not chunk:
                    poll.unregister(child.stdout)
                else:
                    output.extend(chunk)
                    if len(output) > LIMIT:
                        raise ValueError('Metadata output limit exceeded')
        await_exit(child.pid, deadline)
    finally:
        # setsid acquired PGID == child.pid. Never poll/wait before SIGKILL:
        # the unreaped leader reserves that identity even if it already exited.
        # Kill on EOF too: descendants may have closed stdout but still be alive.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError as denied:
            if sys.platform != 'darwin' or denied.errno != errno.EPERM:
                raise
            # Darwin can deny SIGKILL for a group with only the zombie leader.
            # Reap only our original Popen, then require proven group absence.
            # Never send another signal after releasing the leader's PID.
            child.wait(timeout=5)
            try:
                os.killpg(child.pid, 0)
            except ProcessLookupError:
                pass
            else:
                raise denied
        finally:
            child.stdout.close()
            child.wait(timeout=5)
    if child.returncode:
        raise ValueError('Metadata command failed')
    return json.loads(output)


def metadata(transport):
    user = transport(USER_PATH).get('user', {})
    if user.get('id') != ACTOR or user.get('username') != USERNAME:
        raise ValueError('Wrong metadata actor')
    d = transport(DEPLOYMENT_PATH)
    if (d.get('projectId') != PROJECT or d.get('project', {}).get('id') != PROJECT
            or d.get('ownerId') != TEAM):
        raise ValueError('Wrong metadata project or owner')
    if d.get('readyState') != 'READY' or 'target' not in d or d['target'] not in (None, 'preview'):
        raise ValueError('Deployment must be ready and nonproduction')
    if not isinstance(d.get('id'), str) or not re.fullmatch(r'dpl_[A-Za-z0-9]+', d['id']):
        raise ValueError('Missing deployment identity')
    source = d.get('source')
    result = {key: d[key] for key in ('id', 'readyState', 'target', 'source')}
    if source == 'git':
        sha = d.get('gitSource', {}).get('sha')
        result['gitSource'] = {'sha': sha}
    elif source == 'cli':
        meta = d.get('meta', {})
        if not (meta.get('gitDirty') is False or meta.get('gitDirty') in ('false', '0')):
            raise ValueError('CLI deployment is not clean')
        sha = meta.get('gitCommitSha')
        result['meta'] = {'gitCommitSha': sha, 'gitDirty': meta['gitDirty']}
    else:
        raise ValueError('Unknown deployment source')
    if not isinstance(sha, str) or not re.fullmatch('[a-f0-9]{40}', sha):
        raise ValueError('Missing Git revision')
    return result


def main():
    try:
        if len(sys.argv) != 1:
            raise ValueError('No arguments allowed')
        check_environment(os.environ)
        for path, expected in PINS.items():
            with open(path, 'rb') as handle:
                digest = hashlib.sha256()
                for chunk in iter(lambda: handle.read(65536), b''):
                    digest.update(chunk)
                if digest.hexdigest() != expected:
                    raise ValueError('Tool identity mismatch')
        print(json.dumps(metadata(cli_read), separators=(',', ':')))
        return 0
    except Exception:
        # Never print subprocess output, exception values, credentials or environment.
        print('Native dev metadata unavailable', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
