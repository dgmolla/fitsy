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
import socket
import threading
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
        for name in ('local-db.mjs', 'local-db-control.mjs', 'impact-plan.mjs'):
            shutil.copyfile(SOURCE / name, self.verify / name)
        lock = (SOURCE / 'db-lock.py').read_text().replace(
            'account = Path(pwd.getpwuid(os.getuid()).pw_dir)',
            f'account = Path({str(self.account)!r})  # synthetic account in disposable COPY only')
        (self.verify / 'db-lock.py').write_text(lock)
        helper = (SOURCE / 'resource-admission.mjs').read_text().replace(
            'const account = userInfo();',
            f'const account = {{ homedir: {json.dumps(str(self.account))} }}; // disposable synthetic account')
        helper = helper.replace('return await admitOwnedDatabasePhase();',
                                'return await admitOwnedDatabasePhase({command: fixtureCommand, disk: () => ({bavail: fixtureSample.disk ?? 20*1024**3, bsize:1}), sleep: fixtureSleep});')
        injection = r'''
let identityReads = 0;
let fixtureElapsed = 0, fixtureHostReads = 0, fixtureSample = {};
const fixtureSamples = JSON.parse(process.env.FIXTURE_WARM_SAMPLES || '[]');
function fixtureSleep(ms) {
  if (!fixtureSamples.length) return;
  // Successful producer and consumer receipts share the real clock.
  // Only failure-only cutoff cases accelerate time in this disposable copy.
  if (fixtureSamples.length && fixtureHostReads >= 3 && ms > 1000) {
    const mode = process.env.FIXTURE_SETTLE_DRIFT;
    if (mode === 'deadline') fixtureElapsed += 60000;
    if (mode === 'socket') unlinkSync(process.env.FITSY_SHIPPING_SOCKET);
    if (mode === 'source') writeFileSync(join(process.cwd(),'drift'),'unreviewed');
    if (mode === 'authority') writeFileSync(process.env.FIXTURE_AUTHORITY, '\\n', {flag:'a'});
    if (mode === 'runtime') writeFileSync(join(process.env.FIXTURE_PACKET,'runtime-before-reader'),'changed');
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
}
const fixtureNow=Date.now;
Date.now=()=>fixtureNow()+fixtureElapsed+(existsSync(join(process.env.FIXTURE_PACKET,'startup-deadline-expired'))?60001:0);
function fixtureCommand(binary, args) {
  if (binary === '/usr/bin/vm_stat') {
    const deferred=join(process.env.FIXTURE_PACKET,'deferred-host.json');
    fixtureSample=existsSync(deferred) ? JSON.parse(readFileSync(deferred,'utf8'))
      : fixtureSamples[Math.min(fixtureHostReads++,fixtureSamples.length-1)] || {};
    if(process.env.FIXTURE_FINISH_DEADLINE && fixtureHostReads===3) writeFileSync(join(process.env.FIXTURE_PACKET,'warm-pair-complete'),'two samples');
    return 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: ' + (fixtureSample.pages ?? process.env.FIXTURE_PAGES ?? 524288) + '.\nPages inactive: 0.\nPages speculative: 0.\n'.replaceAll('\\n','\n');
  }
  if (binary === '/usr/sbin/sysctl') return args[0] === 'vm.swapusage'
    ? `vm.swapusage: total = 0.00M used = ${fixtureSample.swap ?? '0.00'}M free = 0.00M`
    : 'kern.memorystatus_vm_pressure_level: ' + (fixtureSample.pressure ?? process.env.FIXTURE_PRESSURE ?? '1');
  if (binary === '/bin/ps' && args.join(' ') === '-axo pid=,ppid=,lstart=,command=') {
    identityReads++;
    if(process.env.FIXTURE_INITIAL_RUNTIME==='unknown') return '900001 1 Fri Oct 16 00:00:00 2026 /Applications/Docker.app/Contents/MacOS/com.docker.backend\n900002 999999 Fri Oct 16 00:00:00 2026 /Applications/Docker.app/Contents/MacOS/com.docker.virtualization\n';
    const transition=existsSync(join(process.env.FIXTURE_PACKET,'helper-runtime-transition'));
    const coldAbsent=process.env.FIXTURE_COLD_START && !existsSync(join(process.env.FIXTURE_PACKET,'cold-guest-started'));
    if(coldAbsent || (transition && process.env.FIXTURE_HELPER_RUNTIME==='guest-absent')) {
      // Only this disposable helper copy expires the original bounded startup wait.
      if(transition) Date.now=()=>5000000000000;
      return '900001 1 Fri Oct 16 00:00:00 2026 /Applications/Docker.app/Contents/MacOS/com.docker.backend\n';
    }
    const ready=existsSync(join(process.env.FIXTURE_PACKET, `phase-admission-${process.ppid}.json`));
    const moved=process.env.FIXTURE_RUNTIME_AFTER_READY && (ready || process.env.FIXTURE_RUNTIME_AT_STOP);
    const during=(process.env.FIXTURE_RUNTIME_DURING_WAIT && existsSync(join(process.env.FIXTURE_PACKET,'runtime-after-wait'))) || existsSync(join(process.env.FIXTURE_PACKET,'runtime-before-reader'));
    if(moved && process.env.FIXTURE_RUNTIME_AFTER_READY==='guest-absent') return '900001 1 Fri Oct 16 00:00:00 2026 /Applications/Docker.app/Contents/MacOS/com.docker.backend\n';
    const backend=(moved && process.env.FIXTURE_RUNTIME_AFTER_READY==='backend-replaced') || (transition && process.env.FIXTURE_HELPER_RUNTIME==='backend-replaced') ? 900009 : 900001;
    const guest = moved || during || transition || (process.env.FIXTURE_CHANGED_GUEST && identityReads > 1) ? 900003 : 900002;
    return `${backend} 1 Fri Oct 16 00:00:00 2026 /Applications/Docker.app/Contents/MacOS/com.docker.backend\n${guest} ${backend} Fri Oct 16 00:00:00 2026 /Applications/Docker.app/Contents/MacOS/com.docker.virtualization\n`.replaceAll('\\n','\n');
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
    try { return execFileSync(process.env.FIXTURE_DOCKER, args, {encoding:'utf8',env:{...process.env,FIXTURE_IN_HELPER:'1'}}); }
    finally {
      if(args[0]==='ps') fixtureElapsed+=Number(process.env.FIXTURE_READINESS_ELAPSED || 0);
      writeFileSync(join(process.env.FIXTURE_PACKET,'api-completions'), JSON.stringify({args,completed_at:Date.now()/1000})+'\n',{flag:'a'}); }
  }
  return execFileSync(binary, args, {encoding:'utf8',timeout:15000});
}
'''
        helper = helper.replace('if (process.argv[1] && resolve(process.argv[1]) === file)',
                                injection + '\nif (process.argv[1] && resolve(process.argv[1]) === file)')
        helper = helper.replace('existsSync, statfsSync', 'existsSync, unlinkSync, statfsSync')
        (self.verify / 'resource-admission.mjs').write_text(helper)
        runtime = (SOURCE / 'docker-runtime.mjs').read_text()
        runtime = runtime.replace("export function assertAdmittedDockerGuest(expected, command = (binary, args) => execFileSync(binary, args,\n  { encoding: 'utf8', timeout: 15000 }))",
                                  "export function assertAdmittedDockerGuest(expected, command = fixtureCommand)")
        # Retain only the host-query fixture body; no production runtime switch.
        runtime_fixture = injection.replace("let identityReads = 0;", "let identityReads = 0;")
        runtime = "import { existsSync, readFileSync } from 'node:fs';\nimport { join } from 'node:path';\n" + runtime + runtime_fixture
        (self.verify / 'docker-runtime.mjs').write_text(runtime)
        shipping = self.verify / 'shipping-session.mjs'
        shipping.write_text("""#!/opt/homebrew/bin/node
import {spawnSync} from 'node:child_process';
if(process.argv[2]==='--check') {
 if(process.env.FIXTURE_FINISH_DEADLINE) {
  const fs=await import('node:fs');
  if(fs.existsSync(process.env.FIXTURE_PACKET+'/warm-pair-complete'))
   fs.writeFileSync(process.env.FIXTURE_PACKET+'/startup-deadline-expired','cutoff during final live assertion');
 }
 if(process.env.FIXTURE_DENY_SESSION) process.exit(1);
 if(!process.env.FIXTURE_REAL_SOCKET) process.exit(0);
 const {connect}=await import('node:net');
 const client=connect(process.env.FITSY_SHIPPING_SOCKET);
 client.setTimeout(1000,()=>process.exit(1));
 client.on('error',()=>process.exit(1));
 client.on('connect',()=>client.write(process.env.FITSY_SHIPPING_TOKEN));
 client.on('data',data=>process.exit(data.toString()==='valid' ? 0 : 1));
} else {
const result=spawnSync(process.argv[3],process.argv.slice(4),{stdio:'inherit',env:process.env});
process.exitCode=result.status ?? 1;
}
""")
        shipping.chmod(0o700)
        (self.verify / 'run.mjs').write_text('''import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
export async function verify(_args, prepare) {
Object.assign(process.env, prepare());
console.log('remaining canonical selection modeled');
if(process.env.FIXTURE_ASSERT_READER) {
 if(process.env.FIXTURE_READER_REPLACEMENT) {
  const value=JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE,'utf8'));
  value.Id='complete-same-owner-replacement';value.Image='sha256:complete-replacement';
  fs.writeFileSync(process.env.FIXTURE_STATE,JSON.stringify(value));
  process.env.FITSY_VERIFY_OWNED_DB=value.Id;process.env.FITSY_VERIFY_DB_IMAGE=value.Image;
 }
 if(process.env.FIXTURE_LIMIT_STAGE==='reader') {
  const value=JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE,'utf8'));
  const [field,kind]=process.env.FIXTURE_LIMIT_CASE.split(':');
  if(kind==='missing') delete value.HostConfig[field];
  else value.HostConfig[field]=kind==='malformed' ? 'unlimited' : 0;
  fs.writeFileSync(process.env.FIXTURE_STATE,JSON.stringify(value));
 }
 if(process.env.FIXTURE_RUNTIME_BEFORE_READER) fs.writeFileSync(process.env.FIXTURE_PACKET+'/runtime-before-reader','changed guest');
 const local=process.env.FIXTURE_EVENTS+'.local';
 const before=fs.existsSync(local)?fs.readFileSync(local,'utf8'):'';
 const result=spawnSync(process.execPath,['scripts/verify/local-db.mjs','--assert-owned-db'],{cwd:process.cwd(),env:process.env,encoding:'utf8'});
 const after=fs.existsSync(local)?fs.readFileSync(local,'utf8'):'';
 fs.writeFileSync(process.env.FIXTURE_PACKET+'/reader-proof.json',JSON.stringify({returncode:result.status,before,after,stderr:result.stderr}));
 process.exit(result.status ?? 1);
}
if(process.env.FIXTURE_LIMIT_STAGE==='reuse') {
 const value=JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE,'utf8'));
 const [field,kind]=process.env.FIXTURE_LIMIT_CASE.split(':');
 if(kind==='missing') delete value.HostConfig[field];
 else value.HostConfig[field]=kind==='malformed'?'unlimited':0;
 fs.writeFileSync(process.env.FIXTURE_STATE,JSON.stringify(value));
}
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
return 0;
}
''')
        for name in ('prisma/build/index.js', 'tsx/dist/cli.mjs'):
            path = self.root / 'node_modules' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('''import fs from 'node:fs';
const stage=process.argv.some(arg=>arg==='migrate')?'migrate':'seed';
fs.appendFileSync(process.env.FIXTURE_PACKET+'/children',stage+'\\n');
if(process.env.FIXTURE_LIMIT_STAGE===(stage==='migrate'?'seed':'selection')) {
 const value=JSON.parse(fs.readFileSync(process.env.FIXTURE_STATE,'utf8'));
 const [field,kind]=process.env.FIXTURE_LIMIT_CASE.split(':');
 if(kind==='missing') delete value.HostConfig[field];
 else value.HostConfig[field]=kind==='malformed'?'unlimited':0;
 fs.writeFileSync(process.env.FIXTURE_STATE,JSON.stringify(value));
}
''')
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
packet=Path(os.environ['FIXTURE_PACKET']);transition=packet/'helper-runtime-transition'
if os.environ.get('FIXTURE_IN_HELPER') and transition.exists():
 with (packet/'changed-runtime-api').open('a') as stream:stream.write(json.dumps(args)+'\n')
