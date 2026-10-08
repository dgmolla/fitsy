#!/usr/bin/env node
// Persist an explicit test selection; execute argv arrays, never shell text.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { impactPlan, repository } from './impact-plan.mjs';

const file = join(repository, '.evidence/verify/focused-tests.json');
function selection(paths) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('select meaningful focused reproduction/regression tests with focused-tests.mjs --set <test paths>');
  return [...new Set(paths)].map(path => {
    if (typeof path !== 'string' || path.startsWith('-') || relative(repository, resolve(repository, path)) !== path ||
        !/\.(?:test\.(?:ts|tsx|mjs|py)|spec\.(?:ts|tsx))$/.test(path) || !existsSync(resolve(repository, path))) {
      throw new Error(`invalid focused test path: ${path}`);
    }
    return path;
  });
}
function run(paths, pattern) {
  if (pattern !== undefined) {
    if (typeof pattern !== 'string' || !pattern.trim() || pattern.length > 500) throw new Error('invalid Jest test-name pattern');
    new RegExp(pattern);
  }
  const groups = new Map();
  for (const path of paths) {
    let key;
    if (path.endsWith('.mjs')) key = 'node';
    else if (path.endsWith('.py')) key = 'python';
    else key = ['apps/api', 'apps/mobile', 'packages/shared', 'scripts'].find(workspace => path.startsWith(workspace + '/'));
    if (!key) throw new Error(`unsupported focused test workspace: ${path}`);
    const entries = groups.get(key) ?? []; entries.push(path); groups.set(key, entries);
  }
  for (const [key, tests] of groups) {
    const report = join(repository, `.evidence/verify/focused-history/jest-${Date.now()}-${process.pid}.json`);
    const commands = key === 'node' ? [[process.execPath, ['--test', ...tests]]]
      : key === 'python' ? tests.map(test => ['python3', [test, '-q']])
      : [['npm', ['test', '--workspace=' + key, '--', '--runInBand', '--runTestsByPath', ...tests.map(test => resolve(repository, test)), '--json', '--outputFile=' + report, ...(pattern === undefined ? [] : ['--testNamePattern=' + pattern])]]];
    for (const [command, args] of commands) {
      const result = spawnSync(command, args, { cwd: repository, stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
      if (result.error || result.status !== 0) throw new Error(`focused tests failed: ${tests.join(', ')}`);
      if (!['node', 'python'].includes(key)) {
        const outcomes = JSON.parse(readFileSync(report, 'utf8'));
        if (!outcomes.success || !(outcomes.numPassedTests > 0)) throw new Error('focused Jest selection executed no passing tests');
      }
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--set') {
      const flags = process.argv.slice(3).filter(arg => arg.startsWith('--jest-pattern='));
      if (flags.length > 1) throw new Error('pass at most one Jest pattern');
      const pattern = flags[0]?.slice('--jest-pattern='.length);
      if (pattern !== undefined && (!pattern.trim() || pattern.length > 500)) throw new Error('invalid Jest test-name pattern');
      if (pattern !== undefined) new RegExp(pattern);
      const tests = selection(process.argv.slice(3).filter(arg => !arg.startsWith('--jest-pattern=')));
      mkdirSync(join(repository, '.evidence/verify/focused-history'), { recursive: true });
      if (existsSync(file)) renameSync(file, join(repository, `.evidence/verify/focused-history/${Date.now()}.json`));
      writeFileSync(file, JSON.stringify({ version: 1, tests, ...(pattern === undefined ? {} : { pattern }) }) + '\n');
      console.log(JSON.stringify({ name: 'focused-tests', status: 'pass', summary: 'focused test selection saved' }));
    } else {
      const plan = impactPlan();
      if (plan.comparison.unknown) throw new Error('focused test selection requires a known source comparison');
      if (plan.documentationOnly) {
        console.log(JSON.stringify({ name: 'focused-tests', status: 'skipped', summary: 'documentation-only candidate' }));
        process.exitCode = 2;
      }
      else {
        const config = JSON.parse(readFileSync(file, 'utf8'));
        if (config.version !== 1) throw new Error('unsupported focused selection version');
        mkdirSync(join(repository, '.evidence/verify/focused-history'), { recursive: true });
        run(selection(config.tests), config.pattern);
        console.log(JSON.stringify({ name: 'focused-tests', status: 'pass', summary: 'selected reproduction/regression tests pass' }));
      }
    }
  } catch (error) {
    console.log(JSON.stringify({ name: 'focused-tests', status: 'fail', summary: error.message, fix: 'repair and select meaningful tests using node scripts/verify/focused-tests.mjs --set <test paths>' }));
    process.exitCode = 1;
  }
}
