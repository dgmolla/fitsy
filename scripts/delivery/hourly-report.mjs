#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadTimings } from './phase-report.mjs';

const OWNER = 'dgmolla';
const REPO = 'fitsy';
const PROJECT = 1;
const BOARD_URL = 'https://github.com/users/dgmolla/projects/1';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

export const PROJECT_QUERY = `query($owner: String!, $number: Int!, $after: String) {
  user(login: $owner) { projectV2(number: $number) {
    id title url items(first: 100, after: $after) {
      totalCount pageInfo { hasNextPage endCursor }
      nodes { id content {
        __typename
        ... on Issue { number title url state createdAt updatedAt labels(first: 100) { nodes { name } pageInfo { hasNextPage } } }
        ... on PullRequest { number title url state createdAt updatedAt mergedAt labels(first: 100) { nodes { name } pageInfo { hasNextPage } } }
      } fieldValues(first: 100) { pageInfo { hasNextPage } nodes {
        ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2Field { name } } }
        ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2SingleSelectField { name } } }
        ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2Field { name } } }
      } } }
    }
  } }
}`;

function assertComplete(connection, name) {
  if (connection?.pageInfo?.hasNextPage) throw new Error(`${name} has more than 100 values; refusing a partial report`);
}

export async function loadProject(graphql) {
  const items = [];
  const cursors = new Set();
  let after = null;
  let total;
  let url;
  for (;;) {
    const project = (await graphql(PROJECT_QUERY, { owner: OWNER, number: PROJECT, after }))?.user?.projectV2;
    if (!project || project.url !== BOARD_URL) throw new Error('Fitsy Delivery project identity mismatch');
    const page = project.items;
    if (!page?.pageInfo || !Array.isArray(page.nodes)) throw new Error('Project items unavailable');
    total = page.totalCount;
    url = project.url;
    for (const node of page.nodes) {
      assertComplete(node.fieldValues, `Project item ${node.id} fields`);
      if (node.content?.labels) assertComplete(node.content.labels, `Project item ${node.id} labels`);
      const fields = Object.fromEntries((node.fieldValues?.nodes ?? [])
        .filter(value => value?.field?.name)
        .map(value => [value.field.name, value.text ?? value.name ?? value.date ?? '']));
      items.push({ id: node.id, content: node.content, fields,
        labels: node.content?.labels?.nodes?.map(label => label.name) ?? [] });
    }
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error('Project pagination did not advance');
    cursors.add(after);
  }
  if (items.length !== total || new Set(items.map(item => item.id)).size !== total) {
    throw new Error(`Incomplete project read: ${items.length} of ${total} cards`);
  }
  return { url, items };
}

