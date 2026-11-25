import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, evaluateAlerts, renderPage, sanitizeReading } from './snapshot.mjs';

const services = [
  { name: 'Upstash Redis', plan: 'pay as you go', pricing: 'https://upstash.com/pricing/redis', watch: 'daily commands' },
  { name: 'Vercel', plan: 'confirm in console', pricing: 'https://vercel.com/pricing', watch: 'deploys' },
  { name: 'Broken', plan: 'x', pricing: 'https://example.com', watch: 'y' },
];

test('readings are sanitized so extra fields such as keys or ids cannot ride along', () => {
  const clean = sanitizeReading({ used: 90, limit: 100, unit: 'commands', apiKey: 'sk_secret', accountId: 'acct_123', note: 'ok' });
  assert.deepEqual(Object.keys(clean).sort(), ['limit', 'note', 'percent', 'projectedSpendUsd', 'spendUsd', 'unit', 'used']);
  assert.equal(clean.percent, 90);
  assert.equal(JSON.stringify(clean).includes('sk_secret'), false);
});

test('a snapshot marks missing access, survives a failing reader and totals spend', async () => {
  const snapshot = await buildSnapshot({
    services, now: new Date('2026-11-22T21:00:00Z'),
    readers: {
      'Upstash Redis': async () => ({ used: 430000, limit: 500000, unit: 'commands', spendUsd: 1.4, projectedSpendUsd: 3 }),
      Broken: async () => { throw new Error('HTTP 500 from provider\nstack'); },
    },
  });
  const byName = Object.fromEntries(snapshot.services.map(row => [row.name, row]));
  assert.equal(byName['Upstash Redis'].status, 'ok');
  assert.equal(byName.Vercel.status, 'manual/unknown');
  assert.equal(byName.Broken.status, 'error');
  assert.equal(byName.Broken.error, 'HTTP 500 from provider');
  assert.equal(snapshot.totalSpendUsd, 1.4);
  assert.equal(snapshot.totalProjectedUsd, 3);
});

test('alerts fire at 80 percent of a quota and when projected spend jumps over 50 percent', async () => {
  const snapshot = await buildSnapshot({
    services,
    readers: { 'Upstash Redis': async () => ({ used: 430000, limit: 500000, unit: 'commands', spendUsd: 3, projectedSpendUsd: 9 }) },
  });
  assert.deepEqual(evaluateAlerts(snapshot, { totalProjectedUsd: 5 }),
    ['Upstash Redis is at 86% of its commands limit', 'projected month-end spend rose from $5 to $9 (over 50%)']);
  assert.deepEqual(evaluateAlerts(snapshot, { totalProjectedUsd: 8 }), ['Upstash Redis is at 86% of its commands limit']);
});

test('the page is static, escapes content and carries no secrets', async () => {
  const name = '<b>Evil</b>';
  const snapshot = await buildSnapshot({
    services: [{ name, plan: 'p', pricing: 'https://x.test', watch: 'w' }],
    readers: { [name]: async () => ({ used: 1, limit: 2, unit: 'u' }) },
  });
  const html = renderPage(snapshot, ['<script>alert(1)</script>']);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;b&gt;Evil&lt;/b&gt;'));
  assert.ok(html.includes('50%'));
});

test('a service without a usage figure shows its note on the page, and unread services show manual/unknown', async () => {
  const snapshot = await buildSnapshot({ services: [{ name: 'A', plan: 'p', pricing: 'https://a.example', watch: 'w' }, { name: 'B', plan: 'p', pricing: 'https://b.example', watch: 'w' }],
    readers: { A: async () => ({ spendUsd: 20, note: 'plan pro, list price (est.)' }) } });
  const html = renderPage(snapshot, []);
  assert.match(html, /ok: plan pro, list price \(est\.\)/);
  assert.match(html, /manual\/unknown/);
});
