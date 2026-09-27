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
import fcntl, json, os, re, shutil, subprocess, sys, tempfile
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
    if shutil.disk_usage(root).free < 8 * 1024**3:
        raise SystemExit('disk below 8 GiB admission minimum')
    previous = json.loads(config_path.read_text()) if config_path.exists() else None
    active = json.loads((state / 'state.json').read_text()).get('active') if (state / 'state.json').exists() else None
    if active:
        raise SystemExit('active dispatcher claim must be reconciled before reinstall')
    codex = shutil.which('codex')
    if not previous and not codex:
        raise SystemExit('Codex CLI missing for default profile')
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
    key_file = state / 'credentials/jev.env'
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
    config.update({'enabled': False, 'source_sha': head, 'jev_key_file': str(key_file),
                   'repo_root': str(repo), 'worktree_root': str(root), 'slack': slack})
    save(config_path, json.dumps(config, sort_keys=True) + '\n')
    print(json.dumps({'installed_paused': True, 'credential_private': key_file.stat().st_mode & 0o077 == 0,
                      'worker_provider': config['profiles']['standard']['provider']}))
if mode in ('enable', 'pause'):
    if not config_path.is_file():
        raise SystemExit('dispatcher is not installed')
    config = json.loads(config_path.read_text())
    if mode == 'enable':
        current = output('gh', 'api', 'repos/dgmolla/fitsy/commits/main', '--jq', '.sha')
        if config['source_sha'] != current:
            raise SystemExit('installed dispatcher runtime does not match current main')
        publisher = json.loads((Path.home() / '.fitsy-delivery/config.json').read_text())
        notification = json.loads((Path.home() / 'firstmate/config/slack-notifications.json').read_text())
        expected_slack = {'sender': publisher['user'], 'recipient': notification['user'],
                          'channel': publisher['channel'], 'bridge_path': publisher['bridge_path']}
        if publisher.get('recipient_user') != notification['user']:
            raise SystemExit('reporter recipient identity is unverified; reinstall reporter before enabling')
        if any(config.get('slack', {}).get(key) != value for key, value in expected_slack.items()):
            raise SystemExit('dispatcher Slack identity differs from reporter; reinstall before enabling')
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
    print(json.dumps({'enabled': config['enabled'], 'source_sha': config['source_sha']}))
PY

if [[ "$mode" == --check ]]; then exit 0; fi
if [[ "$mode" == --install ]]; then
  mkdir -p "$state/runtime" "$HOME/Library/LaunchAgents"
  chmod 700 "$state" "$state/runtime" "$state/credentials"
  install -m 0700 "$repo/scripts/delivery/local-dispatcher.py" "$state/runtime/local-dispatcher.py"
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
    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
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
