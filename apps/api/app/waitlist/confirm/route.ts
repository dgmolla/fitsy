/**
 * GET /waitlist/confirm?w=<waitlistId>&t=<token>
 *   Renders an explicit confirmation form without mutation, so email
 *   scanners cannot confirm an address by prefetching the link.
 * POST /waitlist/confirm?w=<waitlistId>&t=<token>
 *   Re-verifies the token and sets LaunchWaitlist.confirmedAt idempotently.
 *
 * No auth: the HMAC token in the URL is the auth.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { verifyConfirmToken } from "@/lib/waitlistConfirm";
import { badLinkPage, htmlPage } from "@/lib/htmlPage";
import { LAUNCH_CITY, LAUNCH_DATE_LABEL } from "@/lib/launch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifiedLink(request: NextRequest): { waitlistId: string; actionUrl: string } | null {
  const { searchParams } = request.nextUrl;
  const waitlistId = searchParams.get("w") ?? "";
  const token = searchParams.get("t") ?? "";
  if (!waitlistId || !verifyConfirmToken(waitlistId, token)) {
    return null;
  }
  return {
    waitlistId,
    actionUrl: `/waitlist/confirm?w=${encodeURIComponent(waitlistId)}&amp;t=${encodeURIComponent(token)}`,
  };
}

export async function GET(request: NextRequest): Promise<Response> {
  const verified = verifiedLink(request);
  if (!verified) return badLinkPage("confirmation link");
  const { waitlistId, actionUrl } = verified;
  const exists = await prisma.launchWaitlist.findUnique({ where: { id: waitlistId }, select: { id: true } });
  if (!exists) return badLinkPage("confirmation link");

  return htmlPage(
    "Confirm your Fitsy waitlist spot",
    `<h1>Confirm your spot.</h1>
<p>Confirm you'd like Fitsy launch updates and meal ideas by email. ${LAUNCH_CITY} launches ${LAUNCH_DATE_LABEL}.</p>
<form method="POST" action="${actionUrl}">
  <button type="submit">Confirm my email</button>
</form>
<p class="note">Didn't sign up? Ignore this page. You haven't confirmed anything.</p>`,
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  const verified = verifiedLink(request);
  if (!verified) return badLinkPage("confirmation link");
  const { waitlistId } = verified;

  // The `confirmedAt: null` filter makes a repeat click a zero-row update, so
  // the first confirmation time is kept; the existence probe below keeps a
  // repeat click a 200 rather than a bad-link page.
  const updated = await prisma.launchWaitlist.updateMany({
    where: { id: waitlistId, confirmedAt: null },
    data: { confirmedAt: new Date() },
  });
  const exists =
    updated.count > 0 ||
    (await prisma.launchWaitlist.findUnique({ where: { id: waitlistId }, select: { id: true } })) !==
      null;
  if (!exists) return badLinkPage("confirmation link");

  return htmlPage(
    "You're on the Fitsy waitlist",
    `<h1>You're confirmed.</h1>
<p>We'll email you the moment Fitsy opens in your city. ${LAUNCH_CITY} launches ${LAUNCH_DATE_LABEL}.</p>
<a class="btn" href="https://fitsy.org">Back to fitsy.org</a>
<p class="note">Changed your mind? Every email we send has an unsubscribe link.</p>`,
  );
}
