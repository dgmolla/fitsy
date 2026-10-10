import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Fixture { root(): string; env(): NodeJS.ProcessEnv; source: string; }
export function shippingStartupCases(f: Fixture, setup: () => void,
  prepare: () => ReturnType<typeof spawnSync>, callCount: () => number) {
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
