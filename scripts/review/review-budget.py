#!/usr/bin/env python3
"""Append-only candidate review execution budget, including imported history."""
import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import io
import json
import math
import os
import re
import pwd
import subprocess
from pathlib import Path
import time

ADMIN_HOME = Path(pwd.getpwuid(os.getuid()).pw_dir)
ADMIN_REVIEW = ADMIN_HOME / ".fitsy-review"
ADMIN_CACHE = ADMIN_HOME / ".cache/fitsy-review"
ADMIN_BUDGET = ADMIN_CACHE / "budgets"

CAP_SECONDS = 1800
EXTENSION_SECONDS = 900
RECOVERY_SECONDS = 1800
CLOSEOUT_SECONDS = 5
FAILURE_KINDS = ("completed", "timeout", "transient_provider", "authentication", "process_error", "invalid_output", "interrupted")
NORMAL_REVIEW_SECONDS = 900
DEFAULT_ROUNDS_MAX = 2


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
            if isinstance(row, dict) and row.get("event") == "review-allocation":
                if (type(row.get("issue")) is not int or row["issue"] <= 0
                        or not number(row.get("previous_cap_seconds"))
                        or not number(row.get("additional_seconds")) or not 0 < row["additional_seconds"] <= 300
                        or row.get("cumulative_stop_seconds") != row["previous_cap_seconds"] + row["additional_seconds"]
                        or not re.fullmatch(r"[0-9a-f]{40}", row.get("source_sha", ""))
                        or not re.fullmatch(r"[0-9a-f]{64}", row.get("authorization_sha256", ""))):
                    raise ValueError("invalid bounded permanent review allocation")
                events.append(row)
                continue
            if isinstance(row, dict) and row.get("event") == "count-reconciliation":
                if (row.get("attempt_id") != "issue-count-reconciliation"
                        or type(row.get("issue")) is not int or row["issue"] <= 0
                        or row.get("new_rounds_max", "missing") is not None
                        or not re.fullmatch(r"[0-9a-f]{64}", row.get("limit_sha256", ""))
                        or not re.fullmatch(r"[0-9a-f]{64}", row.get("authorization_sha256", ""))):
                    raise ValueError("invalid coordinator count reconciliation")
                events.append(row)
                continue
            if isinstance(row, dict) and row.get("event") == "execution-limit":
                if (row.get("attempt_id") != "issue-execution-limit"
                        or type(row.get("issue")) is not int or row["issue"] <= 0
                        or not number(row.get("baseline_completed_seconds"))
                        or not number(row.get("completed_seconds_stop_at"))
                        or row["completed_seconds_stop_at"] < row["baseline_completed_seconds"]
                        or row["completed_seconds_stop_at"] - row["baseline_completed_seconds"] > CAP_SECONDS
                        or type(row.get("new_rounds_max")) is not int or not 1 <= row["new_rounds_max"] <= DEFAULT_ROUNDS_MAX
                        or type(row.get("per_round_timeout_seconds_max")) is not int or not 1 <= row["per_round_timeout_seconds_max"] <= NORMAL_REVIEW_SECONDS
                        or not isinstance(row.get("baseline_attempts"), list)
                        or any(not isinstance(key, str) for key in row["baseline_attempts"])
                        or len(set(row["baseline_attempts"])) != len(row["baseline_attempts"])):
                    raise ValueError("invalid issue review execution limit")
                events.append(row)
                continue
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


def import_history(handle, ledger, paths, optional_paths, allow_new=True):
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
                if event["event"] in ("authorized-grant", "liberal-grant", "recovery_extension", "execution-limit", "count-reconciliation", "review-allocation"):
                    raise ValueError("imported history cannot grant new review authority; verify authorization through the external operator manifest")
                new.append(event)
                events[key] = event
        if new:
            if not allow_new:
                raise ValueError("privileged accounting requires retained canonical history; caller imports cannot mutate it")
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
    limits = [e for e in events if e["event"] == "execution-limit"]
    if len(limits) > 1:
        raise ValueError("issue review execution limit cannot be replaced")
    limit = limits[0] if limits else None
    reconciliations = [e for e in events if e["event"] == "count-reconciliation"]
    if reconciliations:
        if (len(reconciliations) != 1 or not limit or limit["new_rounds_max"] != 1
                or reconciliations[0]["issue"] != limit["issue"]
                or reconciliations[0]["limit_sha256"] != hashlib.sha256(json.dumps(limit, sort_keys=True).encode()).hexdigest()):
            raise ValueError("reconciliation must retain the original coordinator limit")
        limit = {**limit, "new_rounds_max": reconciliations[0]["new_rounds_max"]}
    allocations = [e for e in events if e["event"] == "review-allocation"]
    for allocation in allocations:
        if (not limit or allocation["issue"] != limit["issue"]
                or allocation["previous_cap_seconds"] != limit["completed_seconds_stop_at"]):
            raise ValueError("review allocation must extend the retained authority additively")
        limit = {**limit, "completed_seconds_stop_at": allocation["cumulative_stop_seconds"],
                 "new_rounds_max": None, "per_round_timeout_seconds_max": 300}
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
    if limit:
        baseline = set(limit["baseline_attempts"])
        if (not baseline <= finishes.keys()
                or not math.isclose(sum(finishes[key]["elapsed_seconds"] for key in baseline),
                                    limit["baseline_completed_seconds"], abs_tol=1e-6)):
            raise ValueError("execution limit baseline does not match retained history")
        # Independently approved bounded permanent allocations supersede the
        # generic ceiling only by their exact retained additive stop.
        if allocations:
            cap = max(cap, allocations[-1]["cumulative_stop_seconds"])
        cap = min(cap, limit["completed_seconds_stop_at"])
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
        "review_verdicts": verdict_counts,
        "execution_limit": limit,
        "bounded_executions_used": len(starts.keys() - set(limit["baseline_attempts"])) if limit else None}


