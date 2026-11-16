import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const script = resolve(__dirname, 'green-main.mjs');
const sha = (n: number) => String(n).repeat(40).slice(0, 40);

// A fake `gh` that answers the two API shapes the helper uses from a table of commit -> status.
function run(args: string[], states: Record<string, string | undefined>, commits = Object.keys(states)) {
  const dir = mkdtempSync(join(tmpdir(), 'green-main-'));
  try {
    const table = JSON.stringify({ commits, states });
    writeFileSync(join(dir, 'gh'), `#!/usr/bin/env node
const t = ${table}; const url = process.argv[3] || '';
if (url.includes('/commits?sha=main')) { process.stdout.write(t.commits.join('\\n') + '\\n'); process.exit(0); }
const m = /commits\\/([0-9a-f]{40})\\/status/.exec(url);
const state = m && t.states[m[1]];
process.stdout.write(JSON.stringify({ statuses: state ? [{ context: 'full-suite/green', state }, { context: 'other', state: 'success' }] : [{ context: 'other', state: 'success' }] }) + '\\n');
`);
    chmodSync(join(dir, 'gh'), 0o755);
    return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${dirname(process.execPath)}:/usr/bin:/bin` } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('green-main (gate 3 green-commit record)', () => {
  test('--latest skips failed and unrecorded commits and prints the newest green one', () => {
    const r = run(['--latest'], { [sha(1)]: 'failure', [sha(2)]: undefined, [sha(3)]: 'success', [sha(4)]: 'success' });
    expect({ status: r.status, out: r.stdout.trim() }).toEqual({ status: 0, out: sha(3) });
  });

  test('--latest fails when nothing recent is green', () => {
    const r = run(['--latest'], { [sha(1)]: 'failure', [sha(2)]: 'pending' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('No green main commit');
  });

  test.each([['success', 0], ['failure', 1], ['pending', 1], [undefined, 1]])('--check on a %s commit exits %s', (state, code) => {
    const r = run(['--check', sha(5)], { [sha(5)]: state as string | undefined });
    expect(r.status).toBe(code);
  });

  test.each([[[]], [['--check']], [['--check', 'main']], [['--latest', 'extra']]])('rejects bad usage %j', args => {
    expect(run(args as string[], {}).status).toBe(2);
  });
});
