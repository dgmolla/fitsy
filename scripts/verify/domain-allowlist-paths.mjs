#!/usr/bin/env node
// Deleting a retired exception belongs with the product fix that retires it.
// Additions, unrelated removals and unreadable git history retain CTO ownership.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const paths = readFileSync(0, 'utf8').trim().split('\n').filter(Boolean);
const allowlist = 'scripts/verify/structural-allowlist.txt';
let result = paths;
if (paths.includes(allowlist)) {
  try {
    const head = process.argv[2] || 'HEAD';
    const git = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['cat-file', '-e', `${head}:${allowlist}`]);
    const stats = git(['diff', '--numstat', `origin/main...${head}`, '--', allowlist]).split('\t');
    if (stats[0] === '0' && Number(stats[1]) > 0) {
      const patch = git(['diff', '--unified=0', `origin/main...${head}`, '--', allowlist]);
      const removed = patch.split('\n').filter(line => line.startsWith('-') && !line.startsWith('---'));
      const retired = removed.map(line => /^-(?:long-file|console-log|inline-style|direct-api) (.+)$/.exec(line)?.[1]);
      if (retired.length > 0 && retired.every(path => path && paths.includes(path))) {
        result = paths.filter(path => path !== allowlist);
      }
    }
  } catch { /* Fail closed: route the allowlist to its normal infrastructure owner. */ }
}
process.stdout.write(result.join('\n') + '\n');
