import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { journeyFixture, withFixtureEnvironment, prepareJourney, assertJourneyStore } from './journey-fixtures.mjs';
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

test('full selection prepares every required account/store after earlier journeys clear authentication', async () => {
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
    let authenticated = false;
    const observed = [];
    for (const flow of simulatorFlows()) {
      const fixture = journeyFixture(header(flow), file);
      await withFixtureEnvironment(fixture, async () => {
        // Models the destructive boundary that originally broke the next flow.
        // No state is inherited as a substitute for a required setup invocation.
        authenticated = false;
        prepareJourney(fixture, flow, '54503F5C-8A3C-4699-8401-2E1D32890A24');
        if (expected[flow]) {
          const last = JSON.parse(readFileSync(trace, 'utf8').trim().split('\n').at(-1));
          assert.equal(last.flow, flow); assert.equal(last.fixture, expected[flow][0]);
          assert.equal(last.account, `${fixture.name}@example.test`);
          assert.equal(last.udid, '54503F5C-8A3C-4699-8401-2E1D32890A24');
          authenticated = true;
          assert.deepEqual(fixture.stores, expected[flow][1]);
          for (const storeMode of ['test-store', 'apple-simulator', 'unconfigured']) {
            if (fixture.stores.includes(storeMode)) assert.doesNotThrow(() => assertJourneyStore(fixture, { storeMode }));
            else assert.throws(() => assertJourneyStore(fixture, { storeMode }), /requires store/);
          }
          observed.push(flow);
        }
        if (flow.startsWith('subscription-')) assert.equal(authenticated, true);
      });
      assert.equal(process.env.EXPO_PUBLIC_DEV_LOGIN_EMAIL, previousEmail);
    }
    assert.deepEqual(observed.sort(), Object.keys(expected).sort());
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
