import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// External GitHub API fixture: models issue holds and atomic ref ownership.
export function installGithubFixture(bin: string, holdState: string, leaseState: string) {
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const fs=require('fs'),crypto=require('crypto'),args=process.argv.slice(2);
const hold='${holdState}',lease='${leaseState}';
if(args[0]==='issue'){fs.writeFileSync(hold,'[[{"number":99,"title":"release: iOS OTA rollback hold"}]]');process.exit(0)}
const path=args.find(x=>x.startsWith('repos/'))||'';
const method=args[args.indexOf('--method')+1];
if(path.includes('/issues?')){process.stdout.write(fs.readFileSync(hold));process.exit(0)}
if(path.endsWith('/git/ref/heads/main')){process.stdout.write('b'.repeat(40));process.exit(0)}
if(path.includes('/git/commits')){process.stdout.write(method==='POST'?crypto.randomBytes(20).toString('hex'):'c'.repeat(40));process.exit(0)}
if(path.endsWith('/git/refs')&&method==='POST'){
 if(fs.existsSync(lease))process.exit(1);
 fs.writeFileSync(lease,args.find(x=>x.startsWith('sha=')).slice(4));process.exit(0)
}
if(path.endsWith('/git/ref/tags/fitsy-ios-ota-lock')){
 if(!fs.existsSync(lease))process.exit(1);
 const owner=fs.readFileSync(lease,'utf8');process.stdout.write(owner);
 // The pre-existing export completes before rollback can acquire its lease.
 if(owner==='a'.repeat(40))fs.unlinkSync(lease);
 process.exit(0)
}
if(method==='DELETE'&&path.endsWith('/git/refs/tags/fitsy-ios-ota-lock')){fs.unlinkSync(lease);process.exit(0)}
process.exit(99);
`, { mode: 0o755 });
}
