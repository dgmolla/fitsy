import { connect } from 'node:tls';
import { requestJson, github } from './production-alerts.mjs';
import { policy, alert, evaluateApi, evaluateMobile, evaluateDeployment, evaluateQuota, evaluateExpiry, evaluateCrons } from './production-policy.mjs';

export async function probeApi({ fetchImpl = fetch, env = process.env } = {}) {
  let servingSha = null;
  const probes = [...policy.probes, { path: '/api/health?deep=1', status: 200, deep: true }];
  const results = await Promise.all(probes.map(async probe => {
    try {
      if (probe.deep && !env.CRON_SECRET) throw new Error('Deep health credential missing');
      const response = await fetchImpl(`${policy.baseUrl}${probe.path}`, {
        headers: probe.deep ? { authorization: `Bearer ${env.CRON_SECRET}` }
          : probe.status === 401 ? { authorization: 'Bearer fitsy-monitor-invalid-session' } : {},
        redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      });
      if (response.status !== probe.status) {
        return alert(`probe:${probe.path}`, 'probes', 'P1', `${probe.path}: expected ${probe.status}, received ${response.status}.`);
      }
      if (probe.path === '/api/health') {
        const health = await response.json();
        if (health.status !== 'ok' || health.db !== 'connected') throw new Error('Invalid health body');
        servingSha = health.deploymentSha;
      }
      if (probe.deep) {
        const health = await response.json();
        if (health.status !== 'ok' || !['supabase', 'upstash', 'revenuecat'].every(key => health.dependencies?.[key] === 'ok')) {
          throw new Error('Invalid deep health body');
        }
      }
      return null;
    } catch {
      return alert(`probe:${probe.path}`, 'probes', 'P1', `${probe.path}: unreachable, invalid health response or monitoring credential missing.`);
    }
  }));
  return { alerts: results.filter(Boolean), servingSha };
}

/** Axiom's tabular protocol is column-oriented. Partial/malformed results cannot pass. */
export function axiomRows(body) {
  if (body.status?.isPartial !== false || !Array.isArray(body.tables) || body.tables.length !== 1) throw new Error('Incomplete Axiom query');
  const table = body.tables[0];
  if (!Array.isArray(table.fields) || !Array.isArray(table.columns) || table.fields.length !== table.columns.length
      || !table.fields.every(field => typeof field.name === 'string') || new Set(table.fields.map(field => field.name)).size !== table.fields.length
      || !table.columns.every(column => Array.isArray(column) && column.length === table.columns[0].length)) throw new Error('Malformed Axiom table');
  return Array.from({ length: table.columns[0]?.length ?? 0 }, (_, index) =>
    Object.fromEntries(table.fields.map((field, column) => [field.name, table.columns[column][index]])));
}

export async function queryAxiom(apl, startTime, endTime, { env, fetchImpl }) {
  if (!env.AXIOM_TOKEN) throw new Error('Axiom query token missing');
  const body = await requestJson('https://api.axiom.co/v1/datasets/_apl?format=tabular', {
    method: 'POST', headers: { authorization: `Bearer ${env.AXIOM_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ apl, startTime: new Date(startTime).toISOString(), endTime: new Date(endTime).toISOString() }),
  }, fetchImpl);
  return axiomRows(body);
}

const apiQuery = `['${policy.dataset}'] | where type == 'api_request' and environment == 'production'`;
const aggregate = " | summarize requests=count(), errors=countif(status >= 500), rejected=countif(status >= 400 and status < 500), p95=percentile(durationMs, 95), lastSeen=max(_time) by route, method";

export async function apiMetrics(context) {
  const cutoff = context.now - policy.windowMinutes * 60_000;
  const [current, baseline] = await Promise.all([
    queryAxiom(apiQuery + aggregate, cutoff, context.now, context),
    queryAxiom(apiQuery + aggregate, context.now - policy.baselineMinutes * 60_000, cutoff, context),
  ]);
  return evaluateApi(current, baseline, context.now);
}

export async function cronMetrics(context) {
  context.state.cronMonitoringStartedAt ??= context.now;
  const rows = await queryAxiom(apiQuery + " | where route startswith '/api/internal/' and status >= 200 and status < 300 | summarize lastSuccess=max(_time) by route",
    context.now - 15 * 86_400_000, context.now, context);
  return evaluateCrons(rows, context.now, context.state.cronMonitoringStartedAt);
}

export async function mobileMetrics({ env, fetchImpl, now }) {
  if (!env.POSTHOG_PERSONAL_API_KEY || !/^\d+$/.test(env.POSTHOG_PROJECT_ID ?? '')) throw new Error('PostHog query configuration missing');
  const cutoff = new Date(now - policy.windowMinutes * 60_000).toISOString();
  const start = new Date(now - policy.baselineMinutes * 60_000).toISOString();
  const recent = `timestamp >= parseDateTimeBestEffort('${cutoff}')`;
  const failed = "properties.outcome IN ('unknown', 'server_error', 'network_error')";
  const subscription = "event = 'subscription_check' AND properties.kind = 'production'";
  const sql = `SELECT countIf(${subscription} AND ${recent}), countIf(${subscription} AND ${recent} AND ${failed}),
    countIf(${subscription} AND NOT (${recent})), countIf(${subscription} AND NOT (${recent}) AND ${failed}),
    countIf(event = 'client_error' AND properties.kind = 'production' AND properties.is_fatal = true AND ${recent})
    FROM events WHERE timestamp >= parseDateTimeBestEffort('${start}') AND timestamp < parseDateTimeBestEffort('${new Date(now).toISOString()}')
    AND event IN ('subscription_check', 'client_error')`;
  const host = env.POSTHOG_HOST || 'https://us.posthog.com';
  if (!['https://us.posthog.com', 'https://eu.posthog.com'].includes(host)) throw new Error('Unsupported PostHog host');
  const body = await requestJson(`${host}/api/projects/${env.POSTHOG_PROJECT_ID}/query/`, {
    method: 'POST', headers: { authorization: `Bearer ${env.POSTHOG_PERSONAL_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql } }),
  }, fetchImpl);
  if (body.error || body.hasMore || body.results?.length !== 1 || body.results[0].length !== 5) throw new Error('Incomplete PostHog response');
  return evaluateMobile(body.results[0]);
}

