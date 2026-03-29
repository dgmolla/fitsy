// ─── Google ID Token Verification ────────────────────────────────────────────

export interface GoogleTokenClaims {
  sub: string;
  email: string;
  name?: string | undefined;
  picture?: string | undefined;
}

/**
 * Verifies a Google ID token using Google's tokeninfo endpoint.
 *
 * In test environments (NODE_ENV === 'test'), skips real verification and
 * decodes the payload directly so tests don't need real Google tokens.
 */
export async function verifyGoogleToken(
  idToken: string,
): Promise<GoogleTokenClaims> {
  if (process.env["NODE_ENV"] === "test") {
    const parts = idToken.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid ID token format");
    }
    const payloadJson = Buffer.from(parts[1]!, "base64url").toString("utf-8");
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return {
      sub: payload["sub"] as string,
      email: payload["email"] as string,
      name: payload["name"] as string | undefined,
    };
  }

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );

  if (!res.ok) {
    throw new Error("Invalid Google ID token");
  }

  const data = (await res.json()) as Record<string, unknown>;

  const expectedAudience =
    process.env["GOOGLE_CLIENT_ID"] ??
    process.env["EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID"];

  if (expectedAudience && data["aud"] !== expectedAudience) {
    throw new Error("Google ID token audience mismatch");
  }

  const sub = data["sub"] as string | undefined;
  const email = data["email"] as string | undefined;

  if (!sub || !email) {
    throw new Error("Google ID token missing required claims");
  }

  return {
    sub,
    email,
    name: data["name"] as string | undefined,
  };
}
