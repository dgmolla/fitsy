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

export async function queryAxiom(apl, startTime, endTime, { env, fetchImpl }, timestampField) {
  if (!env.AXIOM_TOKEN) throw new Error('Axiom query token missing');
  const body = await requestJson('https://api.axiom.co/v1/datasets/_apl?format=tabular', {
    method: 'POST', headers: { authorization: `Bearer ${env.AXIOM_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ apl, startTime: new Date(startTime).toISOString(), endTime: new Date(endTime).toISOString() }),
  }, fetchImpl);
  const rows = axiomRows(body);
  if (!timestampField) return rows;
  return rows.map(row => {
    const value = row[timestampField];
    // Axiom's tabular max(_time) returns numeric nanoseconds, not Date.parse input.
    // Bound conversion to the query window so wrong units cannot look healthy.
    const millis = typeof value === 'number' && Number.isInteger(value) ? value / 1e6
      : typeof value === 'string' ? Date.parse(value) : NaN;
    if (!Number.isFinite(millis) || millis < startTime || millis >= endTime) throw new Error('Invalid Axiom timestamp');
    return { ...row, [timestampField]: new Date(millis).toISOString() };
  });
}

const apiQuery = `['${policy.dataset}'] | where type == 'api_request' and environment == 'production'`;
const aggregate = " | summarize requests=count(), errors=countif(status >= 500), rejected=countif(status >= 400 and status < 500), p95=percentile(durationMs, 95), lastSeen=max(_time) by route, method";

export async function apiMetrics(context) {
  const cutoff = context.now - policy.windowMinutes * 60_000;
  const [current, baseline] = await Promise.all([
    queryAxiom(apiQuery + aggregate, cutoff, context.now, context, 'lastSeen'),
    queryAxiom(apiQuery + aggregate, context.now - policy.baselineMinutes * 60_000, cutoff, context, 'lastSeen'),
  ]);
  return evaluateApi(current, baseline, context.now);
}

export async function cronMetrics(context) {
  context.state.cronMonitoringStartedAt ??= context.now;
  const rows = await queryAxiom(apiQuery + " | where route startswith '/api/internal/' and status >= 200 and status < 300 | summarize lastSuccess=max(_time) by route",
    context.now - 15 * 86_400_000, context.now, context, 'lastSuccess');
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
  // Developer API quota access is optional. Partial configuration is an error,
  // while an absent integration must not page or invent quota measurements.
  if (![env.UPSTASH_API_KEY, env.UPSTASH_EMAIL, env.UPSTASH_DATABASE_ID, env.UPSTASH_DAILY_COMMAND_LIMIT]
    .some(value => value?.trim())) return null;
  if (!env.UPSTASH_API_KEY || !env.UPSTASH_EMAIL || !/^[a-zA-Z0-9-]+$/.test(env.UPSTASH_DATABASE_ID ?? '')) throw new Error('Quota visibility configuration missing');
  if (!Number.isFinite(Number(env.UPSTASH_DAILY_COMMAND_LIMIT)) || Number(env.UPSTASH_DAILY_COMMAND_LIMIT) <= 0) throw new Error('Invalid quota allowance');
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

export async function workflowMetrics(file, name, context) {
  // Include active attempts: a retry hides its previous failure from a
  // completed-only query. EAS also runs on release tags, not just main.
  const eas = file === 'eas-build.yml';
  const result = await github(`actions/workflows/${file}/runs?${eas ? '' : 'branch=main&'}per_page=100`, context);
  if (!Array.isArray(result.workflow_runs)) throw new Error('Invalid workflow history');
  const runs = eas ? result.workflow_runs.filter(run => run.head_branch === 'main'
    || (run.event === 'push' && /^v[^/]*\.[^/]*\.[^/]*$/.test(run.head_branch ?? ''))) : result.workflow_runs;
  const activeStatuses = ['queued', 'in_progress', 'requested', 'waiting', 'pending'];
  const conclusions = ['success', 'failure', 'timed_out', 'action_required', 'cancelled', 'stale', 'startup_failure', 'skipped', 'neutral'];
  // GitHub's name can be the dynamic run-name. The file-scoped endpoint and
  // returned workflow path identify the observer's trusted release stream.
  if ((!eas && !runs.length) || runs.some(run => run.path !== `.github/workflows/${file}`
      || (!eas && run.head_branch !== 'main')
      || !(eas ? ['push', 'workflow_dispatch'] : file === 'deploy.yml'
        ? ['workflow_run', 'workflow_dispatch'] : ['schedule', 'workflow_dispatch']).includes(run.event)
      || !Number.isSafeInteger(run.id) || run.id <= 0 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0
      || !Number.isFinite(Date.parse(run.updated_at))
      || (run.status === 'completed' ? !conclusions.includes(run.conclusion)
        : !activeStatuses.includes(run.status) || run.conclusion !== null))) {
    throw new Error('Verified workflow identity unavailable');
  }
  const scope = `workflow:${name}`;
  const previous = context.state?.incidents[scope];
  if (eas) {
    const cutoff = context.now - policy.easWorkflowMaxAgeDays * 86_400_000;
    if (!Number.isFinite(cutoff) || !(policy.easWorkflowMaxAgeDays > 0)) throw new Error('Invalid EAS observation window');
    // EAS Actions is an intermittent release path, not an always-on service.
    // Expire inactive history through normal state/recovery delivery. Active
    // attempts and recent persisted receipts still retain the #737 safeguards.
    const previousAt = previous?.workflowUpdatedAt ? Date.parse(previous.workflowUpdatedAt) : previous?.since;
    if (runs.every(item => item.status === 'completed' && Date.parse(item.updated_at) < cutoff)
        && (!previous?.active || (Number.isFinite(previousAt) && previousAt < cutoff))) return [];
    if (!runs.length) return null;
  }
  const completed = runs.filter(item => item.status === 'completed' && !['skipped', 'neutral'].includes(item.conclusion))
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id);
  let run;
  for (const candidate of completed) {
    if (file === 'deploy.yml' && candidate.conclusion === 'success') {
      const result = await github(`actions/runs/${candidate.id}/attempts/${candidate.run_attempt}/jobs?per_page=100`, context);
      if (!Array.isArray(result.jobs) || !result.jobs.length || result.jobs.length !== result.total_count
          || result.jobs.some(job => job.run_id !== candidate.id || job.run_attempt !== candidate.run_attempt || !Array.isArray(job.steps))) {
        throw new Error('Complete release attempt jobs required');
      }
      // The health command also exits zero on supersession. Only its gated
      // release_ready marker proves automatic recovery; manual releases still
      // fail closed on supersession and use the original health step.
      if (!result.jobs.some(job => ['smoke', 'production-ota'].includes(job.name) && job.conclusion === 'success'
          && job.steps.some(step => step.name === (job.name === 'smoke' ? 'Confirm verified release'
            : 'Verify serving identity after smoke') && step.conclusion === 'success'))) continue;
    }
    run = candidate;
    break;
  }
  if (run && run.conclusion !== 'success') {
    return [{ ...alert(scope, scope, name === 'Dev maintenance' ? 'P2' : 'P1', `${name} failed; inspect Actions run ${run.id}, attempt ${run.run_attempt}.`),
      workflowUpdatedAt: run.updated_at, workflowRunId: run.id }];
  }
  // Pending work is neither a recovery nor a broken observer. Omit its scope
  // so shared incidents and reminder delivery survive until an outcome exists.
  if (runs.some(item => item.status !== 'completed')) return null;
  if (!run) {
    if (completed.length && file === 'deploy.yml') return null;
    throw new Error('Verified workflow identity unavailable');
  }
  // Legacy v1 incidents have no workflow watermark. Require a success after
  // their observed start rather than assuming an older result is recovery.
  if (previous?.active && !previous.workflowUpdatedAt
      && (!Number.isFinite(previous.since) || Date.parse(run.updated_at) <= previous.since)) return null;
  if (previous?.active && previous.workflowUpdatedAt
      && (Date.parse(run.updated_at) < Date.parse(previous.workflowUpdatedAt)
        || (run.updated_at === previous.workflowUpdatedAt && run.id < previous.workflowRunId))) return null;
  return [];
}

export async function collectObservations({ env, fetchImpl, now, state }) {
  const context = { env, fetchImpl, now, state, policy };
  const probes = await probeApi(context);
  const sources = [
    ['api', () => apiMetrics(context)], ['mobile', () => mobileMetrics(context)],
    ['deploy', () => deploymentMetrics(context, probes.servingSha)], ['quota', () => quotaMetrics(context)],
    ['crons', () => cronMetrics(context)], ['expiry', () => expiryMetrics(context)],
    ...Object.entries({ 'deploy.yml': 'Deploy', 'eas-build.yml': 'EAS Build + TestFlight', 'dev-maintenance.yml': 'Dev maintenance' })
      .map(([file, name]) => [`workflow:${name}`, () => workflowMetrics(file, name, context)]),
  ];
  const results = await Promise.allSettled(sources.map(([, read]) => read()));
  const observations = [{ scope: 'probes', alerts: probes.alerts }];
  const observerAlerts = [];
  results.forEach((result, index) => {
    const scope = sources[index][0];
    if (result.status === 'fulfilled') {
      if (result.value !== null) observations.push({ scope, alerts: result.value });
    }
    else {
      // Only local schema labels or an HTTP status may leave the provider
      // boundary. Never copy arbitrary exception text, response bodies or URLs.
      const status = result.reason?.httpStatus;
      const detail = Number.isInteger(status) && status >= 100 && status <= 599 ? `HTTP ${status}`
        : ['Incomplete Axiom query', 'Malformed Axiom table', 'Invalid Axiom timestamp', 'Invalid API metric schema'].includes(result.reason?.message)
          ? result.reason.message : 'request or configuration error';
      observerAlerts.push(alert(`observer:${scope}`, 'observer', 'P2', `${scope} monitoring failed (${detail}); inspect the monitoring setup contract.`));
    }
  });
  observations.push({ scope: 'observer', alerts: observerAlerts });
  return observations;
}
