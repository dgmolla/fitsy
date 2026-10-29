"""Source-bound local evidence and fixed host commands; no model-selected commands."""
import json
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import urllib.error
import urllib.request

from recovery import redact


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
    result['diff_stat'] = run(['git', 'diff', 'origin/main...HEAD', '--stat'], wt) or '(no diff)'
    result['diff_hunks'] = run(['git', 'diff', '--no-ext-diff', '--unified=3', 'origin/main...HEAD'], wt)[-16000:] or '(no hunks)'
    local = run(['git', 'diff', '--no-ext-diff', 'HEAD', '--stat'], wt)
    if local:
        result['diff_stat'] += '\nUncommitted repair:\n' + local
        result['diff_hunks'] += '\nUncommitted repair:\n' + run(['git', 'diff', '--no-ext-diff', 'HEAD'], wt)[-8000:]
    result['merge_base'] = run(['git', 'merge-base', 'origin/main', 'HEAD'], wt)
    result['main'] = run(['git', 'rev-parse', 'origin/main'], wt)
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
                                      'xcrun', 'simctl', 'list', 'devices', '--json'], wt, env))
            udid = (env or os.environ)['FITSY_XCTEST_SIM_UDID']
            found = [d for values in devices['devices'].values() for d in values if d['udid'] == udid]
            result['simulator_booted'] = bool(found and found[0]['state'] == 'Booted')
        except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as error:
            result['logs'] += '\nSimulator preflight: ' + redact(str(error))
            result['simulator_booted'] = False
    try:
        selected = json.loads(run(['node', 'scripts/sim/preview-backend.mjs', sha], wt, env))
        result['backend'] = selected['backend']
        with urllib.request.urlopen(selected['backend'] + '/api/health', timeout=15) as response:
            result['api_status'] = response.status
    except urllib.error.HTTPError as error:
        result['api_status'] = error.code
        result['logs'] += '\nAPI health: ' + redact(error.read(4000).decode(errors='replace'))
    except (OSError, RuntimeError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        result['logs'] += '\nBackend preflight unavailable: ' + redact(str(error))
    return result


def host_replay(wt, lock, evidence, env):
    """Fixed canonical runner on the existing host, outside candidate Codex's sandbox."""
    udid = env.get('FITSY_XCTEST_SIM_UDID', '')
    if not re.fullmatch(r'[a-fA-F0-9-]{36}', udid):
        return {'status': 'error', 'logs': 'Host runner requires an explicitly owned simulator UDID.'}
    try:
        head = run(['git', 'rev-parse', 'HEAD'], wt, env)
        source = source_hash(wt, env)
        backend = json.loads(run(['node', 'scripts/sim/preview-backend.mjs', head], wt, env))
        scope = ['--scope=flow', '--flows=' + evidence['flow']] if evidence.get('baseline') else ['--scope=changed']
        process = subprocess.run(['lockf', '-t', '3600', str(lock), 'node', 'scripts/sim/ci.mjs',
                                  *scope, '--udid=' + udid, '--record-video'], cwd=wt,
                                 env={**env, 'EXPO_PUBLIC_API_URL': backend['backend'], 'EXPO_NO_DOTENV': '1'},
                                 capture_output=True, text=True, timeout=3600)
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
            return {**artifacts, 'status': status, 'head': head,
                    'logs': redact((output + process.stderr)[-8000:])}
        if result.get('status') != 'pass' or result.get('name') != 'mobile-e2e':
            raise ValueError('Host runner did not produce a passing canonical result')
        if source_hash(wt, env) != source:
            raise ValueError('Source changed during host replay')
        return {**result, 'head': head, 'source': source, 'flow': evidence.get('flow'), 'logs': output[-8000:]}
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
