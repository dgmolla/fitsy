#!/usr/bin/env node
// Read-only ship-speed budgets from GitHub data (#774). No gate removal: this
// only measures and flags, consumed by the daily Fable ship-health audit.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const REPO = 'dgmolla/fitsy';

export const DEFAULT_BUDGETS = {
  maestroQueueWaitMinutes: 15,
  nativeAttemptsPerSha: 2,
  verifyDurationMinutes: 20,
  pushesPerPr: 8,
  statusCommentsPerIssuePerHour: 4,
};

function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // gh error output can contain response bodies; never surface it raw.
    throw new Error(`gh ${args[0]} failed: ${error.status != null ? `exit ${error.status}` : 'no exit code'}`);
  }
}
function ghJson(args) {
  const raw = gh(args);
  try { return JSON.parse(raw); } catch { throw new Error(`gh ${args.join(' ')} did not return valid JSON`); }
}

const minutesBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 60000;
const hourBucket = iso => iso.slice(0, 13); // '2026-11-10T21'

export function mergedPrs(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  // `commits` is requested per PR, not in this bulk list: across ~200 PRs the
  // nested GraphQL query for commit authors exceeds GitHub's node-count limit.
  const prs = ghJson(['pr', 'list', '--repo', REPO, '--state', 'merged', '--search', `merged:>=${since}`,
    '--limit', '200', '--json', 'number,title,createdAt,mergedAt,headRefOid,url']);
  return prs.map(pr => ({ ...pr, commits: ghJson(['pr', 'view', String(pr.number), '--repo', REPO, '--json', 'commits']).commits }));
}

export function workflowRuns(workflow, days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const runs = ghJson(['run', 'list', '--repo', REPO, '--workflow', workflow, '--limit', '200',
    '--json', 'databaseId,headSha,status,conclusion,createdAt,event']);
  return runs.filter(run => run.createdAt >= since);
}

export function runJobs(databaseId) {
  return ghJson(['api', `repos/${REPO}/actions/runs/${databaseId}/jobs`]).jobs || [];
}

export function fetchIssuesWithComments(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return ghJson(['issue', 'list', '--repo', REPO, '--state', 'all', '--search', `updated:>=${since}`,
    '--limit', '100', '--json', 'number,comments']);
}

export function issueCommentHours(issues, sinceIso) {
  return issues.map(issue => {
    const counts = {};
    for (const comment of issue.comments) {
      if (sinceIso && comment.createdAt < sinceIso) continue;
      const bucket = hourBucket(comment.createdAt);
      counts[bucket] = (counts[bucket] || 0) + 1;
    }
    const peak = Math.max(0, ...Object.values(counts));
    return { issue: issue.number, peakCommentsPerHour: peak };
  });
}

// Pushes per PR: commit count is a close proxy for push count without needing
// to correlate push-triggered workflow runs back to a specific PR branch.
export function pushesPerPr(prs) {
  return prs.map(pr => ({ pr: pr.number, title: pr.title, url: pr.url, pushes: pr.commits.length }));
}

export function openToMergeMinutes(prs) {
  return prs.map(pr => ({ pr: pr.number, title: pr.title, url: pr.url, minutes: Math.round(minutesBetween(pr.createdAt, pr.mergedAt)) }));
}

export function nativeAttemptsPerSha(runs) {
  const bySha = {};
  for (const run of runs) (bySha[run.headSha] ??= []).push(run);
  return Object.entries(bySha).map(([sha, attempts]) => ({ sha, attempts: attempts.length }));
}

export function maestroQueueWaits(runs, jobsFor = runJobs) {
  const waits = [];
  for (const run of runs) {
    for (const job of jobsFor(run.databaseId)) {
      if (job.name !== 'Maestro on Mac' || !job.created_at || !job.started_at) continue;
      waits.push({ run: run.databaseId, sha: run.headSha, queueWaitMinutes: Math.round(minutesBetween(job.created_at, job.started_at) * 10) / 10 });
    }
  }
  return waits;
}

export function verifyDurations(runs, jobsFor = runJobs) {
  const durations = [];
  for (const run of runs) {
    for (const job of jobsFor(run.databaseId)) {
      if (!/^Tests \(L2\)/.test(job.name) || !job.started_at || !job.completed_at) continue;
      durations.push({ run: run.databaseId, sha: run.headSha, job: job.name,
        durationMinutes: Math.round(minutesBetween(job.started_at, job.completed_at) * 10) / 10 });
    }
  }
  return durations;
}

