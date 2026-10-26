import { isIP } from 'node:net';

export function publicUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || (url.port && !['80', '443'].includes(url.port))
    || isIP(host) || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) {
    throw new Error('Only public HTTP(S) website URLs without credentials or custom ports are supported.');
  }
  url.hash = '';
  return url;
}

export type WebFetch = (url: string) => Promise<{ url: string; status: number; contentType: string; bytes: Buffer }>;

/** Public GETs only. No dotenv, cookies, database, model SDK, or authorization header. */
export const fetchWeb: WebFetch = async value => {
  let url = publicUrl(value);
  for (let redirect = 0; redirect < 5; redirect++) {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', credentials: 'omit',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FitsyOfflineNutritionResearch/1.0)', Accept: 'text/html,application/pdf;q=0.9,*/*;q=0.5' },
      signal: AbortSignal.timeout(15_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error(`Redirect without Location: ${url.href}`);
      url = publicUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}: ${url.href}`); }
    const limit = 20 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > limit) {
      await response.body?.cancel(); throw new Error('Download exceeds 20 MiB limit.');
    }
    const parts: Uint8Array[] = [];
    let size = 0;
    if (!response.body) throw new Error('Empty response body.');
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value: part, done } = await reader.read();
        if (done) break;
        size += part.length;
        if (size > limit) { await reader.cancel(); throw new Error('Download exceeds 20 MiB limit.'); }
        parts.push(part);
      }
    } finally { reader.releaseLock(); }
    return { url: url.href, status: response.status, contentType: response.headers.get('content-type') ?? '', bytes: Buffer.concat(parts) };
  }
  throw new Error('Too many redirects.');
};
