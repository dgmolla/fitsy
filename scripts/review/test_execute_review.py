"""Boundary tests use fake external CLIs; no model/API invocation is needed."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).with_name("execute-review.py")
spec = importlib.util.spec_from_file_location("review_executor", SCRIPT)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ExecutorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="review-executor-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.repository = self.root / "checkout"
        self.repository.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.capture = self.root / "capture.json"
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ["PATH"])

    def cli(self, name, code):
        path = self.bin / name
        path.write_text(f"#!{sys.executable}\n" + code)
        path.chmod(0o755)
        return str(path)

    def invoke(self, provider="codex", model="explicit-model", identity=False, env=None):
        return subprocess.run([sys.executable, "-B", str(SCRIPT), *(["--identity"] if identity else []), provider, model],
                              input="Review this diff.\n", cwd=self.repository, env=env or self.env,
                              text=True, capture_output=True, timeout=10)

    def test_provider_and_model_validation_rejects_shell_and_option_injection(self):
        for provider, model in [("other", "model"), ("codex", ""), ("codex", "--sandbox=danger-full-access"),
                                ("claude", "sonnet;touch bad"), ("codex", "$(touch bad)"), ("codex", "a\nb")]:
            with self.subTest(provider=provider, model=model), self.assertRaises(runner.RunnerError):
                runner.validate_selection(provider, model)
        runner.validate_selection("codex", "provider/model-v1:date")
        self.assertFalse((self.repository / "bad").exists())

    def test_timeout_config_is_bounded(self):
        for value in ["0", "-1", "3601", "infinity", "nan", "1.5"]:
            with self.subTest(value=value), self.assertRaises(runner.RunnerError):
                runner.timeout_seconds(value)
        self.assertEqual(runner.timeout_seconds("1"), 1)
        self.assertEqual(runner.timeout_seconds("3600"), 3600)

    def test_identity_is_stable_and_binds_cli_model_policy_and_timeout(self):
        binary = self.cli("codex", "print('codex-cli fake-1')\n")
        first = self.invoke(identity=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        identity = json.loads(first.stdout)
        self.assertEqual(first.stdout, self.invoke(identity=True).stdout)
        self.assertEqual(identity["executable"], str(Path(binary).resolve()))
        self.assertEqual(identity["provider"], "codex")
        self.assertEqual(identity["model"], "explicit-model")
        self.assertEqual(identity["reasoning_effort"], "high")
        self.assertNotEqual(first.stdout, self.invoke(identity=True, env=dict(self.env, FITSY_REVIEW_REASONING_EFFORT="medium")).stdout)
        self.assertEqual(identity["security"]["sandbox"], "read-only")
        self.assertNotEqual(first.stdout, self.invoke(model="other-model", identity=True).stdout)
        self.assertNotEqual(first.stdout, self.invoke(identity=True, env=dict(self.env, FITSY_REVIEW_TIMEOUT_SECONDS="42")).stdout)
        self.cli("codex", "print('codex-cli fake-2')\n")
        self.assertNotEqual(first.stdout, self.invoke(identity=True).stdout)

    def test_codex_is_neutral_read_only_and_emits_only_final_response(self):
        self.cli("codex", f"""import json, os, pathlib, sys
args=sys.argv[1:]
pathlib.Path({str(self.capture)!r}).write_text(json.dumps({{'argv':args,'cwd':os.getcwd(),'prompt':sys.stdin.read(),'env':dict(os.environ)}}))
pathlib.Path(args[args.index('--output-last-message')+1]).write_text('FINAL VERDICT')
print('untrusted partial output must not be emitted')
""")
        result = self.invoke(env=dict(self.env, BASH_ENV="/malicious/startup", NODE_OPTIONS="--require=/malicious/code", CODEX_THREAD_ID="inherited"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "FINAL VERDICT")
        capture = json.loads(self.capture.read_text())
        args = capture["argv"]
        self.assertNotEqual(capture["cwd"], str(self.repository))
        self.assertIn(str(self.repository), capture["prompt"])
        self.assertIn("Review this diff.", capture["prompt"])
        for flag in ["--ignore-user-config", "--ignore-rules", "--strict-config", "--ephemeral"]:
            self.assertIn(flag, args)
        self.assertEqual(args[args.index("--sandbox") + 1], "read-only")
        self.assertEqual(args[args.index("--ask-for-approval") + 1], "never")
        self.assertNotIn("--add-dir", args)
        self.assertIn('model_reasoning_effort="high"', args)
        self.assertIn('project_doc_max_bytes=0', args)
        self.assertIn('skills.bundled.enabled=false', args)
        for feature in ("hooks", "plugins", "apps", "multi_agent", "multi_agent_v2",
                        "skill_search", "skill_mcp_dependency_install", "remote_plugin",
                        "external_agent_memory_import", "shell_snapshot"):
            self.assertIn(["--disable", feature], [args[i:i+2] for i in range(len(args)-1)])
        for name in ["BASH_ENV", "NODE_OPTIONS", "CODEX_THREAD_ID"]:
            self.assertNotIn(name, capture["env"])
        self.assertFalse(Path(capture["cwd"]).exists())

    def test_claude_only_exposes_read_tools_and_keeps_envelope(self):
        self.cli("claude", f"""import json,pathlib,sys
