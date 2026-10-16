"""Real fixed caller/lock/filesystem with explicitly synthetic account, session and OS/Docker.

Only disposable source copies replace account lookup and external observations.
Production has no fixture environment switch or alternate authority store.
No Docker daemon, installed approval, review provider or product is exercised.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import unittest


SOURCE = Path(__file__).resolve().parent
NODE = '/opt/homebrew/bin/node'
PYTHON = '/Applications/Xcode.app/Contents/Developer/usr/bin/python3'


class PhaseBoundaryTests(unittest.TestCase):
    def setUp(self):
        # Approval fixtures use private, nonsticky OS-temp ancestry, separately
        # from the command TMPDIR supplied by the real test launcher.
        secure = Path(subprocess.check_output(['getconf', 'DARWIN_USER_TEMP_DIR'], text=True).strip()).resolve()
        for parent in (secure, *secure.parents):
            self.assertEqual(parent.stat().st_mode & 0o022, 0)
            self.assertIn(parent.stat().st_uid, (0, os.getuid()))
        self.directory = Path(tempfile.mkdtemp(prefix='fitsy-phase-boundary-', dir=secure)).resolve()
        self.identity = self.directory.stat()
        self.root = self.directory / 'candidate'
        self.verify = self.root / 'scripts/verify'
        self.verify.mkdir(parents=True)
        self.packet = self.directory / 'packet'
        self.packet.mkdir(mode=0o700)
        self.account = self.directory / 'account'
        self.account.mkdir(mode=0o700)
        self.admin = self.account / '.fitsy-review'
        for path in (self.admin, self.admin / 'operators', self.admin / 'completed'):
            path.mkdir(mode=0o700)
        self.ledger = self.account / '.cache/fitsy-review/budgets/issue-463.jsonl'
        self.ledger.parent.mkdir(parents=True)
        self.ledger.write_text('{"retained_history":"synthetic"}\n')
        self.ledger.chmod(0o600)
        self.package = self.directory / 'package'
        self.package.mkdir()
        (self.package / 'marker').write_text('selected package fixture')
        self.git(self.package, 'init', '-q')
        self.commit(self.package)
        for name in ('local-db.mjs', 'impact-plan.mjs'):
            shutil.copyfile(SOURCE / name, self.verify / name)
        lock = (SOURCE / 'db-lock.py').read_text().replace(
            'account = Path(pwd.getpwuid(os.getuid()).pw_dir)',
            f'account = Path({str(self.account)!r})  # synthetic account in disposable COPY only')
        (self.verify / 'db-lock.py').write_text(lock)
        helper = (SOURCE / 'resource-admission.mjs').read_text().replace(
            'const account = userInfo();',
            f'const account = {{ homedir: {json.dumps(str(self.account))} }}; // disposable synthetic account')
        helper = helper.replace('return await admitOwnedDatabasePhase();',
                                'return await admitOwnedDatabasePhase({command: fixtureCommand, disk: () => ({bavail: 20*1024**3, bsize:1}), sleep: () => {}});')
        injection = r'''
let identityReads = 0;
function fixtureCommand(binary, args) {
  if (binary === '/usr/bin/vm_stat') return 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: ' + (process.env.FIXTURE_PAGES || 524288) + '.\nPages inactive: 0.\nPages speculative: 0.\n'.replaceAll('\\n','\n');
  if (binary === '/usr/sbin/sysctl') return args[0] === 'vm.swapusage'
    ? 'vm.swapusage: total = 0.00M used = 0.00M free = 0.00M'
    : 'kern.memorystatus_vm_pressure_level: ' + (process.env.FIXTURE_PRESSURE || '1');
  if (binary === '/bin/ps' && args.join(' ') === '-axo pid=,ppid=,lstart=,command=') {
    identityReads++;
    const guest = process.env.FIXTURE_CHANGED_GUEST && identityReads > 1 ? 900003 : 900002;
    return `900001 1 Fri Oct 16 00:00:00 2026 /Applications/Docker.app/Contents/MacOS/com.docker.backend\n${guest} 900001 Fri Oct 16 00:00:00 2026 /Applications/Docker.app/Contents/MacOS/com.docker.virtualization\n`.replaceAll('\\n','\n');
  }
  if (binary === '/bin/ps' && args.join(' ') === '-axo pid=,pgid=,command=') {
    // External capacity is synthetic, like the VM and pressure observations.
    // Real process ancestry and inherited flock assertions remain untouched.
    const group=execFileSync('/bin/ps',['-p',String(process.pid),'-o','pgid='],{encoding:'utf8'}).trim();
    const rows=execFileSync('/bin/ps',args,{encoding:'utf8'}).split('\n')
      .filter(line=>line.trim().split(/\s+/)[1]===group);
    if(process.env.FIXTURE_COMPETING_HEAVY) rows.push('900090 900090 node scripts/verify/run.mjs --layer=all');
    return rows.join('\n');
  }
  if (binary === '/usr/local/bin/docker') {
    if (!existsSync(join(process.env.FIXTURE_PACKET, `phase-intent-${process.ppid}.json`))) throw Error('Docker before atomic phase intent');
    return execFileSync(process.env.FIXTURE_DOCKER, args, {encoding:'utf8',env:{...process.env,FIXTURE_IN_HELPER:'1'}});
  }
  return execFileSync(binary, args, {encoding:'utf8',timeout:15000});
}
'''
        helper = helper.replace('if (process.argv[1] && resolve(process.argv[1]) === file)',
                                injection + '\nif (process.argv[1] && resolve(process.argv[1]) === file)')
        (self.verify / 'resource-admission.mjs').write_text(helper)
        shipping = self.verify / 'shipping-session.mjs'
        shipping.write_text("""#!/opt/homebrew/bin/node
