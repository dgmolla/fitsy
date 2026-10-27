import { z } from 'zod';

export const AUTH_BODY_MAX_BYTES = 64 * 1024;
export const AUTH_INPUT_ERROR = 'Invalid authentication input';
const token = z.string().min(1).max(16 * 1024);
const email = z.string().max(320).trim().toLowerCase().email().max(254);
const name = z.string().max(200);
const password = z.string().min(1).max(1024);

// Strip unused extensions while retaining every field sent by native Apple auth.
export const appleAuthSchema = z.object({
  identityToken: token,
  nonce: z.string().min(1).max(256),
  authorizationCode: z.string().min(1).max(4096).optional(),
  fullName: z.object({
    givenName: z.string().max(100).nullish(),
    familyName: z.string().max(100).nullish(),
  }).nullish(),
  email: email.nullish(),
});
export const googleAuthSchema = z.object({ idToken: token });
export const loginSchema = z.object({ email, password });
export const registerSchema = z.object({ email, password: password.min(8), name: name.optional() });

/** Provider metadata is optional and may contain non-string legacy attributes. */
export function providerDisplayName(value: unknown): string | null {
  const parsed = name.safeParse(value);
  return parsed.success ? parsed.data : null;
}
