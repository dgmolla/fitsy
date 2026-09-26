// Local performance cache, never an independent review or product attestation.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { git } from './impact-plan.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const lifetime = 6 * 3600_000;
export function sourceIdentity(root) {
  const paths = git(['ls-files', '--cached', '--others', '--exclude-standard', '-z'], root).split('\0').filter(Boolean);
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
  return sha(salt + JSON.stringify({ values, node: process.version, executable: process.execPath,
    platform: process.platform, arch: process.arch,
    dependencies: existsSync(dependencyFile) ? sha(readFileSync(dependencyFile)) : null }));
}

export function verificationCache(root, env, plan) {
  const directory = join(root, '.evidence/verify/check-cache');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const saltFile = join(directory, 'salt');
  if (!existsSync(saltFile)) {
    try { writeFileSync(saltFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const source = sourceIdentity(root);
  const environment = environmentIdentity(root, env, readFileSync(saltFile, 'utf8'));
  const selection = sha(JSON.stringify({ files: plan.files, unknown: plan.comparison.unknown }));
  return {
    read(check) {
      try {
        const receipt = JSON.parse(readFileSync(join(directory, `${check.name}.json`), 'utf8'));
        if (receipt.version !== 1 || receipt.source !== source || receipt.environment !== environment || receipt.selection !== selection ||
            receipt.definition !== sha(JSON.stringify(check)) || receipt.result?.name !== check.name || receipt.result?.status !== 'pass' ||
            !Number.isFinite(receipt.finishedAt) || receipt.finishedAt > Date.now() || Date.now() - receipt.finishedAt > lifetime) return null;
        return { ...receipt.result, duration_ms: 0, cached: true, verified_at: new Date(receipt.finishedAt).toISOString() };
      } catch { return null; }
    },
    unchanged() { return sourceIdentity(root) === source; },
    invalidate(check) {
      try { unlinkSync(join(directory, `${check.name}.json`)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
    write(check, result) {
      if (result.status !== 'pass' || plan.comparison.unknown) return;
      const receipt = { version: 1, source, environment, selection, definition: sha(JSON.stringify(check)), finishedAt: Date.now(), result };
      const file = join(directory, `${check.name}.json`);
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(receipt) + '\n', { mode: 0o600 });
      renameSync(temporary, file);
    },
  };
}