def required_window(starts, finishes, lens):
    """Use recent successful executions of this combined reviewer, never its verdict."""
    recent = [e["elapsed_seconds"] for e in reversed(list(finishes.values()))
              if e.get("lens") == lens and e.get("failure_kind") == "completed"
              and starts.get(e["attempt_id"], {}).get("lens") == lens][:3]
    observed = math.ceil(max(recent) * 1.25) if recent else 0
    return max(NORMAL_REVIEW_SECONDS, observed), recent


def prospective_policy(path, ledger, candidate, issue, events):
    """Private operator policy narrows capacity; it never adds a grant."""
    if path is None:
        return None
    path = path.resolve()
    if (not path.is_file() or path.stat().st_uid != os.getuid()
            or path.stat().st_mode & 0o077 or not candidate
            or ledger.name != f"issue-{issue}.jsonl"):
        raise ValueError("prospective policy requires private operator file and original issue ledger")
    git_env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    check = subprocess.run(["git", "-C", str(path.parent), "rev-parse", "--show-toplevel"],
                           env=git_env, capture_output=True, text=True)
    if check.returncode == 0:
        raise ValueError("prospective policy must be outside every Git checkout")
    policy = json.loads(path.read_text())
    if (set(policy) != {"issue", "candidate", "seconds", "baseline", "provenance"}
            or policy["issue"] != issue or policy["candidate"] != candidate
            or type(policy["seconds"]) is not int or not 1 <= policy["seconds"] <= 300
            or not re.fullmatch(r"https://github.com/dgmolla/fitsy/issues/" + str(issue)
                               + r"#issuecomment-[1-9][0-9]*", policy["provenance"])
            or not isinstance(policy["baseline"], dict)):
        raise ValueError("prospective policy identity/schema mismatch")
    starts, finishes, total = usage(events)
    for attempt, digest in policy["baseline"].items():
        if attempt not in starts or attempt not in finishes:
            raise ValueError("prospective baseline must contain completed original attempts")
        raw = json.dumps([starts[attempt], finishes[attempt]], sort_keys=True).encode()
        if hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError("prospective baseline history changed")
    stopped = any(row.get("verdict") == "incomplete" or row.get("failure_kind") in ("timeout", "transient_provider", "interrupted", "authentication", "process_error", "invalid_output")
                  for key, row in finishes.items() if key not in policy["baseline"])
    spent = sum(row["elapsed_seconds"] for key, row in finishes.items()
                if key not in policy["baseline"])
    return {"prospective_stopped": stopped, "prospective_completed_seconds": spent,
            "prospective_remaining_seconds": max(0, policy["seconds"] - spent - total["reserved_seconds"]),
            "prospective_cap_seconds": policy["seconds"]}


def canonical_authority(path, expected):
    # Administrator/coordinator custody is trusted, as in execute-review.py.
    # Candidate environment and copies of controls cannot select this authority.
    if path is None:
        raise ValueError("canonical coordinator authority is required")
    if path.absolute() != expected.absolute() or path.resolve() != expected.resolve():
        raise ValueError("admission requires canonical coordinator authority, not caller-selected proof")
    probe = path
    while probe != ADMIN_HOME:
        if probe.is_symlink() or probe.stat().st_uid != os.getuid() or probe.stat().st_mode & 0o022:
            raise ValueError("coordinator authority must remain administrator managed")
        probe = probe.parent
    return completed_context(path)


def canonical_ledger(ledger, issue):
    expected = ADMIN_BUDGET / f"issue-{issue}.jsonl"
    if ledger.absolute() != expected.absolute() or ledger.resolve() != expected.resolve():
        raise ValueError("admission requires original canonical issue ledger")


def operator_authority(args, kind):
    canonical_ledger(args.ledger, args.issue)
    operator = Path(__file__).absolute()
    installations = {ADMIN_REVIEW / "operators/review-budget.py",
                     ADMIN_REVIEW / "repo/scripts/review/review-budget.py"}
    if operator not in installations or operator.is_symlink():
        raise ValueError("privileged actions require canonical operator installation")
    probe = operator
    while probe != ADMIN_HOME:
        if probe.is_symlink() or probe.stat().st_uid != os.getuid() or probe.stat().st_mode & 0o022:
            raise ValueError("privileged actions require canonical operator installation custody")
        probe = probe.parent
    expected = (ADMIN_REVIEW / "completed" / f"issue-{args.issue}.json" if kind == "completed"
                else ADMIN_REVIEW / "operators" / f"issue-{args.issue}-{kind}.json")
    approval = canonical_authority(args.authorization_file, expected)
    if (not re.fullmatch(r"[0-9a-f]{40}", approval.get("control_sha", ""))
            or approval.get("operator_sha256") != hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
            or (getattr(args, "control_sha", None) is not None
                and approval["control_sha"] != args.control_sha)):
        raise ValueError("coordinator has not approved this exact independently reviewed operator installation")
    return approval


def completed_authority(args):
    approval = operator_authority(args, "completed")
    expected = subprocess.check_output(["git", "-C", str(args.candidate_root), "show",
                                        args.control_sha + ":scripts/review/review-budget.py"],
                                       env={k:v for k,v in os.environ.items() if not k.startswith("GIT_")})
    if hashlib.sha256(expected).hexdigest() != approval["operator_sha256"]:
        raise ValueError("installed operator differs from coordinator-approved committed source")
    return approval


