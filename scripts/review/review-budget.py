#!/usr/bin/env python3
"""Append-only candidate review execution budget, including imported history."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import time

CAP_SECONDS = 1800
CLOSEOUT_SECONDS = 5


def utc():
    return datetime.now(timezone.utc).isoformat()


def number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def read_events(handle):
    handle.seek(0)
    events = []
    for line in handle:
        if not line.strip():
            continue
        event = json.loads(line)
        if not isinstance(event, dict):
            raise ValueError("invalid review ledger event")
        rows = event.get("events") if event.get("event") == "import" else [event]
        if not isinstance(rows, list):
            raise ValueError("invalid imported review history")
        for row in rows:
            if (not isinstance(row, dict) or row.get("event") not in ("start", "finish")
                    or not isinstance(row.get("attempt_id"), str) or not row["attempt_id"]):
                raise ValueError("invalid review attempt")
            field = "epoch" if row["event"] == "start" else "elapsed_seconds"
            if not number(row.get(field)):
                raise ValueError(f"invalid review {field}")
            if row["event"] == "start" and "reserved_seconds" in row and not number(row["reserved_seconds"]):
                raise ValueError("invalid review reservation")
            events.append(row)
    return events


def indexed(events):
    unique = {}
    for event in events:
        key = (event["event"], event["attempt_id"])
        if key in unique and unique[key] != event:
            raise ValueError(f"conflicting retained review history for {event['attempt_id']}")
        unique[key] = event
    return unique


def append(handle, event):
    handle.seek(0, 2)
    handle.write(json.dumps(event, sort_keys=True) + "\n")
    handle.flush()
    os.fsync(handle.fileno())


def import_history(handle, ledger, paths, optional_paths):
    """Retain original events and flags; copied histories count exactly once."""
    events = indexed(read_events(handle))
    pending = []
    for path, required in [(p, True) for p in paths] + [(p, False) for p in optional_paths]:
        source = Path(path)
        if not source.exists():
            if required:
                raise ValueError(f"missing required review ledger: {source}")
            continue
        if source.resolve() == ledger.resolve():
            continue
        with source.open() as old:
            fcntl.flock(old, fcntl.LOCK_SH)
            incoming = indexed(read_events(old))
            old.seek(0)
            digest = hashlib.sha256(old.read().encode()).hexdigest()
        new = []
        for key, event in incoming.items():
            if key in events and events[key] != event:
                raise ValueError(f"conflicting retained review history in {source}")
            if key not in events:
                new.append(event)
                events[key] = event
        if new:
            pending.append({"event": "import", "at": utc(), "source": str(source.resolve()),
                            "sha256": digest, "events": new})
    usage(list(events.values()))
    for event in pending:
        append(handle, event)
    return list(events.values())


def bind_candidate(ledger, candidate, issue):
    """Keep the delivery issue stable across clones and later source heads."""
    if not isinstance(issue, int) or issue <= 0 or not candidate.strip():
        raise ValueError("candidate requires a positive delivery issue and branch identity")
    directory = ledger.parent / "candidates"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (hashlib.sha256(candidate.encode()).hexdigest() + ".json")
    with path.open("a+") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        handle.seek(0)
        previous = handle.read()
        if previous:
            binding = json.loads(previous)
            if binding.get("candidate") != candidate or binding.get("issue") != issue:
                raise ValueError("candidate issue binding conflict; retain the original delivery issue and history")
        else:
            append(handle, {"candidate": candidate, "issue": issue, "at": utc()})


def elapsed(start):
    # Monotonic time measures new executions; legacy records retain epoch accounting.
    if number(start.get("monotonic")) and time.monotonic() >= start["monotonic"]:
        return time.monotonic() - start["monotonic"]
    return max(0, time.time() - start["epoch"])


def usage(events):
    starts = {e["attempt_id"]: e for e in events if e["event"] == "start"}
    finishes = {e["attempt_id"]: e for e in events if e["event"] == "finish"}
    if any(key not in starts for key in finishes):
        raise ValueError("review finish has no retained start")
    # Exception/adoption/closeout flags are historical provenance, never excluded time.
    completed = sum(e["elapsed_seconds"] for e in finishes.values())
    active = {key: e for key, e in starts.items() if key not in finishes}
    # An interrupted new attempt retains its full reservation until reconciled.
    # An unbounded legacy attempt has unknown completion and fails closed at the cap.
    reserved = sum(e.get("reserved_seconds", CAP_SECONDS) for e in active.values())
    return starts, finishes, {"cap_seconds": CAP_SECONDS, "completed_seconds": completed,
        "reserved_seconds": reserved, "remaining_seconds": max(0, CAP_SECONDS - completed - reserved),
        "review_seconds": completed,
        "observed_running_seconds": sum(min(elapsed(e), e["reserved_seconds"]) for e in active.values() if "reserved_seconds" in e),
        "unbounded_attempts": [key for key, e in active.items() if "reserved_seconds" not in e],
        "rounds": len({e.get("round_id") for e in starts.values()}), "unfinished_attempts": list(active)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("begin", "finish", "status"))
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--import-ledger", action="append", default=[])
    parser.add_argument("--optional-import-ledger", action="append", default=[])
    for name in ("round-id", "lens", "source-sha", "attempt-id"):
        parser.add_argument(f"--{name}")
    # Retained CLI compatibility: these permits cannot extend the time-only cap.
    for name in ("exception", "adoption", "closeout"):
        parser.add_argument(f"--{name}")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--candidate")
    parser.add_argument("--issue", type=int)
    parser.add_argument("--outcome", choices=("pass", "fail", "interrupted"), default="interrupted")
    args = parser.parse_args()
    args.ledger.parent.mkdir(parents=True, exist_ok=True)
    try:
        if args.candidate is not None:
            bind_candidate(args.ledger, args.candidate, args.issue)
        with args.ledger.open("a+") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            events = import_history(handle, args.ledger, args.import_ledger, args.optional_import_ledger)
            starts, finishes, total = usage(events)
            result = {"allowed": True, "reason": "history accounted", "ledger": str(args.ledger.resolve()), **total}
            if args.action != "status" and not all((args.round_id, args.lens, args.source_sha, args.attempt_id)):
                raise ValueError("review attempt identity is required")
            if args.action == "begin":
                if args.attempt_id in starts:
                    result.update(allowed=False, reason="duplicate attempt")
                elif not 1 <= args.timeout_seconds <= 3600:
                    result.update(allowed=False, reason="review timeout must be between 1 and 3600 seconds")
                else:
                    grant = min(args.timeout_seconds, math.floor(total["remaining_seconds"] - CLOSEOUT_SECONDS))
                    if grant < 1:
                        result.update(allowed=False, reason="cumulative review time exhausted or reserved")
                    else:
                        append(handle, {"event": "start", "at": utc(), "epoch": time.time(),
                            "monotonic": time.monotonic(), "round_id": args.round_id, "lens": args.lens,
                            "source_sha": args.source_sha, "attempt_id": args.attempt_id,
                            "timeout_seconds": grant, "reserved_seconds": grant + CLOSEOUT_SECONDS,
                            "legacy_permits": {key: getattr(args, key) for key in ("exception", "adoption", "closeout") if getattr(args, key)}})
                        result.update(reason="within cumulative time budget", timeout_seconds=grant,
                                      reservation_seconds=grant + CLOSEOUT_SECONDS)
            elif args.action == "finish":
                start = starts.get(args.attempt_id)
                if not start or args.attempt_id in finishes:
                    result.update(allowed=False, reason="missing or already finished attempt")
                elif any(start.get(key) != getattr(args, key) for key in ("round_id", "lens", "source_sha")):
                    result.update(allowed=False, reason="review closeout identity mismatch")
                else:
                    seconds = elapsed(start)
                    append(handle, {"event": "finish", "at": utc(), "attempt_id": args.attempt_id,
                        "round_id": args.round_id, "lens": args.lens, "source_sha": args.source_sha,
                        "elapsed_seconds": seconds, "outcome": args.outcome,
                        **{key: start[key] for key in ("exception", "adoption", "closeout") if key in start}})
                    result.update(reason="recorded", elapsed_seconds=seconds)
        print(json.dumps(result))
        return 0 if result["allowed"] else 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"allowed": False, "reason": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
