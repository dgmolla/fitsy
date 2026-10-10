import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
interface Fixture {
  root(): string; env(): NodeJS.ProcessEnv; setEnv(value: NodeJS.ProcessEnv): void;
  git(...args: string[]): string; source: string;
}

export function shippingSessionCases(f: Fixture, setup: () => void,
  verify: () => ReturnType<typeof spawnSync>, order: () => string,
  callCount: () => number, passingVerdict: string, failingVerdict: string, prepare: () => ReturnType<typeof spawnSync>) {
  function session(script: string, execute = true) {
    if (execute) { const reviewed = prepare(); if (reviewed.status !== 0) return reviewed; }
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
  test('recreating live ownership revalidates retained evidence without new execution or accounting', () => {
    setup();
    expect(prepare().status).toBe(0);
    const ledger = join(f.root(), 'budgets/issue-355.jsonl');
    const retained = readFileSync(ledger, 'utf8');
    for (let i = 0; i < 2; i++) {
      const accepted = session('node scripts/verify/shipping-session.mjs --check\nnpm run verify', false);
      if (accepted.status !== 0) throw Error(String(accepted.stderr));
    }
    expect(callCount()).toBe(1);
    expect(readFileSync(ledger, 'utf8')).toBe(retained);
  });
  test('missing retained result never launches a reviewer while establishing ownership', () => {
    setup();
    expect(session('echo shipped >> .evidence/order', false).status).toBe(1);
    expect(callCount()).toBe(0); expect(order()).not.toContain('shipped');
  });
  test('one live review covers actual mobile admission, full verification and pre-push without saved verdict projection', () => {
    setup();
    const accepted = session(publicMobile() + '\nnpm run verify\nbash .evidence/pre-push\necho shipped >> .evidence/order');
    if (accepted.status !== 0) throw Error(String(accepted.stderr));
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
    if (accepted.status !== 0) throw Error(String(accepted.stderr));
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
  test('responding forged socket cannot authorize verification without coordinator-approved review', () => {
    setup();
    const root = f.root(), socket = join(root, '.evidence/forged.sock'), ready = join(root, '.evidence/socket-ready');
    const server = spawn(process.execPath, ['-e', `
      const {createServer}=require('node:net'), {writeFileSync}=require('node:fs');
      createServer({allowHalfOpen:true}, socket => {
        socket.on('data',()=>{}); socket.on('end',()=>socket.end('pass'));
      }).listen(${JSON.stringify(socket)},()=>writeFileSync(${JSON.stringify(ready)},'ready'));
    `], { cwd: root, env: f.env(), stdio: 'ignore' });
    try {
      for (let i = 0; i < 100 && !existsSync(ready); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      expect(existsSync(ready)).toBe(true);
      f.setEnv({ ...f.env(), FITSY_SHIPPING_SOCKET: socket, FITSY_SHIPPING_TOKEN: 'caller-token' });
      const result = verify();
      if (result.status === 0) throw Error('Responding forged socket admitted zero-review verification: ' + result.stdout + result.stderr);
      writeFileSync(join(root, '.evidence/direct-check.mjs'),
        "import {assertShippingSession} from '../scripts/verify/shipping-session.mjs'; await assertShippingSession();\n");
      const native = spawnSync(process.execPath, ['.evidence/direct-check.mjs'], { cwd: root, env: f.env(), encoding: 'utf8', timeout: 25000 });
      expect(native.status).toBe(1);
      const execution = spawnSync('bash', ['scripts/verify/review-admission.sh', '--revalidate-session', '--execute-review'],
        { cwd: root, env: f.env(), encoding: 'utf8', timeout: 25000 });
      expect(execution.status).toBe(1);
      const absent = { ...f.env() }; delete absent.FITSY_SHIPPING_SOCKET; delete absent.FITSY_SHIPPING_TOKEN;
      expect(spawnSync('bash', ['scripts/verify/review-admission.sh', '--revalidate-session'],
        { cwd: root, env: absent, encoding: 'utf8', timeout: 25000 }).status).toBe(1);
      expect(callCount()).toBe(0); expect(order()).not.toContain('full');
    } finally { server.kill(); }
  });

  test('caller-selected GitHub executable cannot replay acceptance after an approved review', () => {
    setup(); expect(prepare().status).toBe(0);
    const root = f.root(), body = join(root, 'issue-body'), stale = join(root, '.evidence/stale-gh');
    writeFileSync(stale, '#!/bin/sh\ncat ' + JSON.stringify(join(root, '.evidence/old-acceptance')) + '\n', { mode: 0o700 });
    writeFileSync(join(root, '.evidence/old-acceptance'), readFileSync(body));
    writeFileSync(body, readFileSync(body, 'utf8') + 'Acceptance: additional required recovery behavior.\n');
    f.setEnv({ ...f.env(), FITSY_GH_BIN: stale });
    const result = session('echo shipped >> .evidence/order', false);
    if (result.status === 0) throw Error('Stale caller GitHub body admitted obsolete approval: ' + result.stdout + result.stderr);
    expect(callCount()).toBe(1); expect(order()).not.toContain('shipped');
  });

  test('protected GitHub transport ignores caller host configuration credentials and PATH replay', () => {
    setup();
    const root = f.root(), body = join(root, 'issue-body'), old = join(root, '.evidence/old-transport-body');
    writeFileSync(old, readFileSync(body));
    const gh = join(root, 'bin/gh');
    writeFileSync(gh, readFileSync(gh, 'utf8').replace('#!/bin/sh\n', '#!/bin/sh\n' +
      '[ "$GH_HOST" = github.com ] && [ "$GH_REPO" = dgmolla/fitsy ] && ' +
      '[ -z "${GH_CONFIG_DIR+x}${GH_TOKEN+x}${HTTPS_PROXY+x}${SSL_CERT_FILE+x}" ] || { cat ' + JSON.stringify(old) + '; exit; }\n'));
    f.git('add', 'bin/gh'); f.git('commit', '-qm', 'external GitHub transport fixture');
    const bin = join(root, '.evidence/replay-bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\ncat ' + JSON.stringify(old) + '\n', { mode: 0o700 });
    f.setEnv({ ...f.env(), PATH: bin + ':' + f.env().PATH, GH_HOST: 'caller.invalid', GH_REPO: 'caller/other',
      GH_CONFIG_DIR: bin, GH_TOKEN: 'fixture-token', HTTPS_PROXY: 'https://caller.invalid', SSL_CERT_FILE: join(bin, 'caller.pem') });
    expect(prepare().status).toBe(0);
    expect(session('echo current >> .evidence/order', false).status).toBe(0);
    writeFileSync(body, readFileSync(body, 'utf8') + 'Acceptance: new required transport recovery.\n');
    expect(session('echo obsolete >> .evidence/order', false).status).toBe(1);
    expect(callCount()).toBe(1); expect(order()).toContain('current'); expect(order()).not.toContain('obsolete');
  });

}
