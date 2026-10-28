import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { policy } from './production-policy.mjs';
import { collectObservations } from './production-providers.mjs';
import { dispatchAlerts, loadAlertState, saveAlertState, sendSlack } from './production-alerts.mjs';
import { assertRequiredEnvironment } from '../deploy/env-manifest.mjs';

export async function runMonitor({ env = process.env, fetchImpl = fetch, now = Date.now(), event } = {}) {
  const store = await loadAlertState({ env, fetchImpl, policy });
  const observations = await collectObservations({ env, fetchImpl, now, event, state: store.state });
  try { assertRequiredEnvironment('monitor', env); }
  catch (error) { observations.find(item => item.scope === 'observer').alerts.push({
    key: 'observer:configuration', scope: 'observer', severity: 'P2', summary: error.message,
  }); }
  await dispatchAlerts({ observations, state: store.state, now, policy,
    save: state => saveAlertState(store.number, state, { env, fetchImpl, policy }),
    send: (message, urgent, destination) => sendSlack(message, urgent, { env, fetchImpl, policy }, destination),
  });
  return observations.flatMap(item => item.alerts);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : undefined;
    const alerts = await runMonitor({ event });
    console.log(JSON.stringify({ status: alerts.length ? 'alerting' : 'healthy', alerts: alerts.map(item => item.key) }));
    if (alerts.length) process.exitCode = 1;
  } catch {
    // Never log provider exception text: it can contain credentials or bodies.
    console.error('Production monitoring stopped: configuration, state, provider query or alert delivery failed.');
    try { await sendSlack('*TL;DR:* Production monitoring stopped; inspect the failed Production Monitor run.', true,
      { env: process.env, fetchImpl: fetch, policy }); } catch { /* Actions failure remains visible independently. */ }
    process.exitCode = 1;
  }
}