pathlib.Path({str(self.capture)!r}).write_text(json.dumps(sys.argv[1:]))
sys.stdin.read()
print('{{"result":"VERDICT"}}')
""")
        result = self.invoke("claude", "sonnet")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"result": "VERDICT"})
        args = json.loads(self.capture.read_text())
        self.assertEqual(args[args.index("--tools")+1], "Read,Glob,Grep")
        for flag in ["--restricted", "--safe-mode", "--strict-mcp-config", "--disable-slash-commands"]:
            self.assertIn(flag, args)
        self.assertNotIn("--fallback-model", args)

    def test_nonzero_exit_discards_even_a_passing_final_file_without_fallback(self):
        self.cli("codex", """import pathlib,sys
args=sys.argv[1:]
pathlib.Path(args[args.index('--output-last-message')+1]).write_text('PASS')
print('PASS')
print('Authentication unavailable', file=sys.stderr)
sys.exit(7)
""")
        fallback_marker = self.root / "fallback"
        self.cli("claude", f"import pathlib\npathlib.Path({str(fallback_marker)!r}).touch()\n")
        result = self.invoke()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("exited 7", result.stderr)
        self.assertIn("Authentication unavailable", result.stderr)
        self.assertFalse(fallback_marker.exists())

    def test_missing_or_empty_final_response_fails_closed(self):
        for body in ["print('PASS')\n", "import pathlib,sys\na=sys.argv\npathlib.Path(a[a.index('--output-last-message')+1]).write_text('')\n"]:
            self.cli("codex", body)
            result = self.invoke()
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")

    def test_deadline_kills_tool_descendants_and_discards_partial_output(self):
        marker = self.root / "late-write"
        child = f"import pathlib,time;time.sleep(2);pathlib.Path({str(marker)!r}).touch()"
        self.cli("codex", f"import subprocess,sys,time\nsubprocess.Popen([sys.executable,'-c',{child!r}])\nprint('PASS',flush=True)\ntime.sleep(30)\n")
        result = self.invoke(env=dict(self.env, FITSY_REVIEW_TIMEOUT_SECONDS="1"))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("deadline", result.stderr)
        # Wait beyond the child write point to prove it was killed, not detached.
        import time
        time.sleep(1.2)
        self.assertFalse(marker.exists())

    def test_codex_rejects_a_temporary_directory_inside_a_project(self):
        binary = self.cli("codex", "raise AssertionError('must not execute')\n")
        with patch.object(tempfile, "tempdir", str(self.repository)):
            with self.assertRaisesRegex(runner.RunnerError, "outside the repository"):
                runner.execute("codex", "model", binary, "Review", self.repository, 1)
        config = self.root / ".codex"
        config.mkdir()
        (config / "config.toml").write_text('sandbox_mode="danger-full-access"')
        with patch.object(tempfile, "tempdir", str(self.root)):
            with self.assertRaisesRegex(runner.RunnerError, "inherits project configuration"):
                runner.execute("codex", "model", binary, "Review", self.repository, 1)

    def test_invalid_reasoning_effort_fails_before_running_the_cli(self):
        marker = self.root / "invoked"
        self.cli("codex", f"import pathlib\npathlib.Path({str(marker)!r}).touch()\n")
        result = self.invoke(env=dict(self.env, FITSY_REVIEW_REASONING_EFFORT="none"))
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertIn("FITSY_REVIEW_REASONING_EFFORT", result.stderr)
        self.assertFalse(marker.exists())

    def test_empty_prompt_never_spawns_a_reviewer(self):
        marker = self.root / "invoked"
        binary = self.cli("codex", f"import pathlib\npathlib.Path({str(marker)!r}).touch()\n")
        with self.assertRaises(runner.RunnerError):
            runner.execute("codex", "model", binary, "  ", self.repository, 1)
        self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
