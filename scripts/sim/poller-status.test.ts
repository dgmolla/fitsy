import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('the Mac Simulator status lifecycle and installed caller pass their behavior regressions', () => {
  execFileSync(process.execPath, ['--test', resolve(__dirname, 'poller-status.test.mjs'), resolve(__dirname, 'install-poller-status.test.mjs')],
    { stdio: 'pipe', encoding: 'utf8', timeout: 30000 });
});
