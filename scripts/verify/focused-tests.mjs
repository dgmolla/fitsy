#!/usr/bin/env node
// Persist an explicit test selection; execute argv arrays, never shell text.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { impactPlan, repository, focusedDatabaseRequired } from './impact-plan.mjs';
import { passingTests } from './test-results.mjs';

const file = join(repository, '.evidence/verify/focused-tests.json');
function selection(paths) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('select meaningful focused reproduction/regression tests with focused-tests.mjs --set <test paths>');
  return [...new Set(paths)].map(path => {
    if (typeof path !== 'string' || path.startsWith('-') || relative(repository, resolve(repository, path)) !== path ||
        !/\.(?:test\.(?:ts|tsx|mjs|py)|spec\.(?:ts|tsx))$/.test(path) || !existsSync(resolve(repository, path))) {
      throw new Error(`invalid focused test path: ${path}`);
    }
    if (/\.(?:ts|tsx)$/.test(path) && !['apps/api', 'apps/mobile', 'scripts'].some(workspace => path.startsWith(workspace + '/'))) {
      throw new Error(`unsupported focused test workspace: ${path}`);
    }
    return path;
  });
}
async function run(paths, pattern) {
  if (pattern !== undefined) {
    if (typeof pattern !== 'string' || !pattern.trim() || pattern.length > 500) throw new Error('invalid Jest test-name pattern');
    new RegExp(pattern);
  }
  // Never expose a caller database to any selected test without owned admission.
  if (focusedDatabaseRequired(paths)) {
    const { assertOwnedDatabase } = await import('./local-db.mjs');
    assertOwnedDatabase();
  }
  const groups = new Map();
  for (const path of paths) {
    let key;
    if (path.endsWith('.mjs')) key = 'node';
    else if (path.endsWith('.py')) key = 'python';
    else key = ['apps/api', 'apps/mobile', 'scripts'].find(workspace => path.startsWith(workspace + '/'));
    if (!key) throw new Error(`unsupported focused test workspace: ${path}`);
    const entries = groups.get(key) ?? []; entries.push(path); groups.set(key, entries);
  }
  const reports = mkdtempSync(join(tmpdir(), 'fitsy-focused-'));
  let executed = 0;
  try {
    for (const [key, tests] of groups) {
      const report = join(reports, key.replaceAll('/', '-') + '.json');
      const commands = key === 'node' ? [[process.execPath, ['--test', '--test-reporter=spec', '--test-reporter-destination=stderr', '--test-reporter=' + join(repository, 'scripts/verify/node-focused-reporter.mjs'), '--test-reporter-destination=' + report, ...tests]]]
        : key === 'python' ? tests.map((test, index) => ['python3', [join(repository, 'scripts/verify/python-focused.py'), test, report + '.' + index]])
        : [['npm', ['test', '--workspace=' + key, '--', ...(key === 'scripts' ? ['--maxWorkers=1', '--workerIdleMemoryLimit=256MB'] : ['--runInBand']), '--runTestsByPath', ...tests.map(test => resolve(repository, test)), '--json', '--outputFile=' + report, ...(pattern === undefined ? [] : ['--testNamePattern=' + pattern])]]];
      for (const [command, args] of commands) {
        const childEnv = key === 'python' ? { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
          : key === 'scripts' ? { ...process.env, FITSY_MEDIA_INTEGRATION: '0', NODE_OPTIONS: '--max-old-space-size=512' } : { ...process.env };
        delete childEnv.FITSY_VERIFY_FOCUSED_RECIPE;
        const result = spawnSync(command, args, { cwd: repository, stdio: ['ignore', 'inherit', 'inherit'], env: childEnv });
        if (result.error || result.status !== 0) throw new Error(`focused tests failed: ${tests.join(', ')}`);
        executed += passingTests(key === 'python' ? args.at(-1) : report,
          ['node', 'python'].includes(key) ? key : 'jest');
      }
    }
    return executed;
  } finally { rmSync(reports, { recursive: true, force: true }); }
}
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--set') {
      const flags = process.argv.slice(3).filter(arg => arg.startsWith('--jest-pattern='));
      if (flags.length > 1) throw new Error('pass at most one Jest pattern');
      const pattern = flags[0]?.slice('--jest-pattern='.length);
      if (pattern !== undefined && (!pattern.trim() || pattern.length > 500)) throw new Error('invalid Jest test-name pattern');
      if (pattern !== undefined) new RegExp(pattern);
      const tests = selection(process.argv.slice(3).filter(arg => !arg.startsWith('--jest-pattern=')));
      mkdirSync(join(repository, '.evidence/verify'), { recursive: true });
      writeFileSync(file, JSON.stringify({ version: 1, tests, ...(pattern === undefined ? {} : { pattern }) }) + '\n');
      console.log(JSON.stringify({ name: 'focused-tests', status: 'pass', summary: 'focused test selection saved' }));
    } else {
      const plan = impactPlan();
      if (plan.comparison.unknown) throw new Error('focused test selection requires a known source comparison');
      // The canonical runner passes its selected recipe, never a prior result.
      const config = JSON.parse(process.env.FITSY_VERIFY_FOCUSED_RECIPE ?? readFileSync(file, 'utf8'));
      if (config.version !== 1) throw new Error('unsupported focused selection version');
      const executed = await run(selection(config.tests), config.pattern);
      console.log(JSON.stringify({ name: 'focused-tests', status: 'pass', summary: 'selected reproduction/regression tests pass', executed_tests: executed }));
    }
  } catch (error) {
    console.log(JSON.stringify({ name: 'focused-tests', status: 'fail', summary: error.message, fix: 'repair and select meaningful tests using node scripts/verify/focused-tests.mjs --set <test paths>' }));
    process.exitCode = 1;
  }
}
