// Local performance cache, never an independent review or product attestation.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { createRequire } from 'node:module';
import { git } from './impact-plan.mjs';

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
    const tools = ['bash', 'git', 'node', 'dirname', 'grep', 'sed', 'sort', 'tr', 'head', 'cut', 'xargs', 'find'];
    if (check.name === 'secrets') tools.push('gitleaks');
    if (check.name === 'actionlint') tools.push('actionlint', 'shellcheck');
    if (['lint', 'typecheck', 'boundaries', 'focused-tests', 'test'].includes(check.name)) tools.push('npm', 'npx');
    if (check.name === 'test' || check.selection?.includes?.('.test.py')) tools.push('python3');
    visit(process.execPath);
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

export function verificationCache(root, env, plan, scope) {
  const directory = join(root, '.evidence/verify/check-cache');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const saltFile = join(directory, 'salt');
  if (!existsSync(saltFile)) {
    try { writeFileSync(saltFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const source = sourceIdentity(root);
  const environment = environmentIdentity(root, env, readFileSync(saltFile, 'utf8'));
  // Equal file lists can come from different commit ranges or selection scopes.
  const { base, head, unknown } = plan.comparison;
  const selection = sha(JSON.stringify({ files: plan.files, comparison: { base, head, unknown }, scope }));
  const identities = new Map();
  function installed(check) {
    if (!identities.has(check)) identities.set(check, installedIdentity(root, (env.PATH ?? '').split(delimiter), check));
    return identities.get(check);
  }
  return {
    read(check) {
      try {
        const receipt = JSON.parse(readFileSync(join(directory, `${check.name}.json`), 'utf8'));
        if (installed(check) === null || receipt.version !== 4 || receipt.installed !== installed(check) || receipt.source !== source || receipt.environment !== environment || receipt.selection !== selection ||
            receipt.definition !== sha(JSON.stringify(check)) || receipt.result?.name !== check.name || receipt.result?.status !== 'pass' ||
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
      const receipt = { version: 4, source, environment, installed: installed(check), selection, definition: sha(JSON.stringify(check)), finishedAt: Date.now(), result };
      const file = join(directory, `${check.name}.json`);
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(receipt) + '\n', { mode: 0o600 });
      renameSync(temporary, file);
    },
  };
}
