// Provider readers for the cost collector (#994). Each reader is read-only (GET), returns plain numbers, and never returns or
// logs its key. Keys come from ~/.config/fitsy/*.env files created for this purpose (chmod 600); a missing file means the reader
// is simply not registered and the service shows as "no access yet".
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function keyFromEnvFile(file, name) {
  if (!existsSync(file)) return null;
  const value = new RegExp(`^${name}=(.*)$`, 'm').exec(readFileSync(file, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '');
  return value || null;
}

const money = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// PostHog: GET /api/billing/ with a personal key scoped to Billing: Read. Spend is this period's amount after discount; the
// quota is the free tier of events (a paid plan has no hard events limit), so the percent shows how far past or inside it we are.
export function posthogReader({ key, fetchImpl = fetch, host = 'https://us.posthog.com' }) {
  return async () => {
    const response = await fetchImpl(`${host}/api/billing/`, { headers: { authorization: `Bearer ${key}` }, redirect: 'error' });
    if (!response.ok) throw new Error(`posthog billing read failed (HTTP ${response.status})`);
    const body = await response.json();
    const events = body.usage_summary?.events ?? {};
    return {
      used: Number.isFinite(events.usage) ? events.usage : null,
      limit: Number.isFinite(events.free_tier_units) && events.free_tier_units > 0 ? events.free_tier_units : null,
      unit: 'events (free tier)',
      spendUsd: money(body.current_total_amount_usd_after_discount ?? body.current_total_amount_usd),
      projectedSpendUsd: money(body.projected_total_amount_usd_after_discount ?? body.projected_total_amount_usd),
      note: `plan ${typeof body.billing_plan === 'string' ? body.billing_plan : 'unknown'}`,
    };
  };
}

// Anthropic: GET /v1/organizations/cost_report with an Admin key (reads only). Amounts are decimal strings in cents ("123.45"
// is $1.2345). Spend is the month to date; the projection is that daily average over the month's length.
export function anthropicReader({ key, fetchImpl = fetch, now = () => new Date(), host = 'https://api.anthropic.com' }) {
  return async () => {
    const at = now();
    const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    const daysInMonth = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0)).getUTCDate();
    const elapsedDays = Math.max(1, at.getUTCDate());
    let cents = 0;
    let page = null;
    for (let requests = 0; requests < 5; requests += 1) {
      const url = `${host}/v1/organizations/cost_report?starting_at=${start.toISOString().replace('.000Z', 'Z')}&limit=31${page ? `&page=${encodeURIComponent(page)}` : ''}`;
      const response = await fetchImpl(url, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, redirect: 'error' });
      if (!response.ok) throw new Error(`anthropic cost read failed (HTTP ${response.status})`);
      const body = await response.json();
      for (const bucket of body.data ?? []) for (const row of bucket.results ?? []) cents += Number(row.amount) || 0;
      if (!body.has_more || !body.next_page) break;
      page = body.next_page;
    }
    const spend = money((cents / 100).toFixed(2));
    return { used: null, limit: null, unit: 'usd', spendUsd: spend, projectedSpendUsd: money(((cents / 100) / elapsedDays * daysInMonth).toFixed(2)), note: 'month to date, usage based' };
  };
}

export function defaultReaders({ home = process.env.HOME, fetchImpl = fetch } = {}) {
  const dir = resolve(home, '.config/fitsy');
  const readers = {};
  const posthogKey = keyFromEnvFile(resolve(dir, 'posthog-read.env'), 'POSTHOG_READ_KEY');
  if (posthogKey) readers.PostHog = posthogReader({ key: posthogKey, fetchImpl });
  const anthropicKey = keyFromEnvFile(resolve(dir, 'anthropic.env'), 'ANTHROPIC_ADMIN_KEY');
  if (anthropicKey) readers['Anthropic API'] = anthropicReader({ key: anthropicKey, fetchImpl });
  return readers;
}