if os.environ.get('FIXTURE_IN_HELPER') and args[0]==os.environ.get('FIXTURE_HELPER_CHANGE_AFTER'):
 transition.write_text('the observed live runtime changes after this API')
with events.open('a') as stream:stream.write(json.dumps(args)+'\n')
if not os.environ.get('FIXTURE_IN_HELPER'):
 with Path(str(events)+'.local').open('a') as stream:stream.write(json.dumps(args)+'\n')
if args[0]=='context':
 if os.environ.get('FIXTURE_DAEMON_FAIL'): print('synthetic daemon failure',file=sys.stderr);sys.exit(1)
 print('desktop-linux')
elif args[0]=='info':
 mode=os.environ.get('FIXTURE_INFO_ERROR')
 counter=packet/'info-attempt-count';count=int(counter.read_text())+1 if counter.exists() else 1
 counter.write_text(str(count))
 if mode and (mode!='transient-once' or count==1):
  errors={'transient-once':'Cannot connect to the Docker daemon at unix:///fixture/docker.sock. Is the docker daemon running?',
          'persistent':'Cannot connect to the Docker daemon at unix:///fixture/docker.sock. Is the docker daemon running?',
          'authentication':'unauthorized: authentication required',
          'policy':'authorization denied by policy: Cannot connect to the Docker daemon',
          'unknown':'unexpected daemon failure with unknown cause'}
  if mode=='persistent' and count==2: (packet/'startup-deadline-expired').write_text('same bounded startup expired')
  print(errors[mode],file=sys.stderr);sys.exit(1)
 daemon='startup-daemon' if os.environ.get('FIXTURE_COLD_START') and not (packet/'cold-guest-started').exists() else 'daemon-fixture'
 print(daemon+'|fixture-version|4294967296|2')
