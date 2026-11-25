// Provider readers for the cost collector (#994). Each reader is read-only (GET), returns plain numbers, and never returns or
// logs its key. Keys come from ~/.config/fitsy/*.env files created for this purpose (chmod 600); a missing file means the reader
// is simply not registered and the service shows as "manual/unknown".
import { execFileSync } from 'node:child_process';
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

// Supabase: the Management API exposes no billing or org usage (probed: organizations 403, billing/usage 404), so this reader gives
// the live signal only: recent API requests across the account's projects, plus project health. Spend stays a hand-entered figure.
export function supabaseReader({ key, fetchImpl = fetch, host = 'https://api.supabase.com' }) {
  const get = async path => {
    const response = await fetchImpl(`${host}${path}`, { headers: { authorization: `Bearer ${key}` }, redirect: 'error' });
    if (!response.ok) throw new Error(`supabase read failed (HTTP ${response.status})`);
    return response.json();
  };
  return async () => {
    const projects = await get('/v1/projects');
    let requests = 0;
    for (const project of projects) requests += Number((await get(`/v1/projects/${project.ref}/analytics/endpoints/usage.api-requests-count`)).result?.[0]?.count) || 0;
    const unhealthy = projects.filter(project => project.status !== 'ACTIVE_HEALTHY').map(project => project.name);
    return { used: requests, limit: null, unit: 'API requests (recent)', spendUsd: null, projectedSpendUsd: null, note: unhealthy.length ? `not healthy: ${unhealthy.join(', ')}` : `${projects.length} projects healthy` };
  };
}

// Vercel: the billing endpoints are not available to this team, but the team record carries its plan. The spend is the plan's published
// list price per seat (Pro is $20 per seat per month, https://vercel.com/pricing) times an assumed single seat: an estimate, labelled so.
const VERCEL_LIST_PRICE_USD = { hobby: 0, pro: 20 };
export function vercelPlanReader({ run = (...args) => execFileSync(args[0], args.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }) } = {}) {
  return async () => {
    const body = JSON.parse(run('vercel', 'api', '/v2/teams'));
    const plan = body.teams?.[0]?.billing?.plan;
    if (typeof plan !== 'string') throw new Error('vercel team plan not readable');
    const price = VERCEL_LIST_PRICE_USD[plan];
    return {
      used: null, limit: null, unit: null, spendUsd: price ?? null, projectedSpendUsd: price ?? null,
      note: price === undefined ? `plan ${plan}: no list price recorded, manual` : `plan ${plan}, list price (est.) $${price}/seat/month x 1 seat, vercel.com/pricing`,
    };
  };
}

// RevenueCat: GET /v2/projects/{id}/metrics/overview with a key scoped to the overview metrics only. RevenueCat is free until $2,500 of
// monthly tracked revenue and then 1 percent of it (https://www.revenuecat.com/pricing), so usage is the trailing 28-day revenue against
// that threshold and the spend is the 1 percent above it, an estimate.
const REVENUECAT_FREE_REVENUE_USD = 2500;
export function revenuecatReader({ key, projectId, fetchImpl = fetch, host = 'https://api.revenuecat.com' }) {
  return async () => {
    const response = await fetchImpl(`${host}/v2/projects/${encodeURIComponent(projectId)}/metrics/overview`, { headers: { authorization: `Bearer ${key}` }, redirect: 'error' });
    if (!response.ok) throw new Error(`revenuecat metrics read failed (HTTP ${response.status})`);
    const body = await response.json();
    const revenue = (body.metrics ?? []).find(metric => metric.id === 'revenue')?.value;
    if (!Number.isFinite(revenue)) throw new Error('revenuecat overview has no revenue metric');
    const spend = Math.round(Math.max(0, revenue - REVENUECAT_FREE_REVENUE_USD) * 0.01 * 100) / 100;
    return { used: revenue, limit: REVENUECAT_FREE_REVENUE_USD, unit: 'USD revenue, last 28 days', spendUsd: spend, projectedSpendUsd: spend, note: '1% above $2,500, estimate' };
  };
}

