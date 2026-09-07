#!/usr/bin/env python3
"""Render a lens verdict JSON (stdin) as a PR comment (stdout)."""
import json
import sys

d = json.load(sys.stdin)
out = [f"## lens/{d['lens']}: {d['verdict']}"]
for f in d.get("findings", []):
    sev = f.get("severity", "?")
    loc = f"{f.get('file', '?')}:{f.get('line', 0)}"
    out.append(f"\n**{sev}** `{loc}` — {f.get('summary', '')}")
    if f.get("scenario"):
        out.append(f"  - scenario: {f['scenario']}")
    if f.get("fix"):
        out.append(f"  - fix: {f['fix']}")
out.append("\n<sub>posted by scripts/review/run-lens.sh (local runner)</sub>")
print("\n".join(out))
