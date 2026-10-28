import { readFileSync } from 'node:fs';

export const policy = JSON.parse(readFileSync(new URL('./production-monitor.config.json', import.meta.url), 'utf8'));
export const alert = (key, scope, severity, summary) => ({ key, scope, severity, summary });

export function evaluateApi(rows, baseline, now = Date.now()) {
  const alerts = [];
  let requests = 0, errors = 0;
  for (const row of [...rows, ...baseline]) {
    if (!/^\/api\/[a-zA-Z0-9/[\]-]+$/.test(row.route) || !/^(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)$/.test(row.method)
        || !Number.isSafeInteger(row.requests) || row.requests < 0 || !Number.isSafeInteger(row.errors)
        || row.errors < 0 || row.errors > row.requests || !Number.isFinite(row.p95) || row.p95 < 0
        || !Number.isSafeInteger(row.rejected) || row.rejected < 0 || row.rejected > row.requests
        || !Number.isFinite(Date.parse(row.lastSeen))) {
      throw new Error('Invalid API metric schema');
    }
  }
  for (const row of rows) {
    requests += row.requests; errors += row.errors;
    const previous = baseline.find(item => item.route === row.route && item.method === row.method);
    if (row.requests >= policy.latencyMinimumRequests && row.p95 > policy.latencyP95Ms
        && (!previous || previous.requests < policy.latencyMinimumRequests
          || row.p95 > previous.p95 * policy.latencyBaselineMultiplier)) {
      alerts.push(alert(`latency:${row.method}:${row.route}`, 'api', 'P2', `${row.method} ${row.route} p95 ${Math.round(row.p95)}ms`));
    }
    if (row.route === '/api/revenuecat/webhook' && row.rejected >= policy.errorCount) {
      alerts.push(alert('webhook:rejected', 'api', 'P2', 'RevenueCat webhook rejection burst; inspect provider delivery/auth configuration.'));
    }
  }
  if (errors >= policy.errorCount || (requests > 0 && errors / requests > policy.errorRate)) {
    alerts.push(alert('api:5xx', 'api', 'P1', `${errors}/${requests} API requests returned 5xx in ${policy.windowMinutes} minutes.`));
  }
  const lastSeen = Math.max(0, ...[...rows, ...baseline].map(row => Date.parse(row.lastSeen) || 0));
  if (now - lastSeen > policy.telemetryMaxAgeMinutes * 60_000) {
    alerts.push(alert('api:telemetry-missing', 'api', 'P1', 'API telemetry is missing or stale; synthetic traffic should produce events.'));
  }
  return alerts;
}

export function evaluateMobile(row) {
  const [checks, unknown, baselineChecks, baselineUnknown, fatal] = row;
  if (![checks, unknown, baselineChecks, baselineUnknown, fatal].every(value => Number.isSafeInteger(value) && value >= 0)
      || unknown > checks || baselineUnknown > baselineChecks) throw new Error('Invalid mobile metric schema');
  const rate = checks ? unknown / checks : 0;
  const previous = baselineChecks ? baselineUnknown / baselineChecks : 0;
  const alerts = [];
  if (checks >= policy.mobileMinimumChecks && rate > policy.mobileUnknownRate
      && rate > previous * policy.mobileBaselineMultiplier) {
    alerts.push(alert('mobile:subscription', 'mobile', 'P2', `${unknown}/${checks} mobile subscription checks are unknown or failed.`));
  }
  if (fatal > 0) alerts.push(alert('mobile:fatal', 'mobile', 'P1', `${fatal} fatal mobile errors observed.`));
  return alerts;
}

export function evaluateDeployment({ servingSha, mainSha, mainChangedAt, latest }, now = Date.now()) {
  if (![servingSha, mainSha].every(sha => /^[a-f0-9]{40}$/i.test(sha ?? ''))
      || !Number.isFinite(Date.parse(mainChangedAt))) throw new Error('Missing deployment identity');
  const alerts = [];
  if (latest?.readyState === 'ERROR') alerts.push(alert('deploy:error', 'deploy', 'P1', 'Latest production Vercel deployment failed.'));
  if (servingSha !== mainSha && now - Date.parse(mainChangedAt) > policy.staleDeploymentMinutes * 60_000) {
    alerts.push(alert('deploy:stale', 'deploy', 'P1', 'Production has not served current main for more than 30 minutes.'));
  }
  return alerts;
}

export function evaluateQuota(used, limit) {
  if (!Number.isFinite(used) || used < 0 || !Number.isFinite(limit) || limit <= 0) throw new Error('Invalid quota measurement');
  return used / limit >= policy.quotaWarning
    ? [alert('upstash:quota', 'quota', used / limit >= policy.quotaCritical ? 'P1' : 'P2', `Upstash daily commands at ${Math.round(100 * used / limit)}% of configured allowance.`)] : [];
}

export function evaluateExpiry(kind, expiresAt, now = Date.now()) {
  const days = (Date.parse(expiresAt) - now) / 86_400_000;
  if (!Number.isFinite(days)) throw new Error('Invalid expiry measurement');
  return days <= policy.expiryWarningDays
    ? [alert(`expiry:${kind}`, 'expiry', days <= policy.expiryCriticalDays ? 'P1' : 'P2', `Production ${kind} expires in ${Math.floor(days)} days.`)] : [];
}

export function evaluateCrons(rows, now = Date.now(), monitoringStartedAt = 0) {
  return Object.entries(policy.cronMaxAgeHours).flatMap(([route, hours]) => {
    const last = rows.find(row => row.route === route)?.lastSuccess;
    if (!last && now - monitoringStartedAt <= hours * 3_600_000) return [];
    return now - (Date.parse(last) || 0) > hours * 3_600_000
      ? [alert(`cron:${route}`, 'crons', 'P2', `${route} has no successful execution within ${hours} hours.`)] : [];
  });
}

