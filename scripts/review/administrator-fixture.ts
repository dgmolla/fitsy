import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
