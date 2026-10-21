import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
export function installFixtureTools(directory: string) {
  // Retain the parent suite's admitted Git and system Bash when the hook
  // installs its protected PATH. Regular files remain safe to replace with stubs.
  const git = execFileSync('/usr/bin/which', ['git'], { encoding: 'utf8' }).trim();
  for (const [name, executable] of [['bash', '/bin/bash'], ['git', git], ['python3', execFileSync('/usr/bin/which', ['python3'], { encoding: 'utf8' }).trim()]] as const) {
    const file = join(directory, 'bin', name);
    if (existsSync(file)) continue;
    const quoted = "'" + executable.replace(/'/g, "'\"'\"'") + "'";
    mkdirSync(join(directory, 'bin'), { recursive: true });
    writeFileSync(file, `#!/bin/sh
exec ${quoted} "$@"
`);
    chmodSync(file, 0o755);
  }
  // Darwin's bare mktemp ignores TMPDIR; fixtures keep transient files owned.
  const temporary = join(directory, 'bin/mktemp');
  if (!existsSync(temporary)) {
    writeFileSync(temporary, '#!/bin/sh\nif [ "$#" = 0 ]; then temporary=${TMPDIR:-/tmp}; exec /usr/bin/mktemp "${temporary%/}/fitsy-fixture.XXXXXX"; fi\nexec /usr/bin/mktemp "$@"\n');
    chmodSync(temporary, 0o755);
  }

}

export function timingHook(root: string, directory: string, env: NodeJS.ProcessEnv) {
  const write = (file: string, value: string) => {
    mkdirSync(join(directory, file, '..'), { recursive: true });
    writeFileSync(join(directory, file), value);
  };
  installFixtureTools(directory);
  write('scripts/delivery/phase-events.mjs', readFileSync(join(root, 'scripts/delivery/phase-events.mjs'), 'utf8'));
  write('package.json', JSON.stringify({ private: true, scripts: { verify: 'node scripts/verify/run.mjs --layer=0-2 --scope=changed' } }));
  // Auth is exercised by the real shipping-session fixtures; these hook/cache fixtures model a reviewed live owner.
  write('scripts/verify/shipping-session.mjs', `#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
if(process.argv[2]==='--check') process.exit(0);
if(process.argv[2]!=='--candidate-checks') process.exit(1);
const check=process.argv[3];
const command=check==='cheap'?[process.execPath,['scripts/verify/run.mjs','--stage=cheap','--layer=0-1','--runs=local']]:['/bin/bash',['-p','-c','for c in size-check domain-check; do /bin/bash -p scripts/verify/$c.sh; code=$?; [ "$code" = 0 ] || [ "$code" = 2 ] || exit "$code"; done']];
process.exit(spawnSync(command[0],command[1],{stdio:'inherit',env:process.env}).status??1);
`);
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
  for (const file of ['impact-plan.mjs', 'local-db.mjs', 'docker-runtime.mjs', 'db-lock.py', 'receipt-cache.mjs', 'run.mjs', 'run.sh', 'secrets.sh', 'migration-safety.sh']) {
    mkdirSync(join(directory, 'scripts/verify'), { recursive: true });
    copyFileSync(join(root, 'scripts/verify', file), join(directory, 'scripts/verify', file));
  }
  // The copied verifier has its own protected interpreter PATH as well.
  const verifier = join(directory, 'scripts/verify/run.mjs');
  writeFileSync(verifier, readFileSync(verifier, 'utf8').replace(
    'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node',
    `PATH=${join(directory, 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node`));
}
