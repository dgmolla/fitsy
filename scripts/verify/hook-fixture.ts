import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { appleGitHookPrologue } from './apple-git-hook-env';

const protectedPath = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
export function fixtureNodeUnderProtectedPath(env: NodeJS.ProcessEnv) {
  // Hosted npm can export NODE from setup-node while the hook selects a
  // different interpreter from its protected PATH.
  const routed: NodeJS.ProcessEnv = { ...env, PATH: protectedPath };
  delete routed.NODE_OPTIONS;
  delete routed.NODE_PATH;
  return execFileSync('/usr/bin/env', ['node', '-p', 'process.execPath'],
    { env: routed, encoding: 'utf8' }).trim();
}

// Isolated administrator installation retains executable modes and uses only
// the fixture GitHub boundary, including inside the protected hook PATH.
export function installedFixtureHook(root: string, directory: string, apple = false) {
  return readFileSync(join(root, '.githooks/pre-push'), 'utf8')
    .replace('export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      `export PATH=${join(directory, 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)
    .replace('hook_path="$PATH"', (apple ? appleGitHookPrologue : '') + 'hook_path="$PATH"');
}
export function timingHook(root: string, directory: string, env: NodeJS.ProcessEnv) {
  const write = (file: string, value: string) => {
    mkdirSync(join(directory, file, '..'), { recursive: true });
    writeFileSync(join(directory, file), value);
  };
  write('scripts/delivery/phase-events.mjs', readFileSync(join(root, 'scripts/delivery/phase-events.mjs'), 'utf8'));
  write('package.json', JSON.stringify({ private: true, scripts: { verify: 'node scripts/verify/run.mjs --layer=0-2 --scope=changed' } }));
  // Auth is exercised by the real shipping-session fixtures; these hook/cache fixtures model a reviewed live owner.
  write('scripts/verify/shipping-session.mjs', '#!/usr/bin/env node\nif (process.argv[2] !== \'--check\') process.exit(1);\n');
  chmodSync(join(directory, 'scripts/verify/shipping-session.mjs'), 0o755);
  const bound = spawnSync(process.execPath, ['scripts/delivery/phase-events.mjs', 'bind', '--issue', '355'],
    { cwd: directory, env, encoding: 'utf8' });
  expect(bound.status).toBe(0);
  write('bin/gh', '#!/bin/sh\necho "$3 $4" >> .evidence/gh-calls\ncase "$4" in user) echo \'{"login":"fixture"}\' ;; *"/comments?"*) echo \'[]\' ;; */comments) cat >/dev/null; echo \'{"id":1}\' ;; *) exit 1 ;; esac\n');
  chmodSync(join(directory, 'bin/gh'), 0o755);
  return { ...env, PATH: `${join(directory, 'bin')}:${protectedPath}`,
    NODE: fixtureNodeUnderProtectedPath(env) };
}


export function installVerificationFixture(root: string, directory: string) {
  for (const file of ['impact-plan.mjs', 'local-db.mjs', 'db-lock.py', 'receipt-cache.mjs', 'run.mjs', 'run.sh', 'secrets.sh', 'migration-safety.sh']) {
    mkdirSync(join(directory, 'scripts/verify'), { recursive: true });
    copyFileSync(join(root, 'scripts/verify', file), join(directory, 'scripts/verify', file));
  }
  // The copied verifier has its own protected interpreter PATH as well.
  const verifier = join(directory, 'scripts/verify/run.mjs');
  writeFileSync(verifier, readFileSync(verifier, 'utf8').replace(
    'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node',
    `PATH=${join(directory, 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node`));
}
