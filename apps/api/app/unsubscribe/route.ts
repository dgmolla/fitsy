/**
 * GET  /unsubscribe?u=<userId>&t=<token>
 *   → Show confirmation page (no mutation — mail scanners prefetch links).
 *
 * POST /unsubscribe?u=<userId>&t=<token>
 *   → Set emailOptOutAt (idempotent via COALESCE).
 *   Also serves RFC 8058 one-click unsubscribe (body ignored).
 *
 * No auth required — the HMAC token in the URL is the auth.
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BRAND_GREEN = "#1B3A26";
const BG = "#FDFBF7";

function htmlPage(title: string, body: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:${BG};color:#222;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:24px}
  .card{max-width:440px;width:100%;background:#fff;border:1px solid #e5e1d8;border-radius:16px;padding:40px 36px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.06)}
  h1{font-size:22px;font-weight:700;color:${BRAND_GREEN};margin-bottom:12px}
  p{font-size:15px;line-height:1.6;color:#555;margin-bottom:20px}
  button{background:${BRAND_GREEN};color:#fff;border:none;border-radius:8px;padding:12px 28px;font-size:15px;font-weight:600;cursor:pointer;width:100%}
  button:hover{background:#254d35}
  .note{font-size:13px;color:#999;margin-top:16px}
</style>
</head>
<body>
<div class="card">${body}</div>
</body>
</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function badLink(): Response {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invalid link</title></head><body><p>Invalid unsubscribe link</p></body></html>`,
    {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = request.nextUrl;
  const userId = searchParams.get("u") ?? "";
  const token = searchParams.get("t") ?? "";

  if (!userId || !verifyUnsubscribeToken(userId, token)) {
    return badLink();
  }

  // Build the action URL preserving query params
  const actionUrl = `/unsubscribe?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}`;

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
  const { searchParams } = request.nextUrl;
  const userId = searchParams.get("u") ?? "";
  const token = searchParams.get("t") ?? "";

  if (!userId || !verifyUnsubscribeToken(userId, token)) {
    return badLink();
  }

  // Idempotent: COALESCE preserves the original opt-out timestamp on re-submissions.
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "User" SET "emailOptOutAt" = COALESCE("emailOptOutAt", NOW()) WHERE id = ${userId}`,
  );

  const body = `
<h1>You're unsubscribed.</h1>
<p>We've removed you from Fitsy marketing and launch update emails. This may take a day or two to take full effect.</p>
<p>Account-related emails (receipts, security notices) are unaffected.</p>
`;

  return htmlPage("Unsubscribed — Fitsy", body);
}
