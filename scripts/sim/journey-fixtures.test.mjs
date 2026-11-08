import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { journeyFixture, withFixtureEnvironment, prepareJourney, assertJourneyStore, releaseExceptions } from './journey-fixtures.mjs';
import { simulatorFlows, repository } from '../verify/impact-plan.mjs';

const yaml = createRequire(import.meta.url)('js-yaml');
const header = flow => yaml.loadAll(readFileSync(join(repository, `apps/mobile/e2e/flows/${flow}.yaml`), 'utf8'))[0];
const expected = {
  'log-meal': ['entitled-dev', ['test-store']],
  'onboarding-guided-preview': ['unsubscribed-dev', ['test-store']],
  'onboarding-returning-preview': ['unsubscribed-dev', ['test-store']],
  'paywall-live-terms': ['unsubscribed-dev', ['test-store']],
  reminders: ['unsubscribed-dev', ['test-store']],
  'subscription-expired-routing': ['expired-subscription', ['test-store', 'apple-simulator']],
  'subscription-restore-empty': ['empty-store', ['test-store', 'apple-simulator']],
  'subscription-restore-expired': ['apple-history', ['apple-simulator']],
};

test('all account-dependent saved journeys require local preparation before native execution', () => {
  for (const [flow, [fixture]] of Object.entries(expected)) {
    assert.throws(() => journeyFixture(header(flow), ''), new RegExp(`Local fixture ${fixture} is required`));
  }
  assert.equal(journeyFixture(header('signin-options'), '').name, 'default');
});

