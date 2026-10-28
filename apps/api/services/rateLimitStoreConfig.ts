/** Shared by request handling and the Vercel readiness probe. Never log values. */
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
