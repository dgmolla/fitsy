import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
test('Verify covers every job and rejects failed, cancelled, missing or unexpected skipped work', () => {
  const jobs = read('.github/workflows/verify.yml').split('\njobs:\n')[1];
  const aggregate = jobs.split('\n  verify:\n')[1];
  const names = [...jobs.matchAll(/^  ([\w-]+):$/gm)].map(match => match[1]).filter(name => name !== 'verify');
  assert.deepEqual(aggregate.match(/needs: \[([^\]]+)\]/)[1].split(', ').sort(), names.sort());
  assert.match(aggregate, /if: \$\{\{ always\(\) \}\}/);
  assert.match(aggregate, /name: Verify\n/);
  const command = aggregate.split('        run: |\n')[1].replace(/^ {10}/gm, '');
  const run = (needs, event) => spawnSync('bash', ['-e', '-c', command], {
    env: { ...process.env, NEEDS_JSON: JSON.stringify(needs), GITHUB_EVENT_NAME: event }, encoding: 'utf8' }).status;
  for (const event of ['pull_request', 'push']) for (const flags of [['true', 'true', 'true'], ['true', 'true', 'false'], ['false', 'false', 'false']]) {
    const needs = Object.fromEntries(names.map(name => [name, { result: 'success' }]));
    needs.classify.outputs = Object.fromEntries(['code', 'tests', 'build'].map((key, i) => [key, flags[i]]));
    ['static', 'test', 'build'].forEach((name, i) => { needs[name].result = flags[i] === 'true' ? 'success' : 'skipped'; });
    needs['domain-check'].result = event === 'pull_request' ? 'success' : 'skipped';
    assert.equal(run(needs, event), 0);
    for (const name of names) for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      if (result !== needs[name].result) assert.notEqual(run({ ...needs, [name]: { ...needs[name], result } }, event), 0, `${event}: ${name} ${result}`);
    }
    delete needs.classify.outputs.code;
    assert.notEqual(run(needs, event), 0);
  }
});
test('protection payload adds requirements without dropping existing gates; never executes gh or the script', () => {
  const query = read('scripts/github/apply-branch-protection.sh').match(/payload=\$\(jq --argjson app "\$app" '([\s\S]*?)' <<<"\$current"\)/)[1];
  const payload = old => JSON.parse(execFileSync('jq', ['--argjson', 'app', '15368', query], { input: JSON.stringify(old), encoding: 'utf8' }));
  const actors = { users: [{ login: 'owner' }], teams: [{ slug: 'team' }], apps: [{ slug: 'app' }] };
  const old = { required_status_checks: { checks: [{ context: 'review', app_id: 7 }, { context: 'Verify', app_id: null }], contexts: ['review', 'legacy', 'Verify'] }, restrictions: actors,
    required_pull_request_reviews: { required_approving_review_count: 3, dismissal_restrictions: actors, bypass_pull_request_allowances: actors } };
  for (const key of ['required_linear_history', 'required_conversation_resolution', 'block_creations', 'lock_branch', 'allow_fork_syncing']) old[key] = { enabled: true };
  const updated = payload(old), fresh = payload({});
  assert.deepEqual(updated.required_status_checks, { strict: true, contexts: [], checks: [{ context: 'Verify', app_id: 15368 }, { context: 'legacy', app_id: -1 }, { context: 'review', app_id: 7 }] });
  assert.equal(updated.required_pull_request_reviews.required_approving_review_count, 3);
  assert.deepEqual(updated.restrictions, { users: ['owner'], teams: ['team'], apps: ['app'] });
  assert.deepEqual(updated.required_pull_request_reviews.dismissal_restrictions, updated.restrictions);
  for (const key of Object.keys(old).filter(key => old[key].enabled)) assert.equal(updated[key], true);
  assert.deepEqual(fresh.required_pull_request_reviews, { dismiss_stale_reviews: true, require_code_owner_reviews: false, require_last_push_approval: false, required_approving_review_count: 0, bypass_pull_request_allowances: { users: [], teams: [], apps: [] } });
  assert.deepEqual(updated.required_pull_request_reviews.bypass_pull_request_allowances, fresh.required_pull_request_reviews.bypass_pull_request_allowances);
  assert.equal(fresh.enforce_admins, true); assert.equal(fresh.allow_force_pushes, false); assert.equal(fresh.allow_deletions, false); assert.equal(fresh.restrictions, null);
  assert.deepEqual(payload({ ...old, required_status_checks: updated.required_status_checks }), updated);
});
