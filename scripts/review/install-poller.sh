#!/usr/bin/env bash
# Install the review poller as a LaunchAgent (every 3 minutes, on the Max
# subscription). Same launchd pattern as the daily-memo job.
#   bash scripts/review/install-poller.sh          # install + start
#   bash scripts/review/install-poller.sh --uninstall
set -euo pipefail
LABEL="com.fitsy.review-poller"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REVIEW_HOME="$HOME/.fitsy-review"
SCRIPT="$REVIEW_HOME/repo/scripts/review/poller.sh"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "uninstalled $LABEL"
  exit 0
fi

mkdir -p "$REVIEW_HOME" "$HOME/Library/LaunchAgents"
if [ ! -d "$REVIEW_HOME/repo/.git" ]; then
  gh repo clone dgmolla/fitsy "$REVIEW_HOME/repo" -- --quiet
fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPT</string>
  </array>
  <key>StartInterval</key><integer>180</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key><string>$REVIEW_HOME/launchd.log</string>
  <key>StandardErrorPath</key><string>$REVIEW_HOME/launchd.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL (every 3 min). Logs: $REVIEW_HOME/poller.log"
