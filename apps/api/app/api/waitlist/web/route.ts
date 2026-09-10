import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { waitlistLimiter } from "@/lib/rateLimit";
import { isValidWaitlistEmail, normalizeEmail } from "@/lib/waitlist";
import { sendWaitlistConfirmation } from "@/lib/waitlistConfirmSend";

export const runtime = "nodejs";

/**
 * POST /api/waitlist/web - join the launch waitlist from fitsy.org.
 *
 * Public (no account). Body: { email, hp? }. Stores the email only: no
 * location, no name. Writes to the same LaunchWaitlist table as onboarding's
 * "Notify me" so there is exactly one launch email list.
 *
 * Double opt-in: a new row is unconfirmed and gets a confirmation email
 * (deferred with after() so the response is not held on the provider).
 * Nothing else is ever sent to an unconfirmed row. Re-submitting an
 * unconfirmed address re-sends the confirmation at most once a day.
 *
 * Abuse controls: per-IP rate limit, strict-ish email validation, and a
 * honeypot field (`hp`) that real users never see; bots that fill it get a
 * 200 and nothing stored. The field is deliberately not named like a real
 * contact field, so browser autofill never fills it for a real person.
 *
 * Always responds { ok: true } for a well-formed address, whether or not it
 * was already on the list, so the form cannot be used to probe membership.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  const limit = waitlistLimiter.check(ip);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email: rawEmail, hp } = (body ?? {}) as {
    email?: unknown;
    hp?: unknown;
  };

  // Honeypot: humans never fill this (it is hidden). Pretend success.
  if (typeof hp === "string" && hp.length > 0) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (typeof rawEmail !== "string") {
    return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
  }
  const email = normalizeEmail(rawEmail);
  if (!isValidWaitlistEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
  }

  // No-op update: an existing row (from either surface) is left untouched,
  // including notifiedAt and emailOptOutAt.
  // confirmedAt is set explicitly (not omitted): the column carries a
  // cutover DB default for rows the previous bundle inserts during the
  // migrate/promote window, which must not apply to a fresh website signup.
  const row = await prisma.launchWaitlist.upsert({
    where: { email },
    create: { email, source: "web", confirmedAt: null },
    update: {},
    select: { id: true, confirmedAt: true },
  });

  if (row.confirmedAt === null) {
    after(() => sendWaitlistConfirmation({ id: row.id, email }));
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
