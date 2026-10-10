import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Fixture coordinator independently approves retained fake-provider artifacts.
// This helper is never used by production admission or real operator custody.
export function approveFixtureCaches(root: string, env: NodeJS.ProcessEnv) {
  const cache = (env.FITSY_REVIEW_CACHE || env.REVIEW_TEST_CACHE)!;
  if (!existsSync(cache)) return;
  const operators = join(env.REVIEW_TEST_ADMIN!, '.fitsy-review/operators');
  mkdirSync(operators, { recursive: true, mode: 0o700 });
  for (const name of readdirSync(cache).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
    const raw = readFileSync(join(cache, name));
    const value = JSON.parse(raw.toString());
    if (!value.execution) continue;
    const ledger = join(root, 'budgets/issue-355.jsonl');
    const approval = { issue: 355, source_sha: JSON.parse(readFileSync(ledger, 'utf8').trim().split('\n').find(line => { const row = JSON.parse(line); return row.event === 'start' && row.attempt_id === value.execution.attempt_id; })!).source_sha,
      base_sha: value.execution.base_sha, domains: Object.keys(value.domains).sort(),
      cache_key: name.slice(0, -5), result_sha256: createHash('sha256').update(raw).digest('hex'),
      ledger_sha256: createHash('sha256').update(readFileSync(ledger)).digest('hex') };
    writeFileSync(join(operators, `issue-355-cache-${name.slice(0, -5)}.json`), JSON.stringify(approval), { mode: 0o600 });
  }
}

export function installAdmissionFixture(root: string, admin: string, cache: string, git: (...args: string[]) => string) {
    const admission = join(root, 'scripts/verify/review-admission.sh');
    writeFileSync(admission, readFileSync(admission, 'utf8')
      .replace('PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', `PATH=${join(root, 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)
      .replace('ADMIN_HOME="$(python3 -I -c \'import os,pwd; print(pwd.getpwuid(os.getuid()).pw_dir)\')"', `ADMIN_HOME=${JSON.stringify(admin)}`)
      .replace('TRUSTED_GH=/opt/homebrew/bin/gh', `TRUSTED_GH=${JSON.stringify(join(root, 'bin/gh'))}`)
      .replace('TRUSTED_REPO="$ADMIN_HOME/.fitsy-review/repo"', `TRUSTED_REPO=${JSON.stringify(join(root, 'old-poller/repo'))}`)
      .replace('FITSY_REVIEW_BUDGET_HOME="$REVIEW_CACHE/budgets"', `FITSY_REVIEW_BUDGET_HOME=${JSON.stringify(join(root, 'budgets'))}`));
    const session = join(root, 'scripts/verify/shipping-session.mjs');
    writeFileSync(session, readFileSync(session, 'utf8')
      .replaceAll('userInfo().homedir', JSON.stringify(admin))
      .replace('PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node', `PATH=${join(root, 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node`)
      .replace("const administratorPath = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';", `const administratorPath = ${JSON.stringify(join(root, 'bin') + ':/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')};`)
      .replace(`const managedRepo = join(${JSON.stringify(admin)}, '.fitsy-review/repo');`, `const managedRepo = ${JSON.stringify(join(root, 'old-poller/repo'))};`));
    chmodSync(session, 0o755);
    const verification = join(root, 'scripts/verify/run.mjs');
    writeFileSync(verification, readFileSync(verification, 'utf8')
      .replace('PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node', `PATH=${join(root, 'bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin node`));
    chmodSync(verification, 0o755);
    const runner = join(root, 'scripts/review/run-review.sh');
    const installed = readFileSync(runner, 'utf8')
      .replace('CACHE_DIR="${FITSY_REVIEW_CACHE:-$HOME/.cache/fitsy-review}"', `CACHE_DIR="\${FITSY_REVIEW_CACHE:-${cache}}"`)
      .replace('BUDGET_HOME="${FITSY_REVIEW_BUDGET_HOME:-$HOME/.cache/fitsy-review/budgets}"', `BUDGET_HOME="\${FITSY_REVIEW_BUDGET_HOME:-${join(root, 'budgets')}}"`);
    writeFileSync(runner, installed);
    // Install the same fixture runner in its retained trusted-main commit.
    const branch = git('branch', '--show-current').trim();
    git('checkout', '-q', '--detach', 'origin/main');
    writeFileSync(runner, installed);
    git('add', 'scripts/review/run-review.sh'); git('commit', '-qm', 'fixture admin runner');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const trusted = git('rev-parse', 'HEAD').trim();
    git('checkout', '-q', branch);
    writeFileSync(runner, installed);
    git('-C', join(root, 'old-poller/repo'), 'fetch', '-q', root, trusted);
    git('-C', join(root, 'old-poller/repo'), 'update-ref', 'refs/remotes/origin/main', trusted);
}
