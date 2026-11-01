#!/usr/bin/env node
// On-demand adoption by the existing Mac owner, after reviewed integration.
// Keep both host callers on their existing import path and preserve all state/history.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { gitEnv, isMain, repository } from '../verify/impact-plan.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
export function installExpiredFixture(hostDirectory, source = repository) {
  const host = resolve(hostDirectory);
  const git = args => execFileSync('git', args, { cwd: source, env: gitEnv(), encoding: 'utf8' }).trim();
  const head = git(['rev-parse', 'HEAD']);
  if (head !== git(['rev-parse', 'origin/main']) || git(['status', '--porcelain']))
    throw new Error('Install only from a clean reviewed checkout of origin/main after merge');
  if (existsSync(join(host, 'lock'))) throw new Error('Simulator runner busy; install at its existing idle boundary');
  const target = join(host, 'expired-fixture.mjs');
  const previous = readFileSync(target, 'utf8');
  // Fail before touching an unrelated host directory or a changed import contract.
  for (const caller of ['poller.mjs', 'expired-runner.mjs']) {
    if (!readFileSync(join(host, caller), 'utf8').includes("from './expired-fixture.mjs'"))
      throw new Error(`Host ${caller} no longer uses the maintained expired-fixture import`);
  }
  const files = ['expired-fixture.mjs', 'backend-identity.mjs'].map(name => ({
    name, contents: readFileSync(join(source, 'scripts/sim', name), 'utf8'),
  }));
  const sourceHash = hash(JSON.stringify(files));
  const bundle = join(host, 'fixture-modules', `${head}-${sourceHash.slice(0, 12)}`);
  const modulePath = './' + relative(host, join(bundle, 'expired-fixture.mjs')).split('\\').join('/');
  const shim = `// Installed from main ${head}; source hash ${sourceHash}.\nexport * from ${JSON.stringify(modulePath)};\n`;
  mkdirSync(bundle, { recursive: true, mode: 0o700 });
  for (const { name, contents } of files) {
    const path = join(bundle, name);
    if (existsSync(path)) {
      if (readFileSync(path, 'utf8') !== contents) throw new Error('Installed fixture snapshot changed');
    } else writeFileSync(path, contents, { mode: 0o444, flag: 'wx' });
  }
  if (git(['rev-parse', 'HEAD']) !== head || git(['status', '--porcelain']))
    throw new Error('Source changed during host fixture preparation');
  if (previous === shim) return { head, sourceHash, changed: false, target };
  const receipts = join(host, 'fixture-installations');
  mkdirSync(receipts, { recursive: true, mode: 0o700 });
  const id = `${Date.now()}-${process.pid}`;
  const backup = join(receipts, `${id}.previous.mjs`);
  writeFileSync(backup, previous, { mode: 0o600, flag: 'wx' });
  const temporary = join(host, `.expired-fixture-${id}.tmp`);
  writeFileSync(temporary, shim, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, target);
  const receipt = { head, sourceHash, changed: true, target, backup, previousHash: hash(previous),
    installedHash: hash(shim), installedAt: new Date().toISOString(), requiresNewProcess: true };
  writeFileSync(join(receipts, `${id}.json`), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return receipt;
}

if (isMain(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: install-expired-fixture.mjs <existing-sim-review-directory>');
    console.log(JSON.stringify(installExpiredFixture(process.argv[2])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
