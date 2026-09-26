#!/usr/bin/env node
import { existsSync, statfsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(import.meta.url);
export function admitResources({ root = resolve(dirname(file), '../..'), exists = existsSync,
  disk = statfsSync, env = process.env } = {}) {
  if (!exists(resolve(root, 'node_modules/js-yaml'))) {
    return { name: 'resource-admission', status: 'fail', summary: 'dependencies are missing',
      fix: 'install the locked dependencies before verification' };
  }
  const minimum = (env.FITSY_VERIFY_NEEDS_NATIVE === '1' ? 8 : 2) * 1024 ** 3;
  const space = disk(root);
  if (space.bavail * space.bsize < minimum) {
    return { name: 'resource-admission', status: 'fail', summary: `free disk is below the ${minimum / 1024 ** 3} GiB admission floor`,
      fix: 'release only task-owned disposable resources before the next build or test' };
  }
  return { name: 'resource-admission', status: 'pass', summary: 'dependency and resource admission passed', fix: '' };
}

if (process.argv[1] && resolve(process.argv[1]) === file) {
  const result = admitResources();
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'pass' ? 0 : 1;
}
