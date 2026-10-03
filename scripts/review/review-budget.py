#!/usr/bin/env python3
"""Append-only candidate review execution budget, including imported history."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
import re
import subprocess
from pathlib import Path
import time

CAP_SECONDS = 1800
EXTENSION_SECONDS = 900
RECOVERY_SECONDS = 1800
CLOSEOUT_SECONDS = 5
FAILURE_KINDS = ("completed", "timeout", "transient_provider", "authentication", "process_error", "invalid_output", "interrupted")
NORMAL_REVIEW_SECONDS = 900


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
            if isinstance(row, dict) and row.get("event") in ("authorized-grant", "liberal-grant"):
                if (type(row.get("issue")) is not int or row["issue"] <= 0
                        or type(row.get("seconds")) is not int or not 1 <= row["seconds"] <= 14400
                        or not isinstance(row.get("attempt_id"), str) or not row["attempt_id"]
                        or not re.fullmatch(r"https://github.com/dgmolla/fitsy/issues/" + str(row["issue"]) + r"#issuecomment-[1-9][0-9]*", row.get("provenance", ""))):
                    raise ValueError("invalid authorized review grant")
                events.append(row)
                continue
            if isinstance(row, dict) and row.get("event") == "recovery_extension":
                if (row.get("attempt_id") != "issue-recovery" or row.get("seconds") != RECOVERY_SECONDS
                        or type(row.get("issue")) is not int or row["issue"] <= 0
                        or not isinstance(row.get("failed_attempt"), str)):
                    raise ValueError("invalid infrastructure recovery extension")
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
            if row["event"] == "finish" and "verdict" in row and row["verdict"] not in ("pass", "fail", "incomplete"):
                raise ValueError("invalid review verdict")
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
                if event["event"] in ("authorized-grant", "liberal-grant", "recovery_extension"):
                    raise ValueError("imported history cannot grant new review authority; verify authorization through the external operator manifest")
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
    if len(extensions) > 1:
        raise ValueError("multiple review extensions are not permitted")
    recoveries = [e for e in events if e["event"] == "recovery_extension"]
    if len(recoveries) > 1:
        raise ValueError("multiple infrastructure recovery extensions are not permitted")
    grants = [e for e in events if e["event"] in ("authorized-grant", "liberal-grant")]
    if len({e["issue"] for e in grants}) > 1 or len({e["provenance"] for e in grants}) != len(grants) or sum(e["seconds"] for e in grants) > 14400:
        raise ValueError("duplicate, mismatched or excessive authorized grants")
    if grants and extensions and grants[0]["issue"] != extensions[0]["issue"]:
        raise ValueError("authorized review grant issue mismatch")
    cap = sum(e["seconds"] for e in grants) + CAP_SECONDS + (EXTENSION_SECONDS if extensions else 0) + (RECOVERY_SECONDS if recoveries else 0)
    starts = {e["attempt_id"]: e for e in events if e["event"] == "start"}
    finishes = {e["attempt_id"]: e for e in events if e["event"] == "finish"}
    if any(key not in starts for key in finishes):
        raise ValueError("review finish has no retained start")
    if recoveries:
        if not extensions or recoveries[0]["issue"] != extensions[0]["issue"]:
            raise ValueError("infrastructure recovery issue mismatch")
        evidence = finishes.get(recoveries[0]["failed_attempt"])
        if not evidence or evidence.get("outcome") != "fail" or evidence.get("failure_kind") not in ("timeout", "transient_provider"):
            raise ValueError("infrastructure recovery lacks retained failure evidence")
    # Exception/adoption/closeout flags are historical provenance, never excluded time.
    completed = sum(e["elapsed_seconds"] for e in finishes.values())
    active = {key: e for key, e in starts.items() if key not in finishes}
    # An interrupted new attempt retains its full reservation until reconciled.
    # An unbounded legacy attempt has unknown completion and fails closed at the cap.
    reserved = sum(e.get("reserved_seconds", cap) for e in active.values())
    verdict_counts = {"pass": 0, "fail": 0, "incomplete": 0, "legacy_unknown": 0}
    for finish in finishes.values():
        verdict_counts[finish.get("verdict", "legacy_unknown")] += 1
    return starts, finishes, {"cap_seconds": cap, "extension_issue": extensions[0]["issue"] if extensions else None, "authorized_grant_issue": grants[0]["issue"] if grants else None, "recovery_issue": recoveries[0]["issue"] if recoveries else None, "completed_seconds": completed,
        "reserved_seconds": reserved, "remaining_seconds": max(0, cap - completed - reserved),
        "review_seconds": completed,
        "observed_running_seconds": sum(min(elapsed(e), e["reserved_seconds"]) for e in active.values() if "reserved_seconds" in e),
        "unbounded_attempts": [key for key, e in active.items() if "reserved_seconds" not in e],
        "rounds": len({e.get("round_id") for e in starts.values()}), "unfinished_attempts": list(active),
        "execution_outcomes": {name: sum(e.get("outcome") == name for e in finishes.values()) for name in ("pass", "fail", "interrupted")},
        "review_verdicts": verdict_counts}


def required_window(starts, finishes, lens):
    """Use recent successful executions of this combined reviewer, never its verdict."""
    recent = [e["elapsed_seconds"] for e in reversed(list(finishes.values()))
              if e.get("lens") == lens and e.get("failure_kind") == "completed"
              and starts.get(e["attempt_id"], {}).get("lens") == lens][:3]
    observed = math.ceil(max(recent) * 1.25) if recent else 0
    return max(NORMAL_REVIEW_SECONDS, observed), recent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("begin", "finish", "status", "extend", "grant-authorized"))
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
    parser.add_argument("--authorization-file", type=Path)
    parser.add_argument("--failure-kind", choices=FAILURE_KINDS)
    parser.add_argument("--outcome", choices=("pass", "fail", "interrupted"), default="interrupted")
    parser.add_argument("--verdict", choices=("pass", "fail", "incomplete"))
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
                raise ValueError("authorized grant issue mismatch")
            if total["recovery_issue"] is not None and args.issue is not None and total["recovery_issue"] != args.issue:
                raise ValueError("infrastructure recovery issue mismatch")
            if args.action == "grant-authorized":
                # This is operator authorization, never inferred from reviewer output.
                # Keep the approval manifest outside the branch being reviewed.
                path = args.authorization_file.resolve() if args.authorization_file else None
                if (not path or Path(__file__).resolve().parents[2] == path or Path(__file__).resolve().parents[2] in path.parents
                        or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o022
                        or not args.candidate or args.ledger.name != f"issue-{args.issue}.jsonl"
                        or total["unfinished_attempts"]):
                    raise ValueError("authorized grant requires a private external operator manifest and released issue ledger")
                # A separately installed trusted script must also reject any
                # candidate Git checkout, not only its own installation root.
                git_env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
                checkout = subprocess.run(["git", "-C", str(path.parent), "rev-parse", "--show-toplevel"],
                                          env=git_env, capture_output=True, text=True)
                if checkout.returncode == 0:
                    raise ValueError("authorization manifest must be outside every Git checkout")
                raw = path.read_bytes()
                approval = json.loads(raw)
                if set(approval) != {"issue", "seconds", "provenance"} or approval["issue"] != args.issue:
                    raise ValueError("authorization manifest issue/schema mismatch")
                grant = {"event": "authorized-grant", "attempt_id": "authorized-" + hashlib.sha256(approval["provenance"].encode()).hexdigest(),
                         "at": utc(), **approval, "authorization_sha256": hashlib.sha256(raw).hexdigest()}
                # Validate the proposed history before append, including dedupe and ceiling.
                proposed = events + [grant]
                import io
                validated = read_events(io.StringIO("\n".join(json.dumps(e) for e in proposed)))
                usage(validated)
                append(handle, grant)
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
            # One issue-wide infrastructure allowance, tied to a same-head/lens
            # failed execution. All elapsed time remains charged and visible.
            failures = [e for e in finishes.values() if e.get("source_sha") == args.source_sha
                        and e.get("lens") == args.lens and e.get("outcome") == "fail"]
            latest = failures[-1] if failures else None
            if (args.action == "begin" and eligible and total["recovery_issue"] is None
                    and total["extension_issue"] is not None and total["authorized_grant_issue"] is None and not total["unfinished_attempts"]
                    and total["remaining_seconds"] < args.timeout_seconds + CLOSEOUT_SECONDS
                    and latest and latest.get("failure_kind") in ("timeout", "transient_provider")):
                append(handle, {"event": "recovery_extension", "attempt_id": "issue-recovery", "at": utc(),
                                "issue": args.issue, "seconds": RECOVERY_SECONDS, "failed_attempt": latest["attempt_id"]})
                events = list(indexed(read_events(handle)).values())
                starts, finishes, total = usage(events)
            result = {"allowed": True, "reason": "history accounted", "ledger": str(args.ledger.resolve()), **total}
            if args.action == "status" and args.required and args.lens:
                minimum, observed = required_window(starts, finishes, args.lens)
                result.update(required_window_seconds=minimum, recent_completed_seconds=observed,
                              can_admit=total["remaining_seconds"] >= minimum + CLOSEOUT_SECONDS)
            if args.action == "begin":
                if args.attempt_id in starts:
                    result.update(allowed=False, reason="duplicate attempt")
                elif not 1 <= args.timeout_seconds <= 3600:
                    result.update(allowed=False, reason="review timeout must be between 1 and 3600 seconds")
                else:
                    ceiling = args.timeout_seconds
                    if latest and latest.get("failure_kind") in ("timeout", "transient_provider") and total["authorized_grant_issue"] is None:
                        previous = starts.get(latest["attempt_id"], {}).get("timeout_seconds")
                        # Legacy attempts lacking a granted deadline cannot authorize
                        # automatic growth beyond the request or executor ceiling.
                        if type(previous) is int and previous > 0:
                            ceiling = min(ceiling, previous * 2, 3600)
                    grant = min(ceiling, math.floor(total["remaining_seconds"] - CLOSEOUT_SECONDS))
                    minimum, observed = required_window(starts, finishes, args.lens) if args.required else (1, [])
                    result.update(required_window_seconds=minimum, recent_completed_seconds=observed)
                    if grant < minimum:
                        result.update(allowed=False, reason=f"insufficient review capacity: {grant}s available deadline, {minimum}s required from normal {NORMAL_REVIEW_SECONDS}s baseline and recent completed {args.lens} runtimes")
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
                    if args.verdict and ((args.outcome != "pass" and args.verdict != "incomplete") or
                                         (args.outcome == "pass" and args.verdict == "incomplete")):
                        raise ValueError("review execution outcome and verdict conflict")
                    seconds = elapsed(start)
                    append(handle, {"event": "finish", "at": utc(), "attempt_id": args.attempt_id,
                        "round_id": args.round_id, "lens": args.lens, "source_sha": args.source_sha,
                        "elapsed_seconds": seconds, "outcome": args.outcome,
                        **({"verdict": args.verdict} if args.verdict else {}),
                        **({"failure_kind": args.failure_kind} if args.failure_kind else {}),
                        **{key: start[key] for key in ("exception", "adoption", "closeout") if key in start}})
                    result.update(reason="recorded", elapsed_seconds=seconds)
        print(json.dumps(result))
        return 0 if result["allowed"] else 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"allowed": False, "reason": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
