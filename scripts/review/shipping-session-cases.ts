import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
interface Fixture {
  root(): string; env(): NodeJS.ProcessEnv; setEnv(value: NodeJS.ProcessEnv): void;
  git(...args: string[]): string; source: string;
}

export function shippingSessionCases(f: Fixture, setup: () => void,
  verify: () => ReturnType<typeof spawnSync>, order: () => string,
  callCount: () => number, passingVerdict: string, failingVerdict: string) {
  function session(script: string) {
    const root = f.root();
    writeFileSync(join(root, '.evidence/shipping.sh'), 'set -e\n' + script + '\n');
    return spawnSync(process.execPath, ['scripts/verify/shipping-session.mjs', '--', 'bash', '.evidence/shipping.sh'], {
      cwd: root, encoding: 'utf8', timeout: 25000,
      env: { ...f.env(), FITSY_REVIEW_PROVIDER: 'claude', FITSY_REVIEW_MODEL: 'fixture-model' },
    });
  }
  const publicMobile = () => {
    const root = f.root();
    writeFileSync(join(root, '.evidence/mobile.mjs'), `import {execFileSync} from 'node:child_process';
import {admitFinalCandidate} from ${JSON.stringify(join(f.source, 'scripts/sim/product-flow.mjs'))};
admitFinalCandidate({publishable:true},(command,args)=>execFileSync(command,args,{cwd:process.cwd(),env:process.env,stdio:'inherit'}));
`);
    return 'node .evidence/mobile.mjs';
  };
  test('one live review covers actual mobile admission, full verification and pre-push without saved verdict projection', () => {
    setup();
    const accepted = session(publicMobile() + '\nnpm run verify\nbash .evidence/pre-push\necho shipped >> .evidence/order');
    if (accepted.status !== 0) throw Error(accepted.stderr);
    expect(callCount()).toBe(1);
    expect(order().split('\n').filter(line => line === 'full')).toHaveLength(1);
    expect(accepted.stdout).toContain('"cached":true');
    expect(order()).toContain('shipped');
    expect(verify().status).toBe(0); // The closed session cannot admit later commands.
    expect(callCount()).toBe(2);
  });
  test('one failed review then consolidated repair leaves one round for mobile, full acceptance and pre-push', () => {
    setup(); writeFileSync(join(f.root(), 'verdict'), failingVerdict);
    expect(session(publicMobile() + '\nnpm run verify\nbash .evidence/pre-push').status).toBe(1);
    expect(order()).not.toContain('full'); expect(callCount()).toBe(1);
    const ledger = join(f.root(), 'budgets/issue-355.jsonl');
    const failed = readFileSync(ledger, 'utf8');
    writeFileSync(join(f.root(), 'app.ts'), 'export const value = 3;\n');
    f.git('add', 'app.ts'); f.git('commit', '-qm', 'consolidated repair');
    writeFileSync(join(f.root(), 'verdict'), passingVerdict);
    const accepted = session(publicMobile() + '\nnpm run verify\nbash .evidence/pre-push');
    if (accepted.status !== 0) throw Error(accepted.stderr);
    expect(callCount()).toBe(2); expect(order()).toContain('full');
    expect(readFileSync(ledger, 'utf8').startsWith(failed)).toBe(true);
  });
  test('failed full acceptance inside the active session stops shipping', () => {
    setup(); writeFileSync(join(f.root(), '.evidence/full-fail'), 'fail');
    const result = session(publicMobile() + '\nnpm run verify\nbash .evidence/pre-push\necho shipped >> .evidence/order');
    expect(result.status).toBe(1); expect(callCount()).toBe(1);
    expect(order()).toContain('full'); expect(order()).not.toContain('shipped');
  });
  test.each(['app.ts', '.evidence/verify/focused-tests.json'])('source or focused selection drift invalidates active admission before full acceptance: %s', path => {
    setup(); mkdirSync(join(f.root(), '.evidence/verify'), { recursive: true });
    const result = session(publicMobile() + `\necho drift >> ${path}\nnpm run verify\necho shipped >> .evidence/order`);
    expect(result.status).toBe(1); expect(callCount()).toBe(1);
    expect(order()).not.toContain('full'); expect(order()).not.toContain('shipped');
  });
  test('cheap failure stops a shipping session before reviewer or final journeys', () => {
    setup(); writeFileSync(join(f.root(), '.evidence/cheap-fail'), 'fail');
    expect(session(publicMobile() + '\nnpm run verify').status).toBe(1);
    expect(callCount()).toBe(0); expect(order()).not.toContain('full');
  });
  test('forged or expired active session fails closed without another review execution', () => {
    setup(); f.setEnv({ ...f.env(), FITSY_SHIPPING_SOCKET: join(f.root(), '.evidence/missing.sock'), FITSY_SHIPPING_TOKEN: 'fake' });
    expect(verify().status).toBe(1); expect(callCount()).toBe(0); expect(order()).not.toContain('full');
  });
}
