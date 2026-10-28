import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('production monitoring exercises real probes, thresholds, shared state, alert delivery and config guards', () => {
  execFileSync(process.execPath, ['--test', 'scripts/verify/production-monitor.test.mjs', 'scripts/deploy/production-recovery.test.mjs'],
    { cwd: resolve(__dirname, '../..'), stdio: 'pipe', timeout: 30_000 });
}, 35_000);
