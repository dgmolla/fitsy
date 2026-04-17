#!/bin/bash
# Session-start guardrail: surface uncommitted work, stale stashes, and dirty state
# so the agent doesn't start fresh without knowing what's in-flight.

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

output=""

# 1. Uncommitted changes (staged or unstaged)
dirty=$(git status --porcelain 2>/dev/null | head -20)
if [ -n "$dirty" ]; then
  count=$(echo "$dirty" | wc -l | tr -d ' ')
  output+="UNCOMMITTED CHANGES ($count files). May be leftover from a prior session:"$'\n'
  output+="$dirty"$'\n\n'
fi

# 2. Stale stashes
stash_count=$(git stash list 2>/dev/null | wc -l | tr -d ' ')
if [ "$stash_count" -gt 0 ]; then
  stash_list=$(git stash list 2>/dev/null | head -10)
  output+="GIT STASHES ($stash_count total). Stashes often contain lost work from prior sessions:"$'\n'
  output+="$stash_list"$'\n'
  if [ "$stash_count" -gt 10 ]; then
    output+="  ... and $((stash_count - 10)) more"$'\n'
  fi
  output+=$'\n'
fi

# 3. Detached HEAD
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
if [ "$branch" = "HEAD" ]; then
  commit=$(git rev-parse --short HEAD 2>/dev/null)
  output+="DETACHED HEAD at $commit — you may have lost track of a branch."$'\n\n'
fi

# Output
if [ -n "$output" ]; then
  echo "=== SESSION START: Work-in-progress check ==="
  echo "$output"
  echo "ACTION: Review the above before starting new work. Commit, apply, or clean up stale state."
  echo "==="
fi

exit 0
