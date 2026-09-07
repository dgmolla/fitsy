import { createPrivateKey, sign } from "crypto";

/**
 * App Store Connect API client, shared by the review watcher cron and the
 * landing-page pricing loader. Auth is a short-lived ES256 JWT minted from
 * the team API key.
 *
 * Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_P8_BASE64 (base64 of the .p8),
 *      ASC_APP_ID (defaults to the Fitsy app id).
 */

const ASC_BASE = "https://api.appstoreconnect.apple.com/v1";
const DEFAULT_APP_ID = "6763851364";
/** Apple caps ASC tokens at 20 minutes; 10 keeps a comfortable margin. */
const TOKEN_TTL_S = 600;

interface AscCredentials {
  keyId: string;
  issuerId: string;
  p8Base64: string;
}

function ascCredentials(): AscCredentials | null {
  const keyId = process.env["ASC_KEY_ID"];
  const issuerId = process.env["ASC_ISSUER_ID"];
  const p8Base64 = process.env["ASC_P8_BASE64"];
  if (!keyId || !issuerId || !p8Base64) return null;
  return { keyId, issuerId, p8Base64 };
}

export function isAscConfigured(): boolean {
  return ascCredentials() !== null;
}

export function ascAppId(): string {
  return process.env["ASC_APP_ID"] ?? DEFAULT_APP_ID;
}

/** Mint a short-lived ES256 JWT for the App Store Connect API. */
export function ascToken(): string {
  const creds = ascCredentials();
  if (!creds) throw new Error("ASC credentials not configured");
  const p8 = Buffer.from(creds.p8Base64, "base64").toString("utf8");
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = enc({ alg: "ES256", kid: creds.keyId, typ: "JWT" });
  const payload = enc({
    iss: creds.issuerId,
    iat: now,
    exp: now + TOKEN_TTL_S,
    aud: "appstoreconnect-v1",
  });
  const signingInput = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey(p8),
    dsaEncoding: "ieee-p1363", // raw r||s, required for JOSE ES256
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

export interface AscGetOptions {
  /** Reuse a token across several calls in one walk. */
  token?: string;
}

/**
 * GET an ASC endpoint (path relative to /v1) and parse JSON.
 * Throws `Error("ASC <status> for <path>")` on a non-2xx response.
 */
export async function ascGet<T = unknown>(
  path: string,
  opts: AscGetOptions = {},
): Promise<T> {
  const res = await fetch(`${ASC_BASE}${path}`, {
    headers: { Authorization: `Bearer ${opts.token ?? ascToken()}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ASC ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/** Status code carried by an ascGet error, or null if it was not an HTTP failure. */
export function ascErrorStatus(err: unknown): number | null {
  const m = err instanceof Error ? /^ASC (\d{3}) /.exec(err.message) : null;
  return m ? Number(m[1]) : null;
}
