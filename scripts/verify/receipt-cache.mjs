// Local performance cache, never an independent review or product attestation.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
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

// Bind the installed file versions, not just PATH or package-lock text.
// inode + nanosecond ctime/mtime identify replacements and in-place writes,
// including ignored dependencies, without rereading every installed file.
function installedIdentity(root, paths) {
  const hash = createHash('sha256');
  const visited = new Set();
  function visit(file, recursive) {
    const path = realpathSync(file);
    const info = statSync(path, { bigint: true });
    hash.update(JSON.stringify([file, path, ...['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].map(key => String(info[key]))]));
    if (info.isDirectory() && recursive && !visited.has(path)) {
      visited.add(path);
      for (const entry of readdirSync(path).sort()) visit(join(path, entry), true);
    } else if (!info.isDirectory() && !info.isFile()) throw new Error('Uncertain installed input');
  }
  function present(path) {
    try { lstatSync(path); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  try {
    // Relative PATH entries depend on nested working directories. Rerun rather
    // than claiming an identity for an executable we cannot resolve reliably.
    if (paths.some(path => !isAbsolute(path))) return null;
    visit(process.execPath, false);
    for (const path of [...new Set(paths)]) {
      if (!present(path)) { hash.update(JSON.stringify([path, 'absent'])); continue; }
      visit(path, false);
      // The complete directory listing binds optional tools appearing at the
      // same PATH. Resolved file versions also bind symlink target changes.
      for (const entry of readdirSync(path).sort()) visit(join(path, entry), false);
    }
    const modules = join(root, 'node_modules');
    if (present(modules)) visit(modules, true);
    else hash.update('no installed dependencies');
    return hash.digest('hex');
  } catch {
    // An unreadable, broken or unsupported installed input cannot prove reuse.
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
  const installed = installedIdentity(root, (values.find(([key]) => key === 'PATH')?.[1] ?? '').split(delimiter));
  if (installed === null) return null;
  const dependencyFile = join(root, 'node_modules/.package-lock.json');
  return sha(salt + JSON.stringify({ values, installed, node: process.versions, executable: process.execPath,
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
  return {
    read(check) {
      try {
        const receipt = JSON.parse(readFileSync(join(directory, `${check.name}.json`), 'utf8'));
        if (environment === null || receipt.version !== 3 || receipt.source !== source || receipt.environment !== environment || receipt.selection !== selection ||
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
      if (environment === null || result.status !== 'pass' || plan.comparison.unknown) return;
      const receipt = { version: 3, source, environment, selection, definition: sha(JSON.stringify(check)), finishedAt: Date.now(), result };
      const file = join(directory, `${check.name}.json`);
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(receipt) + '\n', { mode: 0o600 });
      renameSync(temporary, file);
    },
  };
}
