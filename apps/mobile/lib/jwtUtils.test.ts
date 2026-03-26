/**
 * @jest-environment node
 */
import { decodeEmailFromToken } from './jwtUtils';

// Build a minimal JWT with a given payload (no real signing)
function makeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fakesig`;
}

describe('decodeEmailFromToken', () => {
  it('returns the email claim from a valid token', () => {
    const token = makeToken({ email: 'user@example.com', sub: 'u1' });
    expect(decodeEmailFromToken(token)).toBe('user@example.com');
  });

  it('returns — when the email claim is missing', () => {
    const token = makeToken({ sub: 'u1' });
    expect(decodeEmailFromToken(token)).toBe('—');
  });

  it('returns — when the email claim is not a string', () => {
    const token = makeToken({ email: 42 });
    expect(decodeEmailFromToken(token)).toBe('—');
  });

  it('returns — for an empty string', () => {
    expect(decodeEmailFromToken('')).toBe('—');
  });

  it('returns — for a malformed token with no dots', () => {
    expect(decodeEmailFromToken('notavalidtoken')).toBe('—');
  });

  it('returns — when payload is not valid JSON', () => {
    const badToken = 'header.!!!.sig';
    expect(decodeEmailFromToken(badToken)).toBe('—');
  });
});
