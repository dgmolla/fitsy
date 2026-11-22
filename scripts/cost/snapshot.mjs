// Cost dashboard core (#994): turns provider readings into a sanitized snapshot, evaluates alerts, and renders a static page.
// Providers are plain functions that return a reading or null (no access yet); this module never sees a key.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export function loadInventory(root) {
  return JSON.parse(readFileSync(resolve(root, 'docs/engineering/devops/cost-inventory.json'), 'utf8')).services;
}

// A reading: { used, limit, unit, spendUsd?, projectedSpendUsd?, note? }. Anything else is dropped so no id or key can ride along.
export function sanitizeReading(reading) {
  if (!reading) return null;
  const number = value => (Number.isFinite(value) ? Number(value) : null);
  const used = number(reading.used), limit = number(reading.limit);
  return {
    used, limit, unit: typeof reading.unit === 'string' ? reading.unit.slice(0, 40) : null,
    percent: used !== null && limit ? Math.round((used / limit) * 1000) / 10 : null,
    spendUsd: number(reading.spendUsd), projectedSpendUsd: number(reading.projectedSpendUsd),
    note: typeof reading.note === 'string' ? reading.note.slice(0, 160) : null,
  };
}

export async function buildSnapshot({ services, readers, now = new Date() }) {
  const rows = [];
  for (const service of services) {
    let reading = null, error = null;
    try { reading = sanitizeReading(await readers[service.name]?.()); } catch (failure) { error = String(failure?.message ?? failure).split('\n')[0].slice(0, 120); }
    rows.push({
      name: service.name, plan: service.plan, pricing: service.pricing, watch: service.watch,
      status: error ? 'error' : reading ? 'ok' : 'no access yet', error, ...(reading ?? {}),
    });
  }
  const totalSpend = rows.reduce((sum, row) => sum + (row.spendUsd ?? 0), 0);
  const totalProjected = rows.reduce((sum, row) => sum + (row.projectedSpendUsd ?? row.spendUsd ?? 0), 0);
  return {
    version: 1, refreshedAt: now.toISOString(), totalSpendUsd: Math.round(totalSpend * 100) / 100,
    totalProjectedUsd: Math.round(totalProjected * 100) / 100, services: rows,
  };
}

// Alerts: any quota at or above 80 percent, or a projected month-end total more than 50 percent above the previous snapshot.
export function evaluateAlerts(snapshot, previous) {
  const alerts = snapshot.services.filter(row => row.percent !== null && row.percent >= 80)
    .map(row => `${row.name} is at ${row.percent}% of its ${row.unit ?? 'plan'} limit`);
  const before = previous?.totalProjectedUsd;
  if (before > 0 && snapshot.totalProjectedUsd > before * 1.5) {
    alerts.push(`projected month-end spend rose from $${before} to $${snapshot.totalProjectedUsd} (over 50%)`);
  }
  return alerts;
}

export function renderPage(snapshot, alerts = []) {
  const money = value => (value === null || value === undefined ? '-' : `$${Number(value).toFixed(2)}`);
  const usage = row => (row.used === null || row.used === undefined
    ? escapeHtml(row.status) : `${row.used}${row.limit ? ` / ${row.limit}` : ''} ${escapeHtml(row.unit ?? '')}`);
  const rows = snapshot.services.map(row => `<tr class="${row.percent >= 80 ? 'warn' : ''}"><td><a href="${escapeHtml(row.pricing)}">${escapeHtml(row.name)}</a></td>`
    + `<td>${escapeHtml(row.plan)}</td><td>${usage(row)}</td>`
    + `<td>${row.percent === null || row.percent === undefined ? '-' : `${row.percent}%`}</td><td>${money(row.spendUsd)}</td><td>${money(row.projectedSpendUsd)}</td></tr>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fitsy costs</title>
<style>body{font:16px system-ui;margin:16px}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}.warn{background:#fff3cd}.alert{background:#f8d7da;padding:8px;margin:8px 0}</style></head><body>
<h1>Fitsy costs</h1><p>Refreshed ${escapeHtml(snapshot.refreshedAt)}. Month to date ${money(snapshot.totalSpendUsd)}, projected month end ${money(snapshot.totalProjectedUsd)}.</p>
${alerts.map(text => `<div class="alert">${escapeHtml(text)}</div>`).join('\n')}
<table><thead><tr><th>Service</th><th>Plan</th><th>Usage</th><th>Of limit</th><th>Spend</th><th>Projected</th></tr></thead><tbody>
${rows}
</tbody></table></body></html>
`;
}
