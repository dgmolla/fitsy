import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Background public research only. No cookies, API keys, redirects to private hosts, or model calls. */
export function researchUrl(value: string): URL {
  const url = new URL(value), host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) {
    throw new Error('PDF research requires a public HTTPS URL');
  }
  url.hash = '';
  return url;
}

export function publicResearchAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a !== undefined && b !== undefined && a > 0 && a < 224 && a !== 10 && a !== 127
      && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168)
      && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19));
  }
  // IPv4-mapped, loopback, link-local, unique-local and transition addresses fail closed.
  return isIP(address) === 6 && /^2[0-9a-f]{3}:/i.test(address) && !/^200[12]:/i.test(address);
}

export async function fetchPipelinePdfSource(value: string, signal?: AbortSignal) {
  let url = researchUrl(value);
  for (let redirects = 0; redirects < 5; redirects++) {
    signal?.throwIfAborted();
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(row => !publicResearchAddress(row.address))) throw new Error('PDF research host is not public');
    const response = await fetch(url, { redirect: 'manual', credentials: 'omit',
      headers: { 'User-Agent': 'FitsyNutritionResearch/2.0', Accept: 'text/html,application/pdf' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('PDF research redirect has no location');
      url = researchUrl(new URL(location, url).href); continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('PDF research HTTP failure'); }
    const limit = 20 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw new Error('PDF source exceeds 20 MiB'); }
    const reader = response.body.getReader(), parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value: part, done } = await reader.read();
        if (done) break;
        size += part.length;
        if (size > limit) { await reader.cancel(); throw new Error('PDF source exceeds 20 MiB'); }
        parts.push(part);
      }
    } finally { reader.releaseLock(); }
    return { url: url.href, status: response.status, contentType: response.headers.get('content-type') ?? '', bytes: Buffer.concat(parts) };
  }
  throw new Error('PDF research redirect limit reached');
}
