// Local performance cache, never an independent review or product attestation.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { git, impactPlan, repository, focusedDatabaseRequired } from './impact-plan.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const lifetime = 6 * 3600_000;
export function sourceIdentity(root, env = process.env) {
  const paths = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root, env).split('\0').filter(Boolean);
  // Ignored local configuration affects execution just as exported env does.
  for (const directory of ['', 'apps/api', 'apps/mobile', 'scripts']) {
    try { for (const file of readdirSync(join(root, directory))) if (/^\.env(?:\.|$)/.test(file)) paths.push(join(directory, file)); }
    catch { /* Absent optional workspace. */ }
  }
  const hash = createHash('sha256');
  for (const path of [...new Set(paths)].sort()) {
    if (path.startsWith('.evidence/')) continue;
    const file = join(root, path);
    hash.update(`${path}\0`);
    if (!existsSync(file)) hash.update('<deleted>');
    else {
      const stat = lstatSync(file);
      hash.update(`${stat.mode}\0`);
      if (stat.isSymbolicLink()) hash.update(readlinkSync(file));
      else if (stat.isFile()) hash.update(readFileSync(file));
      else throw new Error(`Unsupported source input: ${path}`);
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

// Resolve the tools these checks use, not every unrelated executable in PATH.
// Package snapshots cover declared runtime dependencies without visiting a
// shared node_modules tree or following workspace caches and fixture evidence.
function installedIdentity(root, paths, check) {
  const hash = createHash('sha256');
  const visited = new Set();
  const directories = new Set();
  function present(file) {
    try { lstatSync(file); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  function visit(file) {
    const path = realpathSync(file);
    const info = statSync(path, { bigint: true });
    hash.update(JSON.stringify([file, path, ...['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].map(key => String(info[key]))]));
    if (info.isDirectory()) {
      if (directories.has(path)) return;
      directories.add(path);
      for (const entry of readdirSync(path).sort()) {
        if (!['node_modules', '.git', '.evidence'].includes(entry)) visit(join(path, entry));
      }
    } else if (!info.isFile()) throw new Error('Uncertain installed input');
  }
  function packages(from, names) {
    const require = createRequire(from);
    for (const name of [...new Set(names)].sort()) {
      const manifest = (require.resolve.paths(name) ?? []).map(path => join(path, name, 'package.json')).find(present);
      if (!manifest) { hash.update(JSON.stringify([from, name, 'absent'])); continue; }
      const path = realpathSync(manifest);
      if (visited.has(path)) continue;
      visited.add(path); visit(dirname(path));
      const data = JSON.parse(readFileSync(path, 'utf8'));
      packages(path, Object.keys({ ...data.dependencies, ...data.optionalDependencies, ...data.peerDependencies }));
    }
  }
  function manifest(file) {
    if (!present(file)) return;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    packages(file, Object.keys({ ...data.dependencies, ...data.devDependencies }));
  }
  try {
    if (paths.some(path => !isAbsolute(path))) return null;
    // Shared canonical shell closure: structural.sh -> structural-tests.sh ->
    // route-reviewers.sh (including basename and cat); safety/context scripts
    // use the same text tools. Bare xargs invokes external echo on GNU/Linux;
    // npm's script dispatcher also uses a shell.
    const tools = ['bash', 'sh', 'git', 'node', 'dirname', 'basename', 'cat', 'grep', 'sed', 'sort', 'tr', 'head', 'cut', 'xargs', 'echo', 'find'];
    if (check.name === 'secrets') tools.push('gitleaks');
    if (check.name === 'actionlint') tools.push('actionlint', 'shellcheck');
    if (['lint', 'typecheck', 'boundaries', 'focused-tests', 'test'].includes(check.name)) tools.push('npm', 'npx');
    if (check.name === 'test' || check.selection?.includes?.('.test.py')) tools.push('python3');
    visit(process.execPath);
    // run.mjs executes /bin/bash directly; npm's default script shell is
    // /bin/sh, irrespective of a different executable named sh in PATH.
    // Bind system echo too: xargs' default command can use this fixed path
    // rather than the GNU implementation's PATH lookup bound below.
    for (const file of ['/bin/bash', '/bin/sh', '/bin/echo', '/usr/bin/env']) {
      visit(file); hash.update(readFileSync(realpathSync(file)));
    }
    for (const name of tools) {
      const file = paths.map(path => join(path, name)).find(path => {
        if (!present(path)) return false;
        const info = statSync(path);
        return info.isFile() && (info.mode & 0o111) !== 0;
      });
      if (!file) { hash.update(JSON.stringify([name, 'absent'])); continue; }
      visit(file);
      const bytes = readFileSync(realpathSync(file));
      hash.update(bytes);
      const interpreter = bytes.toString('utf8', 0, Math.min(bytes.length, 256)).split('\n')[0].match(/^#!\s*(\/\S+)(?:\s+(.*))?$/);
      if (interpreter) {
        visit(interpreter[1]); hash.update(readFileSync(realpathSync(interpreter[1])));
        // The named node/python tools are resolved above; unsupported env
        // selectors cannot establish which interpreter actually executes.
        if (interpreter[1].endsWith('/env') && !/^(node|python3)$/.test(interpreter[2] ?? '')) return null;
      }
      // A real npm installation has a package boundary and bundled runtime
      // dependencies. Standalone shell dispatchers instead bind their actual
      // bytes, interpreter and the resolved tools, without inventing a package.
      if (['npm', 'npx'].includes(name)) {
        let directory = dirname(realpathSync(file));
        while (dirname(directory) !== directory && !present(join(directory, 'package.json'))) directory = dirname(directory);
        const packageFile = join(directory, 'package.json');
        const data = present(packageFile) ? JSON.parse(readFileSync(packageFile, 'utf8')) : null;
        if (data?.name === 'npm') {
          visit(directory);
          packages(packageFile, Object.keys({ ...data.dependencies, ...data.optionalDependencies }));
        } else if (!interpreter || !/\/(?:ba|da|k|z)?sh$/.test(interpreter[1])) return null;
      }
    }
    const from = join(root, 'package.json');
    packages(from, ['js-yaml']);
    if (['lint', 'typecheck', 'boundaries', 'test'].includes(check.name) || check.script === 'fixture.sh') manifest(from);
    if (['lint', 'typecheck', 'boundaries', 'test'].includes(check.name)) {
      for (const path of ['apps/api', 'apps/mobile', 'packages/shared', 'scripts']) manifest(join(root, path, 'package.json'));
    }
    if (check.name === 'focused-tests' && check.script === 'focused-tests.sh') {
      for (const path of JSON.parse(check.selection ?? '{}').tests ?? []) {
        const workspace = ['apps/api', 'apps/mobile', 'scripts'].find(directory => path.startsWith(directory + '/'));
        if (workspace) manifest(join(root, workspace, 'package.json'));
        else manifest(from);
      }
    }
    return hash.digest('hex');
  } catch {
    // A used input that cannot be established makes this check run fresh.
    return null;
  }
}

function environmentIdentity(root, env, salt) {
  // npm and Git add invocation metadata when calling the same checks through
  // npm run vs pre-push. Package contents and actual configuration stay bound.
  const metadata = /^(GIT_|npm_package_|npm_lifecycle_|npm_config_(local_prefix|user_agent)|npm_(execpath|node_execpath|command)$)/;
  const volatile = new Set(['_', 'SHLVL', 'PWD', 'OLDPWD', 'INIT_CWD', 'FITSY_VERIFY_REUSE']);
  const values = Object.entries(env).filter(([key]) => !metadata.test(key) && !volatile.has(key)).map(([key, value]) => {
    if (key !== 'PATH' || env.npm_package_json !== join(root, 'package.json')) return [key, value];
    // npm run prepends node_modules/.bin ancestry and its node-gyp shim.
    // Both entrypoints use the same installed tree, bound below by its lock.
    const paths = value.split(delimiter);
    const shim = paths.findIndex(path => path.endsWith('/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin'));
    return [key, shim < 0 ? value : paths.slice(shim + 1).join(delimiter)];
  }).sort(([a], [b]) => a.localeCompare(b));
  const dependencyFile = join(root, 'node_modules/.package-lock.json');
  return sha(salt + JSON.stringify({ values, node: process.versions, executable: process.execPath,
    platform: process.platform, arch: process.arch,
    dependencies: existsSync(dependencyFile) ? sha(readFileSync(dependencyFile)) : null }));
}

// These are the actual common script Jest inputs, before whole-file selection.
export const scriptsJestArguments = ['test', '--workspace=@fitsy/scripts', '--', '--maxWorkers=1', '--workerIdleMemoryLimit=256MB'];
export function scriptsJestEnvironment(env) {
  const child = { ...env, FITSY_MEDIA_INTEGRATION: '0', NODE_OPTIONS: '--max-old-space-size=512' };
  // Launcher transport selects the report; assertions do not consume it.
  delete child.FITSY_VERIFY_FOCUSED_RECIPE;
  return child;
}

export function completeJestFiles(root, tests, report) {
  if (!report.success || report.coverageMap || report.numFailedTests || !report.numPassedTests ||
      report.numPassedTests + (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0) !== report.numTotalTests || report.testResults?.length !== tests.length) return false;
  return tests.every(test => {
    const result = report.testResults.find(result => result.name === resolve(root, test));
    // Optional conditional cases remain skipped under the identical context;
    // every selected file must still contain a real passing assertion.
    return result?.status === 'passed' && result.assertionResults?.some(assertion => assertion.status === 'passed') &&
      result.assertionResults.every(assertion => ['passed', 'pending', 'todo'].includes(assertion.status));
  });
}

export function verificationCache(root, env, plan, scope, inputs = () => ({ env, args: null })) {
  const directory = join(root, '.evidence/verify/check-cache');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const saltFile = join(directory, 'salt');
  if (!existsSync(saltFile)) {
    try { writeFileSync(saltFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const source = sourceIdentity(root);
  const salt = readFileSync(saltFile, 'utf8');
  // Equal file lists can come from different commit ranges or selection scopes.
  const { base, head, unknown } = plan.comparison;
  const selection = sha(JSON.stringify({ files: plan.files, comparison: { base, head, unknown }, scope }));
  const identities = new Map();
  function installed(check) {
    if (!identities.has(check)) identities.set(check, installedIdentity(root, (inputs(check).env.PATH ?? '').split(delimiter), check));
    return identities.get(check);
  }
  const environment = check => environmentIdentity(root, inputs(check).env, salt);
  const definition = check => sha(JSON.stringify({ check, args: inputs(check).args }));
  return {
    read(check) {
      try {
        const receipt = JSON.parse(readFileSync(join(directory, `${check.name}.json`), 'utf8'));
        if (installed(check) === null || receipt.version !== 5 || receipt.installed !== installed(check) || receipt.source !== source || receipt.environment !== environment(check) || receipt.selection !== selection ||
            receipt.definition !== definition(check) || receipt.result?.name !== check.name || receipt.result?.status !== 'pass' ||
            !Number.isFinite(receipt.finishedAt) || receipt.finishedAt > Date.now() || Date.now() - receipt.finishedAt > lifetime) return null;
        return { ...receipt.result, duration_ms: 0, cached: true, verified_at: new Date(receipt.finishedAt).toISOString() };
      } catch { return null; }
    },
    unchanged() { return sourceIdentity(root) === source; },
    invalidate(check) {
      // Retire reusable evidence without deleting the prior attempt.
      const history = join(directory, 'history');
      mkdirSync(history, { recursive: true, mode: 0o700 });
      try { renameSync(join(directory, `${check.name}.json`), join(history, `${check.name}.${Date.now()}.${randomBytes(8).toString('hex')}.json`)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
    write(check, result) {
      if (installed(check) === null || result.status !== 'pass' || plan.comparison.unknown) return;
      const receipt = { version: 5, source, environment: environment(check), installed: installed(check), selection, definition: definition(check), finishedAt: Date.now(), result };
      const file = join(directory, `${check.name}.json`);
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(receipt) + '\n', { mode: 0o600 });
      renameSync(temporary, file);
    },
  };
}

// Direct test.sh and CI remain whole-suite callers. Only this live verifier's
// freshly executed complete focused report may cover a file in residual Jest.
export function focusedScriptsExclusion(root, env, parentPid, argv, jestArgs) {
  try {
    if (env.FITSY_RUNS !== 'local' || env.CI || !Number.isSafeInteger(parentPid) || parentPid <= 1) return '';
    if (JSON.stringify(jestArgs) !== JSON.stringify(scriptsJestArguments)) return '';
    const args = Object.fromEntries(argv.map(arg => {
      const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=')];
    }));
    const scope = args.scope ?? 'all';
    const plan = impactPlan({ cwd: root, env, base: args.base, head: args.head });
    if (plan.comparison.unknown || !(scope === 'all' || plan.testGroups.includes('scripts'))) return '';
    const selection = readFileSync(join(root, '.evidence/verify/focused-tests.json'), 'utf8');
    const recipe = JSON.parse(selection);
    if (recipe.version !== 1 || recipe.pattern !== undefined || !Array.isArray(recipe.tests) || !recipe.tests.length ||
        !recipe.tests.every(test => typeof test === 'string' && /^scripts\/.*\.test\.tsx?$/.test(test) && relative(root, resolve(root, test)) === test) ||
        focusedDatabaseRequired(recipe.tests, {})) return '';
    const require = createRequire(import.meta.url);
    const check = require('js-yaml').load(readFileSync(join(root, 'scripts/verify/registry.yml'), 'utf8')).checks.find(check => check.name === 'focused-tests');
    if (!check || check.script !== 'focused-tests.sh' || !check.cache) return '';
    const focused = { ...check, selection, database: false };
    const cache = verificationCache(root, env, plan, scope, () => ({
      env: { ...env, FITSY_VERIFY_FOCUSED_RECIPE: selection },
      args: ['-p', join(root, 'scripts/verify/focused-tests.sh'), `--scope=${scope}`],
    }));
    const proof = cache.read(focused);
    if (proof?.invocation_pid !== parentPid || proof.whole_files?.length !== recipe.tests.length) return '';
    const reports = new Set();
    for (const file of proof.whole_files) {
      if (!recipe.tests.includes(file.path) || !/^\.evidence\/verify\/focused-history\/[^/]+\.json$/.test(file.report)) return '';
      const raw = readFileSync(join(root, file.report));
      if (sha(raw) !== file.sha256) return '';
      reports.add(file.report);
    }
    if (reports.size !== 1 || !completeJestFiles(root, recipe.tests, JSON.parse(readFileSync(join(root, [...reports][0]), 'utf8')))) return '';
    // Native Jest selection excludes whole files, never individual assertions.
    return recipe.tests.map(test => '^' + resolve(root, test).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$').join('|');
  } catch { return ''; } // Missing, stale or uncertain proof means fresh work.
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--scripts-focused-exclusion') process.exitCode = 1;
  else {
    const separator = process.argv.indexOf('--', 4);
    console.log(separator < 0 ? '' : focusedScriptsExclusion(repository, process.env, Number(process.argv[3]),
      process.argv.slice(4, separator), process.argv.slice(separator + 1)));
  }
}
