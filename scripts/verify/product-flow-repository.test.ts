import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const modulePath = resolve(__dirname, 'product-flow.mjs');
let dir: string;
// Never inherit Git-hook repository pointers into fixture subprocesses.
const fixtureEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('GIT_') && !['FITSY_DIFF_BASE', 'FITSY_DIFF_HEAD'].includes(key)));
const fixtureGit = (args: string[]) => execFileSync('git', args, { env: fixtureEnv() });
const evaluate = (expression: string, env = fixtureEnv()) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `import * as gate from ${JSON.stringify(modulePath)}; process.stdout.write(JSON.stringify(${expression}));`], { encoding: 'utf8', env });
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitsy-product-flow-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test('working changes and deletions invalidate the source identity', () => {
  fixtureGit(['init', '-q', dir]); writeFileSync(join(dir, 'app.ts'), 'original');
  fixtureGit(['-C', dir, 'add', 'app.ts']);
  const hash = () => evaluate(`gate.inputHash(${JSON.stringify(dir)})`).stdout;
  const first = hash(); writeFileSync(join(dir, 'app.ts'), 'changed'); expect(hash()).not.toBe(first);
  const second = hash(); rmSync(join(dir, 'app.ts')); expect(hash()).not.toBe(second);
});

test('the real local registry blocks missing evidence but permits explicit non-product applicability', () => {
  const verify = join(dir, 'scripts/verify'); mkdirSync(verify, { recursive: true });
  for (const name of ['run.mjs', 'impact-plan.mjs', 'product-flow.mjs', 'product-flow.sh', 'registry.yml']) {
    copyFileSync(join(__dirname, name), join(verify, name));
  }
  symlinkSync(resolve(__dirname, '../../node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n.evidence/\n');
  fixtureGit(['init', '-q', dir]);
  fixtureGit(['-C', dir, 'add', '.']);
  fixtureGit(['-C', dir, '-c', 'user.name=Gate Test', '-c', 'user.email=gate@example.invalid', 'commit', '-qm', 'baseline']);
  fixtureGit(['-C', dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const check = () => spawnSync(process.execPath, [join(verify, 'run.mjs'), '--only=product-flow', '--runs=local'], {
    cwd: dir, encoding: 'utf8', env: { ...fixtureEnv(), CI: '', FITSY_DIFF_BASE: '' },
  });
  writeFileSync(join(dir, 'notes.md'), 'Documentation change');
  let result = check();
  expect(result.status).toBe(0); expect(result.stdout).toContain('"applicability":"not_applicable"');
  mkdirSync(join(dir, 'apps/mobile/app/welcome'), { recursive: true });
  writeFileSync(join(dir, 'apps/mobile/app/welcome/payment.tsx'), 'changed paywall');
  result = check();
  expect(result.status).toBe(1); expect(result.stdout).toContain('"status":"fail"');
  expect(result.stdout).toContain('"blocking":true'); expect(result.stdout).not.toContain('"status":"skipped"');
});

test('temporary repositories stay isolated when invoked from a Git hook', () => {
  const sentinel = join(dir, 'sentinel'), target = join(dir, 'fixture');
  fixtureGit(['init', '-q', sentinel]);
  const head = readFileSync(join(sentinel, '.git/HEAD'), 'utf8');
  const config = readFileSync(join(sentinel, '.git/config'), 'utf8');
  const variables = { GIT_DIR: join(sentinel, '.git'), GIT_WORK_TREE: sentinel, GIT_INDEX_FILE: join(sentinel, '.git/index') };
  const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, variables);
    fixtureGit(['init', '-q', target]);
    writeFileSync(join(target, 'fixture.txt'), 'fixture data');
    fixtureGit(['-C', target, 'add', '.']);
    expect(fixtureGit(['-C', target, 'ls-files']).toString().trim()).toBe('fixture.txt');
    const expression = `gate.inputHash(${JSON.stringify(target)})`;
    const clean = evaluate(expression), inherited = evaluate(expression, process.env);
    expect(clean.status).toBe(0); expect(inherited.status).toBe(0);
    expect(inherited.stdout).toBe(clean.stdout);
    expect(readFileSync(join(sentinel, '.git/HEAD'), 'utf8')).toBe(head);
    expect(readFileSync(join(sentinel, '.git/config'), 'utf8')).toBe(config);
    expect(fixtureGit(['-C', sentinel, 'ls-files']).toString()).toBe('');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
