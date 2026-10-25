import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Copied CLI fixtures consume the real planner, routing policy and YAML catalog.
export function copyProductFlowControls(directory: string) {
  const root = resolve(__dirname, '../..');
  const files = ['scripts/verify/product-flow.mjs', 'scripts/verify/impact-plan.mjs',
    'scripts/verify/risk-tiers.yml', 'scripts/route-reviewers.sh',
    ...readdirSync(join(root, 'apps/mobile/e2e/flows')).filter(name => name.endsWith('.yaml'))
      .map(name => `apps/mobile/e2e/flows/${name}`)];
  for (const path of files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    copyFileSync(join(root, path), join(directory, path));
  }
}
