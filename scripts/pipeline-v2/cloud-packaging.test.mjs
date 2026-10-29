import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeManifest } from './cloud/runtime-manifest.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('standalone dependencies preserve exact locked versions and exclude every mobile/workspace installation', () => {
  const source = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const { manifest, lock } = runtimeManifest(source);
  for (const [name, version] of Object.entries(manifest.dependencies)) assert.equal(version, source.packages['node_modules/' + name].version);
  for (const [key, value] of Object.entries(lock.packages).slice(1)) {
    assert.deepEqual(value, source.packages[key]); assert.equal(value.link, undefined);
    assert.doesNotMatch(key, /expo|react-native|react-test-renderer|@fitsy/);
  }
  assert.ok(Object.keys(lock.packages).length < 100);
  assert.ok(lock.packages['node_modules/@prisma/client']);
});
test('dependency extraction preserves nested versions, cycles and optional platform dependencies', () => {
  const names = ['@prisma/client','prisma','@axiomhq/js','zod','h3-js','jose','esbuild'];
  const packages = Object.fromEntries(names.map(name => ['node_modules/' + name,{ version:'1.0.0' }]));
  packages['node_modules/esbuild'].optionalDependencies = { platform:'1' };
  packages['node_modules/platform'] = { version:'1.0.0', optional:true };
  packages['node_modules/jose'].dependencies = { nested:'2' };
  packages['node_modules/jose/node_modules/nested'] = { version:'2.0.0',dependencies:{ jose:'1' } };
  packages['node_modules/nested'] = { version:'1.0.0' };
  const result = runtimeManifest({ packages }).lock.packages;
  assert.ok(result['node_modules/platform']); assert.ok(result['node_modules/jose/node_modules/nested']);
  assert.equal(result['node_modules/nested'],undefined);
  delete packages['node_modules/jose/node_modules/nested']; delete packages['node_modules/nested'];
  assert.throws(()=>runtimeManifest({ packages }),/Missing locked transitive/);
});
test('the bundled deployment entrypoint preserves production refusal, provenance and service-only inputs', () => {
  const out = mkdtempSync(join(tmpdir(),'cloud-bundle-'));
  try {
    const build = spawnSync(process.execPath,['scripts/pipeline-v2/cloud/build.mjs',out],{ cwd:root,encoding:'utf8',timeout:30_000 });
    assert.equal(build.status,0,build.stderr);
    const source = JSON.parse(readFileSync(join(out,'source.json'),'utf8'));
    assert.match(source.sourceHash,/^[a-f0-9]{64}$/);
    const inputs = JSON.parse(readFileSync(join(out,'bundle-inputs.json'),'utf8'));
    assert.ok(inputs.includes('scripts/pipeline-v2/queue.ts'));
    assert.ok(inputs.includes('scripts/pipeline-v2/ue-rate-limiter.ts'));
    assert.ok(inputs.includes('scripts/pipeline-v2/cloud-budget.ts'));
    assert.ok(inputs.every(path=>!/^apps\/(mobile|api\/(app|lib))\//.test(path)));
    for (const entry of ['pipeline-cloud-worker.cjs','pipeline-worker-preflight.cjs']) {
      const driverLog=join(out,'connections');
      const result = spawnSync(process.execPath,['--require',join(root,'scripts/test-fixtures/database-client-recorder.cjs'),join(out,entry)],{ cwd:root,encoding:'utf8',timeout:10_000,
        env:{ PATH:process.env.PATH,HOME:process.env.HOME,NODE_PATH:join(root,'node_modules'),
          PIPELINE_DATABASE_URL:'postgresql://pipeline_writer:synthetic-secret@db.zaxkmjqozvmbifiwbxps.supabase.co/postgres',
          TYPESAFE_API_KEY:'synthetic-provider-key', FITSY_TEST_DB_CLIENT_LOG:driverLog } });
      assert.equal(result.status,1); assert.doesNotMatch(result.stderr,/synthetic-secret|synthetic-provider-key|MODULE_NOT_FOUND/);
      assert.equal(existsSync(driverLog),false);
      assert.match(result.stderr,entry.includes('preflight')?/Pipeline worker preflight failed/:/Cloud worker startup or shutdown failed/);
    }
  } finally { rmSync(out,{ recursive:true,force:true }); }
});
