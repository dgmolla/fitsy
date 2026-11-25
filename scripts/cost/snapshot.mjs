// Cost dashboard core (#994, #1078): turns provider readings into a sanitized snapshot, evaluates alerts, and renders a static page.
// Providers are plain functions that return a reading or null (no access yet); this module never sees a key.
// A service without a reading but with an `estimate` in the inventory becomes an estimated row (list price or free tier), never
// measured usage; measured rows replace it as soon as a reader exists.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const round2 = value => Math.round(value * 100) / 100;

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

// The inventory estimate: { basis: 'list price' | 'free tier', monthlyUsd, limit, note?, unconfirmed? }. Only these fields are kept.
function sanitizeEstimate(estimate) {
  if (!estimate || !Number.isFinite(estimate.monthlyUsd)) return null;
  return {
    basis: estimate.basis === 'free tier' ? 'free tier' : 'list price', monthlyUsd: Number(estimate.monthlyUsd),
    limit: typeof estimate.limit === 'string' ? estimate.limit.slice(0, 120) : null,
    note: typeof estimate.note === 'string' ? estimate.note.slice(0, 160) : null, unconfirmed: estimate.unconfirmed === true,
  };
}

export async function buildSnapshot({ services, readers, now = new Date() }) {
  const rows = [];
  for (const service of services) {
    let reading = null, error = null;
    try { reading = sanitizeReading(await readers[service.name]?.()); } catch (failure) { error = String(failure?.message ?? failure).split('\n')[0].slice(0, 120); }
    const estimate = sanitizeEstimate(service.estimate);
    const base = { name: service.name, plan: service.plan, pricing: service.pricing, watch: service.watch, fixedMonthlyUsd: Number.isFinite(service.fixedMonthlyUsd) ? service.fixedMonthlyUsd : 0 };
    if (error) rows.push({ ...base, status: 'error', basis: 'unknown', error });
    else if (reading && estimate && reading.spendUsd === null && reading.projectedSpendUsd === null) {
      // A live signal without a price (for example project health): keep its usage and take the cost from the estimate.
      rows.push({
        ...base, ...reading, status: estimate.unconfirmed ? 'unconfirmed' : 'estimated', basis: `estimated (${estimate.basis})`, error: null,
        spendUsd: estimate.monthlyUsd, projectedSpendUsd: estimate.monthlyUsd, limitText: estimate.limit,
        note: [estimate.note, reading.note].filter(Boolean).join('; ').slice(0, 160) || null,
      });
    } else if (reading) rows.push({ ...base, status: 'ok', basis: 'measured', error: null, ...reading });
    else if (estimate) {
      rows.push({
        ...base, status: estimate.unconfirmed ? 'unconfirmed' : 'estimated', basis: `estimated (${estimate.basis})`, error: null,
        used: null, limit: null, unit: null, percent: null, spendUsd: estimate.monthlyUsd, projectedSpendUsd: estimate.monthlyUsd,
        limitText: estimate.limit, note: estimate.note,
      });
    } else rows.push({ ...base, status: 'manual/unknown', basis: 'unknown', error: null });
  }
  const measured = rows.filter(row => row.basis === 'measured');
  const estimated = rows.filter(row => row.basis.startsWith('estimated'));
  const totalSpend = measured.reduce((sum, row) => sum + (row.spendUsd ?? 0), 0);
  const totalProjected = measured.reduce((sum, row) => sum + (row.projectedSpendUsd ?? row.spendUsd ?? 0), 0);
  const totalEstimated = estimated.reduce((sum, row) => sum + (row.spendUsd ?? 0), 0);
  return {
    version: 2, refreshedAt: now.toISOString(), totalSpendUsd: round2(totalSpend), totalProjectedUsd: round2(totalProjected),
    totalEstimatedUsd: round2(totalEstimated), totalProjectedWithEstimatesUsd: round2(totalProjected + totalEstimated),
    fixedMonthlyUsd: round2(rows.reduce((sum, row) => sum + row.fixedMonthlyUsd, 0)),
    freeTierCount: rows.filter(row => row.basis !== 'unknown' && (row.projectedSpendUsd ?? row.spendUsd) === 0).length,
    services: rows,
  };
}

