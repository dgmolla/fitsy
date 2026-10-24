import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function installVerificationFixture(root: string, directory: string) {
  for (const file of ['impact-plan.mjs', 'test-results.mjs', 'node-focused-reporter.mjs', 'python-focused.py', 'run.mjs', 'run.sh', 'secrets.sh', 'migration-safety.sh']) {
    mkdirSync(join(directory, 'scripts/verify'), { recursive: true });
    copyFileSync(join(root, 'scripts/verify', file), join(directory, 'scripts/verify', file));
  }
  // The copied verifier has its own protected interpreter PATH as well.
  const verifier = join(directory, 'scripts/verify/run.mjs');
  writeFileSync(verifier, readFileSync(verifier, 'utf8').replace(
    'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node',
    `PATH=${join(directory, 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node`));
}
