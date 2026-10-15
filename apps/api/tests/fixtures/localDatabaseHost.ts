import { execFileSync } from 'node:child_process';
import { isIPv4 } from 'node:net';
import { resolve } from 'node:path';

type Environment = Record<string, string | undefined>;
type VerifyOwnedDatabase = (env: Environment) => void;

const verifyOwnedDatabase: VerifyOwnedDatabase = env => {
  const root = resolve(__dirname, '../../../..');
  try {
    execFileSync(process.execPath, [resolve(root, 'scripts/verify/local-db.mjs'), '--assert-owned-db'],
      { cwd: root, env: env as NodeJS.ProcessEnv, timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    throw new Error('numeric loopback database requires this worktree\'s verified owned fixture');
  }
};

export function isLocalDatabaseHost(url: string | undefined,
  env: Environment = process.env, verifyOwned: VerifyOwnedDatabase = verifyOwnedDatabase): boolean {
  if (!url) return false;
  const host = new URL(url).hostname;
  if (host === 'localhost' || host === 'postgres') return true;
  // The owned fixture publishes an IPv4 loopback port and passes its inspected host.
  // Markers select this route, while the existing container assertion proves ownership.
  if (!(env.FITSY_LOCAL_DB === '1' && env.FITSY_VERIFY_OWNED_DB &&
    env.FITSY_VERIFY_DB_HOST === host && isIPv4(host) && host.startsWith('127.'))) return false;
  verifyOwned(env);
  return true;
}
