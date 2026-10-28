import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { policy, alert } from '../verify/production-policy.mjs';
import { requestJson, loadAlertState, saveAlertState, dispatchAlerts, sendSlack } from '../verify/production-alerts.mjs';
import { assertRequiredEnvironment } from './env-manifest.mjs';

function deploymentSha(deployment) {
  return deployment.gitSource?.sha ?? deployment.meta?.githubCommitSha;
}

export function rollbackCandidate(deployments, failedSha) {
  const failed = deployments.find(item => deploymentSha(item) === failedSha);
  if (!failed || !Number.isFinite(failed.created)) throw new Error('Failed deployment identity unavailable');
  const prior = deployments.filter(item => item.target === 'production' && item.readyState === 'READY'
    && item.created < failed.created && /^[a-f0-9]{40}$/i.test(deploymentSha(item) ?? ''))
    .sort((left, right) => right.created - left.created)[0];
  if (!prior || !/^[a-z0-9-]+\.vercel\.app$/.test(prior.url ?? '')) throw new Error('No explicit previous production target');
  return { url: `https://${prior.url}`, sha: deploymentSha(prior) };
}

async function verifyServing(base, sha, fetchImpl) {
  for (const probe of policy.probes) {
    const response = await fetchImpl(`${base}${probe.path}`, {
      headers: probe.status === 401 ? { authorization: 'Bearer fitsy-monitor-invalid-session' } : {},
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== probe.status) throw new Error('Recovery target probe failed');
    if (probe.path === '/api/health') {
      const health = await response.json();
      if (health.status !== 'ok' || health.db !== 'connected' || health.deploymentSha !== sha) throw new Error('Recovery source mismatch');
    }
  }
}

async function servingIdentity(fetchImpl) {
  const response = await fetchImpl(`${policy.baseUrl}/api/health`, {
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  // A DB/pool outage still includes the serving source in the public 503 body.
  if (![200, 503].includes(response.status)) throw new Error('Serving identity unavailable');
  const health = await response.json();
  if (!/^[a-f0-9]{40}$/i.test(health.deploymentSha ?? '')) throw new Error('Serving identity unavailable');
  return health.deploymentSha;
}

function invokeRollback(target) {
  // The existing helper stays unchanged and receives an explicit target.
  // It requires a project link; never overwrite a link belonging to another app.
  const project = { projectId: policy.vercelProject, orgId: policy.vercelTeam };
  if (existsSync('.vercel/project.json')) {
    const linked = JSON.parse(readFileSync('.vercel/project.json', 'utf8'));
    if (linked.projectId !== project.projectId || linked.orgId !== project.orgId) throw new Error('Wrong Vercel project link');
  } else {
    mkdirSync('.vercel', { recursive: true });
    writeFileSync('.vercel/project.json', JSON.stringify(project), { mode: 0o600 });
  }
  execFileSync('bash', ['scripts/deploy/rollback.sh', 'api', target.url], { stdio: 'inherit', timeout: 90_000 });
}

export async function recoverProduction({ failedSha, smokeOutcome, env = process.env, fetchImpl = fetch,
  runRollback = invokeRollback, page, resolved = async () => {} }) {
  if (smokeOutcome !== 'failure' || !/^[a-f0-9]{40}$/i.test(failedSha ?? '')) throw new Error('Only an identified failed production smoke can recover');
  // Alert transport failure must not prevent restoration of service.
  let alertError;
  try { await page(); } catch (error) { alertError = error; }
  if (await servingIdentity(fetchImpl) !== failedSha) return { status: 'superseded', rolledBack: false };
  if (!env.VERCEL_TOKEN) throw new Error('Production recovery credential missing');
  const listing = await requestJson(`https://api.vercel.com/v6/deployments?projectId=${policy.vercelProject}&teamId=${policy.vercelTeam}&target=production&limit=100`,
    { headers: { authorization: `Bearer ${env.VERCEL_TOKEN}` } }, fetchImpl);
  if (!Array.isArray(listing.deployments)) throw new Error('Production deployment history unavailable');
  const target = rollbackCandidate(listing.deployments, failedSha);
  // Never promote an unprobed deployment or trust READY as evidence of health.
  await verifyServing(target.url, target.sha, fetchImpl);
  if (await servingIdentity(fetchImpl) !== failedSha) return { status: 'superseded', rolledBack: false };
  await runRollback(target);
  await verifyServing(policy.baseUrl, target.sha, fetchImpl);
  await resolved();
  if (alertError) throw new Error('Service recovered but initial alert delivery failed');
  return { status: 'recovered', rolledBack: true, target };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const context = { env: process.env, fetchImpl: fetch, policy };
  let restored = false;
  try {
    let store;
    const publish = async alerts => dispatchAlerts({ observations: [{ scope: 'release-smoke', alerts }], state: store.state,
      now: Date.now(), policy, save: state => saveAlertState(store.number, state, context),
      send: (message, urgent, destination) => sendSlack(message, urgent, context, destination) });
    const result = await recoverProduction({ failedSha: process.env.RELEASE_SHA, smokeOutcome: process.env.SMOKE_OUTCOME,
      page: async () => {
        assertRequiredEnvironment('recovery');
        store = await loadAlertState(context);
        await publish([alert('release:smoke', 'release-smoke', 'P1', 'Release Verify production smoke failed; automatic recovery is starting.')]);
      },
      resolved: async () => {
        restored = true;
        if (!store) throw new Error('Recovery publication unavailable');
        store.state.recoveredReleaseRunId = Number(process.env.GITHUB_RUN_ID);
        await publish([]);
      },
    });
    console.log(JSON.stringify(result));
  } catch {
    const message = restored ? 'Service probes recovered, but alert delivery or recovery receipt publication failed.'
      : 'Production release recovery stopped; inspect source identity, previous target health and alert delivery.';
    console.error(message);
    try { await sendSlack(`*TL;DR:* ${message} Inspect the failed Deploy recovery job.`, true, context); } catch { /* Keep Actions failure visible. */ }
    process.exitCode = 1;
  }
}
