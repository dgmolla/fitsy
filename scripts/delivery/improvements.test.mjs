import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImprovement, verifyImprovements } from './improvements.mjs';
const now = new Date('2026-09-26T20:00:00Z');
const claim = { v: 1, id: 'dedup', issue: 355, category: 'regression', pr: 356,
  finding: 'Repeated summaries inflated elapsed time', prevention: 'Reject duplicate run summaries',
  detector_path: 'scripts/delivery/phase-report.test.mjs', prevention_path: 'scripts/delivery/phase-report.mjs',
  verify_run: 11, deploy_run: 12 };
const sha = 'a'.repeat(40);
const rest = async url => url.includes('/pulls/') ? { merged_at: now.toISOString(), base: { ref: 'main' }, merge_commit_sha: sha } :
  url.includes('/contents/') ? { type: 'file' } : { name: url.endsWith('/11') ? 'Verify' : 'Deploy', head_sha: sha,
    event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success', updated_at: now.toISOString() };

test('improvements require trusted structured claims', () => {
  const comment = { author_association: 'OWNER', body: `<!-- fitsy-improvement:v1:dedup -->\n\`\`\`json\n${JSON.stringify(claim)}\n\`\`\`` };
  assert.equal(parseImprovement(comment, 355).id, 'dedup');
  assert.equal(parseImprovement(comment, 354), null);
  assert.equal(parseImprovement({ ...comment, author_association: 'NONE' }, 355), null);
});

test('counts only merged main fixes with exact-source successful Verify and Deploy, once', async () => {
  assert.equal((await verifyImprovements(rest, [claim, claim], now)).verified.length, 1);
  for (const change of [{ head_sha: 'b'.repeat(40) }, { conclusion: 'failure' }, { event: 'pull_request' }]) {
    const result = await verifyImprovements(async url => ({ ...await rest(url), ...(url.includes('/actions/') ? change : {}) }), [claim], now);
    assert.equal(result.verified.length, 0);
    assert.equal(result.pending, 1);
  }
  const pending = await verifyImprovements(async url => ({ ...await rest(url), ...(url.includes('/pulls/') ? { merged_at: null } : {}) }), [claim], now);
  assert.equal(pending.verified.length, 0);
});
