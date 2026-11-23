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

export function defaultReaders({ home = process.env.HOME, fetchImpl = fetch } = {}) {
  const dir = resolve(home, '.config/fitsy');
  const readers = {};
  const posthogKey = keyFromEnvFile(resolve(dir, 'posthog-read.env'), 'POSTHOG_READ_KEY');
  if (posthogKey) readers.PostHog = posthogReader({ key: posthogKey, fetchImpl });
  return readers;
}
