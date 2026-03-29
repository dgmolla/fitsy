import { jwtVerify, createRemoteJWKSet } from "jose";

// ─── Config ───────────────────────────────────────────────────────────────────

function getSupabaseUrl(): string {
  const url = process.env["SUPABASE_URL"];
  if (!url) throw new Error("SUPABASE_URL environment variable is not set");
  return url;
}

const jwks = createRemoteJWKSet(
  new URL(`${getSupabaseUrl()}/auth/v1/.well-known/jwks.json`),
);

// ─── JWT helpers ──────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;
  email: string;
}

/**
 * Verifies a Supabase-issued JWT using the project's JWKS (ES256).
 * Returns the decoded payload on success; throws on failure.
 */
export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, jwks);
  return {
    sub: payload.sub as string,
    email: payload["email"] as string,
  };
}