def completed_history_prefix(raw_history, attempt, rows, source, digest, accounted):
    """Locate the unique exact adoption without normalizing historical bytes."""
    lines = raw_history.splitlines(keepends=True)
    imports = []
    for offset, line in enumerate(lines):
        if not line.strip():
            continue
        event = json.loads(line)
        if event.get("event") == "import" and any(
                row.get("attempt_id") == attempt for row in event.get("events", [])):
            imports.append((offset, event))
    if accounted:
        if (len(imports) != 1 or imports[0][1].get("events") != rows
                or imports[0][1].get("source") != source
                or imports[0][1].get("sha256") != digest):
            raise ValueError("ambiguous or mismatched original completed import")
        return b"".join(lines[:imports[0][0]])
    if imports:
        raise ValueError("conflicting original completed import")
    return raw_history


def account_completed(handle, ledger, args, events, record=True):
    """Record an operator-attested execution, without granting admission or time.

    The operator attests raw artifact identity after independent inspection.
    This accounting action never makes a reviewer verdict a shipping receipt.
    """
    operator_authority(args, "completed")
    path = args.authorization_file.resolve() if args.authorization_file else None
    if (not path or not path.is_file() or path.stat().st_uid != os.getuid()
            or path.stat().st_mode & 0o077 or not args.candidate
            or ledger.name != f"issue-{args.issue}.jsonl"):
        raise ValueError("completed accounting requires a private external operator manifest")
    git_env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    if subprocess.run(["git", "-C", str(path.parent), "rev-parse", "--show-toplevel"],
                      env=git_env, capture_output=True).returncode == 0:
        raise ValueError("completed accounting authorization must be outside every Git checkout")
    raw = path.read_bytes()
    approval = json.loads(raw)
    has_original_manifest = "original_manifest" in approval
    fields = {"issue", "candidate", "source_sha", "base_sha", "domains", "provider",
              "model", "reasoning_effort", "acceptance_sha256", "provenance", "artifacts",
              "original_ledger_sha256", "prior_completed_seconds", "completed_seconds_stop_at",
              "completed_at", "control_sha", "operator_sha256"}
    # Installation approval may advance; the original accounting attestation
    # and its adoption digest must never advance with it.
    if has_original_manifest:
        reference = approval["original_manifest"]
        if (set(approval) != fields | {"original_manifest"}
                or not isinstance(reference, dict) or set(reference) != {"path", "sha256"}
                or not isinstance(reference["path"], str)
                or not re.fullmatch(r"[0-9a-f]{64}", reference.get("sha256", ""))):
            raise ValueError("invalid original completed manifest reference")
        original_path = Path(reference["path"])
        if (not original_path.is_absolute() or original_path == path
                or not original_path.is_relative_to(ADMIN_REVIEW)
                or ".." in original_path.parts):
            raise ValueError("original completed authority must remain private and administrator managed")
        original_approval = canonical_authority(original_path, original_path)
        original_raw = original_path.read_bytes()
        if (hashlib.sha256(original_raw).hexdigest() != reference["sha256"]
                or set(original_approval) != fields
                or any(original_approval[key] != approval[key]
                       for key in fields - {"control_sha", "operator_sha256"})
                or not re.fullmatch(r"[0-9a-f]{40}", original_approval.get("control_sha", ""))
                or not re.fullmatch(r"[0-9a-f]{64}", original_approval.get("operator_sha256", ""))):
            raise ValueError("original completed accounting attestation mismatch")
        raw = original_raw
        approval = original_approval
    if (set(approval) != fields or approval["issue"] != args.issue
            or approval["candidate"] != args.candidate or approval["source_sha"] != args.source_sha
            or approval["base_sha"] != args.base_sha
            or approval["domains"] != sorted(set(args.required_domain)) or not args.required_domain
            or approval["acceptance_sha256"] != args.acceptance_sha256
            or not re.fullmatch(r"[0-9a-f]{64}", args.acceptance_sha256 or "")
            or any(not re.fullmatch(r"[0-9a-f]{40}", approval[key] or "") for key in ("source_sha", "base_sha"))
            or (approval["provider"], approval["model"], approval["reasoning_effort"]) != ("codex", "gpt-6-sol", "high")
            or not re.fullmatch(r"https://github.com/dgmolla/fitsy/issues/" + str(args.issue)
                               + r"#issuecomment-[1-9][0-9]*", approval["provenance"])):
        raise ValueError("completed accounting source/acceptance/policy binding mismatch")
    artifacts = approval["artifacts"]
    if not isinstance(artifacts, dict) or set(artifacts) != {"verdict", "execution", "prompt", "stderr"}:
        raise ValueError("completed accounting requires all original raw artifacts")
    contents = {}
    for key, artifact in artifacts.items():
        if not isinstance(artifact, dict) or set(artifact) != {"path", "sha256"}:
            raise ValueError("invalid completed artifact identity")
        contents[key] = Path(artifact["path"]).read_bytes()
        if hashlib.sha256(contents[key]).hexdigest() != artifact["sha256"]:
            raise ValueError("completed raw artifact changed")
    execution = json.loads(contents["execution"])
    verdict = json.loads(contents["verdict"])
    seconds = execution.get("elapsed_seconds")
    if (execution.get("kind") != "completed" or execution.get("returncode") != 0
            or not number(seconds) or not 0 < seconds <= 300
            or execution.get("stdout_bytes") != len(contents["verdict"])
            or execution.get("stderr_bytes") != len(contents["stderr"])
            or verdict.get("source_sha") != args.source_sha or verdict.get("base_sha") != args.base_sha
            or set(verdict.get("domains", {})) != set(args.required_domain)
            or any(not isinstance(row, dict) or row.get("verdict") not in ("pass", "fail")
                   or not isinstance(row.get("findings"), list)
                   or (row["verdict"] == "pass" and row["findings"])
                   or (row["verdict"] == "fail" and not row["findings"])
                   for row in verdict["domains"].values())
            or not isinstance(verdict.get("summary"), str) or not verdict["summary"].strip()
            or not isinstance(verdict.get("limitations"), list)):
        raise ValueError("completed execution lacks a complete exact-source verdict")
    review_verdict = "fail" if any(row["verdict"] == "fail" for row in verdict["domains"].values()) else "pass"
    starts, finishes, total = usage(list(indexed(events).values()))
    if total["unfinished_attempts"]:
        raise ValueError("completed accounting requires released original execution ownership")
    attempt = "completed-" + artifacts["execution"]["sha256"]
    completed_at = datetime.fromisoformat(approval["completed_at"])
    if completed_at.tzinfo is None:
        raise ValueError("completed accounting requires an observed timezone-bound completion")
    rows = [{"event": "start", "attempt_id": attempt, "epoch": completed_at.timestamp() - seconds,
             "round_id": args.source_sha, "source_sha": args.source_sha, "lens": "review-round",
             "adoption": hashlib.sha256(raw).hexdigest()},
            {"event": "finish", "attempt_id": attempt, "elapsed_seconds": seconds,
             "round_id": args.source_sha, "source_sha": args.source_sha, "lens": "review-round",
             "outcome": "pass", "verdict": review_verdict, "failure_kind": "completed",
             "adoption": hashlib.sha256(raw).hexdigest()}]
    original = indexed(events)
    present = [(row["event"], attempt) in original for row in rows]
    if any(present) and not (all(present) and all(original[(row["event"], attempt)] == row for row in rows)):
        raise ValueError("conflicting or duplicate completed execution accounting")
    # Bind the unique original import to the exact bytes preceding it. Later
    # executions/allocations are validated and counted separately, never removed.
    if not all(present) and has_original_manifest:
        raise ValueError("original completed manifest reference requires retained accounting")
    prefix = completed_history_prefix(ledger.read_bytes(), attempt, rows, str(path),
                                      hashlib.sha256(raw).hexdigest(), all(present))
    prior_total = usage(list(indexed(read_events(io.StringIO(prefix.decode()))).values()))[2]
    prior = prior_total["completed_seconds"]
    if (hashlib.sha256(prefix).hexdigest() != approval["original_ledger_sha256"]
            or not number(approval["prior_completed_seconds"])
            or not math.isclose(prior, approval["prior_completed_seconds"], abs_tol=1e-6)
            or not number(approval["completed_seconds_stop_at"])
            or not math.isclose(prior_total["cap_seconds"], approval["completed_seconds_stop_at"], abs_tol=1e-6)
            or prior_total["unfinished_attempts"] or prior + seconds > prior_total["cap_seconds"]):
        raise ValueError("completed accounting original history or authorized stop mismatch")
    if total["completed_seconds"] + (0 if all(present) else seconds) > total["cap_seconds"]:
        raise ValueError("completed accounting exceeds current authorized capacity")
    if not all(present) and record:
        append(handle, {"event": "import", "at": utc(), "source": str(path),
                        "sha256": hashlib.sha256(raw).hexdigest(), "events": rows})
    return {"allowed": True, "reason": "completed execution accounted; shipping admission unchanged",
            "accounted_seconds": seconds, "idempotent": all(present),
            **usage(list(indexed(read_events(handle)).values()))[2]}


