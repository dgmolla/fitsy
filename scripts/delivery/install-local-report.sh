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

python3 - "$repo" "$mode" "${roots[@]}" <<'PY'
import base64
import json
from pathlib import Path
import subprocess
import sys

repo, mode, *roots = sys.argv[1:]
for root in roots:
    path = Path(root).expanduser().resolve()
    if not (path / '.evidence/delivery/binding.json').is_file():
        raise SystemExit(f'no delivery binding at timing root: {path}')
if mode == '--install' and not roots:
    raise SystemExit('install requires at least one explicit --timing-root')
source = subprocess.check_output(['gh', 'api',
    'repos/dgmolla/fitsy/contents/.github/workflows/hourly-delivery.yml?ref=main',
    '--jq', '.content'], text=True)
workflow = base64.b64decode(source).decode()
if '\n  schedule:' in workflow:
    raise SystemExit('main still schedules the GitHub digest; local publisher installation refused')
config = json.loads((Path.home() / 'firstmate/config/slack-notifications.json').read_text())
if not Path(config['bridge_path'], 'bridge.py').is_file():
    raise SystemExit('shared Slack limiter unavailable')
print(json.dumps({'mode': mode, 'main_schedule_disabled': True,
                  'timing_roots': len(roots), 'shared_limiter': True}))
PY

if [[ "$mode" == --check ]]; then exit 0; fi

mkdir -p "$state/runtime" "$state/slots" "$state/reports" "$HOME/Library/LaunchAgents"
chmod 700 "$state" "$state/runtime" "$state/slots" "$state/reports"
for file in hourly-report.mjs phase-report.mjs phase-events.mjs improvements.mjs local-report.py; do
  install -m 0644 "$repo/scripts/delivery/$file" "$state/runtime/$file"
done
python3 - "$state" "${roots[@]}" <<'PY'
import json
import math
import os
from pathlib import Path
import sys
import time

state = Path(sys.argv[1]); roots = [str(Path(root).expanduser().resolve()) for root in sys.argv[2:]]
source = json.loads((Path.home() / 'firstmate/config/slack-notifications.json').read_text())
path = state / 'config.json'
if path.exists():
    old = json.loads(path.read_text())
    activated = old['activated_at']
    if old['channel'] != source['channel']:
        raise SystemExit('Slack channel changed; reconcile existing receipts first')
else:
    activated = math.ceil(time.time() / 1800) * 1800
value = {'activated_at': activated, 'channel': source['channel'],
         'bridge_path': source['bridge_path'], 'timing_roots': roots}
temporary = path.with_suffix('.tmp'); temporary.write_text(json.dumps(value) + '\n')
temporary.chmod(0o600); os.replace(temporary, path)
PY

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
