#!/usr/bin/env python3
"""Validate one provider-neutral verdict, or a Claude result envelope, fail-closed."""
import json
import re
import sys


def validate(value, lens):
    if not isinstance(value, dict) or value.get("lens") != lens:
        return False
    if value.get("verdict") not in ("pass", "fail") or not isinstance(value.get("findings"), list):
        return False
    for finding in value["findings"]:
        if not isinstance(finding, dict) or finding.get("severity") not in ("CONFIRMED", "PLAUSIBLE", "NIT"):
            return False
        if type(finding.get("line")) is not int or finding["line"] < 0:
            return False
        if any(not isinstance(finding.get(key), str) or not finding[key].strip()
               for key in ("file", "summary", "scenario", "fix")):
            return False
    confirmed = any(f["severity"] == "CONFIRMED" for f in value["findings"])
    return (value["verdict"] == "fail") == confirmed


def extract(raw, lens):
    try:
        value = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        value = None
    if isinstance(value, dict):
        if value.get("is_error") is True or value.get("error"):
            return None
        if "result" in value:
            raw = value["result"]
            if not isinstance(raw, str):
                return None
        elif validate(value, lens):
            return value
        else:
            return None
    blocks = re.findall(r"```json\s*(.*?)```", raw, re.S)
    # Multiple final verdicts are ambiguous; never choose a convenient pass.
    if len(blocks) > 1:
        return None
    try:
        value = json.loads(blocks[0] if blocks else raw)
    except (json.JSONDecodeError, ValueError):
        return None
    return value if validate(value, lens) else None


if __name__ == "__main__":
    lens = sys.argv[1]
    verdict = extract(sys.stdin.read(), lens)
    if verdict is None:
        verdict = {
            "lens": lens,
            "verdict": "fail",
            "findings": [{
                "severity": "CONFIRMED", "file": "(runner)", "line": 0,
                "summary": "review did not produce a valid completed verdict; failing closed",
                "scenario": "runner failed or response did not satisfy REVIEW.md's output contract",
                "fix": "inspect the configured review provider and errors.log, then rerun the same lens",
            }],
        }
    print(json.dumps(verdict))
