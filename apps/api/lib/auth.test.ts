// ─── Mock authService before importing auth ────────────────────────────────────

const mockVerifyToken = jest.fn();

jest.mock("@/services/authService", () => ({
  verifyToken: mockVerifyToken,
}));

import { requireAuth } from "./auth";
import { NextRequest, NextResponse } from "next/server";

beforeEach(() => {
  mockVerifyToken.mockReset();
});

function makeRequest(authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers["Authorization"] = authHeader;
  }
  return new NextRequest("http://localhost/api/restaurants", {
    method: "GET",
    headers,
  });
}

// ─── Missing / malformed header ────────────────────────────────────────────────

describe("requireAuth — missing or malformed header", () => {
  it("returns 401 when Authorization header is absent", async () => {
    const result = await requireAuth(makeRequest());
    expect(result).toBeInstanceOf(NextResponse);
    const res = result as NextResponse;
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when Authorization header is not a Bearer token", async () => {
    const result = await requireAuth(makeRequest("Basic dXNlcjpwYXNz"));
    expect(result).toBeInstanceOf(NextResponse);
    const res = result as NextResponse;
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is 'Bearer ' with no token", async () => {
    const result = await requireAuth(makeRequest("Bearer "));
    expect(result).toBeInstanceOf(NextResponse);
    const res = result as NextResponse;
    expect(res.status).toBe(401);
  });
});

// ─── Invalid / expired token ───────────────────────────────────────────────────

describe("requireAuth — invalid token", () => {
  it("returns 401 when verifyToken throws (invalid signature)", async () => {
    mockVerifyToken.mockRejectedValue(new Error("invalid signature"));
    const result = await requireAuth(makeRequest("Bearer bad.token.here"));
    expect(result).toBeInstanceOf(NextResponse);
    const res = result as NextResponse;
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when verifyToken throws (token expired)", async () => {
    mockVerifyToken.mockRejectedValue(new Error("JWTExpired"));
    const result = await requireAuth(makeRequest("Bearer expired.token"));
    expect(result).toBeInstanceOf(NextResponse);
    const res = result as NextResponse;
    expect(res.status).toBe(401);
  });
});

// ─── Valid token ───────────────────────────────────────────────────────────────

describe("requireAuth — valid token", () => {
  it("returns JwtPayload when token is valid", async () => {
    const payload = { sub: "user-123", email: "alice@example.com" };
    mockVerifyToken.mockResolvedValue(payload);

    const result = await requireAuth(makeRequest("Bearer valid.jwt.token"));

    expect(result).not.toBeInstanceOf(NextResponse);
    expect(result).toEqual(payload);
    expect(mockVerifyToken).toHaveBeenCalledWith("valid.jwt.token");
  });
});
