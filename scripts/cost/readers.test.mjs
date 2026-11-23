import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultReaders, keyFromEnvFile, posthogReader } from './readers.mjs';

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
