#!/usr/bin/env node
// Push the exact source commit of a release build to GitHub before the EAS build starts.
// Usage: node scripts/deploy/push-build-source.mjs [--remote origin] [--config apps/mobile/app.config.ts]
// Creates tag build/<version>-<buildNumber> at HEAD, pushes it, and refuses unless the remote tag resolves to HEAD.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const defaultGit = cwd => (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function releaseIdentity(configSource) {
  const versions = [...configSource.matchAll(/^\s*version:\s*"(\d+\.\d+\.\d+)",?\s*$/gm)];
  const builds = [...configSource.matchAll(/^\s*buildNumber:\s*"(\d+)",?\s*$/gm)];
  if (versions.length !== 1 || builds.length !== 1) throw new Error('app.config.ts must contain exactly one plain version and one buildNumber line');
  return { version: versions[0][1], buildNumber: builds[0][1] };
}

export function pushBuildSource({ cwd = defaultRoot, remote = 'origin', configPath = 'apps/mobile/app.config.ts', git = defaultGit(cwd) } = {}) {
  const { version, buildNumber } = releaseIdentity(readFileSync(resolve(cwd, configPath), 'utf8'));
  const tag = `build/${version}-${buildNumber}`;
  const ref = `refs/tags/${tag}`;
  if (git('status', '--porcelain', '--untracked-files=no')) throw new Error('refusing to build: tracked files have uncommitted changes, so HEAD is not the build source');
  const sha = git('rev-parse', 'HEAD');
  const remoteSha = () => git('ls-remote', remote, ref).split(/\s+/)[0] || null;
  const existing = remoteSha();
  if (existing && existing !== sha) throw new Error(`refusing to build: ${tag} already points at ${existing}, not HEAD ${sha}; use a new buildNumber`);
  if (!existing) {
    const local = git('tag', '--list', tag);
    if (local && git('rev-parse', `${ref}^{commit}`) !== sha) throw new Error(`refusing to build: local ${tag} points at a different commit than HEAD ${sha}`);
    if (!local) git('tag', tag, sha);
    git('push', remote, ref);
  }
  if (remoteSha() !== sha) throw new Error(`refusing to build: ${tag} on ${remote} does not resolve to HEAD ${sha}`);
  return { tag, sha, version, buildNumber };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  try {
    process.stdout.write(`${JSON.stringify(pushBuildSource({ remote: arg('--remote') ?? 'origin', configPath: arg('--config') ?? 'apps/mobile/app.config.ts' }))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