def completed_context(path):
    """Read operator authority outside source control, never candidate policy."""
    path = path.resolve()
    if (not path.is_file() or path.stat().st_uid != os.getuid()
            or path.stat().st_mode & 0o077):
        raise ValueError("completed review requires private operator authority")
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    if subprocess.run(["git", "-C", str(path.parent), "rev-parse", "--show-toplevel"],
                      env=env, capture_output=True).returncode == 0:
        raise ValueError("completed review authority must be outside every checkout")
    return json.loads(path.read_text())


def reconcile_allocation(handle, args, events, total):
    """Recognize current human authority without rewriting historical limits."""
    approval = operator_authority(args, "allocation")
    if approval.get("issue") != args.issue or approval.get("candidate_source") != args.source_sha:
        raise ValueError("review allocation source or issue mismatch")
    digest = hashlib.sha256(args.authorization_file.read_bytes()).hexdigest()
    previous = next((e for e in events if e.get("event") == "review-allocation"
                     and e.get("authorization_sha256") == digest), None)
    if previous:
        return {"allowed": True, "idempotent": True, **total}
    authority = completed_context(Path(approval["authority_file"]))
    if (approval.get("issue") != args.issue
            or approval.get("candidate_source") != args.source_sha
            or authority.get("human_instruction") != "Add global exception permanently"
            or approval.get("human_instruction") != authority["human_instruction"]
            or (approval.get("provider"), approval.get("model"), approval.get("effort")) != ("codex", "gpt-6-sol", "high")
            or approval.get("original_cap_seconds") != total["cap_seconds"]
            or not math.isclose(approval.get("original_completed_seconds", -1), total["completed_seconds"], abs_tol=1e-6)
            or not approval.get("reason") or total["unfinished_attempts"]
            or approval.get("per_execution_timeout_seconds") != 300):
        raise ValueError("bounded allocation does not match current human authority and retained history")
    event = {"event": "review-allocation", "attempt_id": "allocation-" + digest, "at": utc(),
             "issue": args.issue, "source_sha": args.source_sha,
             "previous_cap_seconds": approval["original_cap_seconds"],
             "additional_seconds": approval["additional_seconds"],
             "cumulative_stop_seconds": approval["cumulative_stop_seconds"],
             "reason": approval["reason"], "authorization_sha256": digest,
             "authority_sha256": hashlib.sha256(Path(approval["authority_file"]).read_bytes()).hexdigest()}
    import io
    read_events(io.StringIO(json.dumps(event)))
    proposed = usage(events + [event])[2]
    if proposed["cap_seconds"] != approval["cumulative_stop_seconds"]:
        raise ValueError("allocation stop disagrees with effective original ledger capacity")
    append(handle, event)
    return {"allowed": True, "idempotent": False, **proposed}


