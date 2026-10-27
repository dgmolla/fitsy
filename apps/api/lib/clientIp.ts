import { isIP } from 'node:net';

/** Only Vercel's deployed ingress is supported as a trusted forwarding proxy. */
export function trustedClientIp(request: { headers: Headers }): string {
  if (process.env['VERCEL'] !== '1' || !['production', 'preview'].includes(process.env['VERCEL_ENV'] ?? '')) {
    // NextRequest has no authenticated socket peer. Never use caller headers here.
    return 'unknown';
  }
  const value = request.headers.get('x-vercel-forwarded-for')?.trim();
  if (!value || value.includes('%') || !isIP(value)) return 'unknown';
  if (isIP(value) === 4) return value;
  // Canonicalize equivalent IPv6 spellings, including IPv4-mapped addresses.
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1]!, 16);
  const low = parseInt(mapped[2]!, 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}
