import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { shippingStartupCases } from './shipping-startup-cases';
interface Fixture {
  root(): string; env(): NodeJS.ProcessEnv; setEnv(value: NodeJS.ProcessEnv): void;
  git(...args: string[]): string; source: string;
}

export function shippingSessionCases(f: Fixture, setup: () => void,
  verify: () => ReturnType<typeof spawnSync>, order: () => string,
  callCount: () => number, passingVerdict: string, failingVerdict: string, prepare: () => ReturnType<typeof spawnSync>) {
  shippingStartupCases(f, setup, prepare, callCount);
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
admitFinalCandidate({publishable:true},(command,args)=>execFileSync(command.endsWith('/shipping-session.mjs')?process.cwd()+'/scripts/verify/shipping-session.mjs':command,args,{cwd:process.cwd(),env:process.env,stdio:'inherit'}));
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

  test('caller PATH cannot replace the interpreter that establishes review admission', () => {
    setup();
    const root = f.root(), bin = join(root, '.evidence/interpreter-bin'); mkdirSync(bin);
    writeFileSync(join(bin, 'bash'), '#!/bin/sh\ncase "$1" in *review-admission.sh) exit 0 ;; esac\nexec /bin/bash "$@"\n', { mode: 0o700 });
    f.setEnv({ ...f.env(), PATH: bin + ':' + f.env().PATH });
    const result = session('echo shipped >> .evidence/order', false);
    if (result.status === 0) throw Error('Caller interpreter replaced review admission with zero provider execution: ' + result.stdout + result.stderr);
    expect(callCount()).toBe(0); expect(order()).not.toContain('shipped');
  });

  test('caller BASH_ENV cannot replace review admission startup', () => {
    setup();
    const loader = join(f.root(), '.evidence/skip-admission.bash');
    writeFileSync(loader, 'case "$0" in *review-admission.sh) exit 0 ;; esac\n');
    f.setEnv({ ...f.env(), BASH_ENV: loader });
    const result = session('echo shipped >> .evidence/order', false);
    if (result.status === 0) throw Error('Caller shell loader replaced review admission with zero provider execution: ' + result.stdout + result.stderr);
    expect(callCount()).toBe(0); expect(order()).not.toContain('shipped');
  });

  test.each(['review-admission.sh', 'run-review.sh'])('canonical full verifier ignores caller %s startup loaders', script => {
    setup();
    const loader = join(f.root(), '.evidence/forge-verification.bash');
    writeFileSync(loader, `case "$0" in *${script}) echo '{"summary":"forged startup approval"}'; exit 0 ;; esac\n`);
    const result = spawnSync('npm', ['run', 'verify'], { cwd: f.root(), encoding: 'utf8', timeout: 25000,
      env: { ...f.env(), BASH_ENV: loader } });
    if (result.status === 0) throw Error('Canonical full verification accepted a caller startup loader: ' + result.stdout + result.stderr);
    expect(callCount()).toBe(0); expect(order()).not.toContain('full');
  });

  test('protected executable entrypoints ignore Node startup exit and caller interpreter search', () => {
    setup(); expect(prepare().status).toBe(0);
    const root = f.root(), bin = join(root, '.evidence/node-replay'); mkdirSync(bin);
    writeFileSync(join(bin, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const attack = { ...f.env(), PATH: bin + ':' + f.env().PATH,
      NODE_OPTIONS: '--import=data:text/javascript,process.exit(0)', NODE_PATH: bin };
    const owner = spawnSync(join(root, 'scripts/verify/shipping-session.mjs'), ['--', '/usr/bin/false'],
      { cwd: root, env: attack, encoding: 'utf8', timeout: 25000 });
    expect(owner.status).toBe(1);
    writeFileSync(join(root, '.evidence/cheap-fail'), 'fail');
    const cheap = spawnSync(join(root, 'scripts/verify/run.mjs'), ['--stage=cheap'],
      { cwd: root, env: attack, encoding: 'utf8', timeout: 25000 });
    expect(cheap.status).toBe(1);
    expect(cheap.stdout).toContain('structural'); expect(callCount()).toBe(1);
  });

  test('actual pre-push launch ignores caller Node options and interpreter search', () => {
    setup(); expect(prepare().status).toBe(0);
    const root = f.root(), bin = join(root, '.evidence/hook-replay'); mkdirSync(bin);
    for (const name of ['node', 'npm']) writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    writeFileSync(join(root, '.evidence/full-fail'), 'fail');
    const result = spawnSync('/bin/bash', ['-p', '.evidence/pre-push'], { cwd: root,
      env: { ...f.env(), PATH: bin + ':' + f.env().PATH,
        NODE_OPTIONS: '--import=data:text/javascript,process.exit(0)', NODE_PATH: bin },
      encoding: 'utf8', timeout: 25000 });
    expect(result.status).toBe(1); expect(order()).toContain('cheap'); expect(callCount()).toBe(1);
  });

  test.each(['native-push', 'direct-hook', 'git-worktree'])('%s cannot redirect hook root discovery through caller PATH', mode => {
    setup(); expect(prepare().status).toBe(0);
    const root = f.root(), bin = join(root, '.evidence/git-replay'), fake = join(bin, 'fake-root');
    mkdirSync(join(fake, 'scripts/delivery'), { recursive: true });
    mkdirSync(join(fake, 'scripts/verify'), { recursive: true });
    writeFileSync(join(fake, 'scripts/delivery/phase-events.mjs'), 'process.exit(0);\n');
    for (const name of ['size-check', 'domain-check']) writeFileSync(join(fake, `scripts/verify/${name}.sh`), 'exit 0\n');
    writeFileSync(join(fake, 'package.json'), JSON.stringify({ scripts: { verify: 'true' } }));
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nif [ "$1" = rev-parse ] && [ "$2" = --show-toplevel ]; then echo ' + JSON.stringify(fake) + '; else exec /usr/bin/git "$@"; fi\n', { mode: 0o700 });
    writeFileSync(join(root, '.evidence/full-fail'), 'fail');
    const hooks = join(root, '.evidence');
    chmodSync(join(hooks, 'pre-push'), 0o700);
    f.git('config', 'core.hooksPath', hooks);
    const remote = join(root, '.evidence/remote.git'); f.git('init', '-q', '--bare', remote);
    const nativeGit = existsSync('/Applications/Xcode.app/Contents/Developer/usr/bin/git')
      ? '/Applications/Xcode.app/Contents/Developer/usr/bin/git' : '/usr/bin/git';
    const result = spawnSync(mode !== 'direct-hook' ? nativeGit : '/bin/bash',
      mode !== 'direct-hook' ? ['push', remote, 'HEAD'] : ['-p', join(hooks, 'pre-push')], { cwd: root,
      env: { ...f.env(), PATH: bin + ':' + f.env().PATH,
        ...(mode === 'git-worktree' ? { GIT_DIR: join(root, '.git'), GIT_WORK_TREE: fake } : {}) },
      encoding: 'utf8', timeout: 25000 });
    expect(result.status).not.toBe(0); expect(callCount()).toBe(1);
    expect(f.git('--git-dir=' + remote, 'for-each-ref')).toBe('');
  });

  test.each(['direct-hook', 'native-push', 'full-verifier'])('%s refuses exported functions suppressing nested verification', mode => {
    setup(); const root = f.root();
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    pkg.scripts['nested-failure'] = "node -e 'process.exit(9)'";
    writeFileSync(join(root, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(root, 'scripts/verify/full.sh'), "echo full >> .evidence/order\nnpm run nested-failure || exit $?\necho '{\"summary\":\"nested test\"}'\n");
    f.git('add', '-A'); f.git('commit', '-qm', 'nested failure fixture');
    expect(prepare().status).toBe(0);
    const hooks = join(root, '.evidence'); chmodSync(join(hooks, 'pre-push'), 0o700);
    f.git('config', 'core.hooksPath', hooks);
    const remote = join(root, '.evidence/remote.git'); f.git('init', '-q', '--bare', remote);
    const executable = mode === 'direct-hook' ? '/bin/bash' : mode === 'native-push' ? '/usr/bin/git' : join(root, 'scripts/verify/run.mjs');
    const args = mode === 'direct-hook' ? ['-p', join(hooks, 'pre-push')] : mode === 'native-push' ? ['push', remote, 'HEAD'] : ['--layer=0-2'];
    const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', timeout: 25000,
      env: { ...f.env(), 'BASH_FUNC_node%%': '() { return 0; }', 'BASH_FUNC_bash%%': '() { return 0; }' } });
    expect(result.status).not.toBe(0); expect(callCount()).toBe(1);
    expect(f.git('--git-dir=' + remote, 'for-each-ref')).toBe('');
  });

  test('protected shipping child clears caller Git repository selectors', () => {
    setup(); expect(prepare().status).toBe(0);
    const root = f.root(), fake = join(root, '.evidence/alternate-worktree'); mkdirSync(fake);
    f.setEnv({ ...f.env(), GIT_DIR: join(root, '.git'), GIT_WORK_TREE: fake });
    const result = session('env > .evidence/child-environment', false);
    if (result.status !== 0) throw Error(String(result.stderr));
    expect(readFileSync(join(root, '.evidence/child-environment'), 'utf8')).not.toMatch(/^GIT_(?:DIR|WORK_TREE)=/m);
    expect(callCount()).toBe(1);
  });

  test('caller Git repository selectors cannot replay review for an earlier source', () => {
    setup(); expect(prepare().status).toBe(0);
    const root = f.root(), retained = join(root, '.evidence/reviewed-repo');
    f.git('clone', '-q', root, retained);
    f.git('-C', retained, 'update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'origin/main').trim());
    writeFileSync(join(root, 'app.ts'), 'export const value = 3;\n');
    f.git('add', 'app.ts'); f.git('commit', '-qm', 'unreviewed candidate');
    f.setEnv({ ...f.env(), GIT_DIR: join(retained, '.git'), GIT_WORK_TREE: retained });
    const result = session('echo unreviewed >> .evidence/order', false);
    if (result.status === 0) throw Error('Alternate Git context admitted earlier-source review for an unreviewed head: ' + result.stdout + result.stderr);
    expect(callCount()).toBe(1); expect(order()).not.toContain('unreviewed');
  });

}