// Alerts: any measured quota at or above 80 percent, or a projected month-end total more than 50 percent above the previous snapshot.
export function evaluateAlerts(snapshot, previous) {
  const alerts = snapshot.services.filter(row => row.percent !== null && row.percent !== undefined && row.percent >= 80)
    .map(row => `${row.name} is at ${row.percent}% of its ${row.unit ?? 'plan'} limit`);
  const before = previous?.totalProjectedUsd;
  if (before > 0 && snapshot.totalProjectedUsd > before * 1.5) {
    alerts.push(`projected month-end spend rose from $${before} to $${snapshot.totalProjectedUsd} (over 50%)`);
  }
  return alerts;
}

const pillFor = row => {
  if (row.status === 'error') return { label: 'error', tone: 'red' };
  if (row.status === 'unconfirmed') return { label: 'unconfirmed', tone: 'amber' };
  if (row.status === 'manual/unknown') return { label: 'unknown', tone: 'grey' };
  if (row.percent !== null && row.percent !== undefined) {
    if (row.percent >= 100) return { label: 'over', tone: 'red' };
    if (row.percent >= 80) return { label: 'near limit', tone: 'orange' };
  }
  return row.status === 'estimated' ? { label: 'estimated', tone: 'blue' } : { label: 'ok', tone: 'green' };
};