// Sentry: GET /api/0/organizations/{org}/stats_v2/ with a personal token scoped to org:read only. Usage is the accepted error events over
// the last 30 days against the Developer plan's 5,000 errors per month. The plan price is not readable with this scope, so spend stays
// blank and the inventory estimate supplies it.
const SENTRY_DEVELOPER_ERRORS = 5000;
export function sentryReader({ key, org, fetchImpl = fetch, host = 'https://sentry.io' }) {
  return async () => {
    const url = `${host}/api/0/organizations/${encodeURIComponent(org)}/stats_v2/?field=${encodeURIComponent('sum(quantity)')}&category=error&interval=1d&statsPeriod=30d&groupBy=outcome`;
    const response = await fetchImpl(url, { headers: { authorization: `Bearer ${key}` }, redirect: 'error' });
    if (!response.ok) throw new Error(`sentry stats read failed (HTTP ${response.status})`);
    const body = await response.json();
    const accepted = (body.groups ?? []).find(group => group.by?.outcome === 'accepted')?.totals?.['sum(quantity)'];
    const used = Number.isFinite(accepted) ? accepted : 0;
    return { used, limit: SENTRY_DEVELOPER_ERRORS, unit: 'errors, last 30 days (Developer limit)', spendUsd: null, projectedSpendUsd: null, note: 'accepted error events' };
  };
}

// Firecrawl: GET /v2/team/credit-usage with the app's own key (read-only endpoint). Used is the plan credits minus the remaining ones.
export function firecrawlReader({ key, fetchImpl = fetch, host = 'https://api.firecrawl.dev' }) {
  return async () => {
    const response = await fetchImpl(`${host}/v2/team/credit-usage`, { headers: { authorization: `Bearer ${key}` }, redirect: 'error' });
    if (!response.ok) throw new Error(`firecrawl credit read failed (HTTP ${response.status})`);
    const data = (await response.json()).data ?? {};
    if (!Number.isFinite(data.planCredits) || !Number.isFinite(data.remainingCredits)) throw new Error('firecrawl credit usage has no plan credits');
    return { used: data.planCredits - data.remainingCredits, limit: data.planCredits, unit: 'credits this period', spendUsd: null, projectedSpendUsd: null, note: 'plan price not exposed by the API' };
  };
}

export function defaultReaders({ home = process.env.HOME, fetchImpl = fetch } = {}) {
  const dir = resolve(home, '.config/fitsy');
  const readers = {};
  const posthogKey = keyFromEnvFile(resolve(dir, 'posthog-read.env'), 'POSTHOG_READ_KEY');
  if (posthogKey) readers.PostHog = posthogReader({ key: posthogKey, fetchImpl });
  const anthropicKey = keyFromEnvFile(resolve(dir, 'anthropic.env'), 'ANTHROPIC_ADMIN_KEY');
  if (anthropicKey) readers['Anthropic API'] = anthropicReader({ key: anthropicKey, fetchImpl });
  const supabaseKey = keyFromEnvFile(resolve(dir, 'supabase.env'), 'SUPABASE_ACCESS_TOKEN');
  if (supabaseKey) readers.Supabase = supabaseReader({ key: supabaseKey, fetchImpl });
  const revenuecatKey = keyFromEnvFile(resolve(dir, 'revenuecat.env'), 'REVENUECAT_METRICS_READ_KEY');
  const revenuecatProject = keyFromEnvFile(resolve(dir, 'revenuecat.env'), 'REVENUECAT_PROJECT_ID');
  if (revenuecatKey && revenuecatProject) readers.RevenueCat = revenuecatReader({ key: revenuecatKey, projectId: revenuecatProject, fetchImpl });
  const sentryToken = keyFromEnvFile(resolve(dir, 'sentry.env'), 'SENTRY_READ_TOKEN');
  const sentryOrg = keyFromEnvFile(resolve(dir, 'sentry.env'), 'SENTRY_ORG');
  if (sentryToken && sentryOrg) readers.Sentry = sentryReader({ key: sentryToken, org: sentryOrg, fetchImpl });
  const firecrawlKey = keyFromEnvFile(resolve(dir, 'firecrawl.env'), 'FIRECRAWL_API_KEY');
  if (firecrawlKey) readers.Firecrawl = firecrawlReader({ key: firecrawlKey, fetchImpl });
  return readers;
}
