import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRouteCoverage, runtimeAudit } from './audit.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function checkPerformance() {
  const budget = JSON.parse(readFileSync(join(root, 'scripts/perf/budgets.json'), 'utf8'));
  const prototypes = join(root, 'apps/mobile/app/mockups');
  const routes = existsSync(prototypes) ? readdirSync(prototypes, { recursive: true }).filter(path => /\.[jt]sx?$/.test(path)) : [];
  assert.equal(routes.length, budget.prototypeRoutes, 'prototype screens must stay outside Expo Router');
  // Use the API's actual aliases and an absolute tsconfig path. A root-only
  // graph leaves @/ imports unresolved and would falsely report zero providers.
  const graph = JSON.parse(execFileSync(process.execPath, [join(root, 'node_modules/dependency-cruiser/bin/dependency-cruise.mjs'),
    'apps/api/app/api', '--config', '.dependency-cruiser.cjs', '--ts-config', join(root, 'apps/api/tsconfig.json'),
    '--exclude', '(\\.test\\.|/tests/)', '--output-type', 'json'], { cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }));
  const publicRoutes = graph.modules.filter(module => /^apps\/api\/app\/api\/(?!internal\/).*\/route\.ts$/.test(module.source))
    .filter(module => /export\s+(?:(?:async\s+)?function\s+GET\b|const\s+GET\s*=)/.test(readFileSync(join(root, module.source), 'utf8')))
    .map(module => module.source.slice('apps/api/app/api/'.length, -'/route.ts'.length));
  assertRouteCoverage(publicRoutes);
  const runtime = runtimeAudit(graph);
  assert.equal(runtime.preloadProviders.length, budget.runtimePreloadProviders, `runtime data routes reach preload providers: ${runtime.preloadProviders.join(', ')}`);
  return runtime;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const runtime = checkPerformance();
    console.log(JSON.stringify({ name: 'performance', status: 'pass', summary: 'no prototype routes or runtime preload providers', runtime }));
  } catch (error) {
    console.log(JSON.stringify({ name: 'performance', status: 'fail', summary: error.message,
      fix: 'keep prototypes in apps/mobile/mockups; resolve imports and move discovery/LLM work to the preload pipeline' }));
    process.exitCode = 1;
  }
}
