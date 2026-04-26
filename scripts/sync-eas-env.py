#!/usr/bin/env python3
"""
Sync EXPO_PUBLIC_* env vars from apps/mobile/.env(.local) to EAS for all
build environments (production, preview, development).

Why: preview/production EAS builds bake EXPO_PUBLIC_* values into the JS
bundle at build time, reading from EAS's server-side environment vars
(NOT your local .env files). Without these synced, builds end up with
process.env.EXPO_PUBLIC_API_URL === undefined and fall back to localhost.

Scope: only EXPO_PUBLIC_* vars. Backend secrets (POSTGRES_*, SUPABASE_*,
ANTHROPIC_API_KEY, etc.) belong in Vercel, not EAS — this script ignores
them on purpose.

Usage:
    python3 scripts/sync-eas-env.py            # apply
    python3 scripts/sync-eas-env.py --dry-run  # preview only
    python3 scripts/sync-eas-env.py --env=preview  # one env at a time

The .env.local file overrides .env when both define the same key.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MOBILE_DIR = REPO_ROOT / "apps" / "mobile"
DEFAULT_ENVS = ("production", "preview", "development")
EXPO_PUBLIC_RE = re.compile(r"^(EXPO_PUBLIC_[A-Z0-9_]+)=(.*)$")


def collect_vars() -> dict[str, str]:
    """Read .env then .env.local — later file wins on overlap."""
    vars: dict[str, str] = {}
    for fname in (MOBILE_DIR / ".env", MOBILE_DIR / ".env.local"):
        if not fname.exists():
            continue
        for line in fname.read_text().splitlines():
            m = EXPO_PUBLIC_RE.match(line)
            if not m:
                continue
            k, v = m.group(1), m.group(2)
            if (v.startswith('"') and v.endswith('"')) or (
                v.startswith("'") and v.endswith("'")
            ):
                v = v[1:-1]
            vars[k] = v
    return vars


def push(key: str, value: str, env: str) -> bool:
    cmd = [
        "eas", "env:create", env,
        "--name", key,
        "--value", value,
        "--visibility", "plaintext",
        "--type", "string",
        "--non-interactive", "--force",
    ]
    proc = subprocess.run(
        cmd, cwd=str(MOBILE_DIR), capture_output=True, text=True
    )
    return proc.returncode == 0


def parse_args(argv: list[str]) -> tuple[bool, tuple[str, ...]]:
    dry = False
    envs: tuple[str, ...] = DEFAULT_ENVS
    for arg in argv[1:]:
        if arg == "--dry-run":
            dry = True
        elif arg.startswith("--env="):
            target = arg.split("=", 1)[1].strip()
            if target not in DEFAULT_ENVS:
                sys.exit(f"unknown --env={target}; pick one of {DEFAULT_ENVS}")
            envs = (target,)
        else:
            sys.exit(
                f"unknown arg: {arg}\n"
                "usage: sync-eas-env.py [--dry-run] [--env=production|preview|development]"
            )
    return dry, envs


def main() -> int:
    dry, envs = parse_args(sys.argv)
    vars = collect_vars()
    if not vars:
        print(f"No EXPO_PUBLIC_* vars found in {MOBILE_DIR}/.env*", file=sys.stderr)
        return 1

    print(f"Found {len(vars)} EXPO_PUBLIC_* var(s) in apps/mobile/.env(.local):")
    for k in sorted(vars):
        print(f"  - {k}")
    print(f"Targeting EAS environments: {', '.join(envs)}")
    print()

    failures = 0
    for key in sorted(vars):
        value = vars[key]
        for env in envs:
            if dry:
                print(f"  [dry-run] {key} -> {env}")
            else:
                ok = push(key, value, env)
                print(f"  {'OK' if ok else 'FAIL'} {key} -> {env}")
                if not ok:
                    failures += 1

    print()
    if dry:
        print("Dry run only — no changes made.")
    else:
        print(f"Done. {failures} failure(s).")
        print("Verify with:  cd apps/mobile && eas env:list <production|preview|development>")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