elif args[0]=='ps':
 if os.environ.get('FIXTURE_COLD_START'): (packet/'cold-guest-started').write_text('guest appears after startup inventory')
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
 if os.environ.get('FIXTURE_RUNTIME_DURING_WAIT') and 'bash' in args:
  (Path(os.environ['FIXTURE_PACKET'])/'runtime-after-wait').write_text('guest900003, unchanged container identity')
 if os.environ.get('FIXTURE_IMAGE_DURING_WAIT') and 'bash' in args:
  value=json.loads(state.read_text());value['Image']='sha256:replacement';state.write_text(json.dumps(value))
 if 'psql' in args:
  if os.environ.get('FIXTURE_LIMIT_STAGE')=='migrate':
   value=json.loads(state.read_text());field,kind=os.environ['FIXTURE_LIMIT_CASE'].split(':')
   if kind=='missing': value['HostConfig'].pop(field,None)
   else: value['HostConfig'][field]='unlimited' if kind=='malformed' else 0
   state.write_text(json.dumps(value))
  with Path(os.environ['FIXTURE_RESETS']).open('a') as stream:stream.write('reset\n')
elif args[0]=='rm':
 if args[-1] != json.loads(state.read_text())['Id']:
  print('No such container: '+args[-1],file=sys.stderr);sys.exit(1)
 state.unlink()
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
        files = [self.verify / name for name in ('db-lock.py', 'resource-admission.mjs', 'local-db.mjs', 'local-db-control.mjs', 'docker-runtime.mjs')]
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
                        FIXTURE_RESETS=str(self.directory / 'resets'), FIXTURE_AUTHORITY=str(self.authority))

    def use_real_deferred_pipeline(self):
        # Only external checks and host/Docker observations are modeled.
        # The actual runner, lock, CLI and preparation callback remain intact.
        for name in ('run.mjs', 'receipt-cache.mjs'):
            shutil.copyfile(SOURCE / name, self.verify / name)
            self.assertEqual(self.sha(self.verify / name), self.sha(SOURCE / name))
        (self.root / 'node_modules/js-yaml').symlink_to(SOURCE.parents[1] / 'node_modules/js-yaml')
        (self.verify / 'registry.yml').write_text('''checks:
  - name: structural
    script: cheap.sh
    layer: 0
    blocking: true
  - name: review-admission
    script: review.sh
    layer: 0
    stage: acceptance
    preflight: true
    blocking: true
    runs: [local]
  - name: build
    script: build.sh
    layer: 3
    blocking: true
    runs: [local]
  - name: test
    script: database.sh
    layer: 2
    database: true
    blocking: true
    runs: [local]
''')
        (self.root / '.evidence/check.mjs').write_text('''import fs from 'node:fs';
const check=process.argv[2], packet=process.env.FIXTURE_PACKET;
const record={check,owned:process.env.FITSY_VERIFY_OWNED_DB ?? null,
  pooled:process.env.POSTGRES_PRISMA_URL ?? null,
  direct:process.env.POSTGRES_URL_NON_POOLING ?? null};
fs.appendFileSync(packet+'/pipeline',JSON.stringify(record)+'\\n');
if(check==='build') {
  if(record.owned || record.pooled || record.direct) throw Error('build acquired database early');
  fs.writeFileSync(packet+'/deferred-host.json',process.env.FIXTURE_DEFERRED_HOST || '{}');
}
if(check==='database') {
  const url='postgresql://fitsy_test:fitsy_test@127.0.0.1:55432/fitsy_verify';
  if(record.owned!=='owned-container' || record.pooled!==url || record.direct!==url ||
      !fs.existsSync(process.env.FIXTURE_RESETS) ||
      fs.readFileSync(packet+'/children','utf8')!=='migrate\\nseed\\n') {
    throw Error('database check did not receive fresh prepared environment');
  }
}
console.log(JSON.stringify({summary:check+' executed'}));
''')
        for script, check in (('cheap.sh', 'cheap'), ('review.sh', 'review'),
                              ('build.sh', 'build'), ('database.sh', 'database')):
            (self.verify / script).write_text(f'#!/bin/bash\n{NODE} .evidence/check.mjs {check}\n')
        task = self.packet / 'task.sh'
        task.write_text(task.read_text().replace(' --locked-run',
                        ' --locked-run --layer=all --scope=all --runs=local'))
        self.commit(self.root)
        self.head = self.git(self.root, 'rev-parse', 'HEAD')
        self.git(self.root, 'update-ref', 'refs/remotes/origin/main', self.head)
        manifest = self.admin / 'completed/issue-463.json'
        manifest.write_text(json.dumps({'source_sha': self.head, 'base_sha': self.head,
                                        'control_sha': 'a' * 40}))
        authority = json.loads(self.authority.read_text())
        authority.update(source_sha=self.head, base_sha=self.head,
                         completed_manifest_sha256=self.sha(manifest))
        authority['files_sha256'] = {name: self.sha(Path(name))
                                     for name in authority['files_sha256']}
        self.authority.write_text(json.dumps(authority))

    def deferred_pipeline(self, host):
        self.use_real_deferred_pipeline()
        result = self.run_packet(FIXTURE_DEFERRED_HOST=json.dumps(host))
        pipeline = [json.loads(line) for line in (self.packet / 'pipeline').read_text().splitlines()]
        checks = [event['check'] for event in pipeline]
        self.assertEqual(checks[:3], ['cheap', 'review', 'build'], result.stdout + result.stderr)
        for check in ('cheap', 'review', 'build'):
            self.assertEqual(checks.count(check), 1, result.stdout + result.stderr)
        self.assertTrue(all(event['owned'] is None for event in pipeline[:3]))
        self.assertEqual(json.loads((self.packet / 'deferred-host.json').read_text()), host)
        self.assertEqual(len(list(self.packet.glob('phase-admission-*.json'))), 1)
        return result, pipeline

    def assert_deferred_host_refusal(self, host):
        result, pipeline = self.deferred_pipeline(host)
        local = Path(str(self.env['FIXTURE_EVENTS']) + '.local')
        self.assertFalse(local.exists(), 'database Docker operations followed post-build host drift: ' +
                         (local.read_text() if local.exists() else '') + result.stdout + result.stderr)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([event['check'] for event in pipeline], ['cheap', 'review', 'build'])
        self.assertFalse((self.directory / 'resets').exists())
        self.assertFalse((self.directory / 'state.json').exists())
        self.assertFalse((self.packet / 'children').exists())
        self.assertFalse(list(self.packet.glob('phase-acquisition-*.json')))
        self.assertEqual(self.git(self.root, 'status', '--porcelain', '--untracked-files=all'), '')

    def test_deferred_build_capacity_drop_refuses_before_database(self):
        # 5.34 GiB stays above the 4.25 GiB stop but below peak plus 4 GiB reserve.
        self.assert_deferred_host_refusal({'pages': 350000})

    def test_deferred_build_pressure_change_refuses_before_database(self):
        self.assert_deferred_host_refusal({'pressure': 2})

    def test_deferred_build_swap_change_refuses_before_database(self):
        self.assert_deferred_host_refusal({'swap': 1})

    def test_deferred_build_disk_drop_refuses_before_database(self):
        self.assert_deferred_host_refusal({'disk': 12 * 1024 ** 3 - 1})

    def test_deferred_build_valid_capacity_prepares_and_checks_once(self):
        result, pipeline = self.deferred_pipeline({})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([event['check'] for event in pipeline], ['cheap', 'review', 'build', 'database'])
        self.assertEqual(pipeline[-1]['owned'], 'owned-container')
        self.assertEqual((self.directory / 'resets').read_text().splitlines(), ['reset'])
        self.assertEqual((self.packet / 'children').read_text().splitlines(), ['migrate', 'seed'])
        acquired = list(self.packet.glob('phase-acquisition-*.json'))
        self.assertEqual(len(acquired), 1)
        phase = next(self.packet.glob('phase-admission-*.json'))
        self.assertEqual(json.loads(acquired[0].read_text())['admission_sha256'], self.sha(phase))
        self.assertEqual(self.git(self.root, 'status', '--porcelain', '--untracked-files=all'), '')

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
        # A short checked command scratch supports a real socket and hook;
        # private approval custody remains in separate secure OS-temp ancestry.
        raw = tempfile.mkdtemp(prefix='fp-', dir='/private/tmp')
        scratch = Path(raw)
        try:
            identity = scratch.stat()
            self.assertEqual(identity.st_mode & 0o777, 0o700)
            hook = scratch / 'h'
            hook.write_text('#!/bin/sh\nexit 0\n')
            hook.chmod(0o700)
            self.assertEqual(subprocess.call([str(hook)]), 0)
            address = str(scratch / 's')
            done = threading.Event()
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
                server.bind(address)
                server.listen()
                server.settimeout(.1)
                def serve():
                    while not done.is_set():
                        try:
                            connection, _ = server.accept()
                            with connection:
                                token = connection.recv(256).decode()
                                connection.sendall(b'valid' if token == self.env['FITSY_SHIPPING_TOKEN'] else b'invalid')
                        except socket.timeout:
                            continue
                worker = threading.Thread(target=serve)
                worker.start()
                try:
                    environment = dict(self.env, **extra, FITSY_SHIPPING_SOCKET=address, FIXTURE_REAL_SOCKET='1')
                    result = subprocess.run([PYTHON, str(self.packet / 'run.py')], cwd=self.root,
                                            env=environment, capture_output=True, text=True, timeout=20)
                finally:
                    done.set()
                    worker.join(timeout=2)
                    self.assertFalse(worker.is_alive())
        finally:
            self.assertEqual((scratch.stat().st_dev, scratch.stat().st_ino, scratch.stat().st_uid, scratch.stat().st_mode & 0o777), (identity.st_dev, identity.st_ino, os.getuid(), 0o700))
            shutil.rmtree(scratch)
        evidence = os.environ.get('FITSY_PHASE_TEST_EVIDENCE')
        if evidence:
            destination = Path(evidence) / (self._testMethodName + '-' + str(time.time_ns()))
            destination.mkdir(mode=0o700)
            (destination / 'stdout').write_text(result.stdout)
            (destination / 'stderr').write_text(result.stderr)
            for path in (*self.packet.iterdir(), self.directory / 'events',
                         self.directory / 'events.local', self.directory / 'resets',
                         self.directory / 'state.json'):
                if path.is_file(): shutil.copyfile(path, destination / path.name)
            (destination / 'command.json').write_text(json.dumps({'argv':[PYTHON,str(self.packet/'run.py')],
                'cwd':str(self.root),'modeled_external_capacity':extra,'socket_scratch':raw,
                'socket_hook_released':not scratch.exists(),'returncode':result.returncode}))
        return result

    def no_docker_or_reset(self):
        self.assertFalse((self.directory / 'events').exists())
        self.assertFalse((self.directory / 'resets').exists())

    def warm_packet(self, samples, **extra):
        return self.run_packet(FIXTURE_WARM_SAMPLES=json.dumps(samples), **extra)

    def test_transient_warm_capacity_settles_without_repeating_docker(self):
        result = self.warm_packet([{}, {'pages':350000}, {}, {}, {}], FIXTURE_ASSERT_READER='1')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        ready = json.loads(next(self.packet.glob('phase-admission-*.json')).read_text())
        self.assertEqual(len(ready['warm_observations']), 2)
        self.assertEqual(ready['warm_observations'][0]['first']['available_memory_bytes'], 350000*16384)
        operations = [json.loads(line) for line in (self.packet/'api-completions').read_text().splitlines()]
        self.assertEqual([row['args'][0] for row in operations], ['context','info','inspect','ps'])
        self.assertGreaterEqual(ready['last_docker_activity_at'], operations[-1]['completed_at'])
        self.assertLessEqual(ready['last_docker_activity_at'], ready['warm_observations'][0]['first']['at']/1000)
        self.assertEqual(len((self.directory/'resets').read_text().splitlines()), 1)
        self.assertEqual(json.loads((self.packet/'reader-proof.json').read_text())['returncode'], 0)

    def test_capacity_settle_deadline_retains_failed_samples_and_last_api(self):
        result = self.warm_packet([{}, {'pages':350000}], FIXTURE_SETTLE_DRIFT='deadline')
        self.assertNotEqual(result.returncode, 0)
        refused = json.loads(result.stdout.splitlines()[-1])
        self.assertIn('native peak plus host reserve', refused['reason'])
        self.assertEqual(len(refused['warm_observations']), 1)
        self.assertEqual(refused['warm_observations'][0]['first']['available_memory_bytes'],350000*16384)
        completed=json.loads((self.packet/'api-completions').read_text().splitlines()[-1])['completed_at']
        self.assertGreaterEqual(refused['last_docker_activity_at'], completed)
        self.assertFalse((self.directory/'resets').exists())
        self.assertFalse(list(self.packet.glob('phase-admission-*.json')))

    def test_permanent_warm_shortage_uses_only_remaining_startup_window(self):
        result = self.warm_packet([{}, {'pages':350000}], FIXTURE_READINESS_ELAPSED='55000')
        self.assertNotEqual(result.returncode, 0)
        refused = json.loads(result.stdout.splitlines()[-1])
        self.assertIn('native peak plus host reserve', refused['reason'])
        self.assertLessEqual(len(refused['warm_observations']), 2)
        self.assertFalse((self.directory/'resets').exists())
        operations = (self.packet/'api-completions').read_text().splitlines()
        self.assertEqual(len(operations), 4)

    def test_cold_cutoff_during_final_live_assertion_cannot_publish(self):
        result = self.warm_packet([{}], FIXTURE_FINISH_DEADLINE='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(list(self.packet.glob('phase-admission-*.json')))
        self.assertFalse((self.directory/'resets').exists())
        refused=json.loads(result.stdout.splitlines()[-1])
        self.assertIn('deadline expired',refused['reason'])

    def test_exact_warm_shortage_has_no_settle_retry(self):
        authority = json.loads(self.authority.read_text())
        authority['cold_required_bytes'] += 2*1024**3
        self.authority.write_text(json.dumps(authority))
        result = self.warm_packet([{'pages':380000}, {'pages':350000}, {}, {}, {}])
        self.assertNotEqual(result.returncode, 0)
        refused = json.loads(result.stdout.splitlines()[-1])
        self.assertEqual(len(refused['warm_observations']), 1)
        self.assertFalse((self.directory/'resets').exists())

    def settle_drift_case(self):
        # Separate fixtures keep each immutable authority and source independent.
        result = self.warm_packet([{}, {'pages':350000}, {}, {}, {}],
                                  FIXTURE_SETTLE_DRIFT=self.drift_case)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertFalse((self.directory/'resets').exists())
        self.assertFalse(list(self.packet.glob('phase-admission-*.json')))
        refused = json.loads(result.stdout.splitlines()[-1])
        self.assertEqual(len(refused['warm_observations']), 1)

    def second_fixed_case(self):
        failure = self.fixed_case
        result = self.warm_packet([{}, {'pages':350000}, failure, {}, {}])
        self.assertNotEqual(result.returncode, 0, result.stdout)
        refused = json.loads(result.stdout.splitlines()[-1])
        self.assertNotIn('native peak plus host reserve', refused['reason'])
        self.assertEqual(len(refused['warm_observations']), 1)
        self.assertFalse((self.directory/'resets').exists())

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


    def test_sufficient_cold_budget_does_not_disable_observed_runtime_custody(self):
        result = self.run_packet(FIXTURE_HELPER_CHANGE_AFTER='context', FIXTURE_HELPER_RUNTIME='guest-replaced')
        self.assertFalse((self.packet / 'changed-runtime-api').exists(), result.stdout + result.stderr)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(list(self.packet.glob('phase-admission-*.json')))
        self.assertFalse((self.directory / 'resets').exists())

    def test_sufficient_cold_budget_absent_guest_refuses_before_next_api(self):
        result = self.run_packet(FIXTURE_HELPER_CHANGE_AFTER='info', FIXTURE_HELPER_RUNTIME='guest-absent')
        self.assertFalse((self.packet / 'changed-runtime-api').exists(), result.stdout + result.stderr)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(list(self.packet.glob('phase-admission-*.json')))
        self.assertFalse((self.directory / 'resets').exists())

    def test_absent_guest_cold_start_requires_fresh_runtime_bound_readiness_set(self):
        result = self.run_packet(FIXTURE_COLD_START='1')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        ready = json.loads(next(self.packet.glob('phase-admission-*.json')).read_text())
        self.assertEqual(ready['readiness']['daemon']['id'], 'daemon-fixture')
        self.assertTrue(ready['startup_observations'])
        preliminary = ready['startup_observations'][0]
        self.assertEqual(preliminary['state'], 'preliminary')
        self.assertEqual(preliminary['daemon']['id'], 'startup-daemon')
        self.assertEqual([value['operation'] for value in preliminary['operations']],
                         ['context', 'info', 'inspect', 'ps'])
        self.assertEqual(preliminary['operations'][2]['result'], 'failed')
        events = [json.loads(line)[0] for line in (self.directory / 'events').read_text().splitlines()]
        self.assertEqual(events[:8], ['context','info','inspect','ps'] * 2)
        self.assertEqual(len((self.directory / 'resets').read_text().splitlines()), 1)

    def test_exact_warm_budget_valid_and_absent_guest_refusal(self):
        authority = json.loads(self.authority.read_text())
        # A larger declared synthetic cold startup allowance creates the actual
        # supported warm-only interval without changing any production guard.
        authority['cold_required_bytes'] += 512 * 1024**2
        self.authority.write_text(json.dumps(authority))
        result = self.run_packet(FIXTURE_PAGES='380000', FIXTURE_COLD_START='1')
        self.assertNotEqual(result.returncode, 0)
        self.no_docker_or_reset()
        result = self.run_packet(FIXTURE_PAGES='380000')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        ready = json.loads(next(self.packet.glob('phase-admission-*.json')).read_text())
        self.assertEqual(ready['startup_observations'], [])
        self.assertEqual(ready['readiness']['identity']['guest']['pid'], 900002)

    def test_unknown_and_initially_changing_runtime_refuse_before_docker(self):
        for options in ({'FIXTURE_INITIAL_RUNTIME': 'unknown'}, {'FIXTURE_CHANGED_GUEST': '1'}):
            result = self.run_packet(**options)
            self.assertNotEqual(result.returncode, 0)
            self.no_docker_or_reset()
            self.assertFalse(list(self.packet.glob('phase-admission-*.json')))


    def test_absent_guest_transient_info_failure_recovers_with_failed_preliminary_evidence(self):
        result = self.run_packet(FIXTURE_COLD_START='1', FIXTURE_INFO_ERROR='transient-once')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        ready = json.loads(next(self.packet.glob('phase-admission-*.json')).read_text())
        first = ready['startup_observations'][0]
        self.assertEqual(first['operations'][-1]['operation'], 'info')
        self.assertEqual(first['operations'][-1]['result'], 'failed')
        self.assertEqual(first['operations'][-1]['failure_kind'], 'connection-not-ready')
        self.assertEqual(ready['readiness']['daemon']['id'], 'daemon-fixture')
        self.assertGreaterEqual(int((self.packet / 'info-attempt-count').read_text()), 3)
        self.assertEqual(len((self.directory / 'resets').read_text().splitlines()), 1)

    def test_persistent_cold_start_connection_failure_stops_at_original_deadline(self):
        result = self.run_packet(FIXTURE_COLD_START='1', FIXTURE_INFO_ERROR='persistent')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(int((self.packet / 'info-attempt-count').read_text()), 2)
        self.assertFalse(list(self.packet.glob('phase-admission-*.json')))
        self.assertFalse((self.directory / 'resets').exists())
        refused = json.loads(result.stdout.splitlines()[-1])
        self.assertEqual(len(refused['startup_observations']), 2)

    def test_cold_start_policy_authentication_and_unknown_failures_are_not_retried(self):
        for mode in ('authentication', 'policy', 'unknown'):
            counter = self.packet / 'info-attempt-count'
            before = int(counter.read_text()) if counter.exists() else 0
            result = self.run_packet(FIXTURE_COLD_START='1', FIXTURE_INFO_ERROR=mode)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(int(counter.read_text()), before + 1)
            self.assertFalse(list(self.packet.glob('phase-admission-*.json')))
            self.assertFalse((self.directory / 'resets').exists())

    def test_observed_live_guest_connection_failure_does_not_gain_startup_retry(self):
        result = self.run_packet(FIXTURE_INFO_ERROR='transient-once')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(int((self.packet / 'info-attempt-count').read_text()), 1)
        self.assertFalse(list(self.packet.glob('phase-admission-*.json')))
        self.assertFalse((self.directory / 'resets').exists())

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

    def test_post_session_stop_rejects_replaced_and_unowned_then_releases_actual_acquisition(self):
        result = self.run_packet()
        self.assertEqual(result.returncode, 0, result.stdout)
        acquisition = json.loads(next(self.packet.glob('phase-acquisition-*.json')).read_text())
        environment = dict(self.env, FITSY_VERIFY_OWNED_DB=acquisition['container']['id'],
                           FITSY_VERIFY_DB_IMAGE=acquisition['container']['image_id'])
        state = Path(self.env['FIXTURE_STATE'])
        original = json.loads(state.read_text())
        argv = [NODE, str(self.verify / 'local-db.mjs'), '--stop-owned-db']
        for field, replacement in [('Id', 'replacement-container'), ('owner', 'unowned')]:
            value = json.loads(json.dumps(original))
            if field == 'owner':
                value['Config']['Labels']['fitsy.verify.owner'] = replacement
            else:
                value[field] = replacement
            state.write_text(json.dumps(value))
            stopped = subprocess.run(argv, cwd=self.root, env=environment, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(stopped.returncode, 0, stopped.stdout)
            self.assertTrue(state.exists())
        state.write_text(json.dumps(original))
        stopped = subprocess.run(argv, cwd=self.root, env=environment, capture_output=True, text=True, timeout=10)
        self.assertEqual(stopped.returncode, 0, stopped.stderr)
        self.assertFalse(state.exists())
        events = [json.loads(line) for line in (self.directory / 'events').read_text().splitlines()]
        self.assertEqual([args for args in events if args[0] == 'rm'], [['rm', '-f', original['Id']]])

    def test_replaced_or_absent_runtime_after_ready_refuses_before_local_docker(self):
        for runtime in ('guest-replaced', 'guest-absent', 'backend-replaced'):
            result = self.run_packet(FIXTURE_RUNTIME_AFTER_READY=runtime,
                                     FITSY_VERIFY_ADMITTED_GUEST='900003', FITSY_VERIFY_ADMITTED_BACKEND='900009')
            self.assertNotEqual(result.returncode, 0, result.stdout)
            self.assertFalse((self.directory / 'resets').exists())
            self.assertFalse(Path(self.env['FIXTURE_EVENTS'] + '.local').exists())

    def test_runtime_replacement_before_reset_preserves_container_and_refuses_reset(self):
        result = self.run_packet(FIXTURE_RUNTIME_DURING_WAIT='1')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertFalse((self.directory / 'resets').exists())
        state = json.loads(Path(self.env['FIXTURE_STATE']).read_text())
        self.assertEqual((state['Id'], state['Image']), ('owned-container', 'sha256:fixture'))

    def test_post_session_changed_runtime_refuses_before_stop_docker(self):
        result = self.run_packet()
        self.assertEqual(result.returncode, 0, result.stdout)
        local = Path(self.env['FIXTURE_EVENTS'] + '.local')
        before = local.read_text()
        environment = dict(self.env, FITSY_VERIFY_OWNED_DB='owned-container', FITSY_VERIFY_DB_IMAGE='sha256:fixture',
                           FIXTURE_RUNTIME_AFTER_READY='guest-replaced', FIXTURE_RUNTIME_AT_STOP='1')
        stopped = subprocess.run([NODE, str(self.verify / 'local-db.mjs'), '--stop-owned-db'], cwd=self.root,
                                 env=environment, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(stopped.returncode, 0, stopped.stdout)
        self.assertEqual(local.read_text(), before)
        self.assertTrue(Path(self.env['FIXTURE_STATE']).exists())

    def test_actual_descendant_owned_assertion_reads_canonical_runtime_and_succeeds(self):
        result = self.run_packet(FIXTURE_ASSERT_READER='1')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        reader = json.loads((self.packet / 'reader-proof.json').read_text())
        self.assertEqual(reader['returncode'], 0)
        self.assertNotEqual(reader['before'], reader['after'])

    def test_same_session_complete_reader_metadata_cannot_replace_canonical_acquisition(self):
        result = self.run_packet(FIXTURE_ASSERT_READER='1', FIXTURE_READER_REPLACEMENT='1')
        self.assertNotEqual(result.returncode, 0)
        proof = json.loads((self.packet / 'reader-proof.json').read_text())
        self.assertNotEqual(proof['returncode'], 0)
        self.assertIn('canonical acquired container', proof['stderr'])
        acquired = json.loads(next(self.packet.glob('phase-acquisition-*.json')).read_text())
        self.assertEqual(acquired['container'], {'id': 'owned-container', 'image_id': 'sha256:fixture'})
        replacement = json.loads(Path(self.env['FIXTURE_STATE']).read_text())
        self.assertEqual((replacement['Id'], replacement['Image']),
                         ('complete-same-owner-replacement', 'sha256:complete-replacement'))
        events = [json.loads(line) for line in Path(self.env['FIXTURE_EVENTS']).read_text().splitlines()]
        self.assertFalse(any(args[0] == 'rm' for args in events))

    def test_actual_descendant_assertion_refuses_runtime_change_before_docker(self):
        result = self.run_packet(FIXTURE_ASSERT_READER='1', FIXTURE_RUNTIME_BEFORE_READER='1')
        self.assertNotEqual(result.returncode, 0)
        reader = json.loads((self.packet / 'reader-proof.json').read_text())
        self.assertNotEqual(reader['returncode'], 0)
        self.assertEqual(reader['before'], reader['after'])

    def test_complete_copied_reader_metadata_outside_session_refuses_before_docker(self):
        self.assertEqual(self.run_packet().returncode, 0)
        local = Path(self.env['FIXTURE_EVENTS'] + '.local')
        before = local.read_text()
        environment = dict(self.env, FITSY_VERIFY_DB_PHASE='1', FITSY_VERIFY_DB_LOCKED='1',
                           FITSY_VERIFY_DB_LOCK_FD='3', FITSY_VERIFY_OWNED_DB='owned-container',
                           FITSY_VERIFY_DB_IMAGE='sha256:fixture',
                           POSTGRES_PRISMA_URL='postgresql://fitsy_test:fitsy_test@127.0.0.1:55432/fitsy_verify',
                           POSTGRES_URL_NON_POOLING='postgresql://fitsy_test:fitsy_test@127.0.0.1:55432/fitsy_verify')
        result = subprocess.run([NODE, str(self.verify / 'local-db.mjs'), '--assert-owned-db'], cwd=self.root,
                                env=environment, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(local.read_text(), before)

    def test_complete_copied_cleanup_metadata_without_real_lock_refuses_before_docker(self):
        self.assertEqual(self.run_packet().returncode, 0)
        local = Path(self.env['FIXTURE_EVENTS'] + '.local')
        before = local.read_text()
        environment = dict(self.env, FITSY_VERIFY_DB_LOCKED='1', FITSY_VERIFY_DB_LOCK_FD='3',
                           FITSY_VERIFY_OWNED_DB='owned-container', FITSY_VERIFY_DB_IMAGE='sha256:fixture')
        result = subprocess.run([NODE, str(self.verify / 'local-db.mjs'), '--locked-stop'], cwd=self.root,
                                env=environment, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(local.read_text(), before)
        self.assertTrue(Path(self.env['FIXTURE_STATE']).exists())

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


for _drift in ('socket', 'source', 'authority', 'runtime'):
    def test(self, mode=_drift):
        self.drift_case = mode
        self.settle_drift_case()
    setattr(PhaseBoundaryTests, 'test_capacity_settle_drift_' + _drift, test)
for _name, _failure in [('stop', {'pages':270000}), ('disk', {'disk':1024}),
                         ('swap', {'swap':1}), ('pressure', {'pressure':'2'})]:
    def test(self, failure=_failure):
        self.fixed_case = failure
        self.second_fixed_case()
    setattr(PhaseBoundaryTests, 'test_capacity_then_fixed_' + _name, test)


def limit_case(stage, field, kind):
    def test(self):
        options = {'FIXTURE_LIMIT_STAGE': stage, 'FIXTURE_LIMIT_CASE': f'{field}:{kind}'}
        if stage == 'reader': options['FIXTURE_ASSERT_READER'] = '1'
        if stage == 'reuse': options['FIXTURE_TWICE'] = '1'
        if stage == 'stop': options = {}
        result = self.run_packet(**options)
        state = Path(self.env['FIXTURE_STATE'])
        if stage == 'stop':
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            original = json.loads(state.read_text())
            value = json.loads(json.dumps(original))
            if kind == 'missing': value['HostConfig'].pop(field, None)
            else: value['HostConfig'][field] = 'unlimited' if kind == 'malformed' else 0
            state.write_text(json.dumps(value))
            acquisition = json.loads(next(self.packet.glob('phase-acquisition-*.json')).read_text())
            env = dict(self.env, FITSY_VERIFY_OWNED_DB=acquisition['container']['id'],
                       FITSY_VERIFY_DB_IMAGE=acquisition['container']['image_id'])
            argv = [NODE, str(self.verify / 'local-db.mjs'), '--stop-owned-db']
            stopped = subprocess.run(argv, cwd=self.root, env=env, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(stopped.returncode, 0, stopped.stdout + stopped.stderr)
            self.assertTrue(state.exists())
            self.assertIn('effective limits', stopped.stderr)
            # Only the disposable observation fixture restores its original inspected limits.
            # This does not authorize a production repair or weaker cleanup fallback.
            state.write_text(json.dumps(original))
            stopped = subprocess.run(argv, cwd=self.root, env=env, capture_output=True, text=True, timeout=10)
            self.assertEqual(stopped.returncode, 0, stopped.stderr)
            self.assertFalse(state.exists())
            return
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        proof = self.packet / 'reader-proof.json'
        if stage == 'reader':
            value = json.loads(proof.read_text())
            self.assertNotEqual(value['returncode'], 0)
            self.assertIn('effective limits', value['stderr'])
            self.assertEqual(len(value['after'].splitlines()), len(value['before'].splitlines()) + 1)
        else:
            self.assertIn('effective limits', result.stdout + result.stderr)
        children = (self.packet / 'children').read_text().splitlines() if (self.packet / 'children').exists() else []
        self.assertEqual(children, {'migrate': [], 'seed': ['migrate'], 'selection': ['migrate','seed'],
                                    'reader': ['migrate','seed'], 'reuse': ['migrate','seed']}[stage])
        self.assertEqual(len(Path(self.env['FIXTURE_RESETS']).read_text().splitlines()), 1)
        self.assertTrue(state.exists(), 'changed effective limits must not authorize cleanup mutation')
        value = json.loads(state.read_text())
        self.assertEqual((value['Id'], value['Image']), ('owned-container', 'sha256:fixture'))
    return test


for _stage in ('migrate', 'seed', 'selection', 'reader', 'reuse', 'stop'):
    for _field in ('Memory', 'MemorySwap', 'NanoCpus'):
        for _kind in ('changed', 'missing', 'malformed'):
            setattr(PhaseBoundaryTests, f'test_effective_limits_{_stage}_{_field}_{_kind}',
                    limit_case(_stage, _field, _kind))


def runtime_api_case(operation, mode):
    def test(self):
        result = self.run_packet(FIXTURE_HELPER_CHANGE_AFTER=operation, FIXTURE_HELPER_RUNTIME=mode)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.packet / 'changed-runtime-api').exists())
        self.assertFalse(list(self.packet.glob('phase-admission-*.json')))
        self.assertFalse((self.directory / 'resets').exists())
    return test


for _operation in ('context', 'info', 'inspect', 'ps'):
    for _mode in ('guest-replaced', 'guest-absent', 'backend-replaced'):
        setattr(PhaseBoundaryTests, f'test_runtime_bound_api_{_operation}_{_mode}',
                runtime_api_case(_operation, _mode))


if __name__ == '__main__':
    unittest.main()
