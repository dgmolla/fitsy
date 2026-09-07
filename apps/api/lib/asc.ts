import { createPrivateKey, sign } from "crypto";

/**
 * Minimal App Store Connect API client shared by the review watcher and the
 * pricing loader. Auth is a short-lived ES256 JWT minted from the team key.
 *
 * Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_P8_BASE64 (base64 of the .p8),
 *      ASC_APP_ID (defaults to the Fitsy app id).
 */

export const ASC_BASE = "https://api.appstoreconnect.apple.com/v1";
export const DEFAULT_APP_ID = "6763851364";

export function ascConfigured(): boolean {
  return Boolean(
    process.env["ASC_KEY_ID"] &&
    process.env["ASC_ISSUER_ID"] &&
    process.env["ASC_P8_BASE64"],
  );
}

export function ascAppId(): string {
  return process.env["ASC_APP_ID"] ?? DEFAULT_APP_ID;
}

/** Mint a short-lived ES256 JWT for the App Store Connect API. */
export function ascToken(): string {
  const keyId = process.env["ASC_KEY_ID"];
  const issuerId = process.env["ASC_ISSUER_ID"];
  const p8b64 = process.env["ASC_P8_BASE64"];
  if (!keyId || !issuerId || !p8b64)
    throw new Error("ASC credentials not configured");
  const p8 = Buffer.from(p8b64, "base64").toString("utf8");
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = enc({ alg: "ES256", kid: keyId, typ: "JWT" });
  const payload = enc({
    iss: issuerId,
    iat: now,
    exp: now + 600,
    aud: "appstoreconnect-v1",
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey(p8),
    dsaEncoding: "ieee-p1363", // raw r||s — required for JOSE ES256
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

/** GET an ASC endpoint (path relative to /v1) and parse JSON. Throws on non-2xx. */
export async function ascGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${ASC_BASE}${path}`, {
    headers: { Authorization: `Bearer ${ascToken()}` },
  });
  if (!res.ok) throw new Error(`ASC ${res.status} for ${path}`);
  return (await res.json()) as T;
}
