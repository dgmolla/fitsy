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

describe('data quotas across routes and credentials', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('limits one user across rotating IPs and resumes after the window', async () => {
    mockVerifyToken.mockResolvedValue({ sub: 'user-quota', email: 'quota@example.test' });
    const request = (ip: number) => new NextRequest('http://localhost/api/restaurants', {
      headers: { authorization: 'Bearer refreshed-token', 'x-forwarded-for': `192.0.2.${ip}` },
    });
    for (let i = 0; i < 120; i++) expect(await requireAuth(request(i))).not.toBeInstanceOf(NextResponse);
    const denied = await requireAuth(request(121)) as NextResponse;
    expect(denied.status).toBe(429);
    expect(denied.headers.get('Retry-After')).toBe('60');
    expect(await denied.json()).toEqual({ error: 'Too many requests' });
    jest.advanceTimersByTime(60_000);
    expect(await requireAuth(request(122))).not.toBeInstanceOf(NextResponse);
  });

  it('limits one canonical IP across users before invoking the JWT provider', async () => {
    mockVerifyToken.mockImplementation(async token => ({ sub: token, email: 'quota@example.test' }));
    const request = (i: number) => new NextRequest('http://localhost/api/subscriptions/status', {
      headers: { authorization: `Bearer ip-quota-${i}`, 'x-vercel-forwarded-for': '198.51.100.1', 'x-forwarded-for': `spoofed-${i}` },
    });
    for (let i = 0; i < 300; i++) expect(await requireAuth(request(i))).not.toBeInstanceOf(NextResponse);
    expect((await requireAuth(request(301)) as NextResponse).status).toBe(429);
    expect(mockVerifyToken).toHaveBeenCalledTimes(300);
    expect(await requireAuth(new NextRequest('http://localhost/api/restaurants'))).toMatchObject({ status: 401 });
  });
});