export function violations(budgets, metrics) {
  const out = [];
  for (const m of metrics.maestroQueueWaits) if (m.queueWaitMinutes > budgets.maestroQueueWaitMinutes)
    out.push(`Maestro queue wait ${m.queueWaitMinutes}min > ${budgets.maestroQueueWaitMinutes}min (run ${m.run})`);
  for (const m of metrics.nativeAttemptsPerSha) if (m.attempts > budgets.nativeAttemptsPerSha)
    out.push(`${m.attempts} native attempts > ${budgets.nativeAttemptsPerSha} for SHA ${m.sha.slice(0, 12)}`);
  for (const m of metrics.verifyDurations) if (m.durationMinutes > budgets.verifyDurationMinutes)
    out.push(`${m.job} took ${m.durationMinutes}min > ${budgets.verifyDurationMinutes}min (run ${m.run})`);
  for (const m of metrics.pushesPerPr) if (m.pushes > budgets.pushesPerPr)
    out.push(`PR #${m.pr} had ${m.pushes} pushes > ${budgets.pushesPerPr}`);
  for (const m of metrics.issueCommentHours) if (m.peakCommentsPerHour > budgets.statusCommentsPerIssuePerHour)
    out.push(`Issue #${m.issue} peaked at ${m.peakCommentsPerHour} comments/hour > ${budgets.statusCommentsPerIssuePerHour}`);
  return out;
}

export async function computeBudgets(days, budgets = DEFAULT_BUDGETS) {
  const prs = mergedPrs(days);
  const simulatorRuns = workflowRuns('simulator.yml', days);
  const verifyRuns = workflowRuns('verify.yml', days);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const metrics = {
    pushesPerPr: pushesPerPr(prs),
    openToMergeMinutes: openToMergeMinutes(prs),
    nativeAttemptsPerSha: nativeAttemptsPerSha(simulatorRuns),
    maestroQueueWaits: maestroQueueWaits(simulatorRuns),
    verifyDurations: verifyDurations(verifyRuns),
    issueCommentHours: issueCommentHours(fetchIssuesWithComments(days), since),
  };
  return { generatedAt: new Date().toISOString(), days, budgets, metrics, violations: violations(budgets, metrics) };
}

function toMarkdown(report) {
  const lines = [`# Ship-speed budgets — ${report.generatedAt}`, '', `Window: last ${report.days} day(s).`, ''];
  lines.push('## Violations', '');
  lines.push(report.violations.length ? report.violations.map(v => `- ${v}`).join('\n') : '_None._');
  lines.push('', '## Summary', '');
  lines.push(`- Merged PRs: ${report.metrics.pushesPerPr.length}`);
  lines.push(`- Simulator runs: ${report.metrics.nativeAttemptsPerSha.reduce((n, a) => n + a.attempts, 0)}`);
  lines.push(`- Verify (L2) job samples: ${report.metrics.verifyDurations.length}`);
  return lines.join('\n') + '\n';
}

if (process.argv[1] && new URL(import.meta.url).pathname === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const days = Number(args.find(a => a.startsWith('--days='))?.slice('--days='.length) || 7);
  const out = args.find(a => a.startsWith('--out='))?.slice('--out='.length);
  // generatedAt is UTC; a caller bucketing by its own local calendar date
  // (e.g. the daily audit's America/Los_Angeles day) should override this,
  // or two runs near midnight UTC could write different-looking filenames
  // for what the caller considers the same day.
  const date = args.find(a => a.startsWith('--date='))?.slice('--date='.length);
  if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');
  const report = await computeBudgets(days);
  if (out) {
    const filenameDate = date || report.generatedAt.slice(0, 10);
    mkdirSync(dirname(resolve(out, 'x')), { recursive: true });
    mkdirSync(resolve(out), { recursive: true });
    writeFileSync(resolve(out, `budgets-${filenameDate}.json`), JSON.stringify(report, null, 2) + '\n');
    writeFileSync(resolve(out, `budgets-${filenameDate}.md`), toMarkdown(report));
  }
  console.log(JSON.stringify({ name: 'ship-speed-budgets', status: report.violations.length ? 'fail' : 'pass',
    summary: report.violations.length ? `${report.violations.length} budget violation(s)` : 'all budgets met' }));
  if (report.violations.length) process.exitCode = 1;
}