export async function loadMergedPulls(rest, now) {
  const since = now.getTime() - 24 * 60 * 60 * 1000;
  const merged = new Map();
  for (let page = 1; page <= 1000; page++) {
    const pulls = await rest(`${API}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
    if (!Array.isArray(pulls)) throw new Error('Pull request listing unavailable');
    for (const pr of pulls) {
      const mergedAt = Date.parse(pr.merged_at ?? '');
      if (pr.base?.ref === 'main' && Number.isFinite(mergedAt) && mergedAt >= since && mergedAt <= now.getTime()) {
        merged.set(pr.number, pr);
      }
    }
    if (pulls.length < 100 || Date.parse(pulls.at(-1).updated_at) < since) return [...merged.values()];
  }
  throw new Error('Pull request pagination exceeded 1000 pages');
}

export async function loadMainGates(rest) {
  const commit = await rest(`${API}/commits/main`);
  if (!/^[0-9a-f]{40}$/.test(commit?.sha ?? '')) throw new Error('Main commit unavailable');
  const runs = await rest(`${API}/actions/runs?head_sha=${commit.sha}&event=push&per_page=100`);
  if (!Array.isArray(runs?.workflow_runs)) throw new Error('Main workflow runs unavailable');
  if (runs.total_count > runs.workflow_runs.length) throw new Error('Main workflow run list incomplete');
  const latest = name => runs.workflow_runs.filter(run => run.name === name && run.head_sha === commit.sha)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const verify = latest('Verify');
  const deploy = latest('Deploy');
  const state = [verify, deploy].every(run => run?.status === 'completed' && run.conclusion === 'success')
    ? 'green' : [verify, deploy].some(run => ['failure', 'cancelled', 'timed_out'].includes(run?.conclusion))
      ? 'failed' : 'pending';
  return { sha: commit.sha, state, verify: verify?.html_url ?? null, deploy: deploy?.html_url ?? null };
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?Z$/.exec(value);
  if (!parts) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const date = new Date(parsed);
  const actual = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()];
  return actual.every((component, index) => component === Number(parts[index + 1])) ? parsed : null;
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function deliverySlot(now, requested) {
  const current = new Date(now.getTime());
  current.setUTCMinutes(now.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  if (requested === undefined) return current.toISOString().slice(0, 16);
  if (!/^\d{4}-\d\d-\d\dT\d\d:(00|30)$/.test(requested)) throw new Error('invalid UTC delivery slot');
  const slot = Date.parse(`${requested}:00Z`);
  if (!Number.isFinite(slot) || new Date(slot).toISOString().slice(0, 16) !== requested ||
      slot > now.getTime() || now.getTime() - slot > 60 * 60 * 1000) {
    throw new Error('delivery slot is invalid, future, or stale');
  }
  return requested;
}

export function buildReport(project, pulls, main, now = new Date(), requestedSlot) {
  const nowMs = now.getTime();
  const hour = new Date(nowMs); hour.setUTCMinutes(0, 0, 0);
  const slotKey = deliverySlot(now, requestedSlot);
  const cards = project.items;
  const issues = cards.filter(item => item.content?.__typename === 'Issue');
  const counts = Object.fromEntries(['Queued', 'In flight', 'Done'].map(status =>
    [status, cards.filter(item => item.fields.Status === status).length]));
  const blocked = cards.filter(item => item.fields.Status !== 'Done' &&
    (item.fields.Blocker?.trim() || item.labels.includes('blocked')));
  const doneIssues = issues.filter(item => item.fields.Status === 'Done');
  const shipped = doneIssues.map(item => ({ item, verified: timestamp(item.fields['Verified at']) }))
    .filter(({ verified }) => verified !== null && verified <= nowMs && verified >= nowMs - 24 * 60 * 60 * 1000)
    .sort((a, b) => b.verified - a.verified || b.item.content.number - a.item.content.number)
    .slice(0, 2).map(({ item }) => ({ number: item.content.number, title: item.content.title,
      url: item.content.url }));
  const next = issues.filter(item => !item.fields.Blocker?.trim() && !item.labels.includes('blocked') &&
    (item.fields.Status === 'In flight' ||
      (item.fields.Status === 'Queued' && ['Now', 'Next'].includes(item.fields.Priority))))
    .sort((a, b) => Number(b.fields.Status === 'In flight') - Number(a.fields.Status === 'In flight') ||
      Number(b.fields.Priority === 'Now') - Number(a.fields.Priority === 'Now') ||
      a.content.number - b.content.number)
    .slice(0, 2).map(item => ({ number: item.content.number, title: item.content.title,
      url: item.content.url,
      status: item.fields.Status }));
  const cycles = doneIssues.map(item => {
    const start = timestamp(item.fields['Started at']);
    const verified = timestamp(item.fields['Verified at']);
    return start !== null && verified !== null && verified >= start && verified <= nowMs ? verified - start : null;
  }).filter(value => value !== null);
  const activeIssues = issues.filter(item => item.fields.Status === 'In flight');
  const ages = activeIssues.map(item => {
    const start = timestamp(item.fields['Started at']);
    return start !== null && start <= nowMs ? nowMs - start : null;
  }).filter(value => value !== null);
  const prTimes = pulls.map(pr => {
    const created = Date.parse(pr.created_at ?? '');
    const merged = Date.parse(pr.merged_at ?? '');
    return Number.isFinite(created) && Number.isFinite(merged) && merged >= created ? merged - created : null;
  }).filter(value => value !== null);
  const highlights = [...issues].filter(item => item.fields.Status !== 'Done' &&
    (item.fields.Status === 'In flight' || item.fields.Blocker?.trim() || item.labels.includes('blocked')))
    .sort((a, b) => Number(b.fields.Status === 'In flight') - Number(a.fields.Status === 'In flight') ||
      Number(Boolean(b.fields.Blocker || b.labels.includes('blocked'))) -
      Number(Boolean(a.fields.Blocker || a.labels.includes('blocked'))))
    .slice(0, 3).map(item => ({ number: item.content.number, title: item.content.title,
      url: item.content.url, status: item.fields.Status, blocker: item.fields.Blocker ?? '',
      progress: item.fields.Progress ?? '', nextAction: item.fields['Next action'] ?? '',
      lastProgressAt: item.fields['Last progress at'] ?? '' }));
  return { version: 1, generatedAt: now.toISOString(), hourKey: hour.toISOString().slice(0, 13), slotKey,
    board: { url: project.url, totalCards: cards.length, counts, blocked: blocked.length,
      now: cards.filter(item => item.fields.Status !== 'Done' && item.fields.Priority === 'Now').length,
      next: cards.filter(item => item.fields.Status === 'Queued' && item.fields.Priority === 'Next').length },
    prs24h: { merged: pulls.length, medianMs: median(prTimes), sample: prTimes.length },
    issueCycle: { medianMs: median(cycles), sample: cycles.length, missing: doneIssues.length - cycles.length },
    summary: { shipped, next, blockers: blocked.filter(item => item.content?.__typename === 'Issue')
      .slice(0, 1).map(item => ({ number: item.content.number, title: item.content.title, url: item.content.url })) },
    wipAge: { oldestMs: ages.length ? Math.max(...ages) : null, sample: ages.length,
      missing: activeIssues.length - ages.length }, main, highlights };
}

export function reportArtifact(report, delivery) {
  return JSON.stringify({ ...report, delivery }, null, 2);
}

function issueLink(issue) {
  const number = issue.number;
  if (!Number.isSafeInteger(number) || number < 1) return null;
  const url = issue.url;
  if (typeof url !== 'string' || !/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/issues\/[0-9]+$/.test(url) ||
      !url.endsWith(`/issues/${number}`)) return null;
  const title = [...String(issue.title ?? '').replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim()];
  const short = title.length > 35 ? `${title.slice(0, 34).join('').trimEnd()}…` : title.join('');
  const safe = (short || 'Issue').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/\|/g, '/').replace(/[*_~`]/g, '');
  return `<${url}|#${number} ${safe}>`;
}