def admit_cache(args, events):
    """A cache entry is data; only retained execution can authenticate it."""
    canonical_ledger(args.ledger, args.issue)
    if not re.fullmatch(r"[0-9a-f]{64}", args.cache_key or ""):
        raise ValueError("invalid canonical cache identity")
    if args.result_file.absolute() != ADMIN_CACHE / (args.cache_key + ".json") or args.result_file.is_symlink():
        raise ValueError("cache must use canonical administrator-managed location")
    approval = canonical_authority(ADMIN_REVIEW / "operators" / f"issue-{args.issue}-cache-{args.cache_key}.json",
                                   ADMIN_REVIEW / "operators" / f"issue-{args.issue}-cache-{args.cache_key}.json")
    raw = args.result_file.read_bytes()
    expected = dict(issue=args.issue, source_sha=args.source_sha, base_sha=args.base_sha,
                    domains=sorted(set(args.required_domain)), cache_key=args.cache_key,
                    result_sha256=hashlib.sha256(raw).hexdigest(),
                    ledger_sha256=hashlib.sha256(args.ledger.read_bytes()).hexdigest())
    if any(approval.get(key) != value for key, value in expected.items()):
        raise ValueError("cache lacks exact coordinator-verified independent execution approval")
    value = json.loads(raw)
    proof = value.get("execution", {})
    starts, finishes, total = usage(events)
    if total["unfinished_attempts"] or total["completed_seconds"] > total["cap_seconds"]:
        raise ValueError("cached execution exceeds effective original ledger authority")
    attempt = proof.get("attempt_id")
    start, finish = starts.get(attempt, {}), finishes.get(attempt, {})
    if (proof.get("cache_key") != args.cache_key or proof.get("base_sha") != args.base_sha
            or start.get("source_sha") != args.source_sha or finish.get("source_sha") != args.source_sha
            or finish.get("outcome") != "pass" or finish.get("failure_kind") != "completed"
            or finish.get("verdict") != value.get("verdict")
            or finish.get("result_sha256") != hashlib.sha256(raw).hexdigest()):
        raise ValueError("cache lacks matching retained source-bound reviewer execution")
    artifacts = proof.get("artifacts", {})
    if set(artifacts) != {"raw", "receipt"}:
        raise ValueError("cache lacks original reviewer artifacts")
    for artifact in artifacts.values():
        if hashlib.sha256(Path(artifact["path"]).read_bytes()).hexdigest() != artifact["sha256"]:
            raise ValueError("cached reviewer artifact changed")
    execution = json.loads(Path(artifacts["receipt"]["path"]).read_text())
    if execution.get("kind") != "completed" or execution.get("returncode") != 0:
        raise ValueError("cache execution is incomplete")
    import importlib.util
    import sys
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("review_round", Path(__file__).with_name("review-round.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    original = module.extract(Path(artifacts["raw"]["path"]).read_text(), args.required_domain)
    if original is None or any(value.get(key) != original.get(key) for key in ("verdict", "domains", "findings")):
        raise ValueError("cache differs from complete original independent verdict")
    return value


def git_changed_paths(root, *comparison, env):
    """Enumerate both sides of moves without rename heuristics or path quoting."""
    raw = subprocess.check_output(
        ["git", "-C", str(root), "diff", "--no-renames", "--name-only", "-z", *comparison],
        env=env)
    return raw.decode().split("\0")[:-1]


def admit_completed(handle, ledger, args, events):
    """Consume original authorized evidence directly, without writing a pass cache."""
    approval = completed_authority(args)
    root = args.candidate_root.resolve()
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    def git(*command):
        return subprocess.check_output(["git", "-C", str(root), *command], env=env).decode().strip()
    if git("rev-parse", "HEAD") != args.source_sha:
        raise ValueError("completed review candidate head mismatch")
    # Runtime may overlay only immutable current-main controls, as the existing
    # authenticated poller does. All product files remain the frozen commit.
    controls = ["scripts/review", "scripts/delivery/phase-events.mjs",
                "scripts/verify/risk-tiers.yml", "REVIEW.md", ".claude/lenses"]
    git("merge-base", "--is-ancestor", args.base_sha, args.source_sha)
    git("merge-base", "--is-ancestor", args.base_sha, args.control_sha)
    changed = git_changed_paths(root, args.base_sha, args.control_sha, env=env)
    # A control-only trusted-main advance cannot expand the product comparison.
    allowed = controls + ["scripts/verify/shipping-session.mjs", "scripts/verify/review-admission.sh",
                          "scripts/verify/product-flow.mjs", "scripts/sim/publish-product-flow.mjs",
                          "scripts/sim/product-flow.mjs", "scripts/sim/runner-controls.test.mjs",
                          "scripts/verify/run.mjs", "scripts/verify/run-output.test.ts",
                          "scripts/verify/test.sh", "scripts/delivery/phase-events.test.mjs",
                          "scripts/verify/receipt-cache.mjs", "scripts/verify/README.md",
                          ".githooks/pre-push",
                          "scripts/delivery/local-dispatcher.py", "scripts/delivery/local-dispatcher.test.py",
                          "scripts/delivery/cold_retention.py", "scripts/delivery/pressure-retention.test.py",
                          "scripts/delivery/resource-controls.test.py", "scripts/delivery/resource_lifecycle.py",
                          "scripts/verify/hook-fixture.ts", "scripts/verify/impact-plan.mjs",
                          "scripts/verify/impact-plan.test.ts", "scripts/verify/product-flow-impact.test.ts",
                          "scripts/verify/product-flow-public-env.test.ts",
                          "scripts/deploy/native-compatibility.test.ts",
                          "AGENTS.md", "docs/engineering/devops/shipping.md",
                          "docs/engineering/devops/resource-control-continuation.md",
                          "docs/engineering/devops/task-management.md",
                          "docs/engineering/devops/review-dispositions.md",
                          "docs/engineering/devops/agent-model-routing.md",
                          "docs/engineering/devops/shipping-control-cutover.md",
                          "docs/engineering/devops/shipping-control-setup",
                          "docs/engineering/devops/ios-release-runbook.md",
                          ".github/workflows/deploy.yml", ".github/workflows/eas-build.yml",
                          ".github/workflows/dev-maintenance.yml",
                          "vercel.json"]
    if any(not any(name == path or name.startswith(path + "/") for path in allowed) for name in changed):
        raise ValueError("trusted main changed product or unrelated inputs; frozen comparison invalid")
    dirty = (git_changed_paths(root, "HEAD", env=env)
             + git_changed_paths(root, "--cached", "HEAD", env=env))
    untracked = git("ls-files", "--others", "--exclude-standard").splitlines()
    if untracked or any(not any(name == path or name.startswith(path + "/") for path in controls) for name in dirty):
        raise ValueError("completed review requires complete frozen source")
    for command in [("diff", "--quiet", args.control_sha, "--", *controls),
                    ("diff", "--cached", "--quiet", args.control_sha, "--", *controls)]:
        if subprocess.run(["git", "-C", str(root), *command], env=env).returncode:
            raise ValueError("completed review runtime controls mismatch")
    prompt = Path(approval["artifacts"]["prompt"]["path"]).read_text()
    trace = Path(approval["artifacts"]["stderr"]["path"]).read_text()
    if (args.source_sha not in prompt or args.base_sha not in prompt
            or f"issue{args.issue}" not in prompt
            or any(domain not in prompt for domain in args.required_domain)
            or "model: gpt-6-sol\n" not in trace or "sandbox: read-only\n" not in trace
            or "approval: never\n" not in trace or "reasoning effort: high\n" not in trace):
        raise ValueError("completed review raw execution/provider context mismatch")
    verdict = json.loads(Path(approval["artifacts"]["verdict"]["path"]).read_text())
    if any(row != {"verdict": "pass", "findings": []} for row in verdict.get("domains", {}).values()):
        raise ValueError("completed admission requires a passing independent verdict")
    accounting = account_completed(handle, ledger, args, events, record=getattr(args, "action", None) != "validate-completed")
    return {"verdict": "pass", "domains": {domain: "pass" for domain in args.required_domain},
            "findings": [], "accounting": accounting,
            "reviewer": {key: approval[key] for key in ("provider", "model", "reasoning_effort")},
            "evidence": {"authorization_sha256": hashlib.sha256(args.authorization_file.read_bytes()).hexdigest(),
                         "artifacts": approval["artifacts"], "control_sha": args.control_sha}}


def reconcile_count(handle, args, events, total):
    """Operator-attested coordinator error correction, without changing capacity."""
    operator_authority(args, "count")
    path = args.authorization_file.resolve() if args.authorization_file else None
    if (not path or not path.is_file() or path.stat().st_uid != os.getuid()
            or path.stat().st_mode & 0o077 or not args.candidate
            or args.ledger.name != f"issue-{args.issue}.jsonl"):
        raise ValueError("count reconciliation requires private external operator authorization")
    git_env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    if subprocess.run(["git", "-C", str(path.parent), "rev-parse", "--show-toplevel"],
                      env=git_env, capture_output=True).returncode == 0:
        raise ValueError("reconciliation authorization must be outside every Git checkout")
    raw = path.read_bytes()
    approval = json.loads(raw)
    required = {"issue", "candidate", "limit_sha256", "ledger_sha256", "count_origin",
                "coordinator_provenance", "human_provenance", "new_rounds_max", "control_sha", "operator_sha256"}
    if (set(approval) != required or approval["issue"] != args.issue
            or approval["candidate"] != args.candidate or approval["count_origin"] != "coordinator"
            or approval["new_rounds_max"] is not None):
        raise ValueError("reconciliation cannot change explicit human count or issue authority")
    for key in ("coordinator_provenance", "human_provenance"):
        if not re.fullmatch(r"https://github.com/dgmolla/fitsy/issues/" + str(args.issue)
                            + r"#issuecomment-[1-9][0-9]*", approval[key]):
            raise ValueError("reconciliation requires issue-bound authority provenance")
    previous = next((e for e in events if e["event"] == "count-reconciliation"), None)
    digest = hashlib.sha256(raw).hexdigest()
    if previous:
        if previous["authorization_sha256"] != digest:
            raise ValueError("count reconciliation already bound to different authority")
        return {"allowed": True, "reason": "count already reconciled", **total}
    original = next((e for e in events if e["event"] == "execution-limit"), None)
    handle.seek(0)
    if (not original or original["new_rounds_max"] != 1
            or approval["limit_sha256"] != hashlib.sha256(json.dumps(original, sort_keys=True).encode()).hexdigest()
            or approval["ledger_sha256"] != hashlib.sha256(handle.read().encode()).hexdigest()
            or total["unfinished_attempts"]
            or any(e.get("verdict") == "incomplete" or e.get("failure_kind") not in (None, "completed")
                   for e in events if e["event"] == "finish")):
        raise ValueError("reconciliation requires unchanged completed history and original coordinator limit")
    event = {"event": "count-reconciliation", "attempt_id": "issue-count-reconciliation", "at": utc(),
             "authorization_sha256": digest, **approval}
    usage(events + [event])
    append(handle, event)
    return {"allowed": True, "reason": "coordinator count reconciled; cumulative ceiling unchanged",
            **usage(events + [event])[2]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("begin", "finish", "status", "extend", "grant-authorized", "bind-limit", "reconcile-count", "reconcile-allocation", "account-completed", "admit-completed", "validate-completed", "completed-context", "admit-cache"))
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
    parser.add_argument("--base-sha")
    parser.add_argument("--candidate-root", type=Path)
    parser.add_argument("--control-sha")
    parser.add_argument("--acceptance-sha256")
    parser.add_argument("--required-domain", action="append", default=[])
    parser.add_argument("--execution-policy", type=Path)
    parser.add_argument("--authorization-file", type=Path)
    parser.add_argument("--result-file", type=Path)
    parser.add_argument("--result-sha256")
    parser.add_argument("--cache-key")
    parser.add_argument("--failure-kind", choices=FAILURE_KINDS)
    parser.add_argument("--outcome", choices=("pass", "fail", "interrupted"), default="interrupted")
    parser.add_argument("--verdict", choices=("pass", "fail", "incomplete"))
    args = parser.parse_args()
    if args.action == "completed-context":
        try:
            value = canonical_authority(args.authorization_file, ADMIN_REVIEW / "completed" / f"issue-{args.issue}.json")
            if value["issue"] != args.issue or value["source_sha"] != args.source_sha:
                raise ValueError("completed review context issue/source mismatch")
            print(value["base_sha"])
            return 0
        except (ValueError, OSError, KeyError) as error:
            print(str(error), file=__import__("sys").stderr)
            return 1
    privileged = {"account-completed": "completed", "admit-completed": "completed",
                  "validate-completed": "completed", "reconcile-allocation": "allocation",
                  "reconcile-count": "count"}
    try:
        if args.action in privileged:
            # Check custody before candidate binding, imports or any ledger write.
            operator_authority(args, privileged[args.action])
        args.ledger.parent.mkdir(parents=True, exist_ok=True)
        if args.candidate is not None:
            bind_candidate(args.ledger, args.candidate, args.issue)
        with args.ledger.open("a+") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            events = import_history(handle, args.ledger, args.import_ledger, args.optional_import_ledger,
                                    allow_new=args.action not in privileged)
            starts, finishes, total = usage(events)
            if total["extension_issue"] is not None and args.issue is not None and total["extension_issue"] != args.issue:
                raise ValueError("review extension issue mismatch")
            if total["authorized_grant_issue"] is not None and args.issue is not None and total["authorized_grant_issue"] != args.issue:
                raise ValueError("authorized grant issue mismatch")
            if total["recovery_issue"] is not None and args.issue is not None and total["recovery_issue"] != args.issue:
                raise ValueError("infrastructure recovery issue mismatch")
            limit = total["execution_limit"]
            if limit and args.issue != limit["issue"]:
                raise ValueError("execution limit requires the original bound issue")
            if args.action == "admit-cache":
                print(json.dumps(admit_cache(args, events)))
                return 0
            if args.action == "reconcile-allocation":
                print(json.dumps(reconcile_allocation(handle, args, events, total)))
                return 0
            if args.action == "reconcile-count":
                print(json.dumps(reconcile_count(handle, args, events, total)))
                return 0
            if args.action in ("admit-completed", "validate-completed"):
                print(json.dumps(admit_completed(handle, args.ledger, args, events)))
                return 0
            if args.action == "account-completed":
                print(json.dumps(account_completed(handle, args.ledger, args, events)))
                return 0
            if limit and args.action in ("grant-authorized", "extend", "bind-limit"):
                raise ValueError("issue execution limit forbids top-ups or allowance resets")
            if args.execution_policy and args.action == "grant-authorized":
                raise ValueError("prospective policy forbids capacity grants")
            if args.action in ("grant-authorized", "bind-limit"):
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
                if args.action == "bind-limit":
                    required = ("baseline_completed_seconds", "completed_seconds_stop_at", "new_rounds_max", "per_round_timeout_seconds_max")
                    if approval.get("issue") != args.issue or any(key not in approval for key in required):
                        raise ValueError("execution limit manifest issue/schema mismatch")
                    baseline = []
                    seconds = 0
                    for key, finish in finishes.items():
                        if math.isclose(seconds, approval["baseline_completed_seconds"], abs_tol=1e-6):
                            break
                        baseline.append(key)
                        seconds += finish["elapsed_seconds"]
                    if not math.isclose(seconds, approval["baseline_completed_seconds"], abs_tol=1e-6):
                        raise ValueError("execution limit baseline must match a retained completed history prefix")
                    event = {"event": "execution-limit", "attempt_id": "issue-execution-limit", "at": utc(),
                             "issue": args.issue, "baseline_attempts": baseline,
                             **{key: approval[key] for key in required},
                             "authorization_sha256": hashlib.sha256(raw).hexdigest()}
                    import io
                    read_events(io.StringIO(json.dumps(event)))
                    usage(events + [event])
                    append(handle, event)
                    starts, finishes, total = usage(events + [event])
                    print(json.dumps({"allowed": True, "reason": "issue execution limit bound", **total}))
                    return 0
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
            if args.action == "begin" and args.candidate and args.issue and not starts and not total["execution_limit"]:
                # New issue defaults are durable; later grants cannot restart the loop.
                event = {"event": "execution-limit", "attempt_id": "issue-execution-limit", "at": utc(),
                         "issue": args.issue, "baseline_attempts": [], "baseline_completed_seconds": 0,
                         "completed_seconds_stop_at": CAP_SECONDS, "new_rounds_max": DEFAULT_ROUNDS_MAX,
                         "per_round_timeout_seconds_max": NORMAL_REVIEW_SECONDS}
                append(handle, event)
                starts, finishes, total = usage(events + [event])
            limit = total["execution_limit"]
            if args.action == "begin" and any(e["event"] == "count-reconciliation" for e in events):
                incomplete = [index for index, event in enumerate(events) if event["event"] == "finish"
                    and (event.get("verdict") == "incomplete" or event.get("failure_kind") not in (None, "completed"))]
                if incomplete:
                    allocations = [event for index, event in enumerate(events) if index > max(incomplete)
                        and event["event"] == "review-allocation" and event["issue"] == args.issue
                        and event["source_sha"] == args.source_sha]
                    if not allocations:
                        raise ValueError("reconciled incomplete history requires a later source-bound review allocation")
                    allocation_args = argparse.Namespace(**vars(args))
                    allocation_args.authorization_file = ADMIN_REVIEW / "operators" / f"issue-{args.issue}-allocation.json"
                    approval = operator_authority(allocation_args, "allocation")
                    if (approval.get("candidate_source") != args.source_sha
                            or hashlib.sha256(allocation_args.authorization_file.read_bytes()).hexdigest()
                            != allocations[-1]["authorization_sha256"]):
                        raise ValueError("incomplete recovery allocation requires matching installed approval")
            if args.action == "begin" and limit and (limit["new_rounds_max"] is not None and total["bounded_executions_used"] >= limit["new_rounds_max"]
                    or total["unfinished_attempts"]):
                print(json.dumps({"allowed": False, "reason": "issue execution limit exhausted or prior reservation unfinished", **total}))
                return 1
            policy = prospective_policy(args.execution_policy, args.ledger, args.candidate, args.issue, events)
            if policy and args.action in ("begin", "extend", "grant-authorized"):
                if total["unfinished_attempts"] or policy["prospective_stopped"] or args.action != "begin":
                    raise ValueError("prospective policy forbids unfinished attempts, incomplete retries and capacity extensions")
            eligible = not limit and args.required and args.risk in ("medium", "high") and args.candidate and args.issue
            if args.action == "extend" and not eligible:
                raise ValueError("extension requires bound normal/protected required review")
            needs_extension = args.action == "extend" or (args.action == "begin" and eligible
                and 1 <= args.timeout_seconds <= 3600 and total["remaining_seconds"] < args.timeout_seconds + CLOSEOUT_SECONDS)
            if needs_extension and policy is None and total["extension_issue"] is None:
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
            if (policy is None and args.action == "begin" and eligible and total["recovery_issue"] is None
                    and total["extension_issue"] is not None and total["authorized_grant_issue"] is None and not total["unfinished_attempts"]
                    and total["remaining_seconds"] < args.timeout_seconds + CLOSEOUT_SECONDS
                    and latest and latest.get("failure_kind") in ("timeout", "transient_provider")):
                append(handle, {"event": "recovery_extension", "attempt_id": "issue-recovery", "at": utc(),
                                "issue": args.issue, "seconds": RECOVERY_SECONDS, "failed_attempt": latest["attempt_id"]})
                events = list(indexed(read_events(handle)).values())
                starts, finishes, total = usage(events)
            result = {"allowed": True, "reason": "history accounted", "ledger": str(args.ledger.resolve()), **total}
            if policy:
                result.update(policy)
            if args.action == "status" and args.required and args.lens:
                minimum, observed = required_window(starts, finishes, args.lens)
                if limit:
                    minimum = min(minimum, limit["per_round_timeout_seconds_max"])
                if policy or any(e["event"] == "count-reconciliation" for e in events):
                    minimum = 1
                result.update(required_window_seconds=minimum, recent_completed_seconds=observed,
                              can_admit=(not limit or ((limit["new_rounds_max"] is None or total["bounded_executions_used"] < limit["new_rounds_max"]) and not total["unfinished_attempts"])) and (not policy or not policy["prospective_stopped"]) and min(total["remaining_seconds"], policy["prospective_remaining_seconds"] if policy else total["remaining_seconds"]) >= minimum + CLOSEOUT_SECONDS)
            if args.action == "begin":
                if args.attempt_id in starts:
                    result.update(allowed=False, reason="duplicate attempt")
                elif not 1 <= args.timeout_seconds <= 3600:
                    result.update(allowed=False, reason="review timeout must be between 1 and 3600 seconds")
                else:
                    ceiling = min(args.timeout_seconds, limit["per_round_timeout_seconds_max"]) if limit else args.timeout_seconds
                    if latest and latest.get("failure_kind") in ("timeout", "transient_provider") and total["authorized_grant_issue"] is None:
                        previous = starts.get(latest["attempt_id"], {}).get("timeout_seconds")
                        # Legacy attempts lacking a granted deadline cannot authorize
                        # automatic growth beyond the request or executor ceiling.
                        if type(previous) is int and previous > 0:
                            ceiling = min(ceiling, previous * 2, 3600)
                    available = min(total["remaining_seconds"], policy["prospective_remaining_seconds"] if policy else total["remaining_seconds"])
                    grant = min(ceiling, math.floor(available - CLOSEOUT_SECONDS))
                    minimum, observed = required_window(starts, finishes, args.lens) if args.required else (1, [])
                    if limit:
                        minimum = min(minimum, limit["per_round_timeout_seconds_max"])
                    if policy or any(e["event"] == "count-reconciliation" for e in events):
                        minimum = 1
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
                    if args.outcome == "pass" and args.failure_kind not in (None, "completed"):
                        raise ValueError("incomplete or timed out execution cannot produce a passing outcome")
                    seconds = elapsed(start)
                    if args.result_sha256 and not re.fullmatch(r"[0-9a-f]{64}", args.result_sha256):
                        raise ValueError("invalid independent result digest")
                    append(handle, {"event": "finish", "at": utc(), "attempt_id": args.attempt_id,
                        "round_id": args.round_id, "lens": args.lens, "source_sha": args.source_sha,
                        "elapsed_seconds": seconds, "outcome": args.outcome,
                        **({"verdict": args.verdict} if args.verdict else {}),
                        **({"failure_kind": args.failure_kind} if args.failure_kind else {}),
                        **({"result_sha256": args.result_sha256} if args.result_sha256 else {}),
                        **{key: start[key] for key in ("exception", "adoption", "closeout") if key in start}})
                    result.update(reason="recorded", elapsed_seconds=seconds)
        print(json.dumps(result))
        return 0 if result["allowed"] else 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"allowed": False, "reason": str(error)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
