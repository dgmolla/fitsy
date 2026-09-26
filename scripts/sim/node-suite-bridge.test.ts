import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireNodeSuite, requirePassingNodeSummary } from './node-suite-bridge';

test('TAP bridge rejects zero tests and failed tests', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-node-bridge-'));
  try {
    const failed = join(dir, 'failed.test.mjs');
    writeFileSync(failed, "import test from 'node:test'; test('failure', () => { throw new Error('fixture failure'); });\n");
    expect(() => requirePassingNodeSummary('# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n', failed))
      .toThrow('did not report all required tests passing');
    expect(() => requirePassingNodeSummary('', failed))
      .toThrow('did not report all required tests passing');
    expect(() => requireNodeSuite(failed)).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
