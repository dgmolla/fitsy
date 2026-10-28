/** Shared by request handling and the Vercel build preflight. Never log values. */
export function rateLimitStoreConfig(): { endpoint: URL; token: string } {
  const url = process.env['UPSTASH_REDIS_REST_URL'];
  const token = process.env['UPSTASH_REDIS_REST_TOKEN'];
  if (!url || !token || /\s/.test(token)) throw new Error('rate limit store is not configured');
  let endpoint: URL;
  try { endpoint = new URL(url); }
  catch { throw new Error('invalid rate limit store URL'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('invalid rate limit store URL');
  }
  return { endpoint, token };
}

// The deployment must refuse missing configuration before running migrations.
// Ordinary local builds do not use the Vercel entrypoint or need a shared store.
if (process.argv[1] && /[/\\]rateLimitStoreConfig\.ts$/.test(process.argv[1])) {
  try { rateLimitStoreConfig(); }
  catch {
    console.error('refusing: configure UPSTASH_REDIS_REST_URL (HTTPS) and UPSTASH_REDIS_REST_TOKEN (writable) for this Vercel environment before deploying');
    process.exitCode = 1;
  }
}
