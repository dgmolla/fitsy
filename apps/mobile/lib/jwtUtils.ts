/**
 * Lightweight JWT payload utilities for client-side use.
 * Only decodes — never verifies — the JWT payload.
 */

/**
 * Decode the email claim from a JWT token string.
 * Returns '—' if the token is malformed or the claim is missing.
 */
export function decodeEmailFromToken(token: string): string {
  try {
    const payload = token.split('.')[1];
    if (!payload) return '—';
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded);
    const json = JSON.parse(decoded) as Record<string, unknown>;
    return typeof json['email'] === 'string' ? json['email'] : '—';
  } catch {
    return '—';
  }
}