export function formatReport(report) {
  const blocker = report.summary.blockers.map(issueLink).filter(Boolean)[0];
  const lines = [
    `*Fitsy ${report.slotKey.slice(11)} UTC* · main ${report.main.state}`,
    `• *Shipped:* ${report.summary.shipped.map(issueLink).filter(Boolean).join(' · ') || 'none verified /24h'}`,
    `• *Next:* ${report.summary.next.map(issueLink).filter(Boolean).join(' · ') || 'none queued'}`,
    `• *Blocker:* ${report.board.blocked ? `${report.board.blocked} open` : 'none'}${blocker ? ` · ${blocker}` : ''} · <${BOARD_URL}#fitsy-slot:${report.slotKey}|Details>`,
  ];
  return lines.join('\n');
}

async function api(fetchImpl, url, token, options = {}) {
  const response = await fetchImpl(url, { ...options, headers: {
    Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...options.headers,
  } });
  const data = await response.json();
  if (!response.ok || data.errors) throw Object.assign(new Error(`GitHub API request failed (${response.status})`), { status: response.status });
  return data;
}

export async function collect(fetchImpl, projectToken, actionsToken, now = new Date(), requestedSlot) {
  const graphql = (query, variables) => api(fetchImpl, 'https://api.github.com/graphql', projectToken,
    { method: 'POST', body: JSON.stringify({ query, variables }) }).then(data => data.data);
  const rest = url => api(fetchImpl, url, actionsToken);
  const [project, pulls, main] = await Promise.all([
    loadProject(graphql), loadMergedPulls(rest, now), loadMainGates(rest),
  ]);
  const local = await loadTimings(rest, project.items, now);
  return { ...buildReport(project, pulls, main, now, requestedSlot), local };
}

