import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const modulePath = resolve(__dirname, 'product-flow.mjs');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('GIT_') && !key.startsWith('EXPO_PUBLIC_')));

test('the real CLI plan requires billing after an ignored public store-key change', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-public-env-'));
  try {
    mkdirSync(join(dir, 'scripts/verify'), { recursive: true });
    mkdirSync(join(dir, 'apps/mobile'), { recursive: true });
    mkdirSync(join(dir, '.evidence/product-flow'), { recursive: true });
    copyFileSync(modulePath, join(dir, 'scripts/verify/product-flow.mjs'));
    symlinkSync(resolve(__dirname, '../../node_modules'), join(dir, 'node_modules'));
    writeFileSync(join(dir, '.gitignore'), 'apps/mobile/.env.development.local\n.evidence/\nnode_modules\n');
    writeFileSync(join(dir, 'apps/mobile/app.tsx'), 'export default null');
    writeFileSync(join(dir, 'apps/mobile/.env.development.local'), 'EXPO_PUBLIC_REVENUECAT_TEST_KEY=before\n');
    const git = (args: string[]) => execFileSync('git', ['-C', dir, ...args], { env: cleanEnv() });
    git(['init', '-q']);
    git(['add', '.gitignore', 'apps/mobile/app.tsx', 'scripts/verify/product-flow.mjs']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']);
    const base = git(['rev-parse', 'HEAD']).toString().trim();
    const identity = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {publicConfigIdentity} from ${JSON.stringify(modulePath)}; process.stdout.write(JSON.stringify(publicConfigIdentity(${JSON.stringify(dir)}, {})));`],
    { encoding: 'utf8', env: cleanEnv() });
    if (identity.status !== 0) throw new Error(identity.stderr);
    writeFileSync(join(dir, '.evidence/product-flow/report.json'), identity.stdout);
    writeFileSync(join(dir, 'apps/mobile/.env.development.local'), 'EXPO_PUBLIC_REVENUECAT_TEST_KEY=after\n');
    const result = spawnSync(process.execPath, ['scripts/verify/product-flow.mjs', '--plan'],
      { cwd: dir, encoding: 'utf8', env: { ...cleanEnv(), FITSY_DIFF_BASE: base } });
    if (result.status !== 0) throw new Error(`CLI failed: ${result.stderr}\n${result.stdout}`);
    expect(JSON.parse(result.stdout)).toMatchObject({ required: true, categories: ['billing'],
      paths: ['public-env:EXPO_PUBLIC_REVENUECAT_TEST_KEY'] });
    const current = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {publicConfigIdentity} from ${JSON.stringify(modulePath)}; process.stdout.write(JSON.stringify(publicConfigIdentity(${JSON.stringify(dir)}, {})));`],
    { encoding: 'utf8', env: cleanEnv() });
    if (current.status !== 0) throw new Error(current.stderr);
    const carried = spawnSync(process.execPath, ['--input-type=module', '-e',
      `import {buildPublicConfigAcceptance} from ${JSON.stringify(modulePath)};
       process.stdout.write(JSON.stringify(buildPublicConfigAcceptance(${identity.stdout}, ${current.stdout})));`],
    { encoding: 'utf8', env: cleanEnv() });
    if (carried.status !== 0) throw new Error(carried.stderr);
    mkdirSync(join(dir, '.evidence/product-build'), { recursive: true });
    writeFileSync(join(dir, '.evidence/product-build/receipt.json'), JSON.stringify({
      ...JSON.parse(current.stdout), appHash: 'same-app', publicConfigAcceptance: JSON.parse(carried.stdout),
    }));
    rmSync(join(dir, '.evidence/product-flow/report.json'));
    const afterRefresh = spawnSync(process.execPath, ['scripts/verify/product-flow.mjs', '--plan'],
      { cwd: dir, encoding: 'utf8', env: { ...cleanEnv(), FITSY_DIFF_BASE: base } });
    if (afterRefresh.status !== 0) throw new Error(afterRefresh.stderr);
    expect(JSON.parse(afterRefresh.stdout).categories).toEqual(['billing']);
    writeFileSync(join(dir, '.evidence/product-flow/report.json'), JSON.stringify({
      ...JSON.parse(current.stdout), publicConfigAcceptance: { keys: ['EXPO_PUBLIC_REVENUECAT_TEST_KEY'] },
    }));
    const afterDevelopment = spawnSync(process.execPath, ['scripts/verify/product-flow.mjs', '--plan'],
      { cwd: dir, encoding: 'utf8', env: { ...cleanEnv(), FITSY_DIFF_BASE: base } });
    if (afterDevelopment.status !== 0) throw new Error(afterDevelopment.stderr);
    expect(JSON.parse(afterDevelopment.stdout).categories).toEqual(['billing']);
    writeFileSync(join(dir, '.evidence/product-flow/report.json'), JSON.stringify({
      ...JSON.parse(current.stdout), result: 'pass', evidenceMode: 'final-candidate',
      appHash: 'same-app',
      publicConfigAcceptance: { keys: ['EXPO_PUBLIC_REVENUECAT_TEST_KEY'],
        verifiedConfigHash: JSON.parse(current.stdout).configHash },
    }));
    const afterAcceptance = spawnSync(process.execPath, ['scripts/verify/product-flow.mjs', '--plan'],
      { cwd: dir, encoding: 'utf8', env: { ...cleanEnv(), FITSY_DIFF_BASE: base } });
    if (afterAcceptance.status !== 0) throw new Error(afterAcceptance.stderr);
    expect(JSON.parse(afterAcceptance.stdout)).toMatchObject({ required: false, categories: [] });
    writeFileSync(join(dir, '.evidence/product-build/receipt.json'), JSON.stringify({
      ...JSON.parse(current.stdout), appHash: 'replacement-app', publicConfigAcceptance: JSON.parse(carried.stdout),
    }));
    const replaced = spawnSync(process.execPath, ['scripts/verify/product-flow.mjs', '--plan'],
      { cwd: dir, encoding: 'utf8', env: { ...cleanEnv(), FITSY_DIFF_BASE: base } });
    if (replaced.status !== 0) throw new Error(replaced.stderr);
    expect(JSON.parse(replaced.stdout).required).toBe(true);
    expect(JSON.parse(replaced.stdout).paths).toContain('public-env:<unknown>');
    writeFileSync(join(dir, 'apps/mobile/.env.development.local'), 'EXPO_PUBLIC_REVENUECAT_TEST_KEY=before\n');
    writeFileSync(join(dir, '.evidence/product-flow/report.json'), JSON.stringify({
      ...JSON.parse(identity.stdout), result: 'pass', evidenceMode: 'final-candidate', appHash: 'older-app',
      publicConfigAcceptance: { keys: ['EXPO_PUBLIC_REVENUECAT_TEST_KEY'],
        verifiedConfigHash: JSON.parse(identity.stdout).configHash },
    }));
    const reverted = spawnSync(process.execPath, ['scripts/verify/product-flow.mjs', '--plan'],
      { cwd: dir, encoding: 'utf8', env: { ...cleanEnv(), FITSY_DIFF_BASE: base } });
    if (reverted.status !== 0) throw new Error(reverted.stderr);
    expect(JSON.parse(reverted.stdout)).toMatchObject({ required: true, categories: ['billing'],
      paths: ['public-env:EXPO_PUBLIC_REVENUECAT_TEST_KEY'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.each(['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'])(
  '%s requires auth acceptance', key => {
    const script = `import {impact} from ${JSON.stringify(modulePath)};
      process.stdout.write(JSON.stringify(impact([], [${JSON.stringify(key)}])));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script],
      { encoding: 'utf8', env: cleanEnv() });
    if (result.status !== 0) throw new Error(result.stderr);
    expect(JSON.parse(result.stdout).categories).toEqual(['auth']);
  });

test('older public-config receipts select every affected category conservatively', () => {
  const script = `import {changedPublicConfigKeys,impact} from ${JSON.stringify(modulePath)};
    const current={configHash:'new',publicConfig:{EXPO_PUBLIC_REVENUECAT_TEST_KEY:'value-hash'}};
    process.stdout.write(JSON.stringify(impact([],changedPublicConfigKeys({configHash:'old'},current))));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script],
    { encoding: 'utf8', env: cleanEnv() });
  if (result.status !== 0) throw new Error(result.stderr);
  expect(JSON.parse(result.stdout).categories).toEqual([
    'auth', 'billing', 'changed-journey', 'discovery', 'notifications', 'onboarding',
  ]);
});

test('reactivating an older artifact carries both changed and pending public keys', () => {
  const script = `import {buildPublicConfigAcceptance,impact} from ${JSON.stringify(modulePath)};
    const active={configHash:'newer',publicConfig:{EXPO_PUBLIC_REVENUECAT_TEST_KEY:'newer-hash'}};
    const current={configHash:'older',publicConfig:{EXPO_PUBLIC_REVENUECAT_TEST_KEY:'older-hash'}};
    const retained={publicConfigAcceptance:{keys:['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID']}};
    const acceptance=buildPublicConfigAcceptance(active,current,retained);
    process.stdout.write(JSON.stringify({keys:acceptance.keys,categories:impact([],acceptance.keys).categories}));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script],
    { encoding: 'utf8', env: cleanEnv() });
  if (result.status !== 0) throw new Error(result.stderr);
  expect(JSON.parse(result.stdout)).toEqual({
    keys: ['EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID', 'EXPO_PUBLIC_REVENUECAT_TEST_KEY'],
    categories: ['auth', 'billing'],
  });
});
