import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/services/authService";
import type { JwtPayload } from "@/services/authService";
import { dataIpLimiter, dataUserLimiter, type RateLimitResult } from "@/lib/rateLimit";

function limited(result: RateLimitResult): NextResponse {
  return NextResponse.json({ error: "Too many requests" }, {
    status: 429,
    headers: { "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))), "Cache-Control": "private, no-store" },
  });
}

function unauthorized(): NextResponse {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Extracts and validates the Bearer JWT from the Authorization header.
 *
 * Returns the decoded JwtPayload on success, or a 401/429 NextResponse.
 * Callers should check `instanceof NextResponse` to detect the error path:
 *
 *   const auth = await requireAuth(request);
 *   if (auth instanceof NextResponse) return auth;
 *   // auth is now JwtPayload
 */
export async function requireAuth(
  request: NextRequest,
): Promise<JwtPayload | NextResponse> {
  const authHeader = request.headers.get("authorization");

  const token = authHeader?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!token) return unauthorized();

  // Vercel overwrites these proxy headers. Prefer its canonical client IP.
  // Local deployments must likewise sit behind a trusted forwarding proxy.
  const ip = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim() || "unknown";
  const ipLimit = dataIpLimiter.check(ip);
  if (!ipLimit.ok) return limited(ipLimit);

  let payload: JwtPayload;
  try {
    payload = await verifyToken(token);
  } catch {
    return unauthorized();
  }
  const userLimit = dataUserLimiter.check(payload.sub);
  if (!userLimit.ok) return limited(userLimit);
  return payload;
}
