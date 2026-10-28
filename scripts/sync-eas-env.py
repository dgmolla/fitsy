#!/usr/bin/env python3
"""Validate one explicit public configuration before syncing one EAS environment.

Dry run (default): python3 scripts/sync-eas-env.py --source FILE --env preview
Apply that plan:   python3 scripts/sync-eas-env.py --source FILE --env preview --apply

Never merges dotenv files or shell values. See the maintained environment runbook:
docs/engineering/devops/staging-environment.md#eas-public-configuration
"""

from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.request

REPO_ROOT = Path(__file__).resolve().parent.parent
MOBILE_DIR = REPO_ROOT / "apps" / "mobile"
# Keep project identities aligned with scripts/lib/db-target-guard.ts.
DEV_PROJECT_REF = "kegycybiruksmrzvniha"
PROD_PROJECT_REF = "zaxkmjqozvmbifiwbxps"
ENVIRONMENTS = ("development", "preview", "production")
API_ORIGINS = {
    "development": {"https://dev.fitsy.org"},
    "preview": {"https://dev.fitsy.org"},
    "production": {"https://fitsy-api.vercel.app"},
}
REQUIRED = {"EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_ANON_KEY"}
PRODUCTION_REQUIRED = REQUIRED | {"EXPO_PUBLIC_REVENUECAT_IOS_KEY", "EXPO_PUBLIC_POSTHOG_API_KEY"}
PUBLIC_PATTERNS = {
    "EXPO_PUBLIC_REVENUECAT_IOS_KEY": r"appl_[A-Za-z0-9]+",
    "EXPO_PUBLIC_REVENUECAT_ANDROID_KEY": r"goog_[A-Za-z0-9]+",
    "EXPO_PUBLIC_REVENUECAT_TEST_KEY": r"test_[A-Za-z0-9]+",
    "EXPO_PUBLIC_POSTHOG_API_KEY": r"phc_[A-Za-z0-9]+",
    "EXPO_PUBLIC_POSTHOG_HOST": r"https://(?:us|eu)\.i\.posthog\.com/?",
    "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID": r"[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com",
    "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID": r"[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com",
}
PUBLIC_NAMES = REQUIRED | PUBLIC_PATTERNS.keys()


class Refused(ValueError):
    """Only static diagnostics and approved names may cross the output boundary."""


class SafeParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        # argparse's normal diagnostic echoes arbitrary arguments and their values.
        self.print_usage(sys.stderr)
        self.exit(2, "Supply exactly one --source FILE and --env development|preview|production; "
                  "choose --dry-run (default) or --apply.\n")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = SafeParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--source", action="append", required=True)
    parser.add_argument("--env", action="append", required=True, choices=ENVIRONMENTS)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    if len(args.source) != 1 or len(args.env) != 1:
        parser.error("ambiguous input")
    args.source, args.env = Path(args.source[0]), args.env[0]
    return args


def collect_vars(source: Path) -> dict[str, str]:
    """Parse a dotenv file as data, never as shell code or interpolated values."""
    try:
        content = source.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        raise Refused("Cannot read the explicit source file.") from None
    values: dict[str, str] = {}
    for number, line in enumerate(content.splitlines(), 1):
        line = line.strip()
        if line.startswith("export "):
            line = line[7:].lstrip()
        if not line.startswith("EXPO_PUBLIC_"):
            continue  # Backend configuration never enters the upload snapshot.
        match = re.fullmatch(r"(EXPO_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*)", line)
        if not match or match[1] not in PUBLIC_NAMES:
            raise Refused(f"Unapproved or malformed public variable at line {number}.")
        name, value = match.groups()
        if name in values:
            raise Refused(f"Duplicate public variable: {name}.")
        if value.startswith(('"', "'")):
            quoted = re.fullmatch(r"(['\"])(.*?)\1\s*(?:#.*)?", value)
            if not quoted:
                raise Refused(f"Malformed quoted public value at line {number}.")
            value = quoted[2]
        else:
            value = value.split("#", 1)[0].rstrip()
        if not value or any(character.isspace() for character in value):
            raise Refused(f"Empty or invalid public value: {name}.")
        values[name] = value
    return values