async function slack(fetchImpl, token, method, params) {
  const isGet = method === 'conversations.history';
  const url = `https://slack.com/api/${method}${isGet ? `?${new URLSearchParams(params)}` : ''}`;
  const response = await fetchImpl(url, { method: isGet ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(isGet ? {} : { body: JSON.stringify(params) }) });
  const result = await response.json();
  if (!response.ok || !result.ok) {
    const code = String(result.error ?? response.status).replace(/[^a-z0-9_]/gi, '');
    throw new Error(`Slack ${method} failed: ${code}`);
  }
  return result;
}

export async function postOnce(fetchImpl, token, channel, report, message) {
  const marker = `fitsy-slot:${report.slotKey}`;
  const legacyMarker = `fitsy-hour:${report.slotKey.slice(0, 13)}`;
  const oldest = Math.floor(Date.parse(`${report.slotKey}:00Z`) / 1000);
  const cursors = new Set();
  let cursor = '';
  for (;;) {
    const history = await slack(fetchImpl, token, 'conversations.history',
      { channel, oldest: String(oldest), limit: '200', ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(history.messages)) throw new Error('Slack history messages unavailable');
    if (history.messages.some(entry => entry.text?.includes(marker) || entry.text?.includes(legacyMarker))) {
      return { posted: false, duplicate: true, marker };
    }
    const next = history.response_metadata?.next_cursor;
    if (!next) break;
    if (cursors.has(next)) throw new Error('Slack history pagination did not advance');
    cursors.add(next); cursor = next;
  }
  const posted = await slack(fetchImpl, token, 'chat.postMessage',
    { channel, text: message, unfurl_links: false, unfurl_media: false });
  if (posted.channel !== channel || !posted.ts) throw new Error('Slack post receipt is incomplete');
  return { posted: true, duplicate: false, channel: posted.channel, ts: posted.ts, marker };
}

async function main() {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf('--output-dir');
  if (outputIndex < 0 || !args[outputIndex + 1]) throw new Error('--output-dir is required');
  const output = resolve(args[outputIndex + 1]);
  const slotArg = args.find(arg => arg.startsWith('--slot='));
  const now = new Date();
  const requestedSlot = slotArg?.slice('--slot='.length);
  deliverySlot(now, requestedSlot);
  await mkdir(output, { recursive: true });
  const post = args.includes('--post');
  if (post && (args.includes('--dry-run') || process.env.DELIVERY_REPORT_ENABLED !== 'true')) {
    throw new Error('Live posting requires DELIVERY_REPORT_ENABLED=true and --post');
  }
  if (!process.env.DELIVERY_GITHUB_TOKEN || !process.env.GITHUB_TOKEN) {
    throw new Error('DELIVERY_GITHUB_TOKEN and GITHUB_TOKEN are required');
  }
  const report = await collect(fetch, process.env.DELIVERY_GITHUB_TOKEN, process.env.GITHUB_TOKEN,
    now, requestedSlot);
  const message = formatReport(report);
  await writeFile(resolve(output, 'report.txt'), `${message}\n`);
  let delivery = { posted: false, dryRun: true };
  if (post) {
    if (!process.env.DELIVERY_SLACK_BOT_TOKEN || !process.env.DELIVERY_SLACK_CHANNEL) {
      throw new Error('Slack bot token and channel are required for posting');
    }
    delivery = await postOnce(fetch, process.env.DELIVERY_SLACK_BOT_TOKEN,
      process.env.DELIVERY_SLACK_CHANNEL, report, message);
  }
  await writeFile(resolve(output, 'report.json'), `${reportArtifact(report, delivery)}\n`);
  process.stdout.write(`${message}\n`);
  process.stdout.write(`delivery: ${delivery.posted ? 'posted' : delivery.duplicate ? 'duplicate' : 'dry-run'}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
