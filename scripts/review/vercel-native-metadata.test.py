"""Synthetic metadata transports only. Never reads operator files or credentials."""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout, redirect_stderr

spec = importlib.util.spec_from_file_location('native_metadata', Path(__file__).with_name('vercel-native-metadata.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.user = {'user': {'id': m.ACTOR, 'username': m.USERNAME}}
        self.deployment = {
            'id': 'dpl_fixture', 'readyState': 'READY', 'target': None, 'source': 'git',
            'projectId': m.PROJECT, 'project': {'id': m.PROJECT}, 'ownerId': m.TEAM,
            'teamId': None, 'gitSource': {'sha': 'a' * 40},
            'env': {'SECRET': 'do-not-return'}, 'meta': {'private': 'do-not-return'},
        }
        self.calls = []

    def transport(self, path):
        self.calls.append(path)
        return copy.deepcopy(self.user if path == m.USER_PATH else self.deployment)

    def test_fresh_minimal_valid_git_metadata(self):
        first = m.metadata(self.transport)
        self.assertEqual(first, {k: self.deployment[k] for k in
                                ('id', 'readyState', 'target', 'source', 'gitSource')})
        self.deployment['gitSource']['sha'] = 'b' * 40
        self.assertEqual(m.metadata(self.transport)['gitSource']['sha'], 'b' * 40)
        self.assertEqual(self.calls, [m.USER_PATH, m.DEPLOYMENT_PATH] * 2)
        self.assertNotIn('do-not-return', json.dumps(first))

    def test_actor_identity_must_match_both_fields(self):
        for field in ('id', 'username'):
            with self.subTest(field=field):
                original = self.user['user'].pop(field)
                with self.assertRaises(ValueError):
                    m.metadata(self.transport)
                self.user['user'][field] = 'wrong'
                with self.assertRaises(ValueError):
                    m.metadata(self.transport)
                self.user['user'][field] = original

    def test_missing_and_wrong_deployment_fields(self):
        original = copy.deepcopy(self.deployment)
        for field in ('id', 'readyState', 'target', 'source', 'projectId', 'project', 'ownerId', 'gitSource'):
            for replacement in ('missing', 'wrong'):
                with self.subTest(field=field, replacement=replacement):
                    self.deployment = copy.deepcopy(original)
                    if replacement == 'missing':
                        self.deployment.pop(field)
                    else:
                        self.deployment[field] = {'id': 'wrong', 'sha': 'wrong'} if field in ('project', 'gitSource') else 'wrong'
                    with self.assertRaises((ValueError, KeyError)):
                        m.metadata(self.transport)
        self.deployment = original
        for change in ({'target': 'production'}, {'readyState': 'BUILDING'}, {'ownerId': None, 'teamId': m.TEAM}):
            self.deployment = {**original, **change}
            with self.assertRaises(ValueError):
                m.metadata(self.transport)

    def test_clean_cli_identity_and_dirty_rejection(self):
        self.deployment.update(source='cli', meta={'gitDirty': False, 'gitCommitSha': 'a' * 40})
        self.deployment.pop('gitSource')
        self.assertEqual(m.metadata(self.transport)['meta']['gitCommitSha'], 'a' * 40)
        for dirty in (None, True, 'true', 0, 1):
            self.deployment['meta']['gitDirty'] = dirty
            with self.assertRaises(ValueError):
                m.metadata(self.transport)

    def test_caller_injection_rejected_and_home_not_selected(self):
        m.check_environment({'HOME': '/neutral', 'PATH': '/untrusted'})
        for key in ('VERCEL_TOKEN', 'VERCEL_CONFIG', 'VC_TOKEN', 'NODE_OPTIONS', 'NODE_PATH',
                    'NPM_CONFIG_USERCONFIG', 'npm_config_prefix', 'XDG_CONFIG_HOME', 'DYLD_INSERT_LIBRARIES', 'BASH_ENV'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                m.check_environment({key: 'secret-canary'})

    def test_actual_native_environment_and_fixed_child(self):
        with tempfile.TemporaryDirectory(prefix='metadata-native-') as scratch:
            native_env = {
                'PATH': '/Applications/Xcode.app/Contents/Developer/usr/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
                'HOME': str(Path(scratch, 'home')), 'USER': 'dawitmolla',
                'LOGNAME': 'dawitmolla', 'LANG': 'en_US.UTF-8',
                'PYTHONDONTWRITEBYTECODE': '1', 'FITSY_MEDIA_INTEGRATION': '0',
                'NPM_CONFIG_CACHE': str(Path(scratch, 'npm-cache')),
                'NPM_CONFIG_USERCONFIG': '/dev/null',
                'NPM_CONFIG_UPDATE_NOTIFIER': 'false',
                'FITSY_SIM_OWNER': 'fitsy443-1d29236-activation512',
                'FITSY_FIXTURE': '443-1d29236-native-activation',
                'FITSY_DISPATCH_WORKER_TIMEOUT_SECONDS': '120',
            }
            m.check_environment(native_env)
            for key, value in (
                    ('NPM_CONFIG_USERCONFIG', str(Path(scratch, 'npmrc'))),
                    ('NPM_CONFIG_UPDATE_NOTIFIER', 'true'),
                    ('NPM_CONFIG_PREFIX', scratch), ('NPM_CONFIG_GLOBALCONFIG', '/dev/null'),
                    ('npm_config_userconfig', '/dev/null'), ('VERCEL_TOKEN', 'secret-canary'),
                    ('NODE_OPTIONS', '--require=evil'), ('ENV', 'evil')):
                with self.subTest(key=key), self.assertRaises(ValueError):
                    m.check_environment({**native_env, key: value})
            script = Path(scratch, 'transport.py')
            script.write_text('import json,os,sys\nprint(json.dumps({"argv":sys.argv[1:],"env":dict(os.environ),"cwd":os.getcwd()}))\n')
            with patch.dict(os.environ, native_env, clear=True), \
                    patch.object(m, 'NODE', sys.executable), patch.object(m, 'CLI', str(script)):
                m.check_environment(os.environ)
                result = m.cli_read(m.USER_PATH)
            self.assertEqual(result['argv'], ['api', m.USER_PATH, '--raw'])
            self.assertEqual(result['cwd'], '/')
            expected_env = {
                'HOME': '/Users/dawitmolla', 'PATH': '/usr/bin:/bin', 'LANG': 'en_US.UTF-8',
                'NO_COLOR': '1', 'VERCEL_TELEMETRY_DISABLED': '1',
            }
            if sys.platform == 'darwin':
                # macOS adds this UID-derived field when launching the synthetic Python child.
                expected_env['__CF_USER_TEXT_ENCODING'] = f'0x{os.getuid():X}:0x0:0x0'
            self.assertEqual(result['env'], expected_env)

    def test_main_rejects_arguments_without_transport_and_sanitizes_failure(self):
        for argv in (['helper', '--host', 'evil'], ['helper', '/v2/user'], ['helper']):
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch.object(sys, 'argv', argv), patch.dict(os.environ, {}, clear=True), \
                    patch.object(m, 'PINS', {}), patch.object(m, 'cli_read', side_effect=RuntimeError('secret-canary')) as read, \
                    redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(m.main(), 1)
            self.assertEqual(read.call_count, int(len(argv) == 1))
            self.assertEqual(stdout.getvalue(), '')
            self.assertEqual(stderr.getvalue(), 'Native dev metadata unavailable\n')

    def test_main_valid_output_and_pin_refusal(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(sys, 'argv', ['helper']), patch.dict(os.environ, {}, clear=True), \
                patch.object(m, 'PINS', {}), patch.object(m, 'cli_read', side_effect=self.transport), \
                redirect_stdout(stdout), redirect_stderr(stderr):
            self.assertEqual(m.main(), 0)
        self.assertEqual(json.loads(stdout.getvalue()), m.metadata(self.transport))
        self.assertEqual(stderr.getvalue(), '')
        with tempfile.TemporaryDirectory(prefix='metadata-pin-') as scratch:
            pin = Path(scratch, 'tool')
            pin.write_text('synthetic tool')
            with patch.object(sys, 'argv', ['helper']), patch.dict(os.environ, {}, clear=True), \
                    patch.object(m, 'PINS', {str(pin): '0' * 64}), patch.object(m, 'cli_read') as read, \
                    redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                self.assertEqual(m.main(), 1)
                read.assert_not_called()

    def test_fixed_subprocess_argv_environment_and_sanitized_errors(self):
        # Only this test substitutes an owned synthetic executable. Runtime has no override.
        with tempfile.TemporaryDirectory(prefix='metadata-transport-') as scratch:
            script = Path(scratch, 'transport.py')
            script.write_text('import json,os,sys\nprint(json.dumps({"argv":sys.argv[1:],"env":dict(os.environ)}))\n')
            with patch.object(m, 'NODE', sys.executable), patch.object(m, 'CLI', str(script)), \
                    patch.dict(os.environ, {'HOME': '/injected', 'VERCEL_TOKEN': 'secret-canary', 'NODE_OPTIONS': 'evil'}):
                result = m.cli_read(m.USER_PATH)
            self.assertEqual(result['argv'], ['api', '/v2/user', '--raw'])
            self.assertEqual(result['env']['HOME'], '/Users/dawitmolla')
            self.assertNotIn('secret-canary', json.dumps(result))
            self.assertNotIn('NODE_OPTIONS', result['env'])
            script.write_text('import sys\nprint("secret-canary",file=sys.stderr)\nsys.exit(1)\n')
            with patch.object(m, 'NODE', sys.executable), patch.object(m, 'CLI', str(script)):
                with self.assertRaisesRegex(ValueError, '^Metadata command failed$'):
                    m.cli_read(m.DEPLOYMENT_PATH)
            script.write_text('print("x"*300000)\n')
            with patch.object(m, 'NODE', sys.executable), patch.object(m, 'CLI', str(script)):
                with self.assertRaisesRegex(ValueError, 'limit exceeded'):
                    m.cli_read(m.USER_PATH)
            script.write_text('import time\ntime.sleep(60)\n')
            with patch.object(m, 'NODE', sys.executable), patch.object(m, 'CLI', str(script)), \
                    patch.object(m.time, 'monotonic', side_effect=[0, 31]):
                with self.assertRaisesRegex(ValueError, 'timed out'):
                    m.cli_read(m.USER_PATH)
        with self.assertRaises(ValueError):
            m.cli_read('https://evil/v2/user')

    def test_actual_shebang_ignores_poisoned_python_startup(self):
        with tempfile.TemporaryDirectory(prefix='metadata-startup-') as scratch:
            root = Path(scratch)
            canary = root / 'executed'
            (root / 'sitecustomize.py').write_text(
                f'from pathlib import Path\nPath({str(canary)!r}).touch()\n')
            helper = root / 'helper'
            helper.write_bytes(Path(m.__file__).read_bytes())
            helper.chmod(0o700)
            # This forces rejection before pins or any real operator CLI, even
            # if isolated startup regresses and the canary executes first.
            result = subprocess.run([str(helper)], env={
                'PATH': '/usr/bin:/bin', 'PYTHONPATH': scratch,
                'NODE_OPTIONS': 'startup-test-reject',
            }, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
            self.assertEqual(result.returncode, 1)
            self.assertFalse(canary.exists())
            self.assertEqual(result.stdout, b'')
            self.assertEqual(result.stderr, b'Native dev metadata unavailable\n')

    @staticmethod
    def process_identity(pid):
        result = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'uid=,lstart=,stat='],
                                stdout=subprocess.PIPE, text=True, timeout=2, check=True)
        return result.stdout.strip()

    def test_actual_owned_group_teardown_on_every_completion_path(self):
        with tempfile.TemporaryDirectory(prefix='metadata-group-') as scratch:
            root = Path(scratch)
            # Separate group and unreaped direct child: unrelated to every CLI.
            sentinel = subprocess.Popen([sys.executable, '-I', '-c', 'import time; time.sleep(60)'],
                                        start_new_session=True)
            try:
                sentinel_identity = self.process_identity(sentinel.pid)
                for mode in ('limit', 'timeout', 'closed', 'failure', 'normal'):
                    with self.subTest(mode=mode):
                        receipt = root / (mode + '.json')
                        descendant_code = (
                            'import json,os,subprocess,time\n'
                            'p=os.getpid()\n'
                            'identity=subprocess.check_output(["/bin/ps","-p",str(p),'
                            '"-o","uid=,lstart=,stat="],text=True).strip()\n'
                            f'with open({str(receipt) + ".tmp"!r},"w") as f: f.write(json.dumps([p,identity]))\n'
                            f'os.replace({str(receipt) + ".tmp"!r},{str(receipt)!r})\n'
                            'time.sleep(60)\n')
                        script = root / 'transport.py'
                        script.write_text(
                            'import os,subprocess,sys,time\n'
                            f'p=subprocess.Popen([sys.executable,"-I","-c",{descendant_code!r}],'
                            + ('stdout=subprocess.DEVNULL' if mode != 'timeout' else 'stdout=None') + ')\n'
                            f'while not os.path.exists({str(receipt)!r}): time.sleep(.01)\n'
                            + {'limit': 'os.write(1,b"x"*300000)\ntime.sleep(60)\n',
                               'timeout': 'os._exit(0)\n',
                               'closed': 'os.close(1)\ntime.sleep(60)\n',
                               'failure': 'sys.exit(1)\n',
                               'normal': 'print(\'{"valid":true}\')\n'}[mode])
                        started = time.monotonic()
                        try:
                            with patch.object(m, 'NODE', sys.executable), \
                                    patch.object(m, 'CLI', str(script)), patch.object(m, 'TIMEOUT', 2):
                                if mode == 'normal':
                                    self.assertEqual(m.cli_read(m.USER_PATH), {'valid': True})
                                else:
                                    message = {'limit': 'limit exceeded', 'timeout': 'timed out', 'closed': 'timed out',
                                               'failure': 'command failed'}[mode]
                                    with self.assertRaisesRegex(ValueError, message):
                                        m.cli_read(m.USER_PATH)
                            self.assertLess(time.monotonic() - started, 8)
                            pid, identity = json.loads(receipt.read_text())
                            deadline = time.monotonic() + 2
                            while time.monotonic() < deadline:
                                try:
                                    current = self.process_identity(pid)
                                except subprocess.CalledProcessError:
                                    break
                                if 'Z' in current.split()[-1]:
                                    break  # terminated, pending the OS orphan reaper
                                time.sleep(.02)
                            else:
                                self.fail('Owned descendant remained live after CLI completion')
                            self.assertEqual(self.process_identity(sentinel.pid).split()[:-1],
                                             sentinel_identity.split()[:-1])
                            self.assertIsNone(sentinel.poll())
                        finally:
                            # Failure cleanup only, exact recorded PID/start/UID.
                            if receipt.exists():
                                pid, identity = json.loads(receipt.read_text())
                                try:
                                    current = self.process_identity(pid)
                                    if current.split()[:-1] == identity.split()[:-1]:
                                        os.kill(pid, signal.SIGKILL)
                                except (ProcessLookupError, subprocess.CalledProcessError):
                                    pass
            finally:
                sentinel.kill()
                sentinel.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
