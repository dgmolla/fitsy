"""Exercise the real uploader against fake external Supabase and EAS services."""
from contextlib import redirect_stderr, redirect_stdout
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

SCRIPT = Path(__file__).with_name("sync-eas-env.py")
spec = importlib.util.spec_from_file_location("sync_eas_env", SCRIPT)
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def jwt(ref, role="anon"):
    payload = base64.urlsafe_b64encode(json.dumps({"ref": ref, "role": role}).encode()).decode().rstrip("=")
    return f"eyJhbGciOiJIUzI1NiJ9.{payload}.syntheticSignature"


def config(target="development", opaque=False):
    ref = sync.PROD_PROJECT_REF if target == "production" else sync.DEV_PROJECT_REF
    return {
        "EXPO_PUBLIC_API_URL": "https://fitsy-api.vercel.app" if target == "production" else "https://dev.fitsy.org",
        "EXPO_PUBLIC_SUPABASE_URL": f"https://{ref}.supabase.co",
        "EXPO_PUBLIC_SUPABASE_ANON_KEY": f"sb_publishable_{ref}" if opaque else jwt(ref),
        "EXPO_PUBLIC_REVENUECAT_IOS_KEY": "appl_syntheticStore",
        "EXPO_PUBLIC_POSTHOG_API_KEY": "phc_syntheticProject",
    }


class SyncEasEnvTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="fitsy-574-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.mobile = self.root / "apps/mobile"
        self.mobile.mkdir(parents=True)
        scripts = self.root / "scripts"
        scripts.mkdir()
        self.cli_script = scripts / SCRIPT.name
        shutil.copyfile(SCRIPT, self.cli_script)
        self.source = self.root / "selected.env"
        self.calls = self.root / "calls.jsonl"
        binary = self.root / "bin"
        binary.mkdir()
        fake = binary / "eas"
        fake.write_text("#!" + sys.executable + "\n" + '''
import json, os, pathlib, sys
args = sys.argv[1:]
assert args[:2] == ['env:push', os.environ['EXPECTED_TARGET']]
assert len(args) == 5 and args[-1] == '--force' and args[2] == '--path'
source = pathlib.Path(args[3])
values = dict(line.split('=', 1) for line in source.read_text().splitlines())
record = {'args': args, 'values': values, 'mode': source.stat().st_mode & 0o777,
          'dir_mode': source.parent.stat().st_mode & 0o777,
          'env': {k: v for k, v in os.environ.items() if k.startswith('EXPO_PUBLIC_')},
          'dotenv': os.environ.get('EXPO_NO_DOTENV'), 'node_env': os.environ.get('NODE_ENV'),
          'cwd': str(pathlib.Path.cwd())}
with open(os.environ['EAS_CALLS'], 'a') as stream: stream.write(json.dumps(record) + '\\n')
# Deliberately noisy provider output must never reach the caller or retained logs.
print('provider-output-' + json.dumps(values))
print('provider-error-' + json.dumps(values), file=sys.stderr)
sys.exit(int(os.environ.get('EAS_EXIT', '0')))
''')
        fake.chmod(0o700)
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("EXPO_PUBLIC_")}
        self.env.update(PATH=str(binary) + os.pathsep + self.env.get("PATH", ""), EAS_CALLS=str(self.calls), EXPECTED_TARGET="development")
        self.addCleanup(patch.stopall)
        patch.object(sync, "MOBILE_DIR", self.mobile).start()
        patch.dict(os.environ, self.env, clear=True).start()
        self.provider = patch("urllib.request.OpenerDirector.open", side_effect=self.supabase).start()

    @staticmethod
    def supabase(request, timeout):
        assert request.get_method() == "GET" and timeout == 10
        ref = request.full_url.removeprefix("https://").removesuffix(".supabase.co/auth/v1/settings")
        assert ref in {sync.DEV_PROJECT_REF, sync.PROD_PROJECT_REF}
        key = request.get_header("Apikey")
        if key not in {jwt(ref), f"sb_publishable_{ref}"}:
            raise urllib.error.HTTPError(request.full_url, 401, "synthetic key rejected", {}, None)
        response = unittest.mock.MagicMock()
        response.__enter__.return_value.status = 200
        return response

    def write(self, values):
        self.source.write_text("".join(f"{name}={value}\n" for name, value in values.items()))

    def run_main(self, target="development", mode="--apply"):
        os.environ["EXPECTED_TARGET"] = target
        output = io.StringIO()
        with redirect_stdout(output), redirect_stderr(output):
            code = sync.main(["--source", str(self.source), "--env", target, *([mode] if mode else [])])
        return code, output.getvalue()

    def records(self):
        return [json.loads(line) for line in self.calls.read_text().splitlines()] if self.calls.exists() else []

    def assert_refused(self, values, target="production", provider=False):
        self.write(values)
        self.provider.reset_mock()
        code, output = self.run_main(target)
        self.assertEqual(code, 1)
        self.assertEqual(self.records(), [])
        self.assertEqual(self.provider.call_count, int(provider))
        for value in values.values():
            if len(value) > 10:
                self.assertNotIn(value, output)
        self.assertNotIn("Traceback", output)

    def test_cli_requires_one_explicit_source_and_target_without_echoing_arguments(self):
        self.write(config())
        # A default file must never rescue a missing explicit source.
        (self.mobile / ".env").write_text(self.source.read_text())
        valid = ["--source", str(self.source), "--env", "development"]
        for args in [[], ["--source", str(self.source)], ["--env=production"],
                     valid + ["--env=production"], valid + ["--source=another.env"],
                     valid + ["--apply", "--dry-run"], valid + ["--unknown=syntheticCredential"],
                     ["--source", str(self.source), "--env=syntheticCredential"],
                     ["--source", str(self.source), "--env=production,preview"]]:
            with self.subTest(args=args):
                result = subprocess.run([sys.executable, "-B", str(self.cli_script), *args],
                                        env=self.env, capture_output=True, text=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("syntheticCredential", result.stdout + result.stderr)
                self.assertEqual(self.records(), [])

    def test_dev_and_prod_files_cannot_cross_targets(self):
        for source, target in [("development", "production"), ("preview", "production"),
                               ("production", "development"), ("production", "preview")]:
            with self.subTest(source=source, target=target):
                self.assert_refused(config(source), target)
                result = subprocess.run([sys.executable, "-B", str(self.cli_script), "--source", str(self.source),
                                         "--env", target, "--apply"], env=self.env,
                                        capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(self.records(), [])

    def test_mixed_project_urls_keys_and_api_origins_are_rejected(self):
        for target, other in [("production", "development"), ("development", "production")]:
            for name in sync.REQUIRED:
                with self.subTest(target=target, name=name):
                    self.assert_refused({**config(target), name: config(other)[name]}, target)

    def test_opaque_dev_and_prod_keys_are_bound_to_the_selected_project(self):
        for target, other in [("production", "development"), ("development", "production")]:
            with self.subTest(target=target):
                self.assert_refused({**config(target, True), "EXPO_PUBLIC_SUPABASE_ANON_KEY":
                                     config(other, True)["EXPO_PUBLIC_SUPABASE_ANON_KEY"]}, target, provider=True)

    def test_private_unknown_and_wrong_type_public_values_never_mutate_eas(self):
        invalid = {
            "EXPO_PUBLIC_SUPABASE_ANON_KEY": ["sb_secret_syntheticPrivate", jwt(sync.PROD_PROJECT_REF, "service_role"),
                                              "not-a-public-key", "e30.bm90anNvbg.signature", "e30.W10.signature"],
            "EXPO_PUBLIC_REVENUECAT_IOS_KEY": ["sk_syntheticPrivate", "test_syntheticStore"],
            "EXPO_PUBLIC_REVENUECAT_ANDROID_KEY": ["appl_wrongPlatform"],
            "EXPO_PUBLIC_POSTHOG_API_KEY": ["phx_syntheticPersonalToken"],
            "EXPO_PUBLIC_POSTHOG_HOST": ["https://example.test/?token=syntheticCredential"],
            "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID": ["syntheticClientSecret"],
            "EXPO_PUBLIC_DEV_LOGIN_EMAIL": ["synthetic@example.test"],
            "EXPO_PUBLIC_DEV_LOGIN_PASSWORD": ["syntheticCredential"],
            "EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY": ["syntheticCredential"],
            "EXPO_PUBLIC_UNREVIEWED_FIELD": ["-----BEGIN PRIVATE KEY-----"],
            "EXPO_PUBLIC_REVENUECAT_TEST_KEY": ["test_syntheticStore"],
        }
        for name, values in invalid.items():
            for value in values:
                with self.subTest(name=name, value=value):
                    self.assert_refused({**config("production"), name: value})

    def test_untrusted_url_forms_fail_before_provider_access(self):
        for name in ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_SUPABASE_URL"]:
            for value in ["http://localhost:3000", "https://dev.fitsy.org.evil.test", "https://user:syntheticCredential@fitsy.org",
                          config("production")[name] + "?token=syntheticCredential", config("production")[name] + "/api"]:
                with self.subTest(name=name, value=value):
                    self.assert_refused({**config("production"), name: value})

    def test_marketing_domain_is_not_a_production_api(self):
        self.assert_refused({**config("production"), "EXPO_PUBLIC_API_URL": "https://fitsy.org"})

    def test_missing_and_malformed_input_cannot_use_defaults_or_shell_fallback(self):
        (self.mobile / ".env").write_text("EXPO_PUBLIC_DEV_LOGIN_PASSWORD=syntheticCredential\n")
        os.environ.update(config("production"))
        for name in config("production"):
            with self.subTest(missing=name):
                self.assert_refused({key: value for key, value in config("production").items() if key != name})
        for suffix in ["EXPO_PUBLIC_API_URL=https://fitsy.org\n", "EXPO_PUBLIC_BROKEN\n",
                       'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID="unterminated\n', "EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=\n",
                       "EXPO_PUBLIC_REVENUECAT_ANDROID_KEY=${PRIVATE_KEY}\n"]:
            self.write(config("production"))
            with self.source.open("a") as stream:
                stream.write(suffix)
            code, _ = self.run_main("production")
            self.assertEqual(code, 1)
            self.assertEqual(self.records(), [])
        self.source.unlink()
        self.assertEqual(self.run_main()[0], 1)
        self.source.write_bytes(b"EXPO_PUBLIC_API_URL=\xff")
        self.assertEqual(self.run_main()[0], 1)
        self.assertEqual(self.records(), [])
        self.provider.assert_not_called()

    def test_dry_run_is_the_default_and_never_invokes_eas(self):
        for mode in [None, "--dry-run"]:
            self.write(config())
            code, output = self.run_main(mode=mode)
            self.assertEqual(code, 0)
            self.assertIn("Dry run only", output)
            self.assertIn("EXPO_PUBLIC_SUPABASE_ANON_KEY -> development", output)
            self.assertEqual(self.records(), [])
            for value in config().values():
                self.assertNotIn(value, output)

    def test_apply_uploads_only_the_validated_snapshot_to_one_target(self):
        for target in sync.ENVIRONMENTS:
            with self.subTest(target=target):
                self.calls.unlink(missing_ok=True)
                values = config(target, opaque=True)
                values.update(EXPO_PUBLIC_REVENUECAT_ANDROID_KEY="goog_syntheticStore",
                              EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID="123-synthetic.apps.googleusercontent.com",
                              EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID="456-synthetic.apps.googleusercontent.com",
                              EXPO_PUBLIC_POSTHOG_HOST="https://us.i.posthog.com")
                if target != "production":
                    values["EXPO_PUBLIC_REVENUECAT_TEST_KEY"] = "test_syntheticStore"
                self.write(values)
                with self.source.open("a") as stream:
                    stream.write("SUPABASE_SERVICE_ROLE_KEY=syntheticPrivate\n")
                # Valid source wins over every implicit file and ambient public value.
                (self.mobile / ".env.local").write_text("EXPO_PUBLIC_DEV_LOGIN_PASSWORD=syntheticCredential\n")
                os.environ["EXPO_PUBLIC_DEV_LOGIN_PASSWORD"] = "syntheticCredential"
                code, output = self.run_main(target)
                self.assertEqual(code, 0, output)
                records = self.records()
                self.assertEqual(len(records), 1)
                record = records[0]
                self.assertEqual(record["values"], values)
                self.assertEqual(record["env"], values)
                self.assertEqual(record["mode"], 0o600)
                self.assertEqual(record["dir_mode"], 0o700)
                self.assertEqual(record["dotenv"], "1")
                self.assertEqual(Path(record["cwd"]).resolve(), self.mobile.resolve())
                self.assertFalse(Path(record["args"][3]).exists())
                for value in values.values():
                    self.assertNotIn(value, " ".join(record["args"]) + output)
                self.assertNotIn("syntheticPrivate", output)
                self.assertNotIn("provider-output", output)
                self.assertNotIn("provider-error", output)

    def test_provider_failure_or_unavailability_prevents_all_eas_mutations(self):
        self.write(config("production"))
        for failure in [OSError("syntheticCredential"), TimeoutError("syntheticCredential"),
                        urllib.error.HTTPError("https://syntheticCredential", 302, "syntheticCredential", {}, None)]:
            self.provider.side_effect = failure
            code, output = self.run_main("production")
            self.assertEqual(code, 1)
            self.assertEqual(self.records(), [])
            self.assertNotIn("syntheticCredential", output)

    def test_eas_failure_is_sanitized_and_snapshot_is_removed_without_retries(self):
        self.write(config())
        os.environ["EAS_EXIT"] = "1"
        code, output = self.run_main()
        self.assertEqual(code, 1)
        self.assertEqual(len(self.records()), 1)
        self.assertFalse(Path(self.records()[0]["args"][3]).exists())
        self.assertNotIn("provider-error", output)
        self.assertIn("reconcile", output)

    def test_source_changes_during_provider_validation_cannot_change_the_upload(self):
        values = config()
        self.write(values)
        def provider(request, timeout):
            self.source.write_text("EXPO_PUBLIC_DEV_LOGIN_PASSWORD=syntheticCredential\n")
            return self.supabase(request, timeout)
        self.provider.side_effect = provider
        self.assertEqual(self.run_main()[0], 0)
        self.assertEqual(self.records()[0]["values"], values)

    def test_missing_eas_or_timeout_does_not_expose_arguments_or_retry(self):
        self.write(config())
        for failure in [FileNotFoundError("syntheticCredential"),
                        subprocess.TimeoutExpired(["eas", "syntheticCredential"], 60, output="syntheticCredential")]:
            with patch("subprocess.run", side_effect=failure) as external_eas:
                code, output = self.run_main()
            self.assertEqual(code, 1)
            external_eas.assert_called_once()
            snapshot = Path(external_eas.call_args.args[0][4])
            self.assertFalse(snapshot.exists())
            self.assertEqual(self.records(), [])
            self.assertNotIn("syntheticCredential", output)

    def test_dotenv_quotes_export_and_comments_parse_without_expansion(self):
        values = config()
        self.source.write_text("# comment\n" + "".join(f'export {name} = "{value}" # comment\n' for name, value in values.items()))
        self.assertEqual(self.run_main()[0], 0)
        self.assertEqual(self.records()[0]["values"], values)

    def test_redirects_never_forward_the_key(self):
        handler = sync.NoRedirect()
        self.assertIsNone(handler.redirect_request(None, None, 302, "", {}, "https://example.test"))

    def test_uploader_tracks_canonical_project_and_production_bundle_requirements(self):
        root = SCRIPT.parent.parent
        guard = (root / "scripts/lib/db-target-guard.ts").read_text()
        for ref in [sync.DEV_PROJECT_REF, sync.PROD_PROJECT_REF]:
            self.assertIn(f'"{ref}"', guard)
        app = (root / "apps/mobile/app.config.ts").read_text()
        required_block = app.split("export const REQUIRED_PUBLIC_ENV = [", 1)[1].split("]", 1)[0]
        for name in sync.PRODUCTION_REQUIRED:
            self.assertIn(f'"{name}"', required_block)


if __name__ == "__main__":
    unittest.main()
