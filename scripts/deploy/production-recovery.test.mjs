import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recoverProduction, rollbackCandidate } from './production-recovery.mjs';
import { policy } from '../verify/production-policy.mjs';

const badSha = 'b'.repeat(40), goodSha = 'a'.repeat(40);
const deployments = [
  { target: 'production', readyState: 'READY', created: 2, url: 'bad.vercel.app', meta: { githubCommitSha: badSha } },
  { target: 'production', readyState: 'READY', created: 1, url: 'good.vercel.app', meta: { githubCommitSha: goodSha } },
];

function fixture() {
  const history = [];
  let serving = badSha, priorStatus = 401, race = false, healthReads = 0, healthStatus = 200;
  const fetchImpl = async url => {
    if (url.startsWith('https://api.vercel.com/')) return Response.json({ deployments });
    if (url.endsWith('/api/health')) {
      if (url.startsWith(policy.baseUrl) && ++healthReads > 1 && race) serving = 'c'.repeat(40);
      return Response.json({ status: 'ok', db: 'connected', deploymentSha: url.startsWith(policy.baseUrl) ? serving : goodSha }, { status: url.startsWith(policy.baseUrl) ? healthStatus : 200 });
    }
    return new Response(null, { status: url.startsWith('https://good.vercel.app') ? priorStatus : 401 });
  };
  return { history, options: { failedSha: badSha, smokeOutcome: 'failure', env: { VERCEL_TOKEN: 'private' }, fetchImpl,
    page: async () => { history.push('slack'); },
    runRollback: async target => { history.push(['rollback.sh', 'api', target.url]); serving = target.sha; healthStatus = 200; },
    resolved: async () => { history.push('resolved'); },
  }, breakPrevious() { priorStatus = 503; }, breakHealth() { healthStatus = 503; }, changeServing() { serving = goodSha; }, race() { race = true; } };
}

test('simulated Release Verify smoke failure pages and rolls back an explicit tested target', async () => {
  const f = fixture();
  const result = await recoverProduction(f.options);
  assert.equal(result.status, 'recovered');
  assert.deepEqual(f.history, ['slack', ['rollback.sh', 'api', 'https://good.vercel.app'], 'resolved']);
  const workflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /id: api_smoke/);
  assert.match(workflow, /needs\.smoke\.outputs\.smoke_outcome == 'failure'/);
  assert.match(workflow, /node scripts\/deploy\/production-recovery\.mjs/);
});

test('recovery never rolls back a healthy smoke, unknown candidate or changed production source', async () => {
  const f = fixture();
  await assert.rejects(recoverProduction({ ...f.options, smokeOutcome: 'success' }));
  await assert.rejects(recoverProduction({ ...f.options, failedSha: '' }));
  f.changeServing();
  assert.equal((await recoverProduction(f.options)).status, 'superseded');
  assert.deepEqual(f.history, ['slack']);
});

test('unhealthy previous deployment and promotion races withhold rollback', async () => {
  const f = fixture(); f.breakPrevious();
  await assert.rejects(recoverProduction(f.options));
  assert.deepEqual(f.history, ['slack']);
  const racing = fixture(); racing.race();
  assert.equal((await recoverProduction(racing.options)).status, 'superseded');
  assert.deepEqual(racing.history, ['slack']);
});

test('a Slack outage cannot withhold restoration, but does keep the recovery job failed', async () => {
  const f = fixture();
  await assert.rejects(recoverProduction({ ...f.options, page: async () => { throw new Error('Slack unavailable'); } }));
  assert.deepEqual(f.history, [['rollback.sh', 'api', 'https://good.vercel.app'], 'resolved']);
});

test('selection rejects previews, unready deployments, unknown history and arbitrary URLs', () => {
  assert.throws(() => rollbackCandidate([], badSha));
  assert.throws(() => rollbackCandidate([deployments[0], { ...deployments[1], target: 'preview' }], badSha));
  assert.throws(() => rollbackCandidate([deployments[0], { ...deployments[1], readyState: 'ERROR' }], badSha));
  assert.throws(() => rollbackCandidate([deployments[0], { ...deployments[1], url: 'evil.example.test' }], badSha));
});

test('a failed DB health response can identify the bad source without preventing verified recovery', async () => {
  const f = fixture(); f.breakHealth();
  assert.equal((await recoverProduction(f.options)).status, 'recovered');
  assert.deepEqual(f.history, ['slack', ['rollback.sh', 'api', 'https://good.vercel.app'], 'resolved']);
});
