import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/services/authService";
import type { JwtPayload } from "@/services/authService";

/**
 * Extracts and validates the Bearer JWT from the Authorization header.
 *
 * Returns the decoded JwtPayload on success, or a 401 NextResponse on failure.
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

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice(7); // strip "Bearer "

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
