#!/usr/bin/env python3
"""Evaluate a raw review against separately recorded, source-bound dispositions."""
import argparse
import hashlib
import json
from pathlib import Path
import sys


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def failure(identity, reason):
    return {"gate": "fail", "reason": reason, "identity": identity}


def evaluate(raw, lens, source_sha, diff_sha256, dispositions, root):
    review = {key: raw.get(key) for key in ("lens", "verdict", "findings")}
    identity = {"source_sha": source_sha, "diff_sha256": diff_sha256, "review_sha256": digest(review)}
    if raw.get("lens") == lens and raw.get("verdict") == "incomplete":
        return failure(identity, "independent review incomplete")
    if raw.get("lens") != lens or raw.get("verdict") not in ("pass", "fail") or not isinstance(raw.get("findings"), list):
        return failure(identity, "invalid raw review")
    if any(f.get("file") == "(runner)" for f in raw["findings"]):
        return failure(identity, "invalid independent review")
    confirmed = [(index, finding) for index, finding in enumerate(raw["findings"])
                 if finding.get("severity") == "CONFIRMED"]
    if not confirmed:
        return {"gate": "pass" if raw["verdict"] == "pass" else "fail",
                "reason": "no confirmed findings", "identity": identity}
    if not dispositions:
        return failure(identity, "missing dispositions")
    try:
        data = json.loads(Path(dispositions).read_text())
    except (OSError, ValueError):
        return failure(identity, "unreadable dispositions")
    if not isinstance(data, dict) or data.get("version") != 1 or data.get("lens") != lens:
        return failure(identity, "invalid disposition header")
    if any(data.get(key) != value for key, value in identity.items()):
        return failure(identity, "stale disposition identity")
    entries = data.get("findings")
    if not isinstance(entries, list) or len(entries) != len(confirmed):
        return failure(identity, "missing or extra dispositions")
    blocked = []
    for (index, finding), entry in zip(confirmed, entries):
        if not isinstance(entry, dict) or entry.get("index") != index or entry.get("finding_sha256") != digest(finding):
            return failure(identity, f"stale finding disposition {index}")
        priority = finding.get("priority")
        if priority not in ("P0", "P1", "P2", "P3") or entry.get("priority") != priority:
            return failure(identity, f"missing or mismatched priority {index}")
        impact = entry.get("impact")
        if not isinstance(impact, dict) or any(not nonempty(impact.get(k)) for k in ("user_outcome", "trigger", "scope", "evidence", "contract")):
            return failure(identity, f"incomplete impact evidence {index}")
        if priority in ("P0", "P1"):
            if entry.get("disposition") != "block":
                return failure(identity, f"invalid high-impact disposition {index}")
            blocked.append(index)
            continue
        if entry.get("disposition") != "defer" or not nonempty(entry.get("owner")) or not nonempty(entry.get("acceptance")):
            return failure(identity, f"unowned follow-up {index}")
        tests = entry.get("required_tests")
        if not isinstance(tests, list) or not tests:
            return failure(identity, f"missing required test {index}")
        seen = set()
        for test in tests:
            if not isinstance(test, dict) or not nonempty(test.get("id")) or not nonempty(test.get("receipt")) or not nonempty(test.get("sha256")):
                return failure(identity, f"invalid test reference {index}")
            if test["id"] in seen:
                return failure(identity, f"duplicate required test {index}")
            seen.add(test["id"])
            receipt_path = (root / test["receipt"]).resolve()
            if not receipt_path.is_relative_to((root / ".evidence").resolve()):
                return failure(identity, f"test receipt outside evidence {index}")
            try:
                receipt_bytes = receipt_path.read_bytes()
                receipt = json.loads(receipt_bytes)
            except (OSError, ValueError):
                return failure(identity, f"missing required test receipt {index}")
            if hashlib.sha256(receipt_bytes).hexdigest() != test["sha256"]:
                return failure(identity, f"changed required test receipt {index}")
            if (not isinstance(receipt, dict) or receipt.get("id") != test["id"]
                    or receipt.get("source_sha") != source_sha or receipt.get("result") != "pass"
                    or receipt.get("exit_code") != 0 or not nonempty(receipt.get("command"))
                    or not nonempty(receipt.get("finished_at"))):
                return failure(identity, f"failed or stale required test {index}")
    if blocked:
        return failure(identity, "P0/P1 finding blocks: " + ",".join(map(str, blocked)))
    return {"gate": "pass", "reason": "owned P2/P3 follow-ups with required tests", "identity": identity}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lens", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--diff-sha256", required=True)
    parser.add_argument("--dispositions")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    try:
        raw = json.load(sys.stdin)
        result = evaluate(raw, args.lens, args.source_sha, args.diff_sha256, args.dispositions, args.root.resolve())
    except (ValueError, TypeError, AttributeError) as error:
        result = failure({}, f"invalid gate input: {error}")
    print(json.dumps(result))
    return 0 if result["gate"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