import {spawnSync} from 'node:child_process';
if(process.argv[2]==='--check') process.exit(process.env.FIXTURE_DENY_SESSION ? 1 : 0);
const result=spawnSync(process.argv[3],process.argv.slice(4),{stdio:'inherit',env:process.env});
process.exitCode=result.status ?? 1;
""")
        shipping.chmod(0o700)
        (self.verify / 'run.mjs').write_text('''import fs from 'node:fs';
console.log('remaining canonical selection modeled');
if(process.env.FIXTURE_FORGE_REUSE) {
 const value=JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE,'utf8'));
 value.Config.Labels['fitsy.verify.owner']='unowned';
 fs.writeFileSync(process.env.FIXTURE_STATE,JSON.stringify(value));
}
if(process.env.FIXTURE_REPLACE_BETWEEN) {
 const value=JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE,'utf8'));
 value.Id='replacement-container'; value.Image='sha256:replacement';
 fs.writeFileSync(process.env.FIXTURE_STATE,JSON.stringify(value));
}
if(process.env.FIXTURE_HOLD) {
 fs.writeFileSync(process.env.FIXTURE_HOLD_READY,'owned child reached');
 setInterval(()=>{},1000);
}
''')
        for name in ('prisma/build/index.js', 'tsx/dist/cli.mjs'):
            path = self.root / 'node_modules' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('process.exit(0);\n')
        binding = self.root / '.evidence/delivery/binding.json'
        binding.parent.mkdir(parents=True)
        binding.write_text('{"issue":463}\n')
        (self.root / '.gitignore').write_text('.evidence\nnode_modules\n')
        self.git(self.root, 'init', '-q')
        self.commit(self.root)
        self.head = self.git(self.root, 'rev-parse', 'HEAD')
        self.git(self.root, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
        manifest = self.admin / 'completed/issue-463.json'
        manifest.write_text(json.dumps({'source_sha': self.head, 'base_sha': self.head, 'control_sha': 'a' * 40}))
        manifest.chmod(0o600)
        self.docker = self.directory / 'docker'
        self.docker.write_text('#!' + PYTHON + '\n' + r'''
import json,os,sys,hashlib
from pathlib import Path
args=sys.argv[1:];state=Path(os.environ['FIXTURE_STATE']);root=os.environ['FIXTURE_ROOT']
name='fitsy-verify-'+hashlib.sha256(root.encode()).hexdigest()[:16]
events=Path(os.environ['FIXTURE_EVENTS'])
with events.open('a') as stream:stream.write(json.dumps(args)+'\n')
if args[0]=='context':
 if os.environ.get('FIXTURE_DAEMON_FAIL'): print('synthetic daemon failure',file=sys.stderr);sys.exit(1)
 print('desktop-linux')
elif args[0]=='info': print('daemon-fixture|fixture-version|4294967296|2')
elif args[0]=='ps':
 if state.exists(): print(json.loads(state.read_text())['Id']+'|'+name+'|Up 1 second')
elif args[0]=='inspect':
 if not state.exists(): print('No such object',file=sys.stderr);sys.exit(1)
 value=json.loads(state.read_text())
 # Replacement retains every existing label, tag, loopback and effective limit.
 # Only this disposable Docker copy implements the adversarial change.
 if os.environ.get('FIXTURE_REPLACE_AFTER_READY') and not os.environ.get('FIXTURE_IN_HELPER') and len(list(Path(os.environ['FIXTURE_PACKET']).glob('phase-admission-*.json'))) == 2:
  value['Id']='replacement-container';value['Image']='sha256:replacement';state.write_text(json.dumps(value))
 print('['+json.dumps(value)+']')
elif args[0]=='run':
 state.write_text(json.dumps({'Id':'owned-container','Image':'sha256:fixture','Config':{'Image':'postgis/postgis:16-3.4','Labels':{'fitsy.verify.owner':name.removeprefix('fitsy-verify-')}},'State':{'Running':True},'HostConfig':{'Memory':805306368,'MemorySwap':1610612736,'NanoCpus':2000000000,'Binds':None},'Mounts':[],'NetworkSettings':{'Ports':{'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55432'}]}}}))
 print('owned-container')
elif args[0]=='exec':
 if os.environ.get('FIXTURE_REPLACE_AT_RESET') and 'psql' in args:
  value=json.loads(state.read_text());value['Id']='replacement-container';value['Image']='sha256:replacement';state.write_text(json.dumps(value))
 # Docker exec addresses immutable IDs; a removed ID cannot redirect to a name replacement.
 if args[1] != json.loads(state.read_text())['Id']:
  print('No such container: '+args[1],file=sys.stderr);sys.exit(1)
 if os.environ.get('FIXTURE_IMAGE_DURING_WAIT') and 'bash' in args:
  value=json.loads(state.read_text());value['Image']='sha256:replacement';state.write_text(json.dumps(value))
 if 'psql' in args:
  with Path(os.environ['FIXTURE_RESETS']).open('a') as stream:stream.write('reset\n')
elif args[0]=='rm': state.unlink()
else: sys.exit(1)
''')
        self.docker.chmod(0o700)
        task = self.packet / 'task.sh'
        task.write_text(f'''#!/bin/bash
set -eu
export FITSY_VERIFY_DB_PHASE=1
{PYTHON} {self.verify / 'db-lock.py'} {self.root} {NODE} {self.verify / 'local-db.mjs'} --locked-run
if [ "${{FIXTURE_TWICE:-}}" = 1 ]; then
  {PYTHON} {self.verify / 'db-lock.py'} {self.root} {NODE} {self.verify / 'local-db.mjs'} --locked-run
fi
''')
        launcher = self.packet / 'run.py'
        launcher.write_text(f'''import subprocess,sys
sys.exit(subprocess.call([{NODE!r},{str(shipping)!r},'--','/bin/bash',{str(task)!r}],cwd={str(self.root)!r}))
''')
        (self.packet / 'db_observation.py').write_text('# modeled external observations\n')
        files = [self.verify / name for name in ('db-lock.py', 'resource-admission.mjs', 'local-db.mjs')]
        files += [self.packet / name for name in ('run.py', 'task.sh', 'db_observation.py')]
        self.authority = self.admin / 'operators/issue-463-phase-admission.json'
        data = {'version': 1, 'issue': 463, 'candidate_root': str(self.root), 'source_sha': self.head,
                'base_sha': self.head, 'selected_package_path': str(self.package),
                'selected_package_sha': self.git(self.package, 'rev-parse', 'HEAD'),
                'completed_manifest_sha256': self.sha(manifest), 'review_ledger_sha256': self.sha(self.ledger),
                'review_control_sha': 'a' * 40, 'native_peak_bytes': 1606418432, 'cold_required_bytes': 5901385728,
                'receipt_directory': str(self.packet), 'execution_id': '12345678-1234-1234-1234-123456789abc',
                'files_sha256': {str(path): self.sha(path) for path in files}}
        self.authority.write_text(json.dumps(data))
        self.authority.chmod(0o600)
        self.env = {key: value for key, value in os.environ.items() if not key.startswith(('GIT_', 'FITSY_VERIFY_'))
                    and key not in ('NODE_OPTIONS', 'NODE_PATH')}
        self.env.update(HOME=str(self.account), PATH=str(self.directory) + ':' + self.env['PATH'],
                        FITSY_SHIPPING_SOCKET=str(self.directory / 'modeled-session.sock'),
                        FITSY_SHIPPING_TOKEN='explicitly-synthetic-session', FIXTURE_PACKET=str(self.packet),
                        FIXTURE_DOCKER=str(self.docker), FIXTURE_ROOT=str(self.root),
                        FIXTURE_STATE=str(self.directory / 'state.json'), FIXTURE_EVENTS=str(self.directory / 'events'),
                        FIXTURE_RESETS=str(self.directory / 'resets'))

    @staticmethod
    def sha(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def git(self, root, *args):
        return subprocess.check_output(['/Applications/Xcode.app/Contents/Developer/usr/bin/git', '-C', str(root),
                                        *args], text=True, stderr=subprocess.DEVNULL).strip()

    def commit(self, root):
        self.git(root, 'config', 'user.name', 'Phase fixture')
        self.git(root, 'config', 'user.email', 'phase@example.invalid')
        self.git(root, 'add', '.')
        self.git(root, 'commit', '-qm', 'fixture')

    def tearDown(self):
        current = self.directory.stat()
        self.assertEqual((current.st_dev, current.st_ino), (self.identity.st_dev, self.identity.st_ino))
        listing = subprocess.check_output(['/bin/ps', '-axo', 'pid=,command='], text=True)
        self.assertFalse(any(str(self.directory) in line for line in listing.splitlines()))
        shutil.rmtree(self.directory)

    def run_packet(self, **extra):
        return subprocess.run([PYTHON, str(self.packet / 'run.py')], cwd=self.root,
                              env=dict(self.env, **extra), capture_output=True, text=True, timeout=20)

    def no_docker_or_reset(self):
        self.assertFalse((self.directory / 'events').exists())
        self.assertFalse((self.directory / 'resets').exists())

    def test_valid_owned_path_and_same_session_second_invocation(self):
        result = self.run_packet(FIXTURE_TWICE='1')
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        receipts = sorted(self.packet.glob('phase-admission-*.json'))
        self.assertEqual(len(receipts), 2)
        phases = [json.loads(path.read_text()) for path in receipts]
        self.assertEqual({phase['readiness']['owned_db']['state'] for phase in phases}, {'absent', 'owned'})
        self.assertEqual(len((self.directory / 'resets').read_text().splitlines()), 2)
        for path, phase in zip(receipts, phases):
            acquired = self.packet / f"phase-acquisition-{phase['lock_pid']}.json"
            self.assertEqual(acquired.stat().st_mode & 0o777, 0o600)
            value = json.loads(acquired.read_text())
            self.assertEqual(value['admission_sha256'], self.sha(path))
            self.assertEqual(value['container'], {'id': 'owned-container', 'image_id': 'sha256:fixture'})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertTrue((self.packet / f"phase-intent-{phase['lock_pid']}.json").exists())

    def test_wrong_session_refuses_before_helper_or_docker(self):
        self.assertNotEqual(self.run_packet(FIXTURE_DENY_SESSION='1').returncode, 0)
        self.no_docker_or_reset()
        self.assertFalse(list(self.packet.glob('phase-intent-*.json')))

    def test_insufficient_capacity_refuses_without_docker_and_releases_lock(self):
        result = self.run_packet(FIXTURE_PAGES='340000')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('cold startup budget unavailable', result.stdout)
        self.no_docker_or_reset()
        self.assertEqual(self.run_packet().returncode, 0)

    def test_helper_failure_never_launches_database_child(self):
        result = self.run_packet(FIXTURE_DAEMON_FAIL='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.directory / 'resets').exists())
        self.assertTrue(list(self.packet.glob('phase-intent-*.json')))
        self.assertFalse(list(self.packet.glob('phase-admission-*.json')))

    def test_external_heavy_execution_refuses_before_docker(self):
        result = self.run_packet(FIXTURE_COMPETING_HEAVY='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('external heavy execution', result.stdout)
        self.no_docker_or_reset()

    def test_forged_reused_container_is_rejected_by_canonical_owned_assertion(self):
        result = self.run_packet(FIXTURE_TWICE='1', FIXTURE_FORGE_REUSE='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len((self.directory / 'resets').read_text().splitlines()), 1)
        self.assertIn('ownership or image', result.stdout)

    def test_complete_replacement_between_admission_and_reset_is_rejected(self):
        result = self.run_packet(FIXTURE_TWICE='1', FIXTURE_REPLACE_AFTER_READY='1')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertEqual(len((self.directory / 'resets').read_text().splitlines()), 1)

    def test_complete_replacement_between_same_session_invocations_is_rejected(self):
        result = self.run_packet(FIXTURE_TWICE='1', FIXTURE_REPLACE_BETWEEN='1')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertEqual(len((self.directory / 'resets').read_text().splitlines()), 1)

    def test_image_identity_changed_before_destructive_reset_is_rejected(self):
        result = self.run_packet(FIXTURE_IMAGE_DURING_WAIT='1')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertFalse((self.directory / 'resets').exists())

    def test_name_replacement_after_last_inspection_cannot_redirect_reset(self):
        result = self.run_packet(FIXTURE_REPLACE_AT_RESET='1')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertFalse((self.directory / 'resets').exists())
        events = [json.loads(line) for line in (self.directory / 'events').read_text().splitlines()]
        reset = next(args for args in events if args[0] == 'exec' and 'psql' in args)
        self.assertEqual(reset[1], 'owned-container')

    def test_actual_phase_cancellation_releases_detached_child_and_guardian(self):
        ready = self.directory / 'held-child-ready'
        environment = dict(self.env, FIXTURE_HOLD='1', FIXTURE_HOLD_READY=str(ready))
        stdout = (self.directory / 'cancel-child.stdout').open('w')
        stderr = (self.directory / 'cancel-child.stderr').open('w')
        child = subprocess.Popen([PYTHON, str(self.packet / 'run.py')], cwd=self.root,
                                 env=environment, stdout=stdout, stderr=stderr,
                                 start_new_session=True)
        groups = {child.pid}
        acquired = {child.pid: (child.pid, subprocess.check_output(
            ['/bin/ps', '-p', str(child.pid), '-o', 'lstart='], text=True).strip())}
        try:
            for _ in range(100):
                if ready.exists() or child.poll() is not None:
                    break
                time.sleep(0.05)
            self.assertTrue(ready.exists(), 'child rc=' + str(child.poll()) + '\n' +
                            (self.directory / 'cancel-child.stdout').read_text() + '\n' +
                            (self.directory / 'cancel-child.stderr').read_text())
            rows = []
            for line in subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,lstart='], text=True).splitlines():
                values = line.split(None, 3)
                if len(values) == 4:
                    rows.append([*map(int, values[:3]), values[3].strip()])
            descendants = {child.pid}
            for _ in range(20):
                previous = len(descendants)
                descendants.update(row[0] for row in rows if row[1] in descendants)
                if len(descendants) == previous:
                    break
            groups.update(row[2] for row in rows if row[0] in descendants)
            acquired = {row[0]: (row[2], row[3]) for row in rows if row[0] in descendants}
            self.assertGreater(len(groups), 1)
            os.killpg(child.pid, signal.SIGTERM)
            child.wait(timeout=5)
            for _ in range(100):
                live = {int(line.strip()) for line in subprocess.check_output(['/bin/ps', '-axo', 'pgid='], text=True).splitlines() if line.strip()}
                if not groups.intersection(live):
                    break
                time.sleep(0.05)
            self.assertFalse(groups.intersection(live))
        finally:
            # These groups were acquired from this fixture's actual descendant
            # tree, including the detached local-db worker and guardian.
            verified = set()
            for line in subprocess.check_output(['/bin/ps', '-axo', 'pid=,pgid=,lstart='], text=True).splitlines():
                values = line.strip().split(None, 2)
                if len(values) == 3 and acquired.get(int(values[0])) == (int(values[1]), values[2]):
                    verified.add(int(values[1]))
            for group in verified:
                try:
                    os.killpg(group, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            if child.poll() is None:
                child.wait(timeout=5)
            stdout.close()
            stderr.close()

    def test_warning_critical_and_unknown_pressure_refuse_before_docker(self):
        for pressure in ('2', '4', 'unknown'):
            result = self.run_packet(FIXTURE_PRESSURE=pressure)
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.no_docker_or_reset()

    def test_source_changed_refuses_before_docker(self):
        (self.root / 'changed').write_text('unreviewed source')
        self.assertNotEqual(self.run_packet().returncode, 0)
        self.no_docker_or_reset()

    def test_symlink_and_hardlink_authority_aliases_refuse(self):
        target = self.authority.with_name('synthetic-original.json')
        self.authority.rename(target)
        self.authority.symlink_to(target)
        self.assertNotEqual(self.run_packet().returncode, 0)
        self.no_docker_or_reset()
        self.authority.unlink()
        os.link(target, self.authority)
        self.assertNotEqual(self.run_packet().returncode, 0)
        self.no_docker_or_reset()


if __name__ == '__main__':
    unittest.main()
