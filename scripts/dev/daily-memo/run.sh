#!/bin/bash
# Daily memo: summarizes Claude Code / Cursor activity since the last run and
# posts it to #dawit-daily-memo. Stateful (last_run in state.json) so a gap
# (machine off/asleep) is caught up in one run instead of losing days.
set -euo pipefail

MEMO_DIR="$HOME/.claude/daily-memo"
STATE_FILE="$MEMO_DIR/state.json"
LOG_FILE="$MEMO_DIR/run.log"
WORK_DIR=$(mktemp -d "$MEMO_DIR/run.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" >> "$LOG_FILE"; }

log "run start"

set -a
source "$MEMO_DIR/.env"
set +a

LAST_RUN=$(jq -r '.last_run' "$STATE_FILE")
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# BSD find's -newermt interprets its date-string argument in local time with no
# way to mark it UTC, so a UTC-labeled string silently gets misread as local
# time (off by the local UTC offset). Use a reference file's mtime instead,
# set via `touch -t` from the epoch, which is timezone-safe.
LAST_RUN_EPOCH=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$LAST_RUN" "+%s")
LAST_RUN_TOUCH_FMT=$(date -j -f "%s" "$LAST_RUN_EPOCH" "+%Y%m%d%H%M.%S")
REF_MARKER="$WORK_DIR/last_run_marker"
touch -t "$LAST_RUN_TOUCH_FMT" "$REF_MARKER"

log "window: $LAST_RUN -> $NOW"

# --- Source 1: Claude Code session transcripts ---------------------------
CLAUDE_FILES_LIST="$WORK_DIR/claude_files.txt"
find "$HOME/.claude/projects" -mindepth 2 -maxdepth 2 -name "*.jsonl" \
  -newer "$REF_MARKER" ! -path "*daily-memo*" > "$CLAUDE_FILES_LIST" 2>/dev/null || true
CLAUDE_FILE_COUNT=$(wc -l < "$CLAUDE_FILES_LIST" | tr -d ' ')
log "claude session files in window: $CLAUDE_FILE_COUNT"

