#!/bin/bash
# Fix review comments for a specific agent and validate against pre-PR gates.
# Runs Claude with the agent's role context, then loops through gates until they pass.
#
# Usage: AGENT=cto PR_NUM=6 bash scripts/fix-and-validate.sh /tmp/review_comments.txt
# Env: ANTHROPIC_API_KEY, GH_TOKEN, PR_NUM, AGENT

set -euo pipefail

REVIEW_COMMENTS_FILE="${1:?Usage: fix-and-validate.sh <review-comments-file>}"
PR_NUM="${PR_NUM:?PR_NUM must be set}"
AGENT="${AGENT:-unknown}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-10}"
STUCK_THRESHOLD="${STUCK_THRESHOLD:-3}"

REVIEW_COMMENTS=$(cat "$REVIEW_COMMENTS_FILE")
GATE_ERRORS=""
PREV_ERROR_HASH=""
SAME_ERROR_COUNT=0

AGENT_CONTEXT=""
if [ "$AGENT" != "unknown" ] && [ -f ".claude/agents/${AGENT}.md" ]; then
  AGENT_CONTEXT="Read your role definition from .claude/agents/${AGENT}.md to understand your domain expertise."
fi

build_fix_prompt() {
  local attempt=$1
  if [ "$attempt" -eq 1 ]; then
    cat <<PROMPT
You are the **${AGENT}** agent fixing review feedback on this PR.

${AGENT_CONTEXT}
Read CLAUDE.md for project context and conventions.

Here is the review feedback from the **${AGENT}** reviewer that you must address:

${REVIEW_COMMENTS}

Instructions:
1. Read the review feedback carefully — only fix issues that were flagged
2. Read the relevant source files to understand full context before editing
3. Make the fixes using the Edit tool
4. Do NOT refactor, improve, or change anything beyond what the review requested
5. Do NOT add comments, docstrings, or type annotations unless the review asked for them
PROMPT
  else
    cat <<PROMPT
You are the **${AGENT}** agent. Your previous fix attempt failed the pre-PR gates.

${AGENT_CONTEXT}
Read CLAUDE.md for project context and conventions.

Here is the original review feedback from the **${AGENT}** reviewer:

${REVIEW_COMMENTS}

Here are the gate errors from your last attempt:

${GATE_ERRORS}

Fix these errors. Read the failing files, understand the issue, and correct it.
Do NOT revert your previous fixes — build on them.
PROMPT
  fi
}

run_gates() {
  GATE_ERRORS=""
  GATES_PASSED=true

  echo "--- Structural tests ---"
  if ! bash scripts/structural-tests.sh > /tmp/gate_output.txt 2>&1; then
    GATES_PASSED=false
    GATE_ERRORS="${GATE_ERRORS}

STRUCTURAL TESTS FAILED:
$(cat /tmp/gate_output.txt)"
  fi

  echo "--- Type check ---"
  if ! npx tsc --noEmit > /tmp/gate_output.txt 2>&1; then
    GATES_PASSED=false
    GATE_ERRORS="${GATE_ERRORS}

TYPE CHECK FAILED:
$(cat /tmp/gate_output.txt)"
  fi

  echo "--- Tests ---"
  if ! npm test > /tmp/gate_output.txt 2>&1; then
    GATES_PASSED=false
    GATE_ERRORS="${GATE_ERRORS}

TESTS FAILED:
$(cat /tmp/gate_output.txt)"
  fi

  echo "--- Build ---"
  if ! npm run build > /tmp/gate_output.txt 2>&1; then
    GATES_PASSED=false
    GATE_ERRORS="${GATE_ERRORS}

BUILD FAILED:
$(cat /tmp/gate_output.txt)"
  fi

  echo "--- No build output ---"
  if git diff --name-only | grep -qE '\.(js|js\.map)$'; then
    GATES_PASSED=false
    GATE_ERRORS="${GATE_ERRORS}

BUILD OUTPUT DETECTED IN WORKING TREE — remove compiled .js/.js.map files"
  fi
}

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "=== ${AGENT} fix: attempt $attempt of $MAX_ATTEMPTS ==="

  build_fix_prompt "$attempt" | claude -p \
    --model sonnet \
    --allowedTools "Read,Glob,Grep,Edit,Write,Bash(npx tsc *),Bash(npm test *),Bash(npm run build *),Bash(bash scripts/structural-tests.sh),Bash(git diff *)"

  echo "=== Running pre-PR gates ==="
  run_gates

  if [ "$GATES_PASSED" = "true" ]; then
    echo "All gates passed on attempt $attempt"
    exit 0
  fi

  echo "Gates failed on attempt $attempt"

  # Comment on PR about retry
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ] && command -v gh &>/dev/null; then
    gh pr comment "$PR_NUM" --body "**harness-bot** (${AGENT}): Fix attempt ${attempt} failed gates — retrying (attempt $((attempt + 1))/${MAX_ATTEMPTS})..." || true
  fi

  # Detect if we're stuck on the same error
  CURRENT_ERROR_HASH=$(echo "$GATE_ERRORS" | md5sum | cut -d' ' -f1)
  if [ "$CURRENT_ERROR_HASH" = "$PREV_ERROR_HASH" ]; then
    SAME_ERROR_COUNT=$((SAME_ERROR_COUNT + 1))
  else
    SAME_ERROR_COUNT=1
    PREV_ERROR_HASH="$CURRENT_ERROR_HASH"
  fi

  if [ "$SAME_ERROR_COUNT" -ge "$STUCK_THRESHOLD" ]; then
    echo "ERROR: Same error $STUCK_THRESHOLD times in a row — stuck"
    if command -v gh &>/dev/null; then
      gh pr comment "$PR_NUM" --body "**harness-bot** (${AGENT}): Auto-fix is stuck — same gate error ${STUCK_THRESHOLD}x in a row after ${attempt} attempts.

\`\`\`
${GATE_ERRORS}
\`\`\`

Manual intervention needed." || true
    fi
    exit 1
  fi

  if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
    echo "ERROR: Failed after $MAX_ATTEMPTS attempts"
    if command -v gh &>/dev/null; then
      gh pr comment "$PR_NUM" --body "**harness-bot** (${AGENT}): Auto-fix failed after ${MAX_ATTEMPTS} attempts. Gate errors on final attempt:

\`\`\`
${GATE_ERRORS}
\`\`\`

Manual intervention needed." || true
    fi
    exit 1
  fi
done
