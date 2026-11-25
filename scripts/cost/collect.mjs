#!/usr/bin/env node
// Mac-side cost collector (#994). Reads hand-entered figures (and later provider readers), writes a sanitized snapshot and a
// static page, and prints any alert line for the on-call job. No key is read here; provider readers plug into `readers`.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultReaders, vercelPlanReader } from './readers.mjs';
import { buildSnapshot, evaluateAlerts, loadInventory, renderPage } from './snapshot.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Hand-entered figures: { "Supabase": { "used": 120, "limit": 500, "unit": "MB", "spendUsd": 0, "projectedSpendUsd": 0, "note": "free tier" } }
export function manualReaders(file) {
  let figures = {};
  if (existsSync(file)) {
    try { figures = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error('cost-manual.json is not valid JSON'); }
  }
  return Object.fromEntries(Object.entries(figures).map(([name, reading]) => [name, async () => reading]));
}

function atomicWrite(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
}

export async function collect({ home = process.env.HOME, now = new Date(), extraReaders = {} } = {}) {
  const dir = resolve(home, '.config/fitsy');
  const snapshotFile = resolve(dir, 'cost-snapshot.json');
  const previous = existsSync(snapshotFile) ? JSON.parse(readFileSync(snapshotFile, 'utf8')) : null;
  // Provider readers (registered only when their key file exists) win over hand-entered figures for the same service.
  const readers = { ...manualReaders(resolve(dir, 'cost-manual.json')), ...defaultReaders({ home }), ...extraReaders };
  const snapshot = await buildSnapshot({ services: loadInventory(root), readers, now });
  const alerts = evaluateAlerts(snapshot, previous);
  atomicWrite(snapshotFile, `${JSON.stringify(snapshot)}\n`);
  atomicWrite(resolve(dir, 'cost-page/index.html'), renderPage(snapshot, alerts));
  return { snapshot, alerts };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { snapshot, alerts } = await collect({ extraReaders: { Vercel: vercelPlanReader() } });
  const withData = snapshot.services.filter(row => row.status === 'ok').length;
  process.stdout.write(`cost snapshot: ${withData} of ${snapshot.services.length} services with data, projected $${snapshot.totalProjectedUsd}\n`);
  for (const alert of alerts) process.stdout.write(`ALERT ${alert}\n`);
}
