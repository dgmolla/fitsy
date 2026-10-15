import { isIPv4 } from 'node:net';

export function isLocalDatabaseHost(url: string | undefined,
  env: Record<string, string | undefined> = process.env): boolean {
  if (!url) return false;
  const host = new URL(url).hostname;
  if (host === 'localhost' || host === 'postgres') return true;
  // The owned fixture publishes an IPv4 loopback port and passes its inspected host.
  // The environment markers select this route; they are not ownership authority.
  return Boolean(env.FITSY_LOCAL_DB === '1' && env.FITSY_VERIFY_OWNED_DB &&
    env.FITSY_VERIFY_DB_HOST === host && isIPv4(host) && host.startsWith('127.'));
}
