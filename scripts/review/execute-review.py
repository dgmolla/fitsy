#!/usr/bin/env python3
"""Run an explicitly selected reviewer without granting it write tools.

The installed CLI and administrator-managed policy are trusted infrastructure.
This adapter constrains model tools, not the CLI's own authentication/log writes.
It never retries with another provider or model and emits no partial success.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile

DEFAULT_TIMEOUT = 900
MAX_TIMEOUT = 3600
CODEX_DISABLED_FEATURES = (
    "hooks", "plugins", "apps", "multi_agent", "multi_agent_v2",
    "skill_search", "skill_mcp_dependency_install", "remote_plugin",
    "external_agent_memory_import", "shell_snapshot",
)
CODEX_CONFIG = (
    'approval_policy="never"', 'sandbox_mode="read-only"',
    'mcp_servers={}', 'orchestrator.mcp.enabled=false',
    'skills.bundled.enabled=false',
    'skills.include_instructions=false', 'project_doc_max_bytes=0',
    'web_search="disabled"', 'shell_environment_policy.inherit="none"',
    'shell_environment_policy.experimental_use_profile=false',
)
CLAUDE_ARGS = (
    "-p", "--restricted", "--safe-mode", "--output-format", "json",
    "--tools", "Read,Glob,Grep", "--allowedTools", "Read", "Glob", "Grep",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--disable-slash-commands", "--settings", '{"disableAllHooks":true}',
    "--permission-mode", "dontAsk", "--permission-prompts", "none",
    "--no-session-persistence", "--no-chrome",
)


class RunnerError(Exception):
    pass


def timeout_seconds(value):
    try:
        result = int(value)
    except (TypeError, ValueError) as error:
        raise RunnerError("FITSY_REVIEW_TIMEOUT_SECONDS must be an integer") from error
    if not 1 <= result <= MAX_TIMEOUT:
        raise RunnerError(f"FITSY_REVIEW_TIMEOUT_SECONDS must be between 1 and {MAX_TIMEOUT}")
    return result


def validate_selection(provider, model):
    if provider not in ("claude", "codex"):
        raise RunnerError("Review provider must be claude or codex")
    if not model or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}", model):
        raise RunnerError("An explicit model identifier is required (letters, digits, . _ : / -)")


def reasoning_effort(provider):
    if provider != "codex":
        return "provider-default"
    effort = os.environ.get("FITSY_REVIEW_REASONING_EFFORT", "high")
    if effort not in ("low", "medium", "high", "xhigh"):
        raise RunnerError("FITSY_REVIEW_REASONING_EFFORT must be low, medium, high or xhigh")
    return effort


def codex_config():
    return (*CODEX_CONFIG, f'model_reasoning_effort="{reasoning_effort("codex")}"')


def executable_for(provider):
    executable = shutil.which(provider)
    if not executable:
        raise RunnerError(f"{provider} CLI is not on PATH; select and install a reviewer explicitly")
    return str(Path(executable).resolve())


def child_environment():
    # Preserve normal CLI authentication, but never shell startup/code injection
    # variables or an inherited agent/session transport. CODEX_HOME retains its
    # actual authentication purpose; --ignore-user-config skips its config.
    env = {key: value for key, value in os.environ.items()
           if key in {"PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TMPDIR",
                      "SYSTEMROOT", "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
                      "CODEX_HOME", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"}}
    env["NO_COLOR"] = "1"
    return env


def run_process(argv, prompt, cwd, timeout, env):
    process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, cwd=cwd, env=env,
                               text=True, start_new_session=True)
    try:
        output, errors = process.communicate(prompt, timeout=timeout)
    except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
        # Kill the entire process group, including shell/tool subprocesses.
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()
        raise RunnerError(f"Reviewer exceeded its {timeout}s deadline or was interrupted") from error
    if process.returncode != 0:
        # Discard stdout even if a failed process printed a passing verdict.
        if errors:
            sys.stderr.write(errors)
        raise RunnerError(f"Reviewer exited {process.returncode}; no verdict accepted")
    return output, errors


def security_config(provider):
    if provider == "claude":
        return {"args": list(CLAUDE_ARGS), "context": "repository", "tools": ["Read", "Glob", "Grep"]}
    return {"sandbox": "read-only", "approval": "never", "context": "neutral-temporary-directory",
            "ignore_user_config": True, "ignore_rules": True,
            "disabled_features": list(CODEX_DISABLED_FEATURES),
            "enabled_features": ["skip_host_skill_discovery"], "config": list(codex_config())}


def identity(provider, model, executable, timeout):
    # Probe outside the checkout so even version discovery cannot select its
    # project customizations. No model invocation occurs in identity mode.
    with tempfile.TemporaryDirectory(prefix="fitsy-review-identity-") as directory:
        version, _ = run_process([executable, "--version"], "", directory, 10, child_environment())
    if not version.strip():
        raise RunnerError("Reviewer did not identify its CLI version")
    digest = hashlib.sha256()
    with open(executable, "rb") as binary:
        for block in iter(lambda: binary.read(1024 * 1024), b""):
            digest.update(block)
    return {"provider": provider, "model": model, "reasoning_effort": reasoning_effort(provider), "executable": executable,
            "executable_sha256": digest.hexdigest(), "cli_version": version.strip(),
            "timeout_seconds": timeout, "security": security_config(provider),
            "executor_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}


def execute(provider, model, executable, prompt, repository, timeout):
    if not prompt.strip():
        raise RunnerError("Refusing an empty review prompt")
    env = child_environment()
    if provider == "claude":
        output, errors = run_process([executable, *CLAUDE_ARGS, "--model", model], prompt, repository, timeout, env)
    else:
        # Never make the repository a Codex working directory: that would load
        # its .codex/config.toml even with --ignore-user-config. Read-only shell
        # tools can read the explicitly named repository without --add-dir.
        with tempfile.TemporaryDirectory(prefix="fitsy-review-") as directory:
            neutral = Path(directory).resolve()
            if repository == neutral or repository in neutral.parents:
                raise RunnerError("Temporary reviewer directory must be outside the repository")
            if any((parent / ".codex/config.toml").exists() or (parent / ".git").exists() for parent in neutral.parents):
                raise RunnerError("Temporary reviewer directory inherits project configuration")
            final = Path(directory) / "final-response.txt"
            argv = [executable, "--ask-for-approval", "never", "exec", "--model", model,
                    "--sandbox", "read-only", "--ignore-user-config", "--ignore-rules", "--strict-config",
                    "--ephemeral", "--skip-git-repo-check", "--color", "never",
                    "--cd", directory, "--output-last-message", str(final)]
            for feature in CODEX_DISABLED_FEATURES:
                argv.extend(["--disable", feature])
            argv.extend(["--enable", "skip_host_skill_discovery"])
            for config in codex_config():
                argv.extend(["--config", config])
            argv.append("-")
            context = f"Repository to review (read-only context): {json.dumps(str(repository))}\nUse absolute paths to inspect this repository.\n\n"
            _, errors = run_process(argv, context + prompt, directory, timeout, env)
            if not final.is_file():
                raise RunnerError("Codex exited without a final response; no verdict accepted")
            output = final.read_text()
    if not output.strip():
        raise RunnerError("Reviewer returned an empty result; no verdict accepted")
    # CLI diagnostics never contaminate the extractor's input.
    if errors:
        sys.stderr.write(errors)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--identity", action="store_true")
    parser.add_argument("provider", choices=("claude", "codex"))
    parser.add_argument("model")
    args = parser.parse_args()
    try:
        validate_selection(args.provider, args.model)
        reasoning_effort(args.provider)
        timeout = timeout_seconds(os.environ.get("FITSY_REVIEW_TIMEOUT_SECONDS", DEFAULT_TIMEOUT))
        executable = executable_for(args.provider)
        if args.identity:
            print(json.dumps(identity(args.provider, args.model, executable, timeout), sort_keys=True))
        else:
            print(execute(args.provider, args.model, executable, sys.stdin.read(), Path.cwd().resolve(), timeout), end="")
    except (RunnerError, OSError, UnicodeError) as error:
        print(f"[review-executor] {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
