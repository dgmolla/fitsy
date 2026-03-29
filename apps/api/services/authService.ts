import { jwtVerify } from "jose";

// ─── Config ───────────────────────────────────────────────────────────────────

function getJwtSecret(): Uint8Array {
  const secret =
    process.env["SUPABASE_JWT_SECRET"] ?? process.env["JWT_SECRET"];
  if (!secret) {
    throw new Error("SUPABASE_JWT_SECRET environment variable is not set");
  }
  return new TextEncoder().encode(secret);
}

// ─── JWT helpers ──────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;
  email: string;
}

/**
 * Verifies a Supabase-issued JWT using SUPABASE_JWT_SECRET.
 * Returns the decoded payload on success; throws on failure.
 */
export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getJwtSecret());
  return {
    sub: payload.sub as string,
    email: payload["email"] as string,
  };
}