const safeUrl = url => (/^https:\/\/[^\s"'<>]+$/.test(String(url)) ? String(url) : '#');
const money = value => (value === null || value === undefined ? '-' : `$${Number(value).toFixed(2)}`);
const stamp = (date, timeZone, zone, timeOnly = false) => `${new Intl.DateTimeFormat('en-US', { timeZone, ...(timeOnly ? {} : { month: 'short', day: 'numeric' }), hour: 'numeric', minute: '2-digit', hour12: true }).format(date)} ${zone}`;
const barTone = percent => (percent >= 100 ? 'red' : percent >= 80 ? 'orange' : percent >= 60 ? 'amber' : 'green');

const usageText = row => {
  if (row.used !== null && row.used !== undefined) return `${row.used}${row.limit ? ` / ${row.limit}` : ''} ${row.unit ?? ''}`.trim();
  if (row.limitText) return `limit: ${row.limitText}`;
  return row.note ?? row.status;
};

const STYLE = `
:root{--bg:#f6f7f9;--card:#fff;--ink:#14161a;--muted:#5f6670;--line:#e3e6ea;--green:#1f9d55;--amber:#d69e2e;--orange:#dd6b20;--red:#d64545;--blue:#2f6fed;--grey:#8a919b}
@media (prefers-color-scheme:dark){:root{--bg:#0e1013;--card:#171a1f;--ink:#eceff3;--muted:#98a1ad;--line:#262b32}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
main{max-width:1120px;margin:0 auto;padding:20px 16px 48px}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.sub{color:var(--muted);margin:0 0 16px}.alert{background:rgba(214,69,69,.12);border:1px solid var(--red);color:var(--ink);border-radius:10px;padding:10px 12px;margin:0 0 8px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px}.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.kpi .label{color:var(--muted);font-size:12px}.kpi .value{font-size:24px;font-weight:650;margin-top:4px}.kpi .value.small{font-size:17px;line-height:1.6}.kpi .hint{color:var(--muted);font-size:12px;margin-top:2px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}.row{display:grid;grid-template-columns:200px 1fr 76px;gap:10px;align-items:center;padding:5px 0}
.row .name{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.track{background:var(--line);border-radius:6px;height:12px;overflow:hidden}.fill{height:100%;border-radius:6px}
.fill.measured{background:var(--blue)}.fill.estimated{background:repeating-linear-gradient(45deg,var(--blue) 0 6px,transparent 6px 12px);opacity:.75}
.fill.green{background:var(--green)}.fill.amber{background:var(--amber)}.fill.orange{background:var(--orange)}.fill.red{background:var(--red)}
.num{text-align:right;font-variant-numeric:tabular-nums;font-size:13px}.legend{color:var(--muted);font-size:12px;margin-top:8px}.empty{color:var(--muted);font-size:13px}
.scroll{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;min-width:760px}
th,td{padding:10px 12px;border-bottom:1px solid var(--line);text-align:left;font-size:13px;vertical-align:top}th{color:var(--muted);font-weight:600;cursor:pointer;white-space:nowrap;user-select:none}
th[aria-sort=ascending]::after{content:" \\25B2"}th[aria-sort=descending]::after{content:" \\25BC"}tr:last-child td{border-bottom:0}a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
.pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;color:#fff}.pill.green{background:var(--green)}.pill.amber{background:var(--amber)}.pill.orange{background:var(--orange)}
.pill.red{background:var(--red)}.pill.blue{background:var(--blue)}.pill.grey{background:var(--grey)}ul.notes{margin:0;padding-left:18px;color:var(--muted)}ul.notes li{margin:4px 0}ul.notes b{color:var(--ink)}
@media (max-width:560px){.row{grid-template-columns:110px 1fr 64px}.kpi .value{font-size:20px}}`;

// Sorts a table by the clicked column using each cell's data-v attribute. No data is interpolated into this script.
const SORT_SCRIPT = `(function(){var t=document.getElementById('services');if(!t)return;var h=t.tHead.rows[0].cells;
Array.prototype.forEach.call(h,function(th,i){th.addEventListener('click',function(){var asc=th.getAttribute('aria-sort')!=='ascending';
Array.prototype.forEach.call(h,function(o){o.removeAttribute('aria-sort')});th.setAttribute('aria-sort',asc?'ascending':'descending');
var rows=Array.prototype.slice.call(t.tBodies[0].rows);rows.sort(function(a,b){var x=a.cells[i].getAttribute('data-v'),y=b.cells[i].getAttribute('data-v');
var nx=parseFloat(x),ny=parseFloat(y),r=(!isNaN(nx)&&!isNaN(ny))?nx-ny:String(x).localeCompare(String(y));return asc?r:-r});
rows.forEach(function(r){t.tBodies[0].appendChild(r)})})})})();`;

export function renderPage(snapshot, alerts = []) {
  const refreshed = new Date(snapshot.refreshedAt);
  const fresh = Number.isNaN(refreshed.getTime()) ? 'unknown' : `${stamp(refreshed, 'America/Chicago', 'CT')} · ${refreshed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const freshShort = Number.isNaN(refreshed.getTime()) ? 'unknown' : stamp(refreshed, 'America/Chicago', 'CT', true);
  const freshHint = Number.isNaN(refreshed.getTime()) ? '' : `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).format(refreshed)} · ${refreshed.toISOString().slice(11, 16)} UTC`;
  const kpi = (label, value, hint, small = false) => `<div class="kpi"><div class="label">${escapeHtml(label)}</div><div class="value${small ? ' small' : ''}">${escapeHtml(value)}</div><div class="hint">${escapeHtml(hint)}</div></div>`;
  const kpis = [
    kpi('Spend this month (measured)', money(snapshot.totalSpendUsd), 'from provider reads'),
    kpi('Projected month end (measured)', money(snapshot.totalProjectedUsd), 'measured services only'),
    kpi('Projected incl. estimates', money(snapshot.totalProjectedWithEstimatesUsd ?? snapshot.totalProjectedUsd), `${money(snapshot.totalEstimatedUsd ?? 0)} of it estimated`),
    kpi('Fixed monthly commitments', money(snapshot.fixedMonthlyUsd ?? 0), 'plans and annual fees'),
    kpi('Services at $0', String(snapshot.freeTierCount ?? 0), `of ${snapshot.services.length} services`),
    kpi('Data freshness', freshShort, freshHint, true),
  ].join('\n');

  const spendRows = snapshot.services.filter(row => (row.spendUsd ?? 0) > 0).sort((a, b) => (b.spendUsd ?? 0) - (a.spendUsd ?? 0));
  const maxSpend = Math.max(...spendRows.map(row => row.spendUsd), 0.01);
  const chart = spendRows.length === 0 ? '<p class="empty">No service has a spend above $0 yet.</p>' : spendRows.map(row => {
    const kind = row.basis === 'measured' ? 'measured' : 'estimated';
    return `<div class="row"><div class="name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</div><div class="track"><div class="fill ${kind}" style="width:${Math.max(2, Math.round((row.spendUsd / maxSpend) * 100))}%"></div></div><div class="num">${money(row.spendUsd)}</div></div>`;
  }).join('\n');

  const quotaRows = snapshot.services.filter(row => row.percent !== null && row.percent !== undefined).sort((a, b) => b.percent - a.percent);
  const quotas = quotaRows.length === 0 ? '<p class="empty">No measured quota yet.</p>' : quotaRows.map(row =>
    `<div class="row"><div class="name" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</div><div class="track"><div class="fill ${barTone(row.percent)}" style="width:${Math.min(100, Math.max(row.percent > 0 ? 2 : 0, row.percent))}%"></div></div><div class="num">${row.percent}%</div></div>`).join('\n');

  const tableRows = snapshot.services.map(row => {
    const pill = pillFor(row);
    const cost = row.spendUsd ?? null;
    return `<tr><td data-v="${escapeHtml(row.name)}"><a href="${escapeHtml(safeUrl(row.pricing))}" rel="noopener">${escapeHtml(row.name)}</a></td>`
      + `<td data-v="${escapeHtml(row.plan)}">${escapeHtml(row.plan)}</td>`
      + `<td data-v="${escapeHtml(row.basis)}">${escapeHtml(row.basis)}</td>`
      + `<td data-v="${cost === null ? '' : cost}" class="num">${money(cost)}</td>`
      + `<td data-v="${row.percent ?? ''}">${escapeHtml(usageText(row))}${row.percent !== null && row.percent !== undefined ? ` (${row.percent}%)` : ''}</td>`
      + `<td data-v="${escapeHtml(safeUrl(row.pricing))}"><a href="${escapeHtml(safeUrl(row.pricing))}" rel="noopener">pricing</a></td>`
      + `<td data-v="${escapeHtml(pill.label)}"><span class="pill ${pill.tone}">${escapeHtml(pill.label)}</span></td></tr>`;
  }).join('\n');

  const unconfirmed = snapshot.services.filter(row => ['unconfirmed', 'manual/unknown', 'error'].includes(row.status));
  const notes = unconfirmed.length === 0 ? '<li>Everything is measured or confirmed.</li>' : unconfirmed.map(row => {
    const why = row.status === 'error' ? `read failed: ${row.error}` : row.status === 'unconfirmed' ? (row.note ?? 'plan not confirmed') : 'no read path yet';
    return `<li><b>${escapeHtml(row.name)}</b>: ${escapeHtml(why)}</li>`;
  }).join('\n');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fitsy costs</title>
<style>${STYLE}</style></head><body><main>
<h1>Fitsy cost monitor</h1><p class="sub">Refreshed ${escapeHtml(fresh)}. Measured figures come from provider reads; estimated rows use list prices or free-tier status.</p>
${alerts.map(text => `<div class="alert">${escapeHtml(text)}</div>`).join('\n')}
<div class="kpis">${kpis}</div>
<h2>Spend by service</h2><div class="panel">${chart}<div class="legend">Solid bars are measured, striped bars are estimated (list price).</div></div>
<h2>Quota usage</h2><div class="panel">${quotas}</div>
<h2>All services</h2><div class="scroll"><table id="services"><thead><tr><th>Service</th><th>Plan</th><th>Basis</th><th>Monthly cost</th><th>Usage vs limit</th><th>Source</th><th>Status</th></tr></thead><tbody>
${tableRows}
</tbody></table></div>
<h2>Still unconfirmed</h2><div class="panel"><ul class="notes">
${notes}
</ul></div>
</main><script>${SORT_SCRIPT}</script></body></html>
`;
}
