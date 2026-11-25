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
  assert.equal(html.split('<script>').length - 1, 1, 'only the page\'s own static sort script');
  assert.ok(!html.includes('alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;b&gt;Evil&lt;/b&gt;'));
  assert.ok(html.includes('50%'));
});

test('a service without a usage figure shows its note on the page, and unread services show as unknown', async () => {
  const snapshot = await buildSnapshot({ services: [{ name: 'A', plan: 'p', pricing: 'https://a.example', watch: 'w' }, { name: 'B', plan: 'p', pricing: 'https://b.example', watch: 'w' }],
    readers: { A: async () => ({ spendUsd: 20, note: 'plan pro, list price (est.)' }) } });
  const html = renderPage(snapshot, []);
  assert.match(html, /plan pro, list price \(est\.\)/);
  assert.match(html, />unknown</);
  assert.equal(snapshot.services.find(row => row.name === 'B').status, 'manual/unknown');
});

const inventory = [
  { name: 'Measured', plan: 'pro', pricing: 'https://m.example/pricing', watch: 'w', fixedMonthlyUsd: 20 },
  { name: 'Supabase', plan: 'p', pricing: 'https://s.example/pricing', watch: 'w', fixedMonthlyUsd: 25, estimate: { basis: 'list price', monthlyUsd: 25, limit: 'Pro: 8 GB', note: 'awaiting #1072', unconfirmed: true } },
  { name: 'Sentry', plan: 'p', pricing: 'https://sentry.example/pricing', watch: 'w', estimate: { basis: 'free tier', monthlyUsd: 0, limit: '5K errors' } },
  { name: 'Nothing', plan: 'p', pricing: 'https://n.example/pricing', watch: 'w' },
];

test('estimated rows are labelled, kept out of measured totals and replaced by a measured reading', async () => {
  const snapshot = await buildSnapshot({
    services: inventory, now: new Date('2026-11-25T16:30:00Z'),
    readers: { Measured: async () => ({ spendUsd: 3, projectedSpendUsd: 9 }), Supabase: async () => ({ used: 52, unit: 'API requests', note: '2 projects healthy' }) },
  });
  const byName = Object.fromEntries(snapshot.services.map(row => [row.name, row]));
  assert.equal(byName.Measured.basis, 'measured');
  assert.equal(byName.Supabase.basis, 'estimated (list price)');
  assert.equal(byName.Supabase.status, 'unconfirmed');
  assert.equal(byName.Supabase.used, 52, 'a live signal without a price keeps its usage');
  assert.equal(byName.Sentry.basis, 'estimated (free tier)');
  assert.equal(byName.Sentry.status, 'estimated');
  assert.equal(byName.Nothing.basis, 'unknown');
  assert.equal(snapshot.totalSpendUsd, 3);
  assert.equal(snapshot.totalProjectedUsd, 9, 'measured projection excludes estimates');
  assert.equal(snapshot.totalEstimatedUsd, 25);
  assert.equal(snapshot.totalProjectedWithEstimatesUsd, 34);
  assert.equal(snapshot.fixedMonthlyUsd, 45);
  assert.equal(snapshot.freeTierCount, 1, 'only the free-tier estimate sits at $0');
  assert.deepEqual(evaluateAlerts(snapshot, { totalProjectedUsd: 9 }), [], 'estimates never raise the projection alert');
  const replaced = await buildSnapshot({ services: inventory, readers: { Sentry: async () => ({ used: 10, limit: 5000, unit: 'errors', spendUsd: 0 }) } });
  assert.equal(replaced.services.find(row => row.name === 'Sentry').basis, 'measured');
});

test('the dashboard shows KPI cards, a spend chart, quota bars, a sortable table with pills and the unconfirmed notes', async () => {
  const snapshot = await buildSnapshot({
    services: inventory, now: new Date('2026-11-25T16:30:00Z'),
    readers: { Measured: async () => ({ used: 90, limit: 100, unit: 'builds', spendUsd: 3, projectedSpendUsd: 9 }) },
  });
  const html = renderPage(snapshot, []);
  for (const label of ['Spend this month (measured)', 'Projected month end (measured)', 'Projected incl. estimates', 'Fixed monthly commitments', 'Data freshness']) assert.ok(html.includes(label), label);
  assert.match(html, /10:30 AM CT/, 'freshness shows central time as well as UTC');
  assert.match(html, /Nov 25 · 16:30 UTC/);
  assert.match(html, /class="fill measured"/);
  assert.match(html, /class="fill estimated"/);
  assert.match(html, /class="fill orange" style="width:90%"/, 'quota bar colored by percent used');
  assert.match(html, /pill orange">near limit</);
  assert.match(html, /pill amber">unconfirmed</);
  assert.match(html, /pill blue">estimated</);
  assert.match(html, /pill grey">unknown</);
  assert.match(html, /<table id="services">/);
  assert.match(html, /href="https:\/\/s\.example\/pricing"/);
  assert.match(html, /<b>Supabase<\/b>: awaiting #1072/);
  assert.match(html, /<b>Nothing<\/b>: no read path yet/);
  assert.equal(/https?:\/\/[^"' ]*\.(js|css|woff2?)\b/.test(html), false, 'no external assets');
});

test('the page links only https pricing URLs and never contains secret-shaped fields', async () => {
  const snapshot = await buildSnapshot({
    services: [{ name: 'Bad', plan: 'p', pricing: 'javascript:alert(1)', watch: 'w' }],
    readers: { Bad: async () => ({ used: 1, apiKey: 'sk_live_secret', token: 'tok_secret', note: 'ok' }) },
  });
  const html = renderPage(snapshot, []);
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('sk_live_secret') && !html.includes('tok_secret'));
  assert.ok(html.includes('href="#"'));
});
