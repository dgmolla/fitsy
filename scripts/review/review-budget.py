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
EXTENSION_SECONDS = 900
CLOSEOUT_SECONDS = 5
# One human-authorized, issue-bound exception. Other issues retain the normal cap.
AUTHORIZED_GRANT = {"issue": 428, "seconds": 600,
    "provenance": "https://github.com/dgmolla/fitsy/issues/428#issuecomment-5935945700"}
AUTHORIZED_BASELINE_ATTEMPT = "88a154b4-95fa-47c9-b108-cd59332809e4"
AUTHORIZED_BASELINE_SECONDS = 2360.544
LIBERAL_GRANT = {"issue": 428, "seconds": 7200,
    "provenance": "https://github.com/dgmolla/fitsy/issues/428#issuecomment-5938480556"}
LIBERAL_BASELINE_ATTEMPTS = frozenset((
    "e69bd34e-a529-416a-8b18-6b82be631f3d",
    "0e399d2f-0e21-46db-b08a-1ccfb6337e90",
    "a4ae2ec2-1f26-49b4-9719-2f4327aa6130",
))
LIBERAL_BASELINE_SECONDS = 3261.214


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
            if isinstance(row, dict) and row.get("event") == "authorized-grant":
                if (row.get("attempt_id") != "issue-428-authorized-grant"
                        or any(row.get(key) != value for key, value in AUTHORIZED_GRANT.items())):
                    raise ValueError("invalid authorized review grant")
                events.append(row)
                continue
            if isinstance(row, dict) and row.get("event") == "liberal-grant":
                if (row.get("attempt_id") != "issue-428-liberal-grant"
                        or any(row.get(key) != value for key, value in LIBERAL_GRANT.items())):
                    raise ValueError("invalid liberal review grant")
                events.append(row)
                continue
            if isinstance(row, dict) and row.get("event") == "extension":
                if (row.get("attempt_id") != "issue-extension" or row.get("seconds") != EXTENSION_SECONDS
                        or type(row.get("issue")) is not int or row["issue"] <= 0
                        or row.get("risk") not in ("medium", "high") or row.get("required") is not True):
                    raise ValueError("invalid issue review extension")
                events.append(row)
                continue
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
    extensions = [e for e in events if e["event"] == "extension"]
    grants = [e for e in events if e["event"] == "authorized-grant"]
    liberal_grants = [e for e in events if e["event"] == "liberal-grant"]
    if len(extensions) > 1:
        raise ValueError("multiple review extensions are not permitted")
    if len(grants) > 1 or (grants and (len(extensions) != 1 or extensions[0]["issue"] != AUTHORIZED_GRANT["issue"])):
        raise ValueError("duplicate or mismatched authorized review grant")
    if len(liberal_grants) > 1 or (liberal_grants and (len(grants) != 1 or grants[0]["issue"] != LIBERAL_GRANT["issue"])):
        raise ValueError("duplicate or mismatched liberal review grant")
    cap = (CAP_SECONDS + (EXTENSION_SECONDS if extensions else 0)
        + (AUTHORIZED_GRANT["seconds"] if grants else 0)
        + (LIBERAL_GRANT["seconds"] if liberal_grants else 0))
    starts = {e["attempt_id"]: e for e in events if e["event"] == "start"}
    finishes = {e["attempt_id"]: e for e in events if e["event"] == "finish"}
    if any(key not in starts for key in finishes):
        raise ValueError("review finish has no retained start")
    # Exception/adoption/closeout flags are historical provenance, never excluded time.
    completed = sum(e["elapsed_seconds"] for e in finishes.values())
    active = {key: e for key, e in starts.items() if key not in finishes}
    # An interrupted new attempt retains its full reservation until reconciled.
    # An unbounded legacy attempt has unknown completion and fails closed at the cap.
    reserved = sum(e.get("reserved_seconds", cap) for e in active.values())
    return starts, finishes, {"cap_seconds": cap, "extension_issue": extensions[0]["issue"] if extensions else None,
        "authorized_grant_issue": grants[0]["issue"] if grants else None, "completed_seconds": completed,
        "liberal_grant_issue": liberal_grants[0]["issue"] if liberal_grants else None,
        "reserved_seconds": reserved, "remaining_seconds": max(0, cap - completed - reserved),
        "review_seconds": completed,
        "observed_running_seconds": sum(min(elapsed(e), e["reserved_seconds"]) for e in active.values() if "reserved_seconds" in e),
        "unbounded_attempts": [key for key, e in active.items() if "reserved_seconds" not in e],
        "rounds": len({e.get("round_id") for e in starts.values()}), "unfinished_attempts": list(active)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("begin", "finish", "status", "extend", "grant-authorized", "grant-liberal"))
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--import-ledger", action="append", default=[])
    parser.add_argument("--optional-import-ledger", action="append", default=[])
    for name in ("round-id", "lens", "source-sha", "attempt-id"):
        parser.add_argument(f"--{name}")
    # Historical permits never add capacity; only the one issue extension can.
    for name in ("exception", "adoption", "closeout"):
        parser.add_argument(f"--{name}")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    parser.add_argument("--risk", choices=("low", "medium", "high"))
    parser.add_argument("--required", action="store_true")
    parser.add_argument("--candidate")
    parser.add_argument("--issue", type=int)
    parser.add_argument("--authorization")
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
            if total["extension_issue"] is not None and args.issue is not None and total["extension_issue"] != args.issue:
                raise ValueError("review extension issue mismatch")
            if total["authorized_grant_issue"] is not None and args.issue is not None and total["authorized_grant_issue"] != args.issue:
                raise ValueError("authorized review grant issue mismatch")
            if total["liberal_grant_issue"] is not None and args.issue is not None and total["liberal_grant_issue"] != args.issue:
                raise ValueError("liberal review grant issue mismatch")
            if args.action == "grant-authorized":
                if (args.issue != AUTHORIZED_GRANT["issue"] or args.authorization != AUTHORIZED_GRANT["provenance"]
                        or args.ledger.name != f"issue-{args.issue}.jsonl" or total["extension_issue"] != args.issue
                        or total["authorized_grant_issue"] is not None or total["unbounded_attempts"]
                        or AUTHORIZED_BASELINE_ATTEMPT not in finishes
                        or total["completed_seconds"] < AUTHORIZED_BASELINE_SECONDS):
                    raise ValueError("authorized review grant requires the original issue ledger, provenance, prior extension and no duplicate")
                append(handle, {"event": "authorized-grant", "attempt_id": "issue-428-authorized-grant", "at": utc(), **AUTHORIZED_GRANT})
                events = list(indexed(read_events(handle)).values())
                starts, finishes, total = usage(events)
            if args.action == "grant-liberal":
                if (args.issue != LIBERAL_GRANT["issue"] or args.authorization != LIBERAL_GRANT["provenance"]
                        or args.ledger.name != f"issue-{args.issue}.jsonl"
                        or total["authorized_grant_issue"] != args.issue
                        or total["liberal_grant_issue"] is not None or total["unfinished_attempts"]
                        or not LIBERAL_BASELINE_ATTEMPTS.issubset(finishes)
                        or total["completed_seconds"] < LIBERAL_BASELINE_SECONDS):
                    raise ValueError("liberal review grant requires the original issue ledger, provenance, completed baseline and no duplicate")
                append(handle, {"event": "liberal-grant", "attempt_id": "issue-428-liberal-grant", "at": utc(), **LIBERAL_GRANT})
                events = list(indexed(read_events(handle)).values())
                starts, finishes, total = usage(events)
            if args.action in ("begin", "finish") and not all((args.round_id, args.lens, args.source_sha, args.attempt_id)):
                raise ValueError("review attempt identity is required")
            eligible = args.required and args.risk in ("medium", "high") and args.candidate and args.issue
            if args.action == "extend" and not eligible:
                raise ValueError("extension requires bound normal/protected required review")
            needs_extension = args.action == "extend" or (args.action == "begin" and eligible
                and 1 <= args.timeout_seconds <= 3600 and total["remaining_seconds"] < args.timeout_seconds + CLOSEOUT_SECONDS)
            if needs_extension and total["extension_issue"] is None:
                if not eligible or total["unbounded_attempts"]:
                    raise ValueError("extension requires a bound normal/protected issue with incomplete required review and reconciled history")
                append(handle, {"event": "extension", "attempt_id": "issue-extension", "at": utc(),
                    "issue": args.issue, "risk": args.risk, "required": True, "seconds": EXTENSION_SECONDS})
                events = list(indexed(read_events(handle)).values())
                starts, finishes, total = usage(events)
            result = {"allowed": True, "reason": "history accounted", "ledger": str(args.ledger.resolve()), **total}
            if args.action == "begin":
                if args.attempt_id in starts:
                    result.update(allowed=False, reason="duplicate attempt")
                elif not 1 <= args.timeout_seconds <= 3600:
                    result.update(allowed=False, reason="review timeout must be between 1 and 3600 seconds")
                elif total["liberal_grant_issue"] == LIBERAL_GRANT["issue"] and args.timeout_seconds > 1200:
                    result.update(allowed=False, reason="issue 428 review attempts are limited to 1200 seconds without a diagnosed timeout")
                else:
                    grant = min(args.timeout_seconds, math.floor(total["remaining_seconds"] - CLOSEOUT_SECONDS))
                    if grant < 1:
                        result.update(allowed=False, reason="cumulative review time exhausted or reserved")
                        if total["extension_issue"] and not total["unfinished_attempts"]:
                            result.update(action="park", notification_key=f"review-budget:{total['extension_issue']}:exhausted")
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
