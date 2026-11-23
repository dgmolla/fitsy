import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, manualReaders } from './collect.mjs';

test('hand-entered figures become readings, a missing file means none, bad JSON is reported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cost-'));
  try {
    const file = join(dir, 'manual.json');
    assert.deepEqual(manualReaders(file), {});
    writeFileSync(file, JSON.stringify({ Supabase: { used: 90, limit: 100, unit: 'MB', spendUsd: 0 } }));
    assert.deepEqual(await manualReaders(file).Supabase(), { used: 90, limit: 100, unit: 'MB', spendUsd: 0 });
    writeFileSync(file, '{ nope');
    assert.throws(() => manualReaders(file), /not valid JSON/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('collect writes a snapshot and a page, alerts on a near-full quota, and compares with the previous run', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cost-home-'));
  try {
    const config = join(home, '.config/fitsy');
    mkdirSync(config, { recursive: true });
    writeFileSync(join(config, 'cost-manual.json'), JSON.stringify({ Supabase: { used: 450, limit: 500, unit: 'MB', spendUsd: 0, projectedSpendUsd: 0 } }));
    const first = await collect({ home, now: new Date('2026-11-23T00:00:00Z') });
    assert.deepEqual(first.alerts, ['Supabase is at 90% of its MB limit']);
    const snapshot = JSON.parse(readFileSync(join(config, 'cost-snapshot.json'), 'utf8'));
    assert.equal(snapshot.services.find(row => row.name === 'Supabase').status, 'ok');
    assert.equal(snapshot.services.find(row => row.name === 'Vercel').status, 'no access yet');
    const page = readFileSync(join(config, 'cost-page/index.html'), 'utf8');
    assert.ok(page.includes('Supabase is at 90%'));
    assert.ok(!/sk_|Bearer/.test(readFileSync(join(config, 'cost-snapshot.json'), 'utf8')));
    writeFileSync(join(config, 'cost-manual.json'), JSON.stringify({ Supabase: { spendUsd: 10, projectedSpendUsd: 10 } }));
    await collect({ home, now: new Date('2026-11-23T01:00:00Z') });
    writeFileSync(join(config, 'cost-manual.json'), JSON.stringify({ Supabase: { spendUsd: 10, projectedSpendUsd: 20 } }));
    const third = await collect({ home, now: new Date('2026-11-23T02:00:00Z') });
    assert.deepEqual(third.alerts, ['projected month-end spend rose from $10 to $20 (over 50%)']);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
