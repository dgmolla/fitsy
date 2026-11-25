import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anthropicReader, defaultReaders, keyFromEnvFile, posthogReader, supabaseReader, vercelPlanReader } from './readers.mjs';

const billing = {
  billing_plan: 'paid', current_total_amount_usd_after_discount: '12.50', projected_total_amount_usd_after_discount: '30.00',
  usage_summary: { events: { usage: 900000, limit: null, free_tier_units: 1000000 } },
};

test('the PostHog reader turns the billing response into plain numbers and sends only a bearer header', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push({ url, auth: init.headers.authorization }); return { ok: true, status: 200, json: async () => billing }; };
  const reading = await posthogReader({ key: 'phx_secret_value', fetchImpl })();
  assert.deepEqual(reading, { used: 900000, limit: 1000000, unit: 'events (free tier)', spendUsd: 12.5, projectedSpendUsd: 30, note: 'plan paid' });
  assert.deepEqual(seen, [{ url: 'https://us.posthog.com/api/billing/', auth: 'Bearer phx_secret_value' }]);
  assert.equal(JSON.stringify(reading).includes('phx_secret_value'), false);
});

test('a failing provider call reports only the HTTP status', async () => {
  await assert.rejects(posthogReader({ key: 'phx_secret_value', fetchImpl: async () => ({ ok: false, status: 403 }) })(), error => {
    assert.match(error.message, /HTTP 403/);
    assert.equal(error.message.includes('phx_secret_value'), false);
    return true;
  });
});

test('readers register only when their key file exists', () => {
  const home = mkdtempSync(join(tmpdir(), 'cost-readers-'));
  try {
    assert.deepEqual(Object.keys(defaultReaders({ home })), []);
    mkdirSync(join(home, '.config/fitsy'), { recursive: true });
    writeFileSync(join(home, '.config/fitsy/posthog-read.env'), 'POSTHOG_READ_KEY=phx_x\n');
    assert.deepEqual(Object.keys(defaultReaders({ home })), ['PostHog']);
    assert.equal(keyFromEnvFile(join(home, '.config/fitsy/posthog-read.env'), 'POSTHOG_READ_KEY'), 'phx_x');
    assert.equal(keyFromEnvFile(join(home, 'missing.env'), 'X'), null);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('the Anthropic reader sums cents across pages into month-to-date dollars and projects the month', async () => {
  const urls = [];
  const pages = [
    { data: [{ results: [{ amount: '150.5' }, { amount: '49.5' }] }], has_more: true, next_page: 'p2' },
    { data: [{ results: [{ amount: '300' }] }, { results: [] }], has_more: false, next_page: null },
  ];
  const fetchImpl = async (url, init) => { urls.push({ url, key: init.headers['x-api-key'] }); return { ok: true, status: 200, json: async () => pages[urls.length - 1] }; };
  const reading = await anthropicReader({ key: 'sk-ant-admin-secret', fetchImpl, now: () => new Date('2026-11-10T12:00:00Z') })();
  assert.equal(reading.spendUsd, 5);
  assert.equal(reading.projectedSpendUsd, 15);
  assert.match(urls[0].url, /cost_report\?starting_at=2026-11-01T00:00:00Z&limit=31$/);
  assert.match(urls[1].url, /&page=p2$/);
  assert.equal(JSON.stringify(reading).includes('sk-ant-admin-secret'), false);
});

test('an Anthropic read failure reports only the status, and the reader registers from anthropic.env', async () => {
  await assert.rejects(anthropicReader({ key: 'sk-ant-admin-secret', fetchImpl: async () => ({ ok: false, status: 401 }) })(), error => /HTTP 401/.test(error.message) && !error.message.includes('sk-ant'));
  const home = mkdtempSync(join(tmpdir(), 'cost-readers-'));
  try {
    mkdirSync(join(home, '.config/fitsy'), { recursive: true });
    writeFileSync(join(home, '.config/fitsy/anthropic.env'), 'ANTHROPIC_ADMIN_KEY=sk-ant-x\n');
    assert.deepEqual(Object.keys(defaultReaders({ home })), ['Anthropic API']);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('the Supabase reader sums recent API requests across projects and flags unhealthy ones, without a spend figure', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(url);
    assert.equal(init.headers.authorization, 'Bearer sbp_secret');
    const body = url.endsWith('/v1/projects')
      ? [{ ref: 'a', name: 'fitsy', status: 'ACTIVE_HEALTHY' }, { ref: 'b', name: 'fitsy-dev', status: 'INACTIVE' }]
      : { result: [{ count: url.includes('/a/') ? 50 : 2 }] };
    return { ok: true, status: 200, json: async () => body };
  };
  const reading = await supabaseReader({ key: 'sbp_secret', fetchImpl })();
  assert.equal(reading.used, 52);
  assert.equal(reading.spendUsd, null);
  assert.equal(reading.note, 'not healthy: fitsy-dev');
  assert.equal(seen.length, 3);
  assert.equal(JSON.stringify(reading).includes('sbp_secret'), false);
  await assert.rejects(supabaseReader({ key: 'sbp_secret', fetchImpl: async () => ({ ok: false, status: 403 }) })(), /HTTP 403/);
});

test('the Vercel plan reader prices the plan at its list price and labels it an estimate, and refuses an unreadable plan', async () => {
  const run = () => JSON.stringify({ teams: [{ billing: { plan: 'pro', status: 'active', currency: 'usd' }, id: 'team_secret' }] });
  const reading = await vercelPlanReader({ run })();
  assert.equal(reading.spendUsd, 20);
  assert.match(reading.note, /list price \(est\.\) \$20\/seat\/month/);
  assert.equal(JSON.stringify(reading).includes('team_secret'), false);
  assert.equal((await vercelPlanReader({ run: () => JSON.stringify({ teams: [{ billing: { plan: 'enterprise' } }] }) })()).spendUsd, null);
  await assert.rejects(vercelPlanReader({ run: () => JSON.stringify({ teams: [] }) })(), /not readable/);
});
