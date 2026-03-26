// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireAuth = jest.fn();
const mockFindNearbyRestaurants = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireAuth: mockRequireAuth,
}));

jest.mock("@/lib/restaurantService", () => ({
  findNearbyRestaurants: mockFindNearbyRestaurants,
}));

import { GET } from "./route";
import { NextRequest, NextResponse } from "next/server";

const VALID_PAYLOAD = { sub: "user-1", email: "alice@example.com" };

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockFindNearbyRestaurants.mockReset();
});

function makeRequest(query: Record<string, string> = {}, authHeader?: string): NextRequest {
  const url = new URL("http://localhost/api/restaurants");
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers["Authorization"] = authHeader;
  }
  return new NextRequest(url.toString(), { method: "GET", headers });
}

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe("GET /api/restaurants — auth guard", () => {
  it("returns 401 when Authorization header is missing", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await GET(makeRequest({ lat: "34.0", lng: "-118.0" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
    expect(mockFindNearbyRestaurants).not.toHaveBeenCalled();
  });

  it("returns 401 when token is invalid", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await GET(makeRequest({ lat: "34.0", lng: "-118.0" }, "Bearer bad.token"));

    expect(res.status).toBe(401);
    expect(mockFindNearbyRestaurants).not.toHaveBeenCalled();
  });
});

// ─── Success ──────────────────────────────────────────────────────────────────

describe("GET /api/restaurants — success", () => {
  it("returns 200 with data when authenticated and lat/lng provided", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockFindNearbyRestaurants.mockResolvedValue({ data: [], total: 0 });

    const res = await GET(
      makeRequest({ lat: "34.05", lng: "-118.24" }, "Bearer valid.token"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ data: [], meta: { total: 0, limit: 20 } });
    expect(mockFindNearbyRestaurants).toHaveBeenCalledTimes(1);
  });
});

// ─── Validation (still enforced after auth) ───────────────────────────────────

describe("GET /api/restaurants — validation", () => {
  it("returns 400 when lat is missing", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);

    const res = await GET(makeRequest({ lng: "-118.0" }, "Bearer valid.token"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/lat/i);
  });

  it("returns 400 when lng is missing", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);

    const res = await GET(makeRequest({ lat: "34.0" }, "Bearer valid.token"));

    expect(res.status).toBe(400);
  });
});
