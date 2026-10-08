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
# The same committed main snapshot supplies local verdict creation outside candidates.
# Installation remains an operator action; workers never promote their branch here.
TRUSTED_STAGE="$(mktemp -d "$REVIEW_HOME/.trusted-local.XXXXXX")"
trap 'rm -f "$STAGED_SCRIPT"; rm -rf "$TRUSTED_STAGE"' EXIT
git -C "$REVIEW_HOME/repo" archive origin/main scripts/review scripts/delivery/phase-events.mjs scripts/verify/risk-tiers.yml scripts/verify/receipt-cache.mjs scripts/verify/impact-plan.mjs REVIEW.md .claude/lenses | tar -x -C "$TRUSTED_STAGE"
# Retain the key across refreshes so valid unchanged receipts remain verifiable.
if [ ! -f "$REVIEW_HOME/provenance-private.pem" ]; then
  umask 077
  openssl genrsa -out "$REVIEW_HOME/provenance-private.pem" 3072
fi
openssl rsa -in "$REVIEW_HOME/provenance-private.pem" -pubout -out "$REVIEW_HOME/provenance-public.pem"
if [ -d "$REVIEW_HOME/trusted-local" ]; then
  TRUSTED_HISTORY="$(mktemp -d "$REVIEW_HOME/.trusted-local.previous.XXXXXX")"
  rmdir "$TRUSTED_HISTORY"
  mv "$REVIEW_HOME/trusted-local" "$TRUSTED_HISTORY"
fi
mv "$TRUSTED_STAGE" "$REVIEW_HOME/trusted-local"
# Preserve existing provider/settings when upgrading a legacy mutable-clone
# launcher. Refresh does not start an absent or disabled service.
REFRESH="${1:-}"
WAS_LOADED=0
if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then WAS_LOADED=1; fi
python3 -I - "$PLIST" "$SCRIPT" "$LABEL" "$REVIEW_HOME" "$REFRESH" <<'PYTHON'
import os,plistlib,sys,tempfile
from pathlib import Path
path,script,label,review_home,mode=sys.argv[1:]
p=Path(path)
value=plistlib.loads(p.read_bytes()) if p.exists() else {}
if mode == '--refresh-runtime' and not value:
    raise SystemExit(0)
value.update({'Label':label,'ProgramArguments':['/bin/bash',script]})
if mode != '--refresh-runtime':
    value.update({'StartInterval':180,'RunAtLoad':True,'StandardOutPath':review_home+'/launchd.log','StandardErrorPath':review_home+'/launchd.log'})
    env=value.setdefault('EnvironmentVariables',{})
    env.setdefault('PATH',str(Path.home())+'/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')
    env.setdefault('FITSY_REVIEW_PROVIDER','codex')
    env.setdefault('FITSY_REVIEW_MODEL','gpt-6-sol')
    env.setdefault('FITSY_REVIEW_REASONING_EFFORT','high')
with tempfile.NamedTemporaryFile('wb',dir=p.parent,delete=False) as out:
    plistlib.dump(value,out); out.flush(); os.fsync(out.fileno()); temporary=Path(out.name)
temporary.chmod(0o600); os.replace(temporary,p)
PYTHON
if [ "$REFRESH" = --refresh-runtime ]; then
  if [ "$WAS_LOADED" = 1 ]; then
    launchctl bootout "gui/$(id -u)/$LABEL"
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
  fi
  echo "refreshed trusted runtime and launcher; prior loaded state=$WAS_LOADED"
  exit 0
fi

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $LABEL (every 3 min). Logs: $REVIEW_HOME/poller.log"
