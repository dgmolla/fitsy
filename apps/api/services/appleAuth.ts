import { jwtVerify, createRemoteJWKSet } from "jose";

// ─── Config ───────────────────────────────────────────────────────────────────

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys");

export interface AppleTokenClaims {
  sub: string;
  email?: string;
  name?: string;
}

// ─── Apple JWKS (cached lazily by jose) ──────────────────────────────────────

let appleJwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getAppleJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!appleJwks) {
    appleJwks = createRemoteJWKSet(APPLE_JWKS_URL);
  }
  return appleJwks;
}

// ─── Token verification ───────────────────────────────────────────────────────

/**
 * Verifies an Apple identity token.
 *
 * In test environments (NODE_ENV === 'test'), skips real Apple JWKS verification
 * and decodes the payload directly from the token.
 */
export async function verifyAppleToken(
  identityToken: string,
): Promise<AppleTokenClaims> {
  if (process.env["NODE_ENV"] === "test") {
    // In tests: decode without verification so tests don't need real Apple tokens
    const parts = identityToken.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid identity token format");
    }
    const payloadJson = Buffer.from(parts[1]!, "base64url").toString("utf-8");
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    const result: AppleTokenClaims = { sub: payload["sub"] as string };
    const email = payload["email"] as string | undefined;
    const name = payload["name"] as string | undefined;
    if (email !== undefined) result.email = email;
    if (name !== undefined) result.name = name;
    return result;
  }

  const audience =
    process.env["APPLE_CLIENT_ID"] ?? "com.fitsy.app";

  const { payload } = await jwtVerify(identityToken, getAppleJwks(), {
    issuer: APPLE_ISSUER,
    audience,
  });

  const sub = payload.sub;
  if (!sub) {
    throw new Error("Apple token missing sub claim");
  }

  const result: AppleTokenClaims = { sub };
  const email = payload["email"] as string | undefined;
  const name = payload["name"] as string | undefined;
  if (email !== undefined) result.email = email;
  if (name !== undefined) result.name = name;
  return result;
}