# --- Source 2: Cursor composer/chat data ----------------------------------
CURSOR_DUMP="$WORK_DIR/cursor_dump.json"
echo "[]" > "$CURSOR_DUMP"
for DB in "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb" \
          "$HOME"/Library/"Application Support"/Cursor/User/workspaceStorage/*/state.vscdb; do
  [ -f "$DB" ] || continue
  LAST_RUN_MS=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$LAST_RUN" "+%s")000
  sqlite3 -json "$DB" "
    SELECT composerId, value FROM composerHeaders h
    JOIN cursorDiskKV kv ON kv.key = 'composerData:' || h.composerId
    WHERE (h.lastUpdatedAt > $LAST_RUN_MS OR h.createdAt > $LAST_RUN_MS)
      AND (h.totalLinesAdded > 0 OR h.totalLinesRemoved > 0)
  " 2>/dev/null > "$WORK_DIR/cursor_partial.json" || echo "[]" > "$WORK_DIR/cursor_partial.json"
  jq -s 'add' "$CURSOR_DUMP" "$WORK_DIR/cursor_partial.json" > "$WORK_DIR/cursor_merged.json" \
    && mv "$WORK_DIR/cursor_merged.json" "$CURSOR_DUMP"
done
CURSOR_COUNT=$(jq 'length' "$CURSOR_DUMP")
log "cursor composer entries in window: $CURSOR_COUNT"

# --- Source 3: Codex --------------------------------------------------------
# No local Codex CLI session store found on this machine as of setup
# (2026-08-28). Nothing to scan yet; add a source block here if that changes.

if [ "$CLAUDE_FILE_COUNT" -eq 0 ] && [ "$CURSOR_COUNT" -eq 0 ]; then
  log "nothing in window, skipping"
  jq --arg now "$NOW" '.last_run = $now' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
  exit 0
fi

# --- Summarize via headless Claude -----------------------------------------
PROMPT_FILE="$WORK_DIR/prompt.txt"
cat > "$PROMPT_FILE" <<EOF
You are writing a daily work memo covering the window from $LAST_RUN to $NOW (UTC).

Sources:
- Claude Code session transcripts (JSONL, one JSON object per line, each with a
  timestamp and message content) at these paths, listed in $CLAUDE_FILES_LIST.
  Read that list, then read each file it names.
- Cursor composer/chat data (raw JSON dumps of composer headers + their
  associated conversation state) at $CURSOR_DUMP. Read it if non-empty.

Task:
1. Only consider activity whose own timestamp falls inside the window above.
   A file's mtime just means "touched during the window" - the file may also
   contain older messages; ignore those.
2. Group the work into chunks, one per distinct work session / topic (not
   one chunk per file, and not one chunk per calendar day). A chunk is
   "what was this stretch of work actually about" - e.g. "Fixed the sim
   build crash", "Investigated search cold start latency".
3. For each chunk write 2-4 bullet points, tweet-size (under ~280 characters
   each, one line, no wrapping into multiple clauses): what was done, the
   outcome or current state, and what (if anything) is left / where it was
   left off. Each bullet is a short fragment, not a paragraph - cut detail
   rather than run long.
4. Only add a date label on a chunk if the overall window spans more than
   one calendar day - otherwise omit dates entirely.
5. Skip trivial/aborted chunks (a session with no real outcome, a one-line
   throwaway question). Use judgment - this is a memo for catching up on
   real work, not a transcript index.
6. Format as Slack mrkdwn: *bold* for chunk titles, then a \`-\` bulleted list
   below, a blank line between chunks. No markdown headers (#), no code
   fences unless quoting an actual snippet.
7. If, after applying all of the above, nothing substantive remains (every
   chunk was trivial/aborted), output exactly the single line
   NOTHING_HAPPENED and nothing else.

Output ONLY the memo, wrapped as <memo>...</memo> (or the single line
NOTHING_HAPPENED). No preamble, no progress notes, no "here is the memo", no
closing remarks. Do not narrate waiting on subagents; just output the final
memo once everything is read.
EOF

RAW_JSON=$(cd "$MEMO_DIR" && "$HOME/.local/bin/claude" -p "$(cat "$PROMPT_FILE")" \
  --restricted --allowedTools Read --add-dir "$HOME/.claude/projects" \
  --output-format json 2>>"$LOG_FILE" || true)
# `.result` is the final message only; the text format also streamed subagent progress ("Waiting on group A") into the memo.
MEMO_TEXT=$(printf '%s' "$RAW_JSON" | jq -r '.result // empty' 2>/dev/null | "$MEMO_DIR/extract-memo.sh" || true)

MEMO_TEXT=$(echo "$MEMO_TEXT" | sed -e 's/[[:space:]]*$//')

if [ -z "$MEMO_TEXT" ] || [ "$MEMO_TEXT" = "NOTHING_HAPPENED" ]; then
  log "summarizer found nothing substantive, skipping post"
  jq --arg now "$NOW" '.last_run = $now' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
  exit 0
fi

# --- Post to Slack -----------------------------------------------------------
# chat.postMessage silently splits `text` into multiple messages past ~4000
# chars, cutting mid-sentence. Use one section block per memo chunk instead,
# so a long memo stays a single message split cleanly at chunk boundaries.
BLOCKS_JSON=$(printf '%s' "$MEMO_TEXT" | jq -Rs '
  split("\n\n")
  | map(select(length > 0))
  | map({type: "section", text: {type: "mrkdwn", text: (if length > 2900 then .[0:2900] + "…" else . end)}})
')
FALLBACK_TEXT=$(printf '%s' "$MEMO_TEXT" | head -c 150)

RESP=$(jq -n --arg channel "$SLACK_CHANNEL_ID" --argjson blocks "$BLOCKS_JSON" --arg text "$FALLBACK_TEXT" \
    '{channel: $channel, blocks: $blocks, text: $text}' | \
  curl -s https://slack.com/api/chat.postMessage \
    -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
    -H "Content-Type: application/json; charset=utf-8" \
    --data @-)

OK=$(echo "$RESP" | jq -r '.ok')
if [ "$OK" != "true" ]; then
  log "slack post failed: $RESP"
  exit 1
fi

log "posted memo (${#MEMO_TEXT} chars)"
jq --arg now "$NOW" '.last_run = $now' "$STATE_FILE" > "$STATE_FILE.tmp" && mv "$STATE_FILE.tmp" "$STATE_FILE"
log "run end"
