#!/usr/bin/env node
// Hourly loop-check pass for the Fitsy on-call agent (#991). Deterministic, read-only, no LLM: each check prints one line
// (ok / warn) so the log shows every check ran. Escalation and routing stay with the on-call session and its prompt.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const repository = resolve(new URL('../..', import.meta.url).pathname);
const minutes = ms => Math.round(ms / 60000);
const result = (name, ok, detail) => ({ name, status: ok ? 'ok' : 'warn', detail });

// Pure: handoff issues nobody has touched. Blocker handoffs warn after 30 minutes, others after 3 hours.
export function unackedHandoffs(issues, now) {
  return issues.filter(issue => {
    const limit = issue.labels.includes('blocker') ? 30 : 180;
    return !issue.commentCount && minutes(now - Date.parse(issue.createdAt)) >= limit;
  }).map(issue => issue.number);
}

// Pure: the app lane posts to Slack, so a stale last_slack.txt during the day means the poster is down.
export function slackStale(lastSlackMs, now, hourPt) {
  return hourPt >= 9 && hourPt < 22 && minutes(now - lastSlackMs) > 150;
}

export function runChecks({ now = Date.now(), run = (...args) => execFileSync(args[0], args.slice(1), { encoding: 'utf8' }),
  exists = existsSync, mtimeMs = file => statSync(file).mtimeMs, home = process.env.HOME,
  hourPt = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' }).format(new Date(now))) % 24 } = {}) {
  const checks = [];
  const attempt = (name, body) => { try { checks.push(body()); } catch (error) { checks.push(result(name, false, `check failed: ${error.message.split('\n')[0]}`)); } };

  attempt('docker', () => { run('docker', 'info', '--format', '{{.ServerVersion}}'); return result('docker', true, 'responding'); });
  attempt('supervisors', () => {
    const out = (() => { try { return run('pgrep', '-fl', 'supervise[.]sh'); } catch { return ''; } })();
    const missing = ['opusplan', 'app'].filter(lane => !new RegExp(`supervise\\.sh ${lane}`).test(out));
    return result('supervisors', missing.length === 0, missing.length ? `not running: ${missing.join(', ')}` : 'opusplan and app alive');
  });
  attempt('slack-liveness', () => {
    const file = resolve(home, 'fitsy-refactor/status/last_slack.txt');
    if (!exists(file)) return result('slack-liveness', false, 'last_slack.txt missing');
    const age = minutes(now - mtimeMs(file));
    return result('slack-liveness', !slackStale(mtimeMs(file), now, hourPt), `last post ${age} min ago`);
  });
  attempt('handoffs', () => {
    const issues = JSON.parse(run('gh', 'issue', 'list', '--repo', 'dgmolla/fitsy', '--label', 'handoff', '--state', 'open', '--json', 'number,createdAt,labels,comments', '--limit', '100'))
      .map(issue => ({ number: issue.number, createdAt: issue.createdAt, labels: issue.labels.map(label => label.name), commentCount: issue.comments.length }));
    const stale = unackedHandoffs(issues, now);
    return result('handoffs', stale.length === 0, stale.length ? `unacked: ${stale.map(number => `#${number}`).join(' ')}` : 'all acknowledged in time');
  });
  attempt('needs-dawit', () => {
    const issues = JSON.parse(run('gh', 'issue', 'list', '--repo', 'dgmolla/fitsy', '--label', 'needs-dawit', '--state', 'open', '--json', 'number', '--limit', '50'));
    return result('needs-dawit', issues.length === 0, issues.length ? `open: ${issues.map(issue => `#${issue.number}`).join(' ')}` : 'none open');
  });
  attempt('blocked', () => {
    const issues = JSON.parse(run('gh', 'issue', 'list', '--repo', 'dgmolla/fitsy', '--label', 'blocked', '--state', 'open', '--json', 'number', '--limit', '50'));
    return result('blocked', issues.length === 0, issues.length ? `open: ${issues.map(issue => `#${issue.number}`).join(' ')}` : 'none open');
  });
  // #874: dev Supabase auth settings and local env names the tests depend on; drift is reported in plain words, never values.
  attempt('external-config', () => {
    let output = '', code = 0;
    try { output = run('node', resolve(repository, 'scripts/dev/check-external-config.mjs')); } catch (error) { code = error.status ?? 1; output = String(error.stdout ?? error.message); }
    const lines = output.trim().split('\n').filter(Boolean);
    return result('external-config', code === 0, code === 0 ? 'no drift' : lines.slice(0, 3).join('; '));
  });
  return checks;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const checks = runChecks();
  for (const check of checks) process.stdout.write(`${new Date().toISOString()} loop-check ${check.name} ${check.status} ${check.detail}\n`);
  process.exit(checks.some(check => check.status === 'warn') ? 1 : 0);
}
