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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
