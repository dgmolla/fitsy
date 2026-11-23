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

// Pure: #1054 weekly maintenance is due when no receipt comment ("Weekly receipt") landed in the last 8 days.
export function weeklyMaintenanceDue(comments, now, windowMs = 8 * 86400_000) {
  return !(comments ?? []).some(comment => /Weekly receipt/i.test(comment.body ?? '') && now - Date.parse(comment.createdAt) <= windowMs);
}

// Pure: the app lane posts to Slack, so a stale last_slack.txt during the day means the poster is down.
export function slackStale(lastSlackMs, now, hourPt) {
  return hourPt >= 9 && hourPt < 22 && minutes(now - lastSlackMs) > 150;
}

// Pure: supervisor.log lines like "[2026-11-22 15:06:11 PST] [opusplan] ..." that report BLOCKED or a network/API backoff recently.
export function recentSupervisorProblems(logText, now, windowMs = 3 * 3600_000) {
  return logText.split('\n').filter(line => /BLOCKED|network\/API error/.test(line)).filter(line => {
    const match = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (PST|PDT)\]/.exec(line);
    if (!match) return false;
    const at = Date.parse(`${match[1]}T${match[2]}${match[3] === 'PDT' ? '-07:00' : '-08:00'}`);
    return Number.isFinite(at) && now - at <= windowMs;
  });
}

// Pure: open blocker issues nobody has touched for an hour.
export function stalledBlockers(issues, now, limitMinutes = 60) {
  return issues.filter(issue => minutes(now - Date.parse(issue.updatedAt)) >= limitMinutes).map(issue => issue.number);
}

export function runChecks({ now = Date.now(), run = (...args) => execFileSync(args[0], args.slice(1), { encoding: 'utf8' }),
  exists = existsSync, readText = file => readFileSync(file, 'utf8'), mtimeMs = file => statSync(file).mtimeMs, home = process.env.HOME,
  hourPt = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Los_Angeles' }).format(new Date(now))) % 24 } = {}) {
  const checks = [];
  const attempt = (name, body) => { try { checks.push(body()); } catch (error) { checks.push(result(name, false, `check failed: ${error.message.split('\n')[0]}`)); } };

  attempt('docker', () => { run('docker', 'info', '--format', '{{.ServerVersion}}'); return result('docker', true, 'responding'); });
  attempt('supervisors', () => {
    // ps, not pgrep -f: pgrep missed a re-exec'd supervisor on macOS.
    const out = (() => { try { return run('ps', '-axo', 'pid=,command='); } catch { return ''; } })();
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
  attempt('supervisor-log', () => {
    const file = resolve(home, 'fitsy-codex-loopv2/claude-queue/supervisor.log');
    if (!exists(file)) return result('supervisor-log', false, 'supervisor.log missing');
    const problems = recentSupervisorProblems(readText(file).split('\n').slice(-400).join('\n'), now);
    return result('supervisor-log', problems.length === 0, problems.length ? `${problems.length} BLOCKED or network lines in the last 3 hours` : 'no BLOCKED or network lines in 3 hours');
  });
  attempt('token-snapshot', () => {
    let output = '';
    try { output = run('/bin/zsh', resolve(home, 'fitsy-codex-loopv2/claude-queue/token-snapshot.sh')); } catch (error) { output = String(error.stdout ?? ''); }
    return result('token-snapshot', !/\bWARN\b/.test(output), /\bWARN\b/.test(output) ? output.split('\n').find(line => /\bWARN\b/.test(line)).slice(0, 160) : 'no warnings');
  });
  attempt('stalled-blockers', () => {
    const issues = JSON.parse(run('gh', 'issue', 'list', '--repo', 'dgmolla/fitsy', '--label', 'blocker', '--state', 'open', '--json', 'number,updatedAt', '--limit', '50'));
    const stalled = stalledBlockers(issues, now);
    return result('stalled-blockers', stalled.length === 0, stalled.length ? `no update for 60+ min: ${stalled.map(number => `#${number}`).join(' ')}` : 'blockers are moving');
  });
  // #994: the hourly pass also refreshes the cost snapshot; any ALERT line (80 percent quota, 50 percent projected jump) is a warning.
  attempt('cost-snapshot', () => {
    const output = run('node', resolve(repository, 'scripts/cost/collect.mjs'));
    const alerts = output.split('\n').filter(line => line.startsWith('ALERT '));
    return result('cost-snapshot', alerts.length === 0, alerts.length ? alerts.map(line => line.slice(6)).join('; ').slice(0, 300) : output.split('\n')[0].slice(0, 120));
  });
  // #1020: a lane that ended a run with questions only in its output gets an auto-filed needs-fitsy issue; surface any still open.
  attempt('idle-with-questions', () => {
    const issues = JSON.parse(run('gh', 'issue', 'list', '--repo', 'dgmolla/fitsy', '--label', 'needs-fitsy', '--state', 'open', '--json', 'number,title', '--limit', '50'))
      .filter(issue => /open questions from run/.test(issue.title));
    return result('idle-with-questions', issues.length === 0, issues.length ? `open: ${issues.map(issue => `#${issue.number}`).join(' ')}` : 'none open');
  });
  // #874: dev Supabase auth settings and local env names the tests depend on; drift is reported in plain words, never values.
  attempt('external-config', () => {
    let output = '', code = 0;
    try { output = run('node', resolve(repository, 'scripts/dev/check-external-config.mjs')); } catch (error) { code = error.status ?? 1; output = String(error.stdout ?? error.message); }
    const lines = output.trim().split('\n').filter(Boolean);
    return result('external-config', code === 0, code === 0 ? 'no drift' : lines.slice(0, 3).join('; '));
  });
  // #1054: the tooling lane owes one receipt comment a week; this warning is what wakes it up (no new sender or schedule).
  attempt('weekly-maintenance', () => {
    const issue = JSON.parse(run('gh', 'issue', 'view', '1054', '--repo', 'dgmolla/fitsy', '--json', 'comments'));
    const due = weeklyMaintenanceDue(issue.comments, now);
    return result('weekly-maintenance', !due, due ? 'no "Weekly receipt" on #1054 in 8 days: tooling lane runs the weekly pass' : 'receipt posted this week');
  });
  return checks;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const checks = runChecks();
  for (const check of checks) process.stdout.write(`${new Date().toISOString()} loop-check ${check.name} ${check.status} ${check.detail}\n`);
  process.exit(checks.some(check => check.status === 'warn') ? 1 : 0);
}