test('full selection invokes every required account/store adapter without inheriting a previous fixture', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-journey-fixtures-'));
  const config = { version: 1, fixtures: {} }, trace = join(directory, 'trace.jsonl');
  const adapter = join(directory, 'prepare.mjs');
  // External preparation adapter records its selected account and store. The
  // real native journeys remain responsible for asserting those genuine states.
  writeFileSync(adapter, `import {appendFileSync} from 'node:fs';
    const [trace, fixture, flow, udid] = process.argv.slice(2);
    appendFileSync(trace, JSON.stringify({fixture, flow, udid, account:process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL})+'\\n');`);
  for (const [name] of Object.values(expected)) {
    const envFile = join(directory, `${name}.env`);
    writeFileSync(envFile, `EXPO_PUBLIC_DEV_LOGIN_EMAIL=${name}@example.test\nEXPO_PUBLIC_DEV_LOGIN_PASSWORD=fixture-only\n`);
    config.fixtures[name] = { envFile, prepare: [process.execPath, adapter, trace, name] };
  }
  const file = join(directory, 'fixtures.json'); writeFileSync(file, JSON.stringify(config));
  const previousEmail = process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL;
  try {
    const observed = [];
    for (const flow of simulatorFlows()) {
      const fixture = journeyFixture(header(flow), file);
      await withFixtureEnvironment(fixture, async () => {
        // This is adapter selection proof, not native authentication proof.
        // The billing caller separately verifies history and runs ci-signin.
        prepareJourney(fixture, flow, '54503F5C-8A3C-4699-8401-2E1D32890A24');
        if (expected[flow]) {
          const last = JSON.parse(readFileSync(trace, 'utf8').trim().split('\n').at(-1));
          assert.equal(last.flow, flow); assert.equal(last.fixture, expected[flow][0]);
          assert.equal(last.account, `${fixture.name}@example.test`);
          assert.equal(last.udid, '54503F5C-8A3C-4699-8401-2E1D32890A24');
          assert.deepEqual(fixture.stores, expected[flow][1]);
          for (const storeMode of ['test-store', 'apple-simulator', 'unconfigured']) {
            if (fixture.stores.includes(storeMode)) assert.doesNotThrow(() => assertJourneyStore(fixture, { storeMode }));
            else assert.throws(() => assertJourneyStore(fixture, { storeMode }), /requires store/);
          }
          observed.push(flow);
        }
      });
      assert.equal(process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL, previousEmail);
    }
    assert.deepEqual(observed.sort(), Object.keys(expected).sort());
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('inactive billing fixtures require their own credentials rather than inheriting the preceding account', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-inactive-fixture-'));
  try {
    const file = join(directory, 'fixtures.json');
    for (const flow of ['subscription-expired-routing', 'subscription-restore-empty']) {
      const [name] = expected[flow];
      writeFileSync(file, JSON.stringify({ version: 1, fixtures: { [name]: { prepare: ['/usr/bin/true'] } } }));
      assert.throws(() => journeyFixture(header(flow), file), /own local dev login/);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const [name, entry, contents, pattern] of [
  ['missing fixture', undefined, '', /Missing local fixture/],
  ['shell command', { prepare: 'echo unsafe' }, '', /executable argv array/],
  ['relative executable', { prepare: ['prepare-fixture'] }, '', /absolute executable/],
  ['unrelated environment override', { prepare: ['/usr/bin/true'], envFile: true }, 'PATH=/tmp\n', /only override EXPO_PUBLIC_/],
  ['missing dev credentials', { prepare: ['/usr/bin/true'], envFile: true }, 'EXPO_PUBLIC_API_URL=https:\/\/dev.fitsy.org\n', /own local dev login/],
]) test(`fixture preflight rejects ${name}`, () => {
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-fixture-invalid-'));
  try {
    const file = join(directory, 'fixtures.json'), envFile = join(directory, 'local.env');
    writeFileSync(envFile, contents);
    writeFileSync(file, JSON.stringify({ version: 1, fixtures: { 'entitled-dev': entry && { ...entry,
      ...(entry.envFile ? { envFile } : {}) } } }));
    assert.throws(() => journeyFixture(header('log-meal'), file), pattern);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('tracked configuration cannot become local fixture authority', () => {
  assert.throws(() => journeyFixture(header('log-meal'), join(repository, 'package.json')), /must not be tracked/);
});

test('failed preparation restores the caller environment and cannot continue to native execution', async () => {
  const previous = process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL;
  let continued = false;
  await assert.rejects(withFixtureEnvironment({ name: 'broken', env: { EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'isolated@example.test' },
    prepare: [process.execPath, '-e', 'process.exit(17)'] }, async () => {
    prepareJourney({ prepare: [process.execPath, '-e', 'process.exit(17)'] }, 'broken', 'owned-device');
    continued = true;
  }));
  assert.equal(continued, false); assert.equal(process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL, previous);
});

test('account fixtures cannot silently switch a PR preview back to stable dev', async () => {
  const previous = process.env.EXPO_PUBLIC_API_URL;
  const preview = 'https://fitsy-api-git-codex-issue-583-dawits-projects-74b6e00f.vercel.app';
  process.env.EXPO_PUBLIC_API_URL = preview;
  let executed = false;
  try {
    await assert.rejects(withFixtureEnvironment({ env: { EXPO_PUBLIC_API_URL: 'https://dev.fitsy.org' } }, async () => {
      executed = true;
    }), /Fixture API origin differs/);
    assert.equal(executed, false);
    assert.equal(process.env.EXPO_PUBLIC_API_URL, preview);
    for (const env of [{}, { EXPO_PUBLIC_API_URL: preview }]) {
      await withFixtureEnvironment({ env }, async () => assert.equal(process.env.EXPO_PUBLIC_API_URL, preview));
      assert.equal(process.env.EXPO_PUBLIC_API_URL, preview);
    }
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = previous;
  }
});

// The exact public owner grant is deliberately pinned, including edits/revocation.
const releaseApprovalBody = "**TL;DR:** Owner approval (Dawit, 2026-11-07 19:14 PT, \"Appr auto these always\"). This grants a standing, scoped approval for the three boundaries in [6716284756](https://github.com/dgmolla/fitsy/issues/755#issuecomment-6716284756). Root 64440: resume the same workstream (`codex/issue-753`, PR754 at d5a16dc2) with one successor worker. Don't run parallel workers.\n\n**1. Duplicate screenshot cleanup: APPROVED.**\n- Scope is only the sealed proposal `aabf2e5d48ae01c9124263384a1c93efd345aa156d15736dfcb17385b3c17245`: exactly 16,119 byte-identical duplicate PNGs (10,361,606,936 bytes). The outside-path and age exception applies to that list only.\n- Keep all 851 verified representatives and every required receipt and recovery input (task.env, fixtures, persistent-expired.env, bundles, archives).\n- Before deleting, re-check file identities, hashes, that nothing is writing to them, and the free-space projection. Use the existing `scripts/delivery/cleanup.py`: dry-run first, then `--apply`.\n- No broad rm, and no deleting repo or user data.\n\n**2. Self-hosted Mac runner registration: APPROVED.**\n- Register `fitsy-mac` with labels `fitsy-sim` for https://github.com/dgmolla/fitsy using only official GitHub tooling: get a registration token through the supported API or gh under existing admin auth, run `config.sh`, then install and start the service. Confirm the runner reads back as online and matching.\n- Never print or log the token or secrets.\n- If GitHub or macOS needs an interactive auth or approval step that existing auth can't do, stop at that exact step and report the missing action precisely. Don't re-ask for this approval, and don't work around the step.\n\n**3. `subscription-restore-expired` Apple-history: release exception APPROVED** for this map/#746 release only.\n- Record it transparently as **excepted, not passed**, with the reason \"unprovisioned real Apple purchase history\".\n- Every other required native flow (the remaining full-28 selection on normal), the auth and subscription regression checks, Verify, AI review and branch protection all stay required.\n- This doesn't extend to any other test, and it isn't a #735/#745 transfer.\n\n**Then continue the approved ship serially:**\n1. Cleanup, then the full normal run on the exact final head.\n2. The runner job goes green for real.\n3. Mark ready and do a protected merge (no admin merge, no faked check).\n4. #746 production activation of C.\n5. EAS/TestFlight. No App Store submission, no production DB writes.\n6. Post-release smoke test. Post the SHAs, build IDs and TestFlight status here and on #746.\n\n**Mandatory audit:** explain why owner blockers, the missing runner, the lock and disk all stalled at once, and add safe preventive defaults, for example screenshot dedupe/retention at capture time and an earlier runner-capacity preflight.\n\n**After a verified shipment:** file the deferred \"Your location\" test issue. #758 stays on hold.\n";

test('release admission retains the full catalog and excepts only genuine Apple-history on the published source', () => {
  const catalog = Object.fromEntries(simulatorFlows().map(name => [name, header(name)]));
  const names = Object.keys(catalog);
  const head = 'a'.repeat(40);
  const approval = { id: 6716597294, user: { login: 'dgmolla' }, body: releaseApprovalBody };
  const pr = { number: 754, state: 'open', head: { sha: head, ref: 'codex/issue-753', repo: { full_name: 'dgmolla/fitsy' } } };
  const execute = (binary, args) => binary === 'git' ? head : JSON.stringify(args.at(-1).endsWith('/754') ? pr : approval);
  assert.deepEqual(releaseExceptions(names, catalog), []);
  assert.throws(() => releaseExceptions(names, catalog, '745', execute), /Unknown/);
  const result = releaseExceptions(names, catalog, '6716597294', execute);
  assert.equal(names.length, 28);
  assert.equal(names.filter(name => !result.some(item => item.flow === name)).length, 27);
  assert.deepEqual(result, [{ flow: 'subscription-restore-expired', status: 'EXCEPTED',
    reason: 'unprovisioned real Apple purchase history',
    approval: 'https://github.com/dgmolla/fitsy/issues/755#issuecomment-6716597294', release: 'map/#746',
    source: head, prHead: head, fixture: 'apple-history', store: 'apple-simulator' }]);
  for (const problem of ['source', 'closed', 'branch', 'repo', 'author', 'grant', 'tag', 'inventory']) {
    const original = JSON.stringify({ pr, approval, catalog });
    if (problem === 'source') pr.head.sha = 'b'.repeat(40);
    if (problem === 'closed') pr.state = 'closed';
    if (problem === 'branch') pr.head.ref = 'codex/issue-746';
    if (problem === 'repo') pr.head.repo.full_name = 'foreign/fitsy';
    if (problem === 'author') approval.user.login = 'different-owner';
    if (problem === 'grant') approval.body += ' revoked';
    if (problem === 'tag') catalog['subscription-restore-expired'].tags = ['fixture:empty-store', 'store:test-store'];
    assert.throws(() => releaseExceptions(names, catalog, '6716597294', problem === 'inventory'
      ? () => { throw new Error('private API failure'); } : execute), /exception|contract/);
    const saved = JSON.parse(original); Object.assign(pr, saved.pr); Object.assign(approval, saved.approval); Object.assign(catalog, saved.catalog);
  }
  assert.deepEqual(releaseExceptions(['cold-start-welcome'], catalog, '6716597294', execute), []);
});
