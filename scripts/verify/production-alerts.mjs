import { createHash } from 'node:crypto';

const marker = '<!-- fitsy-production-monitor-state:v1 -->';

/** Only external HTTP is injected. All evaluation, transitions and delivery are real. */
export async function requestJson(url, init = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('Monitoring provider request failed');
  return response.json();
}

function githubOptions(env, method = 'GET', body) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN missing');
  return { method, headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json',
    'content-type': 'application/json', 'x-github-api-version': '2022-11-28' }, ...(body ? { body: JSON.stringify(body) } : {}) };
}

export function github(path, { env, fetchImpl, policy }, method, body) {
  return requestJson(`https://api.github.com/repos/${policy.repository}/${path}`, githubOptions(env, method, body), fetchImpl);
}

const stateBody = state => `**TL;DR:** Production monitor state tracks shared incidents and delivery receipts.\n\n${marker}\n\n\`\`\`json\n${JSON.stringify(state)}\n\`\`\`\n`;

export async function loadAlertState(context) {
  for (let page = 1; page <= 20; page++) {
    const issues = await github(`issues?state=open&labels=monitoring&per_page=100&page=${page}`, context);
    if (!Array.isArray(issues)) throw new Error('Invalid monitoring issue list');
    const matches = issues.filter(issue => issue.body?.includes(marker));
    if (matches.length > 1) throw new Error('Multiple monitoring state owners');
    if (matches.length === 1) {
      const raw = matches[0].body.match(/```json\n([^]*?)\n```/)?.[1];
      const state = JSON.parse(raw ?? 'null');
      if (state?.version !== 1 || !state.incidents || Array.isArray(state.incidents)) throw new Error('Invalid monitoring state');
      return { number: matches[0].number, state };
    }
    if (issues.length < 100) {
      const state = { version: 1, incidents: {} };
      const issue = await github('issues', context, 'POST', { title: 'Production monitoring state', labels: ['monitoring'], body: stateBody(state) });
      return { number: issue.number, state };
    }
  }
  throw new Error('Monitoring issue discovery incomplete');
}

export function saveAlertState(number, state, context) {
  return github(`issues/${number}`, context, 'PATCH', { body: stateBody(state) });
}

export async function sendSlack(message, urgent, { env, fetchImpl, policy }, destination = 'all') {
  if (!env.SLACK_BOT_TOKEN) {
    throw new Error('Slack alert routing unconfigured');
  }
  const text = message.slice(0, 2900);
  const channels = destination === 'direct' ? [env.SLACK_ALERT_USER_ID]
    : destination === 'channel' || !urgent ? [policy.channel] : [policy.channel, env.SLACK_ALERT_USER_ID];
  for (const channel of channels) {
    if (channel !== policy.channel && !/^U[A-Z0-9]+$/.test(channel ?? '')) throw new Error('Direct Slack routing unconfigured');
    const id = createHash('sha256').update(`${channel}:${text}`).digest('hex');
    const result = await requestJson('https://slack.com/api/chat.postMessage', {
      method: 'POST', headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ channel, text, unfurl_links: false, unfurl_media: false,
        client_msg_id: `${id.slice(0, 8)}-${id.slice(8, 12)}-5${id.slice(13, 16)}-a${id.slice(17, 20)}-${id.slice(20, 32)}` }),
    }, fetchImpl);
    if (result.ok !== true) throw new Error('Slack rejected alert');
  }
}

export async function dispatchAlerts({ observations, state, now, policy, save, send }) {
  let deliveryFailures = 0;
  const evaluated = new Set(observations.map(item => item.scope));
  const active = new Map(observations.flatMap(item => item.alerts).map(item => [item.key, item]));
  for (const [key, incident] of Object.entries(state.incidents)) {
    if (incident.active && evaluated.has(incident.scope) && !active.has(key)) {
      incident.active = false;
      incident.resolvedAt = now;
      incident.recoveryDelivered = false;
    }
  }
  for (const [key, signal] of active) {
    let incident = state.incidents[key];
    if (!incident?.active) {
      incident = state.incidents[key] = { ...signal, active: true, since: now, deliveredAt: null, recoveryDelivered: true };
    } else {
      // Escalating from warning to critical must page immediately.
      if (incident.severity !== signal.severity) { incident.deliveredAt = null; delete incident.pending; }
      Object.assign(incident, signal);
    }
  }
  state.checkedAt = now;
  await save(state); // Reserve shared transition before delivery. Never mark a failed send delivered.
  for (const incident of Object.values(state.incidents)) {
    if (incident.active && (incident.deliveredAt === null || now - incident.deliveredAt >= policy.reminderMinutes * 60_000)) {
      incident.pending ??= { kind: 'alert', at: now, delivered: [] };
    } else if (!incident.active && incident.recoveryDelivered === false) {
      if (incident.pending?.kind !== 'recovery') incident.pending = { kind: 'recovery', at: now, delivered: [] };
    } else { continue; }
    await save(state);
    const pending = incident.pending;
    const text = pending.kind === 'alert'
      ? `*TL;DR:* ${incident.severity} production alert: ${incident.summary}\nIncident: ${incident.key}; since ${new Date(incident.since).toISOString()}. Observed ${new Date(pending.at).toISOString()}.`
      : `*TL;DR:* RESOLVED production alert: ${incident.key}.\nThe affected check passed at ${new Date(incident.resolvedAt).toISOString()}.`;
    const urgent = incident.severity === 'P1';
    for (const destination of urgent ? ['channel', 'direct'] : ['channel']) {
      if (pending.delivered.includes(destination)) continue;
      try { await send(text, urgent, destination); }
      catch { deliveryFailures++; continue; }
      pending.delivered.push(destination);
      await save(state);
    }
    if (pending.delivered.length !== (urgent ? 2 : 1)) continue;
    if (pending.kind === 'alert') {
      incident.deliveredAt = now;
    } else {
      incident.recoveryDelivered = true;
    }
    delete incident.pending;
    await save(state);
  }
  if (deliveryFailures) throw new Error('One or more monitoring notifications remain undelivered');
}
