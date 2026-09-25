#!/usr/bin/env python3
"""Candidate-scoped append-only review time and round cap."""
import argparse
from datetime import datetime, timezone
import fcntl
import json
from pathlib import Path
import time


def utc():
    return datetime.now(timezone.utc).isoformat()


def read_events(handle):
    handle.seek(0)
    return [json.loads(line) for line in handle if line.strip()]


def append(handle, event):
    handle.seek(0, 2)
    handle.write(json.dumps(event, sort_keys=True) + "\n")
    handle.flush()


def exception_valid(path, lens, source_sha, seconds):
    if not path:
        return False
    try:
        data = json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return False
    return (isinstance(data, dict) and data.get("version") == 1
            and data.get("priority") in ("P0", "P1") and data.get("lens") == lens
            and data.get("source_sha") == source_sha
            and all(isinstance(data.get(k), str) and data[k].strip()
                    for k in ("finding", "realistic_impact", "evidence", "repair", "exit_condition", "owner"))
            and type(data.get("budget_seconds")) is int and 0 < data["budget_seconds"] <= 1800
            and seconds < data["budget_seconds"])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=("begin", "finish"))
    p.add_argument("--ledger", type=Path, required=True)
    p.add_argument("--round-id", required=True)
    p.add_argument("--lens", required=True)
    p.add_argument("--source-sha", required=True)
    p.add_argument("--attempt-id", required=True)
    p.add_argument("--exception")
    args = p.parse_args()
    args.ledger.parent.mkdir(parents=True, exist_ok=True)
    with args.ledger.open("a+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        events = read_events(handle)
        starts = {e["attempt_id"]: e for e in events if e.get("event") == "start"}
        finishes = {e["attempt_id"]: e for e in events if e.get("event") == "finish"}
        rounds = {e["round_id"] for e in starts.values() if not e.get("exception")}
        seconds = sum(max(0, e["elapsed_seconds"]) for e in finishes.values() if not e.get("exception"))
        seconds += sum(max(0, time.time() - e["epoch"]) for key, e in starts.items() if key not in finishes and not e.get("exception"))
        exception_seconds = sum(max(0, e["elapsed_seconds"]) for e in finishes.values() if e.get("exception"))
        exception_seconds += sum(max(0, time.time() - e["epoch"]) for key, e in starts.items() if key not in finishes and e.get("exception"))
        if args.action == "begin":
            if args.attempt_id in starts:
                result = {"allowed": False, "reason": "duplicate attempt", "rounds": len(rounds), "review_seconds": seconds}
            else:
                over = seconds >= 1800 or (args.round_id not in rounds and len(rounds) >= 2)
                exception = over and exception_valid(args.exception, args.lens, args.source_sha, exception_seconds)
                if over and not exception:
                    result = {"allowed": False, "reason": "review cap reached", "rounds": len(rounds), "review_seconds": seconds}
                else:
                    append(handle, {"event": "start", "at": utc(), "epoch": time.time(), "round_id": args.round_id,
                                    "lens": args.lens, "source_sha": args.source_sha, "attempt_id": args.attempt_id,
                                    "exception": bool(exception)})
                    result = {"allowed": True, "reason": "named P0/P1 exception" if exception else "within cap",
                              "rounds": len(rounds | {args.round_id}), "review_seconds": seconds}
        else:
            start = starts.get(args.attempt_id)
            if not start or args.attempt_id in finishes:
                result = {"allowed": False, "reason": "missing or already finished attempt"}
            else:
                elapsed = max(0, time.time() - start["epoch"])
                append(handle, {"event": "finish", "at": utc(), "attempt_id": args.attempt_id,
                                "round_id": args.round_id, "lens": args.lens, "source_sha": args.source_sha,
                                "elapsed_seconds": elapsed, "exception": start.get("exception", False)})
                result = {"allowed": True, "reason": "recorded", "elapsed_seconds": elapsed}
        print(json.dumps(result))
        return 0 if result["allowed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
