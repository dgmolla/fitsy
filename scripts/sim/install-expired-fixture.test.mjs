import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installExpiredFixture } from './install-expired-fixture.mjs';

const controls = fileURLToPath(new URL('.', import.meta.url));
async function fixture(action) {
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-host-fixture-'));
  try {
    const source = join(directory, 'source'), host = join(directory, 'host');
    mkdirSync(join(source, 'scripts/sim'), { recursive: true }); mkdirSync(host);
    for (const name of ['expired-fixture.mjs', 'backend-identity.mjs']) copyFileSync(join(controls, name), join(source, 'scripts/sim', name));
    const git = args => execFileSync('git', args, { cwd: source, encoding: 'utf8', env: {
      ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test',
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test',
    } }).trim();
    git(['init', '-q']); git(['config', 'core.hooksPath', '/dev/null']);
    git(['add', '.']); git(['commit', '-qm', 'isolated fixture source']);
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    for (const name of ['poller.mjs', 'expired-runner.mjs'])
      writeFileSync(join(host, name), "import { prepareExpiredFixture } from './expired-fixture.mjs';\n");
    writeFileSync(join(host, 'expired-fixture.mjs'), '// previous host implementation\n');
    writeFileSync(join(host, 'expired-state.json'), 'real history must survive');
    await action({ source, host, git });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('the existing host import loads the main preview-capable fixture in a fresh process', async () => fixture(async ({ source, host }) => {
  const receipt = installExpiredFixture(host, source);
  assert.equal(receipt.changed, true);
  assert.equal(readFileSync(receipt.backup, 'utf8'), '// previous host implementation\n');
  assert.equal(readFileSync(join(host, 'expired-state.json'), 'utf8'), 'real history must survive');
  const script = `import {expiredSession} from './expired-fixture.mjs';
    globalThis.fetch=async url=>({ok:true,json:async()=>({token:String(url),user:{id:'11111111-1111-4111-8111-111111111111'}})});
    console.log(JSON.stringify(await expiredSession({
      EXPO_PUBLIC_API_URL:'https://fitsy-api-abc123-dawits-projects-74b6e00f.vercel.app',
      EXPO_PUBLIC_REVENUECAT_TEST_KEY:'test_fixture',
      FITSY_SIM_EXPIRED_LOGIN_EMAIL:'seed-sim-expired@fitsy.dev',FITSY_SIM_EXPIRED_LOGIN_PASSWORD:'fixture-password'})));`;
  const observed = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: host, encoding: 'utf8' }));
  assert.equal(observed.token, 'https://fitsy-api-abc123-dawits-projects-74b6e00f.vercel.app/api/auth/login');
  assert.equal(receipt.requiresNewProcess, true);
  const history = readdirSync(join(host, 'fixture-installations'));
  assert.equal(installExpiredFixture(host, source).changed, false);
  assert.deepEqual(readdirSync(join(host, 'fixture-installations')), history);
}));

test('busy host and dirty or unmerged source cannot install', async () => fixture(async ({ source, host, git }) => {
  mkdirSync(join(host, 'lock'));
  assert.throws(() => installExpiredFixture(host, source), /runner busy/);
  rmSync(join(host, 'lock'), { recursive: true });
  writeFileSync(join(source, 'dirty'), 'candidate');
  assert.throws(() => installExpiredFixture(host, source), /clean reviewed checkout/);
  git(['add', '.']); git(['commit', '-qm', 'isolated candidate']);
  assert.throws(() => installExpiredFixture(host, source), /clean reviewed checkout/);
  assert.equal(readFileSync(join(host, 'expired-fixture.mjs'), 'utf8'), '// previous host implementation\n');
  assert.equal(existsSync(join(host, 'fixture-installations')), false);
}));

test('changed caller contracts and modified installed snapshots fail closed', async () => fixture(async ({ source, host }) => {
  writeFileSync(join(host, 'poller.mjs'), '// changed import contract');
  assert.throws(() => installExpiredFixture(host, source), /no longer uses/);
  writeFileSync(join(host, 'poller.mjs'), "import { prepareExpiredFixture } from './expired-fixture.mjs';\n");
  installExpiredFixture(host, source);
  const bundle = join(host, 'fixture-modules', readdirSync(join(host, 'fixture-modules'))[0], 'expired-fixture.mjs');
  chmodSync(bundle, 0o600); writeFileSync(bundle, '// changed');
  assert.throws(() => installExpiredFixture(host, source), /snapshot changed/);
}));
