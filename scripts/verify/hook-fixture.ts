import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

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

// Exercise the real hook with task-owned executable fixtures.
export function installedFixtureHook(root: string, directory: string) {
  return readFileSync(join(root, '.githooks/pre-push'), 'utf8')
    .replace('export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      `export PATH=${join(directory, 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`);
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

export function hookEnvironment(root: string, directory: string, env: NodeJS.ProcessEnv) {
  installFixtureTools(directory);
  appendFileSync(join(directory, 'scripts/verify/registry.yml'), `  - name: size-check
    script: size-check.sh
    layer: 1
    blocking: true
    standalone: true
    runs: [ci]
  - name: domain-check
    script: domain-check.sh
    layer: 1
    blocking: true
    standalone: true
    runs: [ci]
`);
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true,
    scripts: { verify: 'node scripts/verify/run.mjs --layer=0-2 --scope=changed' } }));
  const home = join(directory, '.evidence/home');
  mkdirSync(home, { recursive: true });
  return { ...env, HOME: home, PATH: `${join(directory, 'bin')}:${protectedPath}`,
    NODE: fixtureNodeUnderProtectedPath(env) };
}


export function installVerificationFixture(root: string, directory: string) {
  for (const file of ['impact-plan.mjs', 'local-db.mjs', 'local-db-control.mjs', 'docker-runtime.mjs', 'db-lock.py', 'test-results.mjs', 'node-focused-reporter.mjs', 'python-focused.py', 'run.mjs', 'run.sh', 'secrets.sh', 'migration-safety.sh']) {
    mkdirSync(join(directory, 'scripts/verify'), { recursive: true });
    copyFileSync(join(root, 'scripts/verify', file), join(directory, 'scripts/verify', file));
  }
  // The copied verifier has its own protected interpreter PATH as well.
  const verifier = join(directory, 'scripts/verify/run.mjs');
  writeFileSync(verifier, readFileSync(verifier, 'utf8').replace(
    'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node',
    `PATH=${join(directory, 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node`));
}
