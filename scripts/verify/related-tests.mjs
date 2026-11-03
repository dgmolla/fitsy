// Resolve PR tests with Jest's installed dependency graph. Uncertainty runs all.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { impactPlan, isMain, repository } from './impact-plan.mjs';

const workspaces = { mobile: 'apps/mobile', scripts: 'scripts' };
const documentation = path => /^[^/]+\.md$/.test(path) || /^(?:docs|proj-mgmt)\/.*\.(?:md|mdx|rst|txt|png|jpe?g|svg|webp)$/.test(path);
export function relatedTests({ base, head, cwd = repository, env = process.env } = {}) {
  const full = reason => ({ mode: 'full', reason, tests: {} });
  if (env.GITHUB_EVENT_NAME !== 'pull_request') return full('Only pull requests use related tests');
  const plan = impactPlan({ base, head, cwd, env });
  if (plan.comparison.unknown || !plan.files?.length) return full('Unknown or empty comparison');
  const files = plan.files.filter(path => !documentation(path));
  if (!files.length) return full('No source files to route');
  const tests = {};
  for (const path of files) {
    // API retains its complete coverage gate. Shared/runtime/test controls and
    // non-Jest languages have consumers outside Jest's static import graph.
    const group = /^apps\/mobile\/(?:app|components|lib)\/.*\.(?:ts|tsx)$/.test(path) ? 'mobile'
      : /^scripts\/(?!verify\/|delivery\/|sim\/|deploy\/|lib\/).*\.ts$/.test(path) ? 'scripts' : null;
    if (!group || /(?:^|\/)(?:__mocks__|__fixtures__|test-fixtures)\/|(?:^|\/)(?:index|_layout|config|setupTests)\.|\.config\.|auth|session|supabase|payment|purchase|entitlement|subscription|revenuecat/i.test(path)) {
      return full(`Shared, coverage-sensitive or unmapped input: ${path}`);
    }
    const source = resolve(cwd, path);
    if (!existsSync(source)) return full(`Deleted or unavailable input: ${path}`);
    try {
      const workspace = resolve(cwd, workspaces[group]);
      const jest = createRequire(resolve(workspace, 'package.json')).resolve('jest/bin/jest');
      // Inspect each input separately: one mapped file must not conceal another
      // file with no tests. List-only mode never executes globalSetup or tests.
      const result = spawnSync(process.execPath, [jest, '--listTests', '--json', '--runInBand', '--findRelatedTests', source],
        { cwd: workspace, env, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
      if (result.error || result.status !== 0) return full(`Jest dependency discovery failed: ${path}`);
      const selected = JSON.parse(result.stdout);
      if (!Array.isArray(selected) || !selected.length || selected.some(test =>
        typeof test !== 'string' || !test.startsWith(workspace + '/') || !existsSync(test))) {
        return full(`No trustworthy related tests: ${path}`);
      }
      tests[group] = [...new Set([...(tests[group] || []), ...selected])].sort();
    } catch { return full(`Jest dependency discovery unavailable: ${path}`); }
  }
  return { mode: 'related', reason: 'Every changed source maps to Jest tests', tests };
}

if (isMain(import.meta.url)) {
  if (process.argv[2] === '--read') {
    const plan = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    for (const path of plan.tests[process.argv[4]] || []) process.stdout.write(path + '\0');
  } else {
    const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
    console.log(JSON.stringify(relatedTests(args)));
  }
}
