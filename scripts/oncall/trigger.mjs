#!/usr/bin/env node
// Fitsy on-call trigger (#991): a cheap, no-LLM check that decides whether an on-call Claude session is needed.
// Sources: Slack #fitsy-alerts, open incident/monitoring/P1 issues, failed main workflow runs.
// A small state file remembers what was already handled, so each item is reported once and a quiet tick prints nothing.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALERT_CHANNEL = 'C0ASM3865AA';
const MONITORED_WORKFLOWS = ['Deploy', 'Release', 'Production Monitor'];

export function readState(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { slackTs: '0', issues: {}, runs: [] }; }
}

export function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state)}\n`);
  renameSync(temp, file);
}

// Pure: given the fetched snapshot and the previous state, return the new items and the next state.
export function diffSnapshot(snapshot, state) {
  const items = [];
  let slackTs = state.slackTs || '0';
  for (const message of snapshot.slack || []) {
    if (Number(message.ts) > Number(state.slackTs || 0)) {
      items.push({ source: 'slack', ts: message.ts, text: String(message.text || '').slice(0, 500) });
      if (Number(message.ts) > Number(slackTs)) slackTs = message.ts;
    }
  }
  const issues = { ...(state.issues || {}) };
  for (const issue of snapshot.issues || []) {
    if (issues[issue.number] !== issue.updatedAt) {
      items.push({ source: 'issue', number: issue.number, title: issue.title, updatedAt: issue.updatedAt, labels: issue.labels });
      issues[issue.number] = issue.updatedAt;
    }
  }
  const seenRuns = new Set(state.runs || []);
  for (const run of snapshot.runs || []) {
    if (!seenRuns.has(run.id)) {
      items.push({ source: 'run', id: run.id, workflow: run.workflow, sha: run.sha, url: run.url });
      seenRuns.add(run.id);
    }
  }
  return { items, next: { slackTs, issues, runs: [...seenRuns].slice(-200) } };
}

const gh = (...args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));

export function fetchGitHub(repo = 'dgmolla/fitsy', run = gh) {
  const issues = [];
  for (const label of ['incident', 'monitoring', 'P1', 'urgency:P1']) {
    for (const issue of run('issue', 'list', '--repo', repo, '--label', label, '--state', 'open', '--json', 'number,title,updatedAt,labels', '--limit', '50')) {
      if (!issues.some(known => known.number === issue.number)) {
        issues.push({ number: issue.number, title: issue.title, updatedAt: issue.updatedAt, labels: issue.labels.map(item => item.name) });
      }
    }
  }
  const runs = run('run', 'list', '--repo', repo, '--branch', 'main', '--status', 'failure', '--limit', '30', '--json', 'databaseId,workflowName,headSha,url')
    .filter(item => MONITORED_WORKFLOWS.includes(item.workflowName))
    .map(item => ({ id: item.databaseId, workflow: item.workflowName, sha: item.headSha, url: item.url }));
  return { issues, runs };
}

// The Slack token is read from the local env file inside this process and is never printed or logged.
export async function fetchSlack({ envFile, since, fetchImpl = fetch }) {
  const token = /^SLACK_BOT_TOKEN=(.*)$/m.exec(readFileSync(envFile, 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (!token) throw new Error('slack token not configured');
  const url = `https://slack.com/api/conversations.history?channel=${ALERT_CHANNEL}&oldest=${encodeURIComponent(since || '0')}&limit=50`;
  const response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` } });
  const body = await response.json();
  if (!body.ok) throw new Error(`slack error: ${body.error}`);
  return body.messages.map(message => ({ ts: message.ts, text: message.text }));
}

export async function tick({ stateFile, slackEnv, repo, github = fetchGitHub, slack = fetchSlack } = {}) {
  const state = readState(stateFile);
  const snapshot = { ...github(repo) };
  const errors = [];
  try { snapshot.slack = await slack({ envFile: slackEnv, since: state.slackTs }); } catch (error) { errors.push(`slack: ${error.message}`); }
  const { items, next } = diffSnapshot(snapshot, state);
  writeState(stateFile, next);
  return { items, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const home = process.env.HOME;
  const result = await tick({
    stateFile: process.env.ONCALL_STATE || resolve(home, '.config/fitsy/oncall-state.json'),
    slackEnv: process.env.FITSY_SLACK_ENV || resolve(home, '.config/fitsy/slack-bridge.env'),
  });
  if (result.items.length) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (result.errors.length) process.stderr.write(`${result.errors.join('\n')}\n`);
}
