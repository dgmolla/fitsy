import { NextRequest, NextResponse } from "next/server";
import { createPrivateKey, sign } from "crypto";
import { postSlackMessage } from "@fitsy/shared";
import { prisma } from "@/lib/restaurantService";

/**
 * App Store review-result watcher. Triggered by Vercel Cron every 4 hours.
 * Polls the App Store Connect API for the iOS version's review state and posts
 * to Slack ONLY when a terminal result lands (approved / rejected / live) —
 * never on intermediate WAITING_FOR_REVIEW / IN_REVIEW churn. Dedupes so a
 * single result pings once, even though the version sits in (e.g.)
 * PENDING_DEVELOPER_RELEASE for hours until you release it.
 *
 * Always-on: unlike a laptop launchd job, this catches a 3am verdict.
 *
 * Auth: CRON_SECRET Bearer (same as the other internal crons).
 * Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_P8_BASE64 (base64 of the .p8),
 *      ASC_APP_ID (defaults to the Fitsy app id), SLACK_BOT_TOKEN.
 *
 * Dedup state lives in a tiny self-creating KV table (_review_watch) so we
 * never touch the Prisma schema / migration system (see CLAUDE.md drift note).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_APP_ID = "6763851364";
const ASC_BASE = "https://api.appstoreconnect.apple.com/v1";

/** Map an ASC version state to a Slack-worthy result, or null to stay quiet. */
function classify(state: string): { kind: string; emoji: string; text: string } | null {
  switch (state) {
    case "PENDING_DEVELOPER_RELEASE":
      return { kind: "APPROVED", emoji: ":white_check_mark:", text: "*Fitsy was APPROVED* — waiting for you to manually release it." };
    case "PENDING_APPLE_RELEASE":
      return { kind: "APPROVED", emoji: ":white_check_mark:", text: "*Fitsy was APPROVED* — Apple will release it on your scheduled date." };
    case "READY_FOR_SALE":
    case "READY_FOR_DISTRIBUTION":
      return { kind: "LIVE", emoji: ":tada:", text: "*Fitsy is APPROVED and live* on the App Store." };
    case "REJECTED":
    case "DEVELOPER_REJECTED":
      return { kind: "REJECTED", emoji: ":x:", text: "*Fitsy was REJECTED.* Open App Store Connect → Resolution Center for the reviewer's notes." };
    case "METADATA_REJECTED":
      return { kind: "METADATA_REJECTED", emoji: ":warning:", text: "*Fitsy got a METADATA rejection.* Check Resolution Center — usually fixable without a new build." };
    case "INVALID_BINARY":
      return { kind: "INVALID_BINARY", emoji: ":warning:", text: "*Fitsy build marked INVALID.* Check the build / email from Apple." };
    default:
      return null; // IN_REVIEW, WAITING_FOR_REVIEW, PREPARE_FOR_SUBMISSION, PROCESSING_FOR_DISTRIBUTION, etc.
  }
}

/** Mint a short-lived ES256 JWT for the App Store Connect API. */
function ascToken(): string {
  const keyId = process.env["ASC_KEY_ID"];
  const issuerId = process.env["ASC_ISSUER_ID"];
  const p8b64 = process.env["ASC_P8_BASE64"];
  if (!keyId || !issuerId || !p8b64) throw new Error("ASC credentials not configured");
  const p8 = Buffer.from(p8b64, "base64").toString("utf8");
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = enc({ alg: "ES256", kid: keyId, typ: "JWT" });
  const payload = enc({ iss: issuerId, iat: now, exp: now + 600, aud: "appstoreconnect-v1" });
  const signingInput = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey(p8),
    dsaEncoding: "ieee-p1363", // raw r||s — required for JOSE ES256
  });
  return `${signingInput}.${signature.toString("base64url")}`;
}

type Version = { attributes?: { versionString?: string; appStoreState?: string; state?: string } };

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env["CRON_SECRET"];
  const provided = req.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const appId = process.env["ASC_APP_ID"] ?? DEFAULT_APP_ID;

  let versions: Version[];
  try {
    const token = ascToken();
    const res = await fetch(
      `${ASC_BASE}/apps/${appId}/appStoreVersions?filter[platform]=IOS&limit=5`,
      { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `ASC ${res.status}` }, { status: 502 });
    }
    versions = ((await res.json()) as { data?: Version[] }).data ?? [];
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }

  // Pick the most actionable version: prefer one already in a terminal result
  // state, else the newest. ASC returns newest-first; we scan for a result.
  let chosen: { version: string; state: string; result: ReturnType<typeof classify> } | null = null;
  for (const v of versions) {
    const state = v.attributes?.appStoreState ?? v.attributes?.state ?? "";
    const result = classify(state);
    const version = v.attributes?.versionString ?? "?";
    if (result) { chosen = { version, state, result }; break; }
    if (!chosen) chosen = { version, state, result: null };
  }

  if (!chosen || !chosen.result) {
    return NextResponse.json({ ok: true, notified: false, state: chosen?.state ?? "none" });
  }

  // Self-creating KV for once-per-result dedup (no Prisma migration).
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "_review_watch" (key text PRIMARY KEY, value text, updated_at timestamptz DEFAULT now())`,
  );
  const signature = `${chosen.version}:${chosen.state}`;
  const last = await prisma.$queryRawUnsafe<{ value: string }[]>(
    `SELECT value FROM "_review_watch" WHERE key = 'last_result' LIMIT 1`,
  );
  if (last[0]?.value === signature) {
    return NextResponse.json({ ok: true, notified: false, state: chosen.state, deduped: true });
  }

  await postSlackMessage(
    `${chosen.result.emoji} ${chosen.result.text}  _(v${chosen.version} · ${chosen.state})_  https://appstoreconnect.apple.com/apps/${appId}/distribution`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "_review_watch" (key, value, updated_at) VALUES ('last_result', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    signature,
  );

  return NextResponse.json({ ok: true, notified: true, state: chosen.state, version: chosen.version });
}
