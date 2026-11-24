#!/bin/bash
# Reads the summarizer's output on stdin and prints only the memo (#1066).
# The prompt asks for the memo between <memo> and </memo>; anything outside the tags (progress chatter such as "waiting on
# group A") is dropped. With no tags, the whole input is printed so a model that skips the tags still posts.
# Leading and trailing blank lines are trimmed. Plain awk only (BSD and GNU compatible).
awk '
  { text = text $0 "\n" }
  END {
    start = index(text, "<memo>")
    if (start > 0) {
      text = substr(text, start + 6)
      stop = index(text, "</memo>")
      if (stop > 0) text = substr(text, 1, stop - 1)
    }
    count = split(text, lines, "\n")
    first = 1; last = count
    while (first <= count && lines[first] ~ /^[[:space:]]*$/) first++
    while (last >= first && lines[last] ~ /^[[:space:]]*$/) last--
    for (i = first; i <= last; i++) print lines[i]
  }'
