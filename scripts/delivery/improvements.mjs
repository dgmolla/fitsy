const API = 'https://api.github.com/repos/dgmolla/fitsy';
export const CATEGORIES = ['speed', 'regression', 'diagnostics', 'recovery', 'security'];

export function parseImprovement(comment, issue) {
  if (!['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.author_association)) return null;
  const match = /^<!-- fitsy-improvement:v1:([a-z0-9-]{1,80}) -->\s*```json\s*([\s\S]*?)\s*```\s*$/.exec(comment.body ?? '');
  if (!match || comment.body.length > 10000) return null;
  try {
    const d = JSON.parse(match[2]);
    if (d.v !== 1 || d.id !== match[1] || d.issue !== issue || !CATEGORIES.includes(d.category) ||
        !Number.isSafeInteger(d.pr) || d.pr < 1 ||
        ![d.finding, d.prevention].every(s => typeof s === 'string' && s.trim().length > 0 && s.length <= 500) ||
        ![d.detector_path, d.prevention_path].every(s => typeof s === 'string' && /^[a-zA-Z0-9_./-]+$/.test(s) && !s.split('/').includes('..')) ||
        ![d.verify_run, d.deploy_run].every(n => Number.isSafeInteger(n) && n > 0)) return null;
    return { ...d, url: comment.html_url, updatedAt: Date.parse(comment.updated_at ?? comment.created_at) || 0 };
  } catch { return null; }
}

// Source-bound gates prove shipment; the finding/detector relationship is a reviewed writer claim.
export async function verifyImprovements(rest, claims, now) {
  const verified = [], pending = [];
  const latest = new Map();
  for (const claim of claims) {
    const key = `${claim.pr}:${claim.id}`;
    if (!latest.has(key) || (claim.updatedAt ?? 0) >= (latest.get(key).updatedAt ?? 0)) latest.set(key, claim);
  }
  for (const claim of latest.values()) {
    try {
    const pr = await rest(`${API}/pulls/${claim.pr}`);
    const sha = pr.merge_commit_sha;
    if (!pr.merged_at || pr.base?.ref !== 'main' || !/^[a-f0-9]{40}$/.test(sha ?? '')) { pending.push(claim); continue; }
    const runs = await Promise.all([claim.verify_run, claim.deploy_run].map(id => rest(`${API}/actions/runs/${id}`)));
    if (!runs.every((run, i) => run.name === ['Verify', 'Deploy'][i] && run.head_sha === sha &&
        run.event === 'push' && run.head_branch === 'main' && run.status === 'completed' && run.conclusion === 'success')) {
      pending.push(claim); continue;
    }
    const files = await Promise.all([claim.detector_path, claim.prevention_path].map(path =>
      rest(`${API}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`)));
    if (!files.every(file => file.type === 'file')) { pending.push(claim); continue; }
    const at = Math.max(...runs.map(run => Date.parse(run.updated_at)), Date.parse(pr.merged_at));
    if (!Number.isFinite(at) || at > +now) { pending.push(claim); continue; }
    if (at >= +now - 86400000) verified.push({ ...claim, verified_at: new Date(at).toISOString(), sha });
    } catch (error) {
      if (error.status !== 404) throw error;
      pending.push(claim);
    }
  }
  return { verified, pending: pending.length,
    categories: Object.fromEntries(CATEGORIES.map(category => [category, verified.filter(c => c.category === category).length])) };
}
