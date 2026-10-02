#!/usr/bin/env bash
# Install the review poller as a LaunchAgent (every 3 minutes, on the Max
# subscription). Same launchd pattern as the daily-memo job.
#   bash scripts/review/install-poller.sh          # install + start
#   bash scripts/review/install-poller.sh --uninstall
#   bash scripts/review/install-poller.sh --refresh-runtime # preserve service/settings
set -euo pipefail
LABEL="com.fitsy.review-poller"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
REVIEW_HOME="$HOME/.fitsy-review"
SCRIPT="$REVIEW_HOME/runtime/poller.sh"

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

# Keep launchd's executable outside the PR-mutated review clone.
# Publish only a complete trusted-main copy, retaining the prior installed file
# if fetching or writing fails.
mkdir -p "$REVIEW_HOME/runtime"
git -C "$REVIEW_HOME/repo" fetch -q origin main
STAGED_SCRIPT="$(mktemp "$REVIEW_HOME/runtime/.poller.XXXXXX")"
trap 'rm -f "$STAGED_SCRIPT"' EXIT
git -C "$REVIEW_HOME/repo" show origin/main:scripts/review/poller.sh > "$STAGED_SCRIPT"
chmod 700 "$STAGED_SCRIPT"
mv "$STAGED_SCRIPT" "$SCRIPT"
# Refresh executable only, preserving enabled state and persistent provider settings.
if [ "${1:-}" = --refresh-runtime ]; then
  echo "refreshed trusted runtime: $SCRIPT"
  exit 0
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