export async function deploymentMetrics(context, servingSha) {
  const { env, fetchImpl, now, state } = context;
  if (!env.VERCEL_TOKEN) throw new Error('Vercel read credential missing');
  const [main, deployments] = await Promise.all([
    github('commits/main', context),
    requestJson(`https://api.vercel.com/v6/deployments?projectId=${policy.vercelProject}&teamId=${policy.vercelTeam}&target=production&limit=1`,
      { headers: { authorization: `Bearer ${env.VERCEL_TOKEN}` } }, fetchImpl),
  ]);
  const latest = deployments.deployments?.[0];
  if (!latest || !['READY', 'ERROR', 'BUILDING', 'QUEUED', 'CANCELED', 'INITIALIZING'].includes(latest.readyState)) throw new Error('Missing production deployment');
  if (state.mainSha !== main.sha) { state.mainSha = main.sha; state.mainFirstSeenAt = now; }
  return evaluateDeployment({ mainSha: main.sha, mainChangedAt: new Date(state.mainFirstSeenAt).toISOString(), servingSha, latest }, now);
}

export async function quotaMetrics({ env, fetchImpl }) {
  if (!env.UPSTASH_API_KEY || !env.UPSTASH_EMAIL || !/^[a-zA-Z0-9-]+$/.test(env.UPSTASH_DATABASE_ID ?? '')) throw new Error('Quota visibility configuration missing');
  const body = await requestJson(`https://api.upstash.com/v2/redis/stats/${env.UPSTASH_DATABASE_ID}`, {
    headers: { authorization: `Basic ${Buffer.from(`${env.UPSTASH_EMAIL}:${env.UPSTASH_API_KEY}`).toString('base64')}` },
  }, fetchImpl);
  return evaluateQuota(body.daily_net_commands, Number(env.UPSTASH_DAILY_COMMAND_LIMIT));
}

export function certificateExpiry() {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: 'fitsy.org', port: 443, servername: 'fitsy.org', rejectUnauthorized: true });
    socket.setTimeout(5_000);
    socket.once('secureConnect', () => { const expiry = socket.getPeerCertificate().valid_to; socket.destroy(); resolve(expiry); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('TLS check timeout')); });
    socket.once('error', () => { socket.destroy(); reject(new Error('TLS check failed')); });
  });
}

export async function expiryMetrics({ fetchImpl, now, state }, readCertificate = certificateExpiry) {
  if (!state.expiry || now - state.expiry.checkedAt > 3_600_000) {
    const [certificate, domain] = await Promise.all([
      readCertificate(), requestJson('https://rdap.publicinterestregistry.org/rdap/domain/fitsy.org', {}, fetchImpl),
    ]);
    const expires = domain.events?.find(event => event.eventAction === 'expiration')?.eventDate;
    if (!Number.isFinite(Date.parse(certificate)) || !Number.isFinite(Date.parse(expires))) throw new Error('Expiry data missing');
    state.expiry = { certificate, domain: expires, checkedAt: now };
  }
  return [...evaluateExpiry('TLS certificate', state.expiry.certificate, now), ...evaluateExpiry('domain', state.expiry.domain, now)];
}

export async function collectObservations({ env, fetchImpl, now, event, state }) {
  const context = { env, fetchImpl, now, state, policy };
  const probes = await probeApi(context);
  const sources = [
    ['api', () => apiMetrics(context)], ['mobile', () => mobileMetrics(context)],
    ['deploy', () => deploymentMetrics(context, probes.servingSha)], ['quota', () => quotaMetrics(context)],
    ['crons', () => cronMetrics(context)], ['expiry', () => expiryMetrics(context)],
  ];
  const results = await Promise.allSettled(sources.map(([, read]) => read()));
  const observations = [{ scope: 'probes', alerts: probes.alerts }];
  const observerAlerts = [];
  results.forEach((result, index) => {
    const scope = sources[index][0];
    if (result.status === 'fulfilled') observations.push({ scope, alerts: result.value });
    else observerAlerts.push(alert(`observer:${scope}`, 'observer', 'P2', `${scope} monitoring failed or is unconfigured; inspect the monitoring setup contract.`));
  });
  observations.push({ scope: 'observer', alerts: observerAlerts });
  if (event?.workflow_run) {
    const run = event.workflow_run;
    const scope = `workflow:${run.name}`;
    if (['Deploy', 'EAS Build + TestFlight', 'Dev maintenance'].includes(run.name)) {
      observations.push({ scope, alerts: state.recoveredReleaseRunId !== Number(run.id) && ['failure', 'timed_out', 'action_required', 'cancelled'].includes(run.conclusion)
        ? [alert(scope, scope, run.name === 'Dev maintenance' ? 'P2' : 'P1', `${run.name} failed; inspect Actions run ${Number(run.id)}.`)] : [] });
      if (run.name === 'Deploy' && run.conclusion === 'success') observations.push({ scope: 'release-smoke', alerts: [] });
    }
  }
  return observations;
}
