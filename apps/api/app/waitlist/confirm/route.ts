/**
 * GET /waitlist/confirm?w=<waitlistId>&t=<token>
 *   Double opt-in landing. Sets LaunchWaitlist.confirmedAt (idempotent) and
 *   renders a confirmation page. GET is deliberate: this is the link in the
 *   confirmation email, and confirming consent is the one email-link action
 *   that is safe for a mail scanner to trigger (it only ever enables what the
 *   address owner requested and can undo with the unsubscribe link).
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

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;
  const waitlistId = searchParams.get("w") ?? "";
  const token = searchParams.get("t") ?? "";
  if (!waitlistId || !verifyConfirmToken(waitlistId, token)) {
    return badLinkPage("confirmation link");
  }

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
