import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/services/authService";
import type { JwtPayload } from "@/services/authService";
import { dataIpLimiter, dataUserLimiter, rateLimitResponse } from "@/lib/rateLimit";
import { trustedClientIp } from '@/lib/clientIp';

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

  const ipLimit = await dataIpLimiter.check(trustedClientIp(request));
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);

  let payload: JwtPayload;
  try {
    payload = await verifyToken(token);
  } catch {
    return unauthorized();
  }
  const userLimit = await dataUserLimiter.check(payload.sub);
  if (!userLimit.ok) return rateLimitResponse(userLimit);
  return payload;
}
