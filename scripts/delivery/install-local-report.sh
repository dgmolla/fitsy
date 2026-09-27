#!/usr/bin/env bash
# Install the reviewed local half-hour publisher. Run only after main no longer schedules a GitHub digest.
set -euo pipefail

label=com.fitsy.local-delivery-report
state="${FITSY_DELIVERY_HOME:-$HOME/.fitsy-delivery}"
plist="$HOME/Library/LaunchAgents/$label.plist"
repo="$(git rev-parse --show-toplevel)"
mode="${1:---check}"
shift || true

if [[ "$mode" == --uninstall ]]; then
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  rm -f "$plist"
  echo "uninstalled $label; receipts retained in $state"
  exit 0
fi
if [[ "$mode" != --check && "$mode" != --install ]]; then
  echo 'usage: install-local-report.sh --check|--install [--timing-root PATH ...]' >&2
  exit 2
fi

roots=()
while (( $# )); do
  [[ "$1" == --timing-root && $# -ge 2 ]] || { echo 'expected --timing-root PATH' >&2; exit 2; }
  roots+=("$2")
  shift 2
done

publisher_user="$(python3 - "$repo" "$mode" "${roots[@]}" <<'PY'
import base64
import json
from pathlib import Path
import runpy
import subprocess
import sys

repo, mode, *roots = sys.argv[1:]
for root in roots:
    path = Path(root).expanduser().resolve()
    if not (path / '.evidence/delivery/binding.json').is_file():
        raise SystemExit(f'no delivery binding at timing root: {path}')
if mode == '--install' and not roots:
    raise SystemExit('install requires at least one explicit --timing-root')
local_head = subprocess.check_output(['git', '-C', repo, 'rev-parse', 'HEAD'], text=True).strip()
main_head = subprocess.check_output(['gh', 'api', 'repos/dgmolla/fitsy/commits/main',
    '--jq', '.sha'], text=True).strip()
if local_head != main_head:
    raise SystemExit('local checkout is not the exact current main commit; installation refused')
if subprocess.check_output(['git', '-C', repo, 'status', '--porcelain', '--untracked-files=all'],
                           text=True).strip():
    raise SystemExit('local checkout has uncommitted files; installation refused')
source = subprocess.check_output(['gh', 'api',
    'repos/dgmolla/fitsy/contents/.github/workflows/hourly-delivery.yml?ref=main',
    '--jq', '.content'], text=True)
workflow = base64.b64decode(source).decode()
if '\n  schedule:' in workflow:
    raise SystemExit('main still schedules the GitHub digest; local publisher installation refused')
config = json.loads((Path.home() / 'firstmate/config/slack-notifications.json').read_text())
recipient_user = config['user']  # Mention target, not the authenticated publisher.
if not isinstance(recipient_user, str) or not recipient_user:
    raise SystemExit('shared Slack recipient identity unavailable')
if not Path(config['bridge_path'], 'bridge.py').is_file():
    raise SystemExit('shared Slack limiter unavailable')
sys.path.insert(0, config['bridge_path'])
import bridge
bridge.load_env()
settings = bridge.Config.from_env()
if settings.channel != config['channel']:
    raise SystemExit('Slack channel does not match shared limiter configuration')
authenticated_sender = runpy.run_path(str(Path(repo) / 'scripts/delivery/local-report.py'))['authenticated_sender']
publisher_user = authenticated_sender(bridge.Slack(bridge.Store(settings)))
print(publisher_user)
PY
)"
echo "checked $mode: current main, shared limiter, channel and token publisher; ${#roots[@]} timing roots"

if [[ "$mode" == --check ]]; then exit 0; fi

mkdir -p "$state/runtime" "$state/slots" "$state/reports" "$HOME/Library/LaunchAgents"
chmod 700 "$state" "$state/runtime" "$state/slots" "$state/reports"
python3 - "$state" "$publisher_user" "${roots[@]}" <<'PY'
import json
import math
import os
from pathlib import Path
import sys
import time

state = Path(sys.argv[1]); publisher_user = sys.argv[2]
roots = [str(Path(root).expanduser().resolve()) for root in sys.argv[3:]]
source = json.loads((Path.home() / 'firstmate/config/slack-notifications.json').read_text())
path = state / 'config.json'
if path.exists():
    old = json.loads(path.read_text())
    activated = old['activated_at']
    # Legacy installs put the recipient in `user`; recovered installs put the sender there.
    # Only a legacy recipient without slot history may be migrated automatically.
    old_user = old.get('user', old.get('publisher_user'))
    legacy_recipient = ('recipient_user' not in old and old_user == source['user']
                        and not any((state / 'slots').glob('*.json')))
    if old['channel'] != source['channel'] or (old_user != publisher_user and not legacy_recipient):
        raise SystemExit('Slack publisher identity changed; reconcile existing receipts first')
    if old.get('timing_roots') != roots:
        raise SystemExit('timing roots changed; reconcile existing activation and receipts first')
else:
    activated = math.ceil(time.time() / 1800) * 1800
dispatcher_home = Path(os.environ.get('FITSY_DISPATCH_HOME', Path.home() / '.fitsy-dispatcher'))
dispatcher_path = dispatcher_home.expanduser() / 'config.json'
if dispatcher_path.exists():
    dispatcher = json.loads(dispatcher_path.read_text())
    slack = dispatcher.get('slack')
    expected = {'sender': publisher_user, 'recipient': source['user'],
                'channel': source['channel'], 'bridge_path': source['bridge_path']}
    stale = not isinstance(slack, dict) or any(slack.get(key) != value
                                                for key, value in expected.items())
    dispatcher_plist = Path.home() / 'Library/LaunchAgents/com.fitsy.local-dispatcher.plist'
    if stale and (dispatcher.get('enabled') or dispatcher_plist.exists()):
        raise SystemExit('pause and uninstall the stale local dispatcher before reporter '
                         'Slack identity change; reinstall dispatcher afterward')
value = {'activated_at': activated, 'channel': source['channel'], 'user': publisher_user,
         'recipient_user': source['user'],
         'bridge_path': source['bridge_path'], 'timing_roots': roots}
temporary = path.with_suffix('.tmp'); temporary.write_text(json.dumps(value) + '\n')
temporary.chmod(0o600); os.replace(temporary, path)
PY

for file in hourly-report.mjs phase-report.mjs phase-events.mjs improvements.mjs local-report.py; do
  install -m 0644 "$repo/scripts/delivery/$file" "$state/runtime/$file"
done

python_bin="$(command -v python3)"
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>
    <string>$python_bin</string><string>$state/runtime/local-report.py</string>
  </array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key><dict>
    <key>FITSY_DELIVERY_STATE</key><string>$state</string>
    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key><string>$state/launchd.log</string>
  <key>StandardErrorPath</key><string>$state/launchd.log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "installed $label; half-hour slots are eligible after minute 02/32, with 60-second retry checks"
