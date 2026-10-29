"""Source-bound local evidence and fixed host commands; no model-selected commands."""
import json
import hashlib
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import urllib.error
import urllib.request

from recovery import redact
import host


def blocker_reason(wt):
    """Read only a bounded regular workspace marker, never a linked host file."""
    invalid = 'Rejected .infra-blocked: diagnosis must be a regular workspace file with no links.'
    directory = os.open(wt, os.O_RDONLY | os.O_DIRECTORY)
    try:
        try:
            descriptor = os.open('.infra-blocked', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        except FileNotFoundError:
            return None
        except OSError:
            return invalid
        try:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                return invalid
            reason = os.read(descriptor, 1500).decode(errors='replace').strip()
        finally:
            os.close(descriptor)
        os.unlink('.infra-blocked', dir_fd=directory)
        return reason or 'Worker reported an environment blocker without a diagnosis.'
    except OSError:
        return invalid
    finally:
        os.close(directory)


def run(args, cwd, env=None, timeout=60):
    result = subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(redact((result.stderr or result.stdout)[-4000:]))
    return result.stdout.strip()


def source_hash(wt, env=None):
    paths = run(['git', 'ls-files', '-co', '--exclude-standard', '-z'], wt, env).split('\0')
    digest = hashlib.sha256()
    for name in sorted(set(filter(None, paths))):
        path = Path(wt) / name
        digest.update(name.encode() + b'\0')
        digest.update(os.readlink(path).encode() if path.is_symlink() else path.read_bytes() if path.is_file() else b'deleted')
    return digest.hexdigest()


def failed_commands(value):
    if isinstance(value, list):
        for item in value:
            yield from failed_commands(item)
    elif isinstance(value, dict):
        metadata = value.get('metadata', {})
        if metadata.get('status') in ('FAILED', 'ERROR'):
            yield metadata.get('error', {}).get('message') or json.dumps(value.get('command', {}))
        for key, item in value.items():
            if key != 'metadata' and isinstance(item, (dict, list)):
                yield from failed_commands(item)


def local_artifacts(directory):
    result = {'images': [], 'videos': [], 'logs': '', 'flow': '', 'step': ''}
    directory = Path(directory)
    if not directory.is_dir():
        return result
    files = sorted((path for path in directory.rglob('*') if path.is_file() and not path.is_symlink()),
                   key=lambda path: path.stat().st_mtime_ns, reverse=True)
    failures = []
    for path in files:
        if path.name.startswith('commands-') and path.suffix == '.json':
            try:
                for step in failed_commands(json.loads(path.read_text())):
                    failures.append((path, step))
            except (ValueError, OSError):
                continue
    if failures:
        path, result['step'] = failures[0]
        result['flow'] = path.stem.removeprefix('commands-').strip('()')
        # Prefer media from the failed flow's report directory.
        files.sort(key=lambda item: (item.parent != path.parent, 'fail' not in item.name.lower()))
    result['images'] = [str(path) for path in files if path.suffix.lower() in ('.png', '.jpg', '.jpeg')][:2]
    result['videos'] = [str(path) for path in files if path.suffix.lower() == '.mp4'][:1]
    for path in files:
        if path.suffix in ('.log', '.txt') and path.stat().st_size < 2_000_000:
            result['logs'] += f'\n{path.name}:\n' + redact(path.read_text(errors='replace')[-5000:])
    result['logs'] = result['logs'][-16000:]
    result['assertion_failure'] = bool(failures)
    return result


def collect(wt, evidence_root, sha, checks, description='', env=None):
    wt = Path(wt)
    result = {'head': sha, 'sim_state': checks.get('Simulator', '').lower(),
              'deploy_state': checks.get('Vercel', ''), 'checks': checks,
              'free_disk_gb': shutil.disk_usage(wt).free / 1024 ** 3,
              'links': [f'https://github.com/dgmolla/fitsy/commit/{sha}/checks']}
    directory = Path(evidence_root) / sha[:12]
    result.update(local_artifacts(directory))
    result['logs'] = redact(description + '\n' + result['logs'])
    safe = host.dev_environment(wt, env or os.environ)
    diff = ['git', 'diff', '--no-ext-diff', '--no-textconv']
    result['diff_stat'] = run([*diff, 'origin/main...HEAD', '--stat'], wt, safe) or '(no diff)'
    result['diff_hunks'] = run([*diff, '--unified=3', 'origin/main...HEAD'], wt, safe)[-16000:] or '(no hunks)'
    local = run([*diff, 'HEAD', '--stat'], wt, safe)
    if local:
        result['diff_stat'] += '\nUncommitted repair:\n' + local
        result['diff_hunks'] += '\nUncommitted repair:\n' + run([*diff, 'HEAD'], wt, safe)[-8000:]
    result['merge_base'] = run(['git', 'merge-base', 'origin/main', 'HEAD'], wt, safe)
    result['main'] = run(['git', 'rev-parse', 'origin/main'], wt, safe)
    result['main_comparison'] = 'No matching merge-base run available.'
    baseline = local_artifacts(Path(evidence_root) / result['merge_base'][:12])
    # Never infer success from missing failure files or use another flow's result.
    if result['flow'] and baseline['flow'] == result['flow'] and baseline['step'] == result['step']:
        result['main_same_failure'] = True
        result['main_comparison'] = 'Same flow and failing step on merge-base.'
    # Host replay receipts bind both source and flow; a free-form hint cannot mark main passed.
    if (env or os.environ).get('FITSY_XCTEST_SIM_UDID'):
        try:
            devices = json.loads(run(['lockf', '-t', '3600', str(Path(evidence_root).parents[1] / 'loop/sim.lock'),
                                      'xcrun', 'simctl', 'list', 'devices', '--json'], wt, safe))
            udid = (env or os.environ)['FITSY_XCTEST_SIM_UDID']
            found = [d for values in devices['devices'].values() for d in values if d['udid'] == udid]
            result['simulator_booted'] = bool(found and found[0]['state'] == 'Booted')
        except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
            result['logs'] += '\nSimulator preflight: ' + redact(str(error))
            result['simulator_booted'] = False
    try:
        selected = select_backend(wt, sha, env or os.environ)
        result['backend'] = selected['backend']
        with urllib.request.urlopen(selected['backend'] + '/api/health', timeout=15) as response:
            result['api_status'] = response.status
    except urllib.error.HTTPError as error:
        result['api_status'] = error.code
        with error:
            result['logs'] += '\nAPI health: ' + redact(error.read(4000).decode(errors='replace'))
    except (OSError, RuntimeError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        result['preflight_logs'] = '\nBackend preflight unavailable: ' + redact(str(error))
        result['logs'] += result['preflight_logs']
    return result


def select_backend(wt, head, env):
    return json.loads(run(['node', host.control('scripts/sim/preview-backend.mjs'), '--recovery', head], wt,
                          host.backend_environment(wt, env)))


def host_replay(wt, lock, evidence, env):
    """Trusted controls select coverage; candidate execution gets DEV auth and isolation."""
    try:
        safe = host.dev_environment(wt, env)
        head = run(['git', 'rev-parse', 'HEAD'], wt, safe)
        source = source_hash(wt, safe)
        scope = ['--scope=flow', '--flows=' + evidence['flow']] if evidence.get('baseline') else ['--scope=changed']
        runner = host.control('scripts/sim/ci.mjs')
        # Planning executes only installed controls and reads candidate source as
        # data. Native imports, fixtures, Expo and Metro run only after isolation.
        plan = json.loads(run(['node', runner, *scope, '--plan'], wt, safe))
        if (not isinstance(plan.get('required'), bool) or plan.get('scope') not in ('none', 'smoke', 'flow', 'full') or
                plan['required'] != (plan['scope'] != 'none') or not isinstance(plan.get('flows'), list) or
                plan['required'] != bool(plan['flows'])):
            raise ValueError('Trusted native selection returned no coverage decision')
        if not plan['required'] and not evidence.get('flow') and not evidence.get('require_native'):
            if source_hash(wt, safe) != source or run(['git', 'rev-parse', 'HEAD'], wt, safe) != head:
                raise ValueError('Source changed during native selection')
            return {'status': 'pass', 'required': False, 'head': head, 'source': source, 'logs': 'Trusted native scope: none'}
        if not plan['required']:
            # A failing journey still needs replay even if this diff has no mapped UI changes.
            scope = (['--scope=flow', '--flows=' + evidence['flow']] if evidence.get('flow') else ['--scope=full'])
        udid = env.get('FITSY_XCTEST_SIM_UDID', '')
        if not re.fullmatch(r'[a-fA-F0-9-]{36}', udid):
            raise ValueError('Host runner requires an explicitly owned simulator UDID.')
        backend = select_backend(wt, head, env)
        with host.isolated(wt, env, backend) as (isolation, selected):
            process = subprocess.run(['lockf', '-t', '3600', str(lock), *isolation, 'node', runner,
                                      *scope, '--udid=' + udid, '--record-video'], cwd=wt,
                                     env=selected, capture_output=True, text=True, timeout=3600)
        # Failed assertions are actionable evidence too. Bind them to unchanged
        # source just like passing results before returning any artifacts.
        if source_hash(wt, safe) != source or run(['git', 'rev-parse', 'HEAD'], wt, safe) != head:
            raise ValueError('Source changed during host replay')
        output = process.stdout
        lines = output.strip().splitlines()
        if not lines:
            return {'status': 'error', 'head': head, 'exit_code': process.returncode,
                    'logs': redact(f'Host runner returned no JSON output (exit {process.returncode}):\n'
                                   + process.stderr[-8000:])}
        result = json.loads(lines[-1])
        if process.returncode:
            # Only a real failing Maestro report establishes an application/test failure.
            match = re.search(r'inspect (.+)', result.get('summary', ''))
            artifacts = local_artifacts(match[1]) if match else {}
            status = 'failure' if artifacts.get('step') else 'error'
            return {**artifacts, 'status': status, 'head': head, 'source': source,
                    'logs': redact((artifacts.get('logs', '') + '\n' + output + process.stderr)[-16000:])}
        if result.get('status') != 'pass' or result.get('name') != 'mobile-e2e':
            raise ValueError('Host runner did not produce a passing canonical result')
        return {**result, 'required': True, 'head': head, 'source': source, 'flow': evidence.get('flow'), 'logs': output[-8000:]}
    except (OSError, RuntimeError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        return {'status': 'error', 'logs': redact(str(error))}


def compare_main(wt, lock, evidence, env):
    """Reuse an explicitly prepared host baseline; never steal another checkout/device."""
    baseline = env.get('FITSY_LOOP_MAIN_CHECKOUT')
    result = {'main_comparison': 'Host owner must prepare a checkout of the merge-base for comparison.',
              'main_passed': False, 'main_same_failure': False}
    if not baseline or not evidence.get('flow'):
        return result
    try:
        base = run(['git', 'merge-base', 'origin/main', 'HEAD'], wt, env)
        if run(['git', 'rev-parse', 'HEAD'], baseline, env) != base or run(['git', 'status', '--porcelain'], baseline, env):
            raise ValueError('Host baseline is dirty or does not match the merge-base')
        replay = host_replay(baseline, lock, {**evidence, 'baseline': True}, env)
        result['main_passed'] = replay['status'] == 'pass'
        result['main_same_failure'] = (replay['status'] == 'failure' and
                                       replay.get('flow') == evidence['flow'] and replay.get('step') == evidence.get('step'))
        result['main_comparison'] = json.dumps({'head': base, 'flow': evidence['flow'], **replay})
        result['images'] = evidence.get('images', []) + replay.get('images', [])[:1]
        if replay['status'] == 'pass' and replay.get('evidence'):
            result['images'] += local_artifacts(replay['evidence'])['images'][:1]
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
        result['main_comparison'] = redact(str(error))
    return result


def video_frame(evidence, wt):
    if evidence.get('images') or not evidence.get('videos'):
        return
    target = Path(wt) / '.evidence/loop-failure.png'
    target.parent.mkdir(parents=True, exist_ok=True)
    run(['ffmpeg', '-v', 'error', '-sseof', '-1', '-i', evidence['videos'][0],
         '-frames:v', '1', '-y', str(target)], wt)
    evidence['images'] = [str(target)]
