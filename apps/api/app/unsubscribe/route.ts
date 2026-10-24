/**
 * GET  /unsubscribe?u=<userId>&t=<token>
 * GET  /unsubscribe?w=<waitlistId>&t=<token>
 *   → Show confirmation page (no mutation — mail scanners prefetch links).
 *
 * POST /unsubscribe?u=<userId>&t=<token>
 * POST /unsubscribe?w=<waitlistId>&t=<token>
 *   → Set emailOptOutAt (idempotent via COALESCE).
 *   Also serves RFC 8058 one-click unsubscribe (body ignored).
 *
 * `u` links are minted for accounts, `w` links for waitlist-only emails that
 * have no account (joined at fitsy.org). Each path also flips the other
 * table's record for the same address when one exists, and every sender
 * checks opt-out by address (lib/marketingEmail.ts isEmailOptedOut), so an
 * account created after a `w` opt-out, or a website row that never linked,
 * still cannot be mailed.
 *
 * No auth required — the HMAC token in the URL is the auth.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { verifyUnsubscribeToken, type UnsubscribeSubject } from "@/lib/unsubscribe";
import { badLinkPage, htmlPage } from "@/lib/htmlPage";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const badLink = (): Response => badLinkPage("unsubscribe link");

/**
 * Parses and verifies the subject from the query string. Returns null on a
 * missing or bad link. Exactly one of `u` / `w` is honoured; `u` wins if both
 * are present.
 */
function verifiedSubject(request: NextRequest): {
  subject: UnsubscribeSubject;
  actionUrl: string;
} | null {
  const { searchParams } = request.nextUrl;
  const token = searchParams.get("t") ?? "";
  const userId = searchParams.get("u") ?? "";
  const waitlistId = searchParams.get("w") ?? "";

  const subject: UnsubscribeSubject | null = userId
    ? { userId }
    : waitlistId
      ? { waitlistId }
      : null;
  if (!subject || !verifyUnsubscribeToken(subject, token)) return null;

  const param =
    "userId" in subject
      ? `u=${encodeURIComponent(subject.userId)}`
      : `w=${encodeURIComponent(subject.waitlistId)}`;
  return { subject, actionUrl: `/unsubscribe?${param}&t=${encodeURIComponent(token)}` };
}

export async function GET(request: NextRequest): Promise<Response> {
  const verified = verifiedSubject(request);
  if (!verified) return badLink();
  const { actionUrl } = verified;

  const body = `
<h1>Unsubscribe from Fitsy emails?</h1>
<p>This will remove you from marketing and launch update emails. Account-related emails (receipts, security notices) are unaffected.</p>
<form method="POST" action="${actionUrl}">
  <button type="submit">Unsubscribe</button>
</form>
<p class="note">Changed your mind? Just ignore this page — nothing has changed yet.</p>
`;

  return htmlPage("Unsubscribe from Fitsy", body);
}

export async function POST(request: NextRequest): Promise<Response> {
  const verified = verifiedSubject(request);
  if (!verified) return badLink();
  const { subject } = verified;

  // Idempotent: COALESCE preserves the original opt-out timestamp on re-submissions.
  if ("userId" in subject) {
    await prisma.$transaction([
      prisma.$executeRaw(
        Prisma.sql`UPDATE "User" SET "emailOptOutAt" = COALESCE("emailOptOutAt", NOW()) WHERE id = ${subject.userId}`,
      ),
      // Any waitlist row for this account or its address, linked or not.
      prisma.$executeRaw(
        Prisma.sql`UPDATE "LaunchWaitlist" SET "emailOptOutAt" = COALESCE("emailOptOutAt", NOW())
          WHERE "userId" = ${subject.userId}
             OR "email" = (SELECT lower("email") FROM "User" WHERE id = ${subject.userId})`,
      ),
    ]);
  } else {
    await prisma.$transaction([
      prisma.$executeRaw(
        Prisma.sql`UPDATE "LaunchWaitlist" SET "emailOptOutAt" = COALESCE("emailOptOutAt", NOW()) WHERE id = ${subject.waitlistId}`,
      ),
      // If this address has since become an account, opt that out too so the
      // account-keyed send path honours the same choice.
      prisma.$executeRaw(
        Prisma.sql`UPDATE "User" SET "emailOptOutAt" = COALESCE("emailOptOutAt", NOW())
          WHERE id = (SELECT "userId" FROM "LaunchWaitlist" WHERE id = ${subject.waitlistId})`,
      ),
    ]);
  }

  const body = `
<h1>You're unsubscribed.</h1>
<p>We've removed you from Fitsy marketing and launch update emails. This may take a day or two to take full effect.</p>
<p>Account-related emails (receipts, security notices) are unaffected.</p>
`;

  return htmlPage("Unsubscribed — Fitsy", body);
}
