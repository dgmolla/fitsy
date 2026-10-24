import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test.each([undefined, 'local', 'scheduled'].flatMap(runs =>
  [undefined, '54503F5C-8A3C-4699-8401-2E1D32890A24'].map(udid => ({ runs, udid }))))(
  'non-CI smoke cannot launch an unscoped or parallel native driver (runs $runs, owned UDID $udid)',
  ({ runs, udid }) => {
    const dir = mkdtempSync(join(tmpdir(), 'fitsy-shadow-isolation-'));
    const touched = join(dir, 'native-command-called');
    try {
      for (const command of ['maestro', 'xcrun']) {
        const path = join(dir, command);
        writeFileSync(path, '#!/bin/sh\nprintf called > "$NATIVE_COMMAND_RECEIPT"\nexit 99\n');
        chmodSync(path, 0o700);
      }
      const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true', PATH: `${dir}:${process.env.PATH}`, NATIVE_COMMAND_RECEIPT: touched };
      // L2 exports FITSY_RUNS=ci. Choose each fixture's caller explicitly so
      // local-skip assertions never consume the hosted classifier's receipt.
      if (runs) env.FITSY_RUNS = runs;
      else delete env.FITSY_RUNS;
      if (udid) env.FITSY_XCTEST_SIM_UDID = udid;
      else delete env.FITSY_XCTEST_SIM_UDID;
      const result = spawnSync('bash', [resolve(__dirname, 'mobile-e2e.sh')], { env, encoding: 'utf8' });
      expect(result.status).toBe(2);
      expect(existsSync(touched)).toBe(false);
      const receipt = JSON.parse(result.stdout);
      expect(receipt.status).toBe('skipped');
      expect(receipt.fix).toContain('source-bound product-flow');
      expect(receipt.fix).toContain('exact owned UDID');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  },
);
