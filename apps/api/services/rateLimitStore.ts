import { createHash, randomUUID } from 'node:crypto';

export const STORE_TIMEOUT_MS = 1_000;

// Both keys share a Redis cluster hash tag. TIME makes quotas independent of
// worker clocks. Admission and cleanup are atomic, including the identity cap.
export const SLIDING_WINDOW_SCRIPT = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local window = tonumber(ARGV[1])
local maximum = tonumber(ARGV[2])
local capacity = tonumber(ARGV[3])
local identity = ARGV[4]
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[2])
if count >= maximum then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  return {0, 0, math.max(1, tonumber(oldest[2]) + window - now)}
end
if not redis.call('ZSCORE', KEYS[1], identity) and redis.call('ZCARD', KEYS[1]) >= capacity then
  local earliest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, 0, math.max(1, tonumber(earliest[2]) - now)}
end
redis.call('ZADD', KEYS[2], now, ARGV[5])
redis.call('PEXPIRE', KEYS[2], window)
redis.call('ZADD', KEYS[1], now + window, identity)
redis.call('PEXPIRE', KEYS[1], window)
return {1, maximum - count - 1, 0}
`;

export interface SharedQuota {
  namespace: string;
  windowMs: number;
  max: number;
  maxKeys: number;
}

/** No retries or redirects: a timed-out write may already have consumed quota. */
export async function consumeSharedQuota(quota: SharedQuota, key: string): Promise<{
  ok: boolean; remaining: number; retryAfterMs: number;
}> {
  const url = process.env['UPSTASH_REDIS_REST_URL'];
  const token = process.env['UPSTASH_REDIS_REST_TOKEN'];
  if (!url || !token) throw new Error('rate limit store is not configured');
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('invalid rate limit store URL');
  }
  const identity = createHash('sha256').update(key).digest('hex');
  const prefix = `fitsy:rate-limit:v1:{${quota.namespace}}`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('rate limit store timeout'));
    }, STORE_TIMEOUT_MS);
  });
  try {
    const operation = async () => {
      const response = await fetch(endpoint, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['EVAL', SLIDING_WINDOW_SCRIPT, '2', `${prefix}:identities`, `${prefix}:${identity}`,
          String(quota.windowMs), String(quota.max), String(quota.maxKeys), identity, randomUUID()]),
      });
      if (!response.ok) throw new Error('rate limit store HTTP error');
      const body: unknown = await response.json();
      const result = body && typeof body === 'object' && !('error' in body) && 'result' in body ? body.result : undefined;
      if (!Array.isArray(result) || result.length !== 3 || !result.every(Number.isSafeInteger)
        || ![0, 1].includes(result[0]) || result[1] < 0 || result[1] >= quota.max
        || result[2] < 0 || result[2] > quota.windowMs
        || (result[0] === 1 ? result[2] !== 0 : result[1] !== 0 || result[2] === 0)) {
        throw new Error('invalid rate limit store response');
      }
      return { ok: result[0] === 1, remaining: result[1] as number, retryAfterMs: result[2] as number };
    };
    return await Promise.race([operation(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
