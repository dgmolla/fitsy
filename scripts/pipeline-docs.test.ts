import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');
function markdown(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'archive' ? [] : markdown(path);
    return entry.name.endsWith('.md') ? [path] : [];
  });
}

test('active pipeline documentation and operational sources have no retired provider dependency', () => {
  const files = [...markdown('docs/engineering/pipeline'),
    'docs/engineering/architecture/system-design.md', 'docs/engineering/devops/production-deployment.md',
    'docs/engineering/devops/costs.md', 'docs/engineering/backend/idempotent-preload-spec.md',
    'scripts/preload-ue-first.ts', 'scripts/preload-v2.ts', 'scripts/pipeline-utils.ts', 'scripts/rerun.ts',
    'scripts/test-fixtures/preload-cost-runtime.cjs',
    'apps/api/services/chainServing.ts', 'apps/api/services/menuSources/types.ts',
    ...readdirSync(join(root, 'scripts/pipeline-v2')).filter(file => file.endsWith('.ts'))
      .map(file => join('scripts/pipeline-v2', file)),
    '.env.example', 'package.json', 'scripts/package.json', 'scripts/verify/registry.yml', 'scripts/verify/run.mjs',
  ];
  const stale = files.filter(file => /fatsecret|fat_secret/i.test(readFileSync(join(root, file), 'utf8')));
  expect(stale).toEqual([]);
  expect(existsSync(join(root, 'apps/api/services/menuSources/fatSecretSource.ts'))).toBe(false);
});

test('active docs never instruct pulling or sourcing production database credentials locally', () => {
  const stale = markdown('docs').filter(file => {
    const content = readFileSync(join(root, file), 'utf8');
    return /vercel env pull[^\n]*(?:--environment[= ]production|\.env\.prod)|(?:^|\n)\s*(?:set -a\s*&&\s*)?source\s+[^\n]*\.env\.prod/.test(content);
  });
  expect(stale).toEqual([]);
});

test('operator entrypoints distinguish DEV examples from guarded production deployment', () => {
  for (const file of ['docs/engineering/pipeline/runbook.md', 'docs/engineering/devops/production-deployment.md']) {
    const content = readFileSync(join(root, file), 'utf8');
    expect(content).toMatch(/DEV-only/);
    expect(content).toMatch(/signed workload identity/);
    expect(content).toContain('routine-production.md');
    expect(content).toMatch(/approved cloud worker|approved cloud execution/);
  }
  for (const file of ['chain-catalog-batches.md', 'chain-identity-batches.md', 'chain-pdf-pilot.md']) {
    expect(readFileSync(join(root, 'docs/engineering/pipeline', file), 'utf8')).toMatch(/target DEV or disposable loopback fixtures only/);
  }
});
