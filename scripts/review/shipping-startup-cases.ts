import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Fixture { root(): string; env(): NodeJS.ProcessEnv; source: string; }
export function shippingStartupCases(f: Fixture, setup: () => void,
  prepare: () => ReturnType<typeof spawnSync>, callCount: () => number) {
  test('local admission cannot hide focused acceptance with caller-selected comparison', () => {
    setup();
    const cheap = join(f.root(), 'scripts/verify/cheap.sh');
    writeFileSync(cheap, readFileSync(cheap, 'utf8') +
      'node scripts/verify/impact-plan.mjs > .evidence/comparison.json\n');
    expect(spawnSync('git', ['add', 'scripts/verify/cheap.sh'], { cwd: f.root(), env: f.env() }).status).toBe(0);
    expect(spawnSync('git', ['commit', '-qm', 'comparison acceptance fixture'], { cwd: f.root(), env: f.env() }).status).toBe(0);
    expect(prepare().status).toBe(0);
    writeFileSync(join(f.root(), '.evidence/order'), '');
    const result = spawnSync('/bin/bash', ['-p', 'scripts/verify/review-admission.sh'], {
      cwd: f.root(), encoding: 'utf8', timeout: 25000,
      env: { ...f.env(), FITSY_REVIEW_PROVIDER: 'claude', FITSY_REVIEW_MODEL: 'fixture-model',
        FITSY_DIFF_BASE: 'HEAD', FITSY_DIFF_HEAD: 'HEAD' } });
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(f.root(), '.evidence/comparison.json'), 'utf8')).code).toBe(true);
    expect(callCount()).toBe(1);
  });
  test('shipping child retains mobile acceptance despite caller-selected comparison', () => {
    setup();
    mkdirSync(join(f.root(), 'apps/mobile/app'), { recursive: true });
    writeFileSync(join(f.root(), 'apps/mobile/app/nutrition.ts'), 'export const nutrition = true;\n');
    expect(spawnSync('git', ['add', 'apps/mobile/app/nutrition.ts'], { cwd: f.root(), env: f.env() }).status).toBe(0);
    expect(spawnSync('git', ['commit', '-qm', 'mobile acceptance fixture'], { cwd: f.root(), env: f.env() }).status).toBe(0);
    expect(prepare().status).toBe(0);
    const inspect = "import {impactPlan} from './scripts/verify/impact-plan.mjs';" +
      "import {writeFileSync} from 'node:fs';writeFileSync('.evidence/mobile-comparison.json', JSON.stringify(impactPlan()));";
    const result = spawnSync(process.execPath, ['scripts/verify/shipping-session.mjs', '--',
      'node', '--input-type=module', '-e', inspect], {
      cwd: f.root(), encoding: 'utf8', timeout: 25000,
      env: { ...f.env(), FITSY_REVIEW_PROVIDER: 'claude', FITSY_REVIEW_MODEL: 'fixture-model',
        FITSY_DIFF_BASE: 'HEAD', FITSY_DIFF_HEAD: 'HEAD' } });
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(f.root(), '.evidence/mobile-comparison.json'), 'utf8')).native).toBe(true);
    expect(callCount()).toBe(1);
  });
  const preload = (script: string) => '--import=data:text/javascript,' +
    encodeURIComponent(`if(process.argv[1]?.endsWith(${JSON.stringify(script)}))process.exit(0);`);
  test('direct review admission cannot suppress cheap checks with Node startup options', () => {
    setup(); expect(prepare().status).toBe(0);
    writeFileSync(join(f.root(), '.evidence/cheap-fail'), 'fail');
    const result = spawnSync('/bin/bash', ['-p', 'scripts/verify/review-admission.sh'], {
      cwd: f.root(), encoding: 'utf8', timeout: 25000,
      env: { ...f.env(), FITSY_REVIEW_PROVIDER: 'claude', FITSY_REVIEW_MODEL: 'fixture-model',
        NODE_OPTIONS: preload('run.mjs') } });
    expect(result.status).not.toBe(0); expect(callCount()).toBe(1);
  });
  test('publishable native admission cannot suppress ownership checks with Node startup options', () => {
    setup();
    writeFileSync(join(f.root(), '.evidence/native-startup.mjs'),
      `import {execFileSync} from 'node:child_process';
import {admitFinalCandidate} from ${JSON.stringify(join(f.source, 'scripts/sim/product-flow.mjs'))};
admitFinalCandidate({publishable:true},(cmd,args)=>execFileSync(cmd,args,{cwd:process.cwd(),env:process.env,stdio:'inherit'}));
`);
    const result = spawnSync(process.execPath, ['.evidence/native-startup.mjs'], {
      cwd: f.root(), encoding: 'utf8', timeout: 25000,
      env: { ...f.env(), NODE_OPTIONS: preload('shipping-session.mjs') } });
    expect(result.status).not.toBe(0); expect(callCount()).toBe(0);
  });
}
