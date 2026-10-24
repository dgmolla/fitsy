import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { installGithubFixture } from './ota-test-fixtures';

const repo = resolve(__dirname, '../..');
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fitsy-rollback-'));
  mkdirSync(join(root, 'scripts/deploy'), { recursive: true });
  mkdirSync(join(root, 'apps/mobile'), { recursive: true });
  const bin = join(root, 'bin'); mkdirSync(bin);
  for (const file of ['rollback.sh', 'ota-lock.sh', 'ota-hold.sh', 'ota-bundle-identity.py', 'ios-binary-baseline.json'])
    copyFileSync(join(repo, 'scripts/deploy', file), join(root, 'scripts/deploy', file));
  const hold = join(root, 'hold'); writeFileSync(hold, '[[]]');
  installGithubFixture(bin, hold, join(root, 'lease'));
  writeFileSync(join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  writeFileSync(join(bin, 'npx'), `#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2),dir='${root}';
fs.appendFileSync(dir+'/calls',a.join(' ')+'\\n');
const out=x=>process.stdout.write(JSON.stringify(x));
if(a[1]==='update:list')out({currentPage:fs.existsSync(dir+'/recovered')?[{group:'recovered'}]:['g2','g1','g0'].map(group=>({group,platforms:'ios',runtimeVersion:'1.0.0'}))});
else if(a[1]==='update:view')out([{group:a[2],platform:'ios',runtimeVersion:'1.0.0',manifestPermalink:'https://u.expo.dev/update/'+(a[2]==='g0'?'22222222-2222-2222-2222-222222222222':'11111111-1111-1111-1111-111111111111')}]);
else if(a[1]==='update:republish'){fs.writeFileSync(dir+'/recovered',a[a.indexOf('--group')+1]);out([{group:'recovered'}]);}
else process.exit(99);
`, { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env node
const url=process.argv.at(-1);
const hash=process.env.INVALID==='true'?'':process.env.ALL_DUPLICATES==='true'?'a'.repeat(43):url.includes('22222222')?'b'.repeat(43):'a'.repeat(43);
process.stdout.write(JSON.stringify({id:url,createdAt:Date.now(),runtimeVersion:'1.0.0',launchAsset:{hash,contentType:'application/javascript',url:'dynamic download URL'},assets:[],extra:{}}));
`, { mode: 0o755 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function rollback(extra: Record<string, string> = {}) {
  return spawnSync('bash', ['scripts/deploy/rollback.sh', 'mobile'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...extra, PATH: `${join(root, 'bin')}:${process.env.PATH}` },
  });
}
test('default recovery skips duplicate broken groups and selects distinct prior iOS bundle', () => {
  const result = rollback();
  if (result.status) throw new Error(result.stderr);
  expect(result.status).toBe(0);
  expect(readFileSync(join(root, 'recovered'), 'utf8')).toBe('g0');
  expect(readFileSync(join(root, 'calls'), 'utf8')).toContain('update:view g1');
  expect(readFileSync(join(root, 'calls'), 'utf8')).toContain('update:republish --platform ios --group g0');
  expect(readFileSync(join(root, 'hold'), 'utf8')).toContain('rollback hold');
});
test.each([{ ALL_DUPLICATES: 'true' }, { INVALID: 'true' }])('unverifiable recovery fails closed and retains hold (%s)', extra => {
  const result = rollback(extra);
  expect(result.status).not.toBe(0);
  expect(readFileSync(join(root, 'calls'), 'utf8')).not.toContain('update:republish');
  expect(readFileSync(join(root, 'hold'), 'utf8')).toContain('rollback hold');
});
