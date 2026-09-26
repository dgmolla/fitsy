#!/usr/bin/env python3
"""Render a lens verdict JSON (stdin) as a PR comment (stdout)."""
import json
import sys

d = json.load(sys.stdin)
out = [f"## lens/{d['lens']}: {d['verdict']}"]
if d["verdict"] == "incomplete":
    error = d.get("error", {})
    out.append(f"\nIndependent review incomplete ({error.get('kind', 'unknown')}): {error.get('message', 'no completed verdict')}.")
    out.append("Inspect reviewer execution logs and rerun this lens. This is not a code finding.")
for f in d.get("findings", []):
    sev = f.get("severity", "?")
    loc = f"{f.get('file', '?')}:{f.get('line', 0)}"
    out.append(f"\n**{sev} / {f.get('priority', '?')}** `{loc}`: {f.get('summary', '')}")
    if f.get("impact"):
        out.append(f"  - impact: {f['impact']}")
    if f.get("scenario"):
        out.append(f"  - scenario: {f['scenario']}")
    if f.get("fix"):
        out.append(f"  - fix: {f['fix']}")
out.append("\n<sub>posted by scripts/review/run-lens.sh (local runner)</sub>")
print("\n".join(out))
