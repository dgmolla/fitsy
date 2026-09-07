#!/usr/bin/env python3
"""Extract the lens verdict JSON from a `claude -p --output-format json` result.

stdin: the CLI's JSON envelope (or raw text). argv[1]: lens name.
stdout: normalized verdict JSON. Fail-closed: unparseable -> verdict "fail"
with a synthetic finding, so a broken review never silently passes.
"""
import json
import re
import sys

lens = sys.argv[1]
raw = sys.stdin.read()

text = raw
try:
    envelope = json.loads(raw)
    text = envelope.get("result", raw) if isinstance(envelope, dict) else raw
except (json.JSONDecodeError, ValueError):
    pass

verdict = None
for block in re.findall(r"```json\s*(.*?)```", text, re.S) or re.findall(r"(\{.*\})", text, re.S):
    try:
        candidate = json.loads(block)
        if isinstance(candidate, dict) and "verdict" in candidate:
            verdict = candidate
            break
    except (json.JSONDecodeError, ValueError):
        continue

if verdict is None:
    verdict = {
        "lens": lens,
        "verdict": "fail",
        "findings": [{
            "severity": "CONFIRMED",
            "file": "(runner)",
            "line": 0,
            "summary": "review produced no parseable verdict; failing closed",
            "scenario": "runner could not extract the output-contract JSON",
            "fix": "re-run scripts/review/run-lens.sh; if persistent, check ~/.cache/fitsy-review/errors.log",
        }],
    }

verdict["lens"] = lens
verdict.setdefault("findings", [])
if verdict.get("verdict") not in ("pass", "fail"):
    verdict["verdict"] = "fail"
print(json.dumps(verdict))
