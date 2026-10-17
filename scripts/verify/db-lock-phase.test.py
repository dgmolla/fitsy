"""Real flock/descriptor and fixed-route regressions without Docker or approval writes."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SOURCE = Path(__file__).resolve().parent
NODE = '/opt/homebrew/bin/node'
PYTHON = '/Applications/Xcode.app/Contents/Developer/usr/bin/python3'


class PhaseLockTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix='fitsy-phase-flock-')).resolve()
        self.identity = self.root.stat()
        self.verify = self.root / 'scripts/verify'
        self.verify.mkdir(parents=True)
        self.lock = SOURCE / 'db-lock.py'
        self.env = {key: value for key, value in os.environ.items()
                    if not key.startswith('FITSY_VERIFY_') and key not in ('NODE_OPTIONS', 'NODE_PATH')}

    def tearDown(self):
        current = self.root.stat()
        self.assertEqual((current.st_dev, current.st_ino), (self.identity.st_dev, self.identity.st_ino))
        shutil.rmtree(self.root)

    def run_lock(self, command, env=None):
        return subprocess.run([PYTHON, '-I', str(self.lock), str(self.root), NODE, *command],
                              env=env or self.env, capture_output=True, text=True, timeout=10)

    def test_no_request_generic_command_remains_compatible(self):
        result = self.run_lock(['-e', 'console.log("legacy-compatible")'])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('legacy-compatible', result.stdout)

    def test_real_inherited_flock_passes_in_actual_fixed_launcher_child(self):
        local = self.verify / 'local-db.mjs'
        local.write_text("""import { spawnSync } from 'node:child_process';
const result = spawnSync(process.env.PHASE_TEST_PYTHON,
 ['-I', process.env.PHASE_TEST_LOCK, '--assert-phase-lock', process.cwd(), String(process.ppid)],
 { stdio: ['ignore', 'pipe', 'pipe', 3], encoding: 'utf8' });
process.stdout.write(JSON.stringify({status:result.status,error:result.stderr}));
process.exitCode=result.status ?? 1;
""")
        env = dict(self.env, PHASE_TEST_PYTHON=PYTHON, PHASE_TEST_LOCK=str(self.lock))
        # Ensure descriptor 3 is the actual inherited supervisor descriptor,
        # independent of the parent test runner's already-open file descriptors.
        wrapper = """import os,sys
os.chdir(sys.argv[1])
os.closerange(3,256)
os.execv(sys.argv[2],sys.argv[2:])
"""
        result = subprocess.run([PYTHON, '-I', '-c', wrapper, str(self.root), PYTHON, '-I',
                                 str(self.lock), str(self.root), NODE, str(local), '--locked-run'],
                                env=env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(json.loads(result.stdout)['status'], 0)
        self.assertEqual(self.run_lock(['-e', 'process.exit(0)']).returncode, 0)

    def test_forged_open_descriptor_is_not_an_already_held_lock(self):
        directory = self.root / '.evidence/verify'
        directory.mkdir(parents=True)
        fd = os.open(directory / 'db.lock', os.O_CREAT | os.O_RDWR, 0o600)
        try:
            result = subprocess.run([PYTHON, '-I', '-c',
                'import os,sys;os.dup2(int(sys.argv[1]),3);os.execv(sys.argv[2],sys.argv[2:])',
                str(fd), PYTHON, '-I', str(self.lock), '--assert-phase-lock', str(self.root), str(os.getpid())],
                pass_fds=(fd,), capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('not already holding', result.stderr)
        finally:
            os.close(fd)

    def test_busy_real_lock_refuses_without_launching_candidate(self):
        directory = self.root / '.evidence/verify'
        directory.mkdir(parents=True)
        fd = os.open(directory / 'db.lock', os.O_CREAT | os.O_RDWR, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_lock(['-e', 'console.log("must-not-execute")'])
            self.assertEqual(result.returncode, 75)
            self.assertEqual(result.stdout, '')
        finally:
            os.close(fd)

    def test_complete_forged_alternate_home_refuses_before_fixed_helper(self):
        local = self.verify / 'local-db.mjs'
        marker = self.root / 'executed'
        local.write_text(f'import fs from "node:fs";fs.writeFileSync({json.dumps(str(marker))},"bad");')
        (self.verify / 'resource-admission.mjs').write_text(local.read_text())
        binding = self.root / '.evidence/delivery'
        binding.mkdir(parents=True)
        (binding / 'binding.json').write_text('{"issue":463}')
        fake = self.root / 'fake-home'
        operators = fake / '.fitsy-review/operators'
        operators.mkdir(parents=True, mode=0o700)
        authority = operators / 'issue-463-phase-admission.json'
        authority.write_text(json.dumps({'version': 1, 'issue': 463, 'candidate_root': str(self.root),
                                        'source_sha': 'a' * 40, 'base_sha': 'b' * 40,
                                        'native_peak_bytes': 1606418432, 'cold_required_bytes': 5901385728}))
        authority.chmod(0o600)
        env = dict(self.env, HOME=str(fake), FITSY_VERIFY_DB_PHASE='1', FITSY_VERIFY_DB_LOCKED='1',
                   FITSY_SHIPPING_TOKEN='complete-plausible-token', FITSY_SHIPPING_SOCKET=str(fake / 'socket'),
                   FITSY_VERIFY_OWNED_DB='a' * 64, FITSY_VERIFY_DB_IMAGE='sha256:' + 'b' * 64,
                   FITSY_VERIFY_DB_HOST='127.0.0.1', POSTGRES_PRISMA_URL='postgresql://unused@127.0.0.1:1/forbidden',
                   POSTGRES_URL_NON_POOLING='postgresql://unused@127.0.0.1:1/forbidden')
        result = self.run_lock([str(local), '--locked-run'], env)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('noncanonical account HOME', result.stderr)
        self.assertFalse(marker.exists())


if __name__ == '__main__':
    unittest.main()
