import { parseImprovement, verifyImprovements } from './improvements.mjs';
const API = 'https://api.github.com/repos/dgmolla/fitsy';
const PHASES = ['implementation', 'verification', 'unit', 'e2e', 'review', 'shipping'];
const validId = value => typeof value === 'string' && ID.test(value);
const STATES = ['running', 'pass', 'fail', 'interrupted', 'skipped', 'cached'];
const ID = /^[a-zA-Z0-9_.-]{1,100}$/;
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

// These are writer observations, not proof that a source passed a release gate.
export function parseTiming(comment, issue, now) {
  if (!['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.author_association)) return null;
  const match = /^<!-- fitsy-delivery:v1:([a-zA-Z0-9_.-]{1,100}) -->\s*```json\s*([\s\S]*?)\s*```\s*$/.exec(comment.body ?? '');
  if (!match || comment.body.length > 60000) return null;
  try {
    const data = JSON.parse(match[2]);
    if (data.v !== 1 || data.issue !== issue || data.run_id !== match[1] || !iso(data.updated_at) ||
        Date.parse(data.updated_at) > now || !Array.isArray(data.events) || data.events.length > 500) return null;
    const ids = new Set();
    for (const e of data.events) {
      if (!e || !validId(e.event_id) || !validId(e.attempt_id) || ids.has(e.attempt_id) ||
          e.run_id !== data.run_id || e.issue !== issue || !PHASES.includes(e.phase) ||
          !STATES.includes(e.status) || !iso(e.started_at) || Date.parse(e.started_at) > Date.parse(data.updated_at) ||
          !/^[a-f0-9]{40}$/.test(e.source_sha) || !validId(e.producer) ||
          ['check', 'lens', 'round_id'].some(k => e[k] !== undefined && !validId(e[k]))) return null;
      ids.add(e.attempt_id);
      if (e.status === 'running') {
        if (e.finished_at !== null || e.duration_ms !== null) return null;
      } else {
        const wall = Date.parse(e.finished_at) - Date.parse(e.started_at);
        if (!iso(e.finished_at) || Date.parse(e.finished_at) > Date.parse(data.updated_at) || wall < 0 ||
            !Number.isFinite(e.duration_ms) || e.duration_ms < 0 || Math.abs(e.duration_ms - wall) > 1000) return null;
      }
    }
    return { ...data, url: comment.html_url };
  } catch { return null; }
}

export async function loadTimings(rest, items, now) {
  const candidates = items.filter(item => item.content?.__typename === 'Issue' &&
    (item.fields.Status === 'In flight' || (item.fields.Status === 'Done' &&
      iso(item.fields['Verified at']) && Date.parse(item.fields['Verified at']) <= +now &&
      Date.parse(item.fields['Verified at']) >= now.getTime() - 86400000)));
  const records = [], improvements = [];
  let invalid = 0;
  for (const item of candidates) {
    const issue = item.content.number;
    const runs = new Map();
    let complete = false;
    for (let page = 1; page <= 100; page++) {
      const comments = await rest(`${API}/issues/${issue}/comments?per_page=100&page=${page}`);
      if (!Array.isArray(comments)) throw new Error('Issue timing comments unavailable');
      for (const comment of comments) {
        const improvement = parseImprovement(comment, issue);
        if (improvement) improvements.push(improvement);
        if (!comment.body?.startsWith('<!-- fitsy-delivery:v1:')) continue;
        const parsed = parseTiming(comment, issue, now.getTime());
        if (!parsed) { invalid++; continue; }
        const prior = runs.get(parsed.run_id);
        // Multiple summaries for the same run are ambiguous, never additive.
        if (prior) { invalid++; runs.set(parsed.run_id, { conflict: true }); }
        else runs.set(parsed.run_id, parsed);
      }
      if (comments.length < 100) { complete = true; break; }
    }
    if (!complete) throw new Error(`Issue ${issue} timing pagination exceeded its limit`);
    records.push({ issue, active: item.fields.Status === 'In flight',
      runs: [...runs.values()].filter(run => !run.conflict) });
  }
  return { ...summarizeTimings(records, now, invalid),
    improvements: await verifyImprovements(rest, improvements, now) };
}

export function unionMs(intervals) {
  const ordered = intervals.filter(([a, b]) => b >= a).sort((a, b) => a[0] - b[0]);
  let total = 0, end = -Infinity;
  for (const [a, b] of ordered) { total += Math.max(0, b - Math.max(a, end)); end = Math.max(end, b); }
  return total;
}

export function summarizeTimings(records, now, invalid = 0) {
  const stop = now.getTime(), since = stop - 86400000;
  const phases = Object.fromEntries(PHASES.map(phase => [phase,
    { observedMs: null, issues: 0, attempts: 0, failed: 0, cached: 0, skipped: 0, running: 0 }]));
  const active = records.filter(record => record.active);
  let tracked = 0, stale = 0;
  const rounds = [];
  for (const record of records) {
    const events = record.runs.flatMap(run => run.events.filter(e =>
      Date.parse(e.status === 'running' ? run.updated_at : e.finished_at) >= since));
    if (record.active && events.length) tracked++;
    if (record.active && record.runs.length && Math.max(...record.runs.map(run => Date.parse(run.updated_at))) < stop - 7200000) stale++;
    for (const phase of PHASES) {
      const selected = events.filter(e => e.phase === phase), metric = phases[phase];
      const measured = selected.filter(e => ['pass', 'fail', 'interrupted'].includes(e.status));
      const intervals = measured.map(e => [Math.max(since, Date.parse(e.started_at)), Date.parse(e.finished_at)]);
      if (measured.length) { metric.observedMs = (metric.observedMs ?? 0) + unionMs(intervals); metric.issues++; }
      metric.attempts += measured.length;
      metric.failed += selected.filter(e => ['fail', 'interrupted'].includes(e.status)).length;
      for (const status of ['cached', 'skipped', 'running']) metric[status] += selected.filter(e => e.status === status).length;
    }
    const review = events.filter(e => e.phase === 'review' && e.round_id);
    for (const round of new Set(review.map(e => e.round_id))) {
      const attempts = review.filter(e => e.round_id === round);
      const measured = attempts.filter(e => ['pass', 'fail', 'interrupted'].includes(e.status));
      const intervals = measured.map(e => [Math.max(since, Date.parse(e.started_at)), Date.parse(e.finished_at)]);
      rounds.push({ issue: record.issue, round, wallMs: unionMs(intervals),
        lensMs: intervals.reduce((sum, [a, b]) => sum + b - a, 0),
        attempts: measured.length, cached: attempts.filter(e => e.status === 'cached').length,
        running: attempts.filter(e => e.status === 'running').length });
    }
  }
  return { window: '24h', phases, rounds, coverage: { active: active.length, tracked, stale, invalid },
    evidence: records.flatMap(record => record.runs.map(run => ({ issue: record.issue, url: run.url }))) };
}
