import { jwtVerify, createRemoteJWKSet, type FlattenedJWSInput, type JWSHeaderParameters, type GetKeyFunction } from "jose";
import { isDevelopmentEnvironment, REVIEWER_EMAIL } from './runtimeEnvironment';

// ─── Config ───────────────────────────────────────────────────────────────────

function getSupabaseUrl(): string {
  const url = process.env["SUPABASE_URL"];
  if (!url) throw new Error("SUPABASE_URL environment variable is not set");
  return url;
}

let _jwks: GetKeyFunction<JWSHeaderParameters, FlattenedJWSInput> | null = null;

function getJwks() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(
      new URL(`${getSupabaseUrl()}/auth/v1/.well-known/jwks.json`),
    );
  }
  return _jwks;
}

// ─── JWT helpers ──────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;
  email: string;
}

/**
 * Verifies a Supabase-issued JWT using the project's JWKS (ES256).
 * Validates issuer and audience to prevent tokens from other Supabase
 * projects being accepted.
 * Returns the decoded payload on success; throws on failure.
 */
export async function verifyToken(token: string): Promise<JwtPayload> {
  const supabaseUrl = getSupabaseUrl();
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: `${supabaseUrl}/auth/v1`,
    audience: "authenticated",
    requiredClaims: ["sub", "exp", "iat"],
  });
  if (typeof payload.sub !== "string" || !payload.sub.trim()
    || typeof payload["email"] !== "string" || !payload["email"].trim()
    || payload["role"] !== "authenticated" || payload["is_anonymous"] === true) {
    throw new Error("A signed-in Supabase account is required");
  }
  // The public anon key also permits direct calls to Supabase Auth. Enforce
  // the production provider policy on signed claims at every data boundary,
  // so bypassing Fitsy's password route cannot bypass its reviewer limit.
  if (!isDevelopmentEnvironment() && payload['email'].trim().toLowerCase() !== REVIEWER_EMAIL) {
    const metadata = payload['app_metadata'] as { provider?: unknown; providers?: unknown } | undefined;
    const providers = Array.isArray(metadata?.providers) ? metadata.providers : [metadata?.provider];
    const supportedProvider = providers.some(provider => provider === 'apple' || provider === 'google');
    const oauthSession = Array.isArray(payload['amr']) && payload['amr'].some(
      method => method && typeof method === 'object' && method.method === 'oauth',
    );
    if (!supportedProvider || !oauthSession) throw new Error('Apple or Google sign-in is required');
  }
  return {
    sub: payload.sub,
    email: payload["email"],
  };
}