def validate_public_config(values: dict[str, str], target: str) -> None:
    required = PRODUCTION_REQUIRED if target == "production" else REQUIRED
    missing = required - values.keys()
    if missing:
        raise Refused("Missing public configuration: " + ", ".join(sorted(missing)) + ".")
    if values["EXPO_PUBLIC_API_URL"] not in API_ORIGINS[target]:
        raise Refused("EXPO_PUBLIC_API_URL does not identify the selected environment's stable API.")
    ref = PROD_PROJECT_REF if target == "production" else DEV_PROJECT_REF
    if values["EXPO_PUBLIC_SUPABASE_URL"] not in {f"https://{ref}.supabase.co", f"https://{ref}.supabase.co/"}:
        raise Refused("EXPO_PUBLIC_SUPABASE_URL does not identify the selected environment's project.")
    for name, pattern in PUBLIC_PATTERNS.items():
        if name not in values:
            continue
        if target == "production" and name == "EXPO_PUBLIC_REVENUECAT_TEST_KEY":
            raise Refused("Production cannot contain a RevenueCat Test Store key; use platform SDK keys for sandbox purchases.")
        if not re.fullmatch(pattern, values[name]):
            raise Refused(f"Expected a public client value of the correct type: {name}.")
    key = values["EXPO_PUBLIC_SUPABASE_ANON_KEY"]
    if re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]+", key):
        return  # Opaque key/project binding is checked against Supabase below.
    try:
        if not re.fullmatch(r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", key):
            raise ValueError()
        segment = key.split(".")[1]
        payload = json.loads(base64.b64decode(segment + "=" * (-len(segment) % 4), altchars=b"-_", validate=True))
        if payload["role"] == "anon" and payload["ref"] == ref:
            return
    except (ValueError, KeyError, TypeError):
        pass
    raise Refused("EXPO_PUBLIC_SUPABASE_ANON_KEY must be a publishable key or the selected project's anon JWT.")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_supabase_key(values: dict[str, str]) -> None:
    """Read-only provider check also binds opaque publishable keys to the project."""
    request = urllib.request.Request(
        values["EXPO_PUBLIC_SUPABASE_URL"].rstrip("/") + "/auth/v1/settings",
        headers={"apikey": values["EXPO_PUBLIC_SUPABASE_ANON_KEY"], "Accept": "application/json"},
    )
    # Never forward keys through ambient proxies or provider redirects.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=10) as response:
            if response.status != 200:
                raise ValueError()
    except Exception:
        # Provider exceptions can contain URLs, headers and credentials.
        raise Refused("Supabase public key/project verification failed; no EAS changes made.") from None


def push(values: dict[str, str], target: str) -> None:
    # EAS env:push accepts a dotenv path. Values never enter argv or retained logs.
    # Use a validated snapshot, not the original file, which may also hold secrets.
    with tempfile.TemporaryDirectory(prefix="fitsy-eas-public-") as directory:
        snapshot = Path(directory) / "public.env"
        with open(snapshot, "x", encoding="utf-8", opener=lambda path, flags: os.open(path, flags, 0o600)) as stream:
            stream.write("".join(f"{name}={values[name]}\n" for name in sorted(values)))
        child_env = {name: value for name, value in os.environ.items()
                     if not name.startswith("EXPO_PUBLIC_") and name not in {"NODE_OPTIONS", "NODE_PATH"}}
        child_env.update(values)
        child_env.update(EXPO_NO_DOTENV="1", NODE_ENV="production" if target == "production" else "development")
        try:
            result = subprocess.run(
                ["eas", "env:push", target, "--path", str(snapshot), "--force"],
                cwd=MOBILE_DIR, env=child_env, stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
            )
        except (OSError, subprocess.SubprocessError):
            raise Refused("EAS upload did not complete; reconcile the selected target before retrying.") from None
        if result.returncode:
            raise Refused("EAS upload failed; reconcile the selected target before retrying.")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        values = collect_vars(args.source)
        validate_public_config(values, args.env)
        verify_supabase_key(values)
        print(f"Validated EAS plan: {args.env}; {len(values)} public variable(s); values hidden.")
        for name in sorted(values):
            print(f"  {name} -> {args.env}")
        if args.apply:
            push(values, args.env)
            print("EAS upload completed for the selected environment.")
        else:
            print("Dry run only; no EAS changes made. Repeat with --apply to upload.")
        return 0
    except Refused as error:
        print(f"EAS sync refused: {error}", file=sys.stderr)
        return 1
    except OSError:
        print("EAS sync failed to prepare the private upload snapshot.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
