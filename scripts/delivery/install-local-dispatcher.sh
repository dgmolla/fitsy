#!/usr/bin/env bash
# Install one paused local dispatcher from a clean, verified main checkout.
set -euo pipefail

mode="${1:---check}"
shift || true
label=com.fitsy.local-dispatcher
state="${FITSY_DISPATCH_HOME:-$HOME/.fitsy-dispatcher}"
plist="$HOME/Library/LaunchAgents/$label.plist"
repo="$(git rev-parse --show-toplevel)"
worktree_root=''
if [[ $# -gt 0 ]]; then
  [[ $# -eq 2 && "$1" == --worktree-root ]] || { echo 'usage: install-local-dispatcher.sh --check|--install|--enable|--pause|--uninstall [--worktree-root PATH]' >&2; exit 2; }
  worktree_root="$2"
fi

if [[ "$mode" == --uninstall ]]; then
  python3 - "$state" "$plist" "$label" <<'PY'
import fcntl,json,os,subprocess,sys,tempfile
from pathlib import Path
state,plist,label = Path(sys.argv[1]),Path(sys.argv[2]),sys.argv[3]
state.mkdir(parents=True,exist_ok=True,mode=0o700)
with (state/'dispatcher.lock').open('a') as lock:
    fcntl.flock(lock,fcntl.LOCK_EX)
    active = json.loads((state/'state.json').read_text()).get('active') if (state/'state.json').exists() else None
    if active:
        raise SystemExit('active claim must be reconciled before uninstall; use --pause')
    config_path=state/'config.json'
    if config_path.exists():
        config=json.loads(config_path.read_text()); config['enabled']=False
        with tempfile.NamedTemporaryFile('w',dir=state,delete=False) as out:
            json.dump(config,out); out.write('\n'); out.flush(); os.fsync(out.fileno()); temporary=Path(out.name)
        temporary.chmod(0o600); os.replace(temporary,config_path)
    target=f'gui/{os.getuid()}/{label}'
    subprocess.run(['launchctl','bootout',target],capture_output=True)
    loaded=subprocess.run(['launchctl','print',target],capture_output=True)
    if loaded.returncode == 0:
        raise SystemExit('LaunchAgent is still loaded; retaining plist for recovery')
    plist.unlink(missing_ok=True)
PY
  echo "uninstalled $label; claims and receipts retained at $state"
  exit 0
fi
[[ "$mode" == --check || "$mode" == --install || "$mode" == --enable || "$mode" == --pause ]] || { echo 'unknown mode' >&2; exit 2; }

python3 - "$mode" "$repo" "$state" "$worktree_root" <<'PY'
import fcntl, hashlib, json, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

mode, repo, state_name, root_name = sys.argv[1:]
mode = mode.removeprefix('--')
repo = Path(repo).resolve(); state = Path(state_name).expanduser().resolve()
state.mkdir(parents=True, exist_ok=True, mode=0o700)
lock = (state / 'dispatcher.lock').open('a')
fcntl.flock(lock, fcntl.LOCK_EX)
config_path = state / 'config.json'

def output(*args):
    return subprocess.check_output(args, text=True).strip()

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.NamedTemporaryFile('w', dir=path.parent, prefix=path.name + '.', delete=False) as out:
        out.write(value); out.flush(); os.fsync(out.fileno()); temporary = Path(out.name)
    temporary.chmod(0o600); os.replace(temporary, path)

if mode in ('check', 'install'):
    head = output('git', '-C', str(repo), 'rev-parse', 'HEAD')
    main = output('gh', 'api', 'repos/dgmolla/fitsy/commits/main', '--jq', '.sha')
    if head != main or output('git', '-C', str(repo), 'status', '--porcelain', '--untracked-files=all'):
        raise SystemExit('installer requires a clean checkout at exact current main')
    if mode == 'install' and not root_name:
        raise SystemExit('--install requires --worktree-root')
    print(json.dumps({'mode': mode, 'source_sha': head, 'exact_clean_main': True}))
if mode == 'check':
    raise SystemExit(0)
if mode == 'install':
    root = Path(root_name).expanduser().resolve()
    if not root.is_dir():
        raise SystemExit('worktree root must exist')
    # Installing paused recovery code does not admit a worker or native build.
    runtime_sources = [repo / 'scripts/delivery/resource_lifecycle.py', repo / 'scripts/delivery/local-dispatcher.py',
                       repo / 'scripts/sim/retire_task_device.py', repo / 'scripts/sim/sim_resource_uses.py']
    required_update_bytes = sum(path.stat().st_size for path in runtime_sources) + 1024**2
    if shutil.disk_usage(state).free < required_update_bytes:
        raise SystemExit(f'insufficient bytes for paused atomic runtime update: need {required_update_bytes}')
    previous = json.loads(config_path.read_text()) if config_path.exists() else None
    active = json.loads((state / 'state.json').read_text()).get('active') if (state / 'state.json').exists() else None
    if active:
        raise SystemExit('active dispatcher claim must be reconciled before reinstall')
    codex = shutil.which('codex')
    if not previous and not codex:
        raise SystemExit('Codex CLI missing for default profile')
    jev_enabled = previous.get('jev_enabled', False) if previous else False
    if not isinstance(jev_enabled, bool):
        raise SystemExit('jev_enabled must be a boolean')
    key_file = state / 'credentials/jev.env'
    if jev_enabled:
        secret_source = Path.home() / 'Desktop/secrets.env'
        if not secret_source.is_file() or secret_source.stat().st_uid != os.getuid():
            raise SystemExit('authorized Jev source file unavailable')
        matches = []
        for line in secret_source.read_text().splitlines():
            match = re.fullmatch(r'\s*(?:export\s+)?jev\s*=\s*(["\']?)([^"\']+)\1\s*', line)
            if match:
                matches.append(match.group(2))
        if len(matches) != 1:
            raise SystemExit('expected one lowercase jev credential')
        save(key_file, 'jev=' + matches[0] + '\n')
    notification = json.loads((Path.home() / 'firstmate/config/slack-notifications.json').read_text())
    publisher = json.loads((Path.home() / '.fitsy-delivery/config.json').read_text())
    if notification['channel'] != publisher['channel'] or notification['bridge_path'] != publisher['bridge_path']:
        raise SystemExit('shared Slack channel and bridge configuration differ')
    if not re.fullmatch(r'U[A-Z0-9]+', notification['user']) or not re.fullmatch(r'U[A-Z0-9]+', publisher['user']):
        raise SystemExit('Slack recipient or sender identity invalid')
    slack = {'channel': publisher['channel'], 'sender': publisher['user'],
             'recipient': notification['user'], 'bridge_path': publisher['bridge_path']}
    profiles = {'standard': {'provider': 'codex', 'model': 'gpt-6-sol', 'effort': 'medium', 'executable': codex},
                'deep': {'provider': 'codex', 'model': 'gpt-6-sol', 'effort': 'high', 'executable': codex}}
    config = previous or {'state_dir': str(state), 'repo_root': str(repo), 'worktree_root': str(root),
                          'gh_bin': shutil.which('gh'), 'git_bin': shutil.which('git'),
                          'profiles': profiles, 'review': {'provider': 'codex', 'model': 'gpt-6-sol', 'effort': 'high'},
                          'min_free_bytes': 8 * 1024**3, 'worker_timeout_seconds': 90 * 60}
    config.setdefault('scratch_reserve_bytes', 4 * 1024**3)
    lsof = shutil.which('lsof') or ('/usr/sbin/lsof' if os.access('/usr/sbin/lsof', os.X_OK) else None)
    if not lsof:
        raise SystemExit('open-file ownership tool unavailable for installed recovery')
    config['lsof_bin'] = str(Path(lsof).resolve())
    config.update({'enabled': False, 'source_sha': head, 'jev_enabled': jev_enabled,
                   'jev_key_file': str(key_file) if jev_enabled else None,
                   'repo_root': str(repo), 'worktree_root': str(root), 'slack': slack})
    targets = [state / 'runtime/resource_lifecycle.py', state / 'runtime/local-dispatcher.py',
               state / 'sim/retire_task_device.py', state / 'sim/sim_resource_uses.py']
    # Pause the old identity before touching any runtime, then publish the new
    # identity only after every installed byte has been verified under the lock.
    if previous:
        paused = dict(previous); paused['enabled'] = False
        save(config_path, json.dumps(paused, sort_keys=True) + '\n')
    digests = {}
    for source, target in zip(runtime_sources, targets):
        content = source.read_text()
        save(target, content); target.chmod(0o700)
        expected = hashlib.sha256(content.encode()).hexdigest()
        if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
            raise SystemExit('installed runtime content verification failed')
        digests[str(target.relative_to(state))] = expected
    config['runtime_sha256'] = digests
    save(config_path, json.dumps(config, sort_keys=True) + '\n')
    available = shutil.disk_usage(root).free
    required = config['min_free_bytes'] + config['scratch_reserve_bytes']
    print(json.dumps({'installed_paused': True, 'worker_admission': 'ready' if available >= required else 'resource-hold',
                      'available_free_bytes': available, 'required_worker_free_bytes': required, 'jev_enabled': jev_enabled,
                      'credential_private': key_file.stat().st_mode & 0o077 == 0 if jev_enabled else None,
                      'worker_provider': config['profiles']['standard']['provider']}))
if mode in ('enable', 'pause'):
    if not config_path.is_file():
        raise SystemExit('dispatcher is not installed')
    config = json.loads(config_path.read_text())
    if mode == 'enable':
        current = output('gh', 'api', 'repos/dgmolla/fitsy/commits/main', '--jq', '.sha')
        if config['source_sha'] != current:
            raise SystemExit('installed dispatcher runtime does not match current main')
        expected_paths = {'runtime/resource_lifecycle.py', 'runtime/local-dispatcher.py', 'sim/retire_task_device.py', 'sim/sim_resource_uses.py'}
        digests = config.get('runtime_sha256', {})
        if set(digests) != expected_paths or any(
                not (state / path).is_file() or (state / path).is_symlink() or
                hashlib.sha256((state / path).read_bytes()).hexdigest() != digest
                for path, digest in digests.items()):
            raise SystemExit('installed runtime content does not match published source identity')
        runs = json.loads(output('gh', 'run', 'list', '--branch', 'main', '--limit', '30', '--json',
                                 'workflowName,headSha,status,conclusion'))
        if not all(any(run['workflowName'] == name and run['headSha'] == current and
                       run['status'] == 'completed' and run['conclusion'] == 'success' for run in runs)
                   for name in ('Verify', 'Deploy')):
            raise SystemExit('main Verify and Deploy have not both passed for installed runtime')
        active = json.loads((state / 'state.json').read_text()).get('active') if (state / 'state.json').exists() else None
        if active:
            raise SystemExit('an active dispatcher claim must be reconciled before enabling')
    config['enabled'] = mode == 'enable'
    save(config_path, json.dumps(config, sort_keys=True) + '\n')
    available = shutil.disk_usage(config['worktree_root']).free
    required = config.get('min_free_bytes', 8 * 1024**3) + config.get('scratch_reserve_bytes', 4 * 1024**3)
    print(json.dumps({'enabled': config['enabled'], 'source_sha': config['source_sha'],
                      'worker_admission': 'ready' if available >= required else 'resource-hold',
                      'available_free_bytes': available, 'required_worker_free_bytes': required}))
PY

if [[ "$mode" == --check ]]; then exit 0; fi
if [[ "$mode" == --install ]]; then
  mkdir -p "$state/runtime" "$state/sim" "$state/credentials" "$HOME/Library/LaunchAgents"
  chmod 700 "$state" "$state/runtime" "$state/sim" "$state/credentials"
  python_bin="$(command -v python3)"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>
    <string>$python_bin</string><string>$state/runtime/local-dispatcher.py</string>
    <string>tick</string><string>--config</string><string>$state/config.json</string>
  </array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>$state/launchd.log</string>
  <key>StandardErrorPath</key><string>$state/launchd.log</string>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  echo "installed $label paused; use --enable only after main gates and ownership reconciliation"
elif [[ "$mode" == --enable ]]; then
  launchctl kickstart -k "gui/$(id -u)/$label"
fi
