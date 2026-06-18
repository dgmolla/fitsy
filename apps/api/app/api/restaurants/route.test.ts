// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireSubscription = jest.fn();
const mockFindNearbyRestaurants = jest.fn();

// The route gates on requireSubscription (auth + active subscription). The
// entitlement logic itself is unit-tested in lib/subscription.test.ts; here we
// mock the gate so these tests focus on route behavior (happy path =
// authenticated AND entitled).
jest.mock("@/lib/subscription", () => ({
  requireSubscription: mockRequireSubscription,
}));

// Use the real cursor encode/decode but mock the DB-touching service entry.
jest.mock("@/lib/restaurantService", () => {
  const actual = jest.requireActual("@/lib/restaurantService");
  return {
    findNearbyRestaurants: mockFindNearbyRestaurants,
    encodeCursor: actual.encodeCursor,
    decodeCursor: actual.decodeCursor,
  };
});

import { GET } from "./route";
import { NextRequest, NextResponse } from "next/server";
import { encodeCursor } from "@/lib/restaurantService";

const VALID_PAYLOAD = { sub: "user-1", email: "alice@example.com" };

beforeEach(() => {
  mockRequireSubscription.mockReset();
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
    mockRequireSubscription.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await GET(makeRequest({ lat: "34.0", lng: "-118.0" }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
    expect(mockFindNearbyRestaurants).not.toHaveBeenCalled();
  });

  it("returns 401 when token is invalid", async () => {
    mockRequireSubscription.mockResolvedValue(
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
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);
    mockFindNearbyRestaurants.mockResolvedValue({ data: [], total: 0, nextCursor: null });

    const res = await GET(
      makeRequest({ lat: "34.05", lng: "-118.24" }, "Bearer valid.token"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      data: [],
      meta: { total: 0, limit: 20, nextCursor: null },
    });
    expect(mockFindNearbyRestaurants).toHaveBeenCalledTimes(1);
  });
});

// ─── Cursor pagination ────────────────────────────────────────────────────────

describe("GET /api/restaurants — cursor pagination", () => {
  it("forwards nextCursor in meta when the service returns one (full page)", async () => {
    const fakeCursor = encodeCursor({ id: "rest-9", orderKey: 1.5, distanceMiles: 1.5 });
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);
    mockFindNearbyRestaurants.mockResolvedValue({
      data: [],
      total: 0,
      nextCursor: fakeCursor,
    });

    const res = await GET(
      makeRequest({ lat: "34.0", lng: "-118.0" }, "Bearer valid.token"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.meta.nextCursor).toBe(fakeCursor);
  });

  it("returns nextCursor: null when the service signals end of results (partial page)", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);
    mockFindNearbyRestaurants.mockResolvedValue({
      data: [],
      total: 0,
      nextCursor: null,
    });

    const res = await GET(
      makeRequest({ lat: "34.0", lng: "-118.0" }, "Bearer valid.token"),
    );

    const body = await res.json();
    expect(body.meta.nextCursor).toBeNull();
  });

  it("decodes a valid cursor and forwards { id, orderKey } to the service", async () => {
    const inputCursor = encodeCursor({ id: "rest-42", orderKey: 2.4, distanceMiles: 2.4 });
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);
    mockFindNearbyRestaurants.mockResolvedValue({
      data: [],
      total: 0,
      nextCursor: null,
    });

    const res = await GET(
      makeRequest(
        { lat: "34.0", lng: "-118.0", cursor: inputCursor },
        "Bearer valid.token",
      ),
    );

    expect(res.status).toBe(200);
    const callArg = mockFindNearbyRestaurants.mock.calls[0]?.[0] as {
      cursor?: { id: string; orderKey: number };
    };
    expect(callArg.cursor).toEqual({ id: "rest-42", orderKey: 2.4, distanceMiles: 2.4 });
  });

  it("does not pass a cursor field when omitted from the request", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);
    mockFindNearbyRestaurants.mockResolvedValue({
      data: [],
      total: 0,
      nextCursor: null,
    });

    await GET(makeRequest({ lat: "34.0", lng: "-118.0" }, "Bearer valid.token"));

    const callArg = mockFindNearbyRestaurants.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArg).not.toHaveProperty("cursor");
  });

  it("returns 400 when cursor is malformed (not base64-encoded JSON)", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);

    const res = await GET(
      makeRequest(
        { lat: "34.0", lng: "-118.0", cursor: "not-valid-base64-!!!" },
        "Bearer valid.token",
      ),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/cursor/i);
    expect(mockFindNearbyRestaurants).not.toHaveBeenCalled();
  });

  it("returns 400 when cursor decodes to a missing-field shape", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);
    const badCursor = Buffer.from(JSON.stringify({ id: "x" }), "utf8").toString(
      "base64",
    );

    const res = await GET(
      makeRequest(
        { lat: "34.0", lng: "-118.0", cursor: badCursor },
        "Bearer valid.token",
      ),
    );

    expect(res.status).toBe(400);
    expect(mockFindNearbyRestaurants).not.toHaveBeenCalled();
  });
});

// ─── Validation (still enforced after auth) ───────────────────────────────────

describe("GET /api/restaurants — validation", () => {
  it("returns 400 when lat is missing", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);

    const res = await GET(makeRequest({ lng: "-118.0" }, "Bearer valid.token"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/lat/i);
  });

  it("returns 400 when lng is missing", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);

    const res = await GET(makeRequest({ lat: "34.0" }, "Bearer valid.token"));

    expect(res.status).toBe(400);
  });

  it("returns 400 when lat is out of range (>90)", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);

    const res = await GET(makeRequest({ lat: "91", lng: "-118.0" }, "Bearer valid.token"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/lat/i);
  });

  it("returns 400 when lng is out of range (<-180)", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);

    const res = await GET(makeRequest({ lat: "34.0", lng: "-181" }, "Bearer valid.token"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/lng/i);
  });

  it("returns 400 when radius is too large (>50)", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);

    const res = await GET(makeRequest({ lat: "34.0", lng: "-118.0", radius: "99" }, "Bearer valid.token"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/radius/i);
  });

  it("returns 400 when radius is zero or negative", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);

    const res = await GET(makeRequest({ lat: "34.0", lng: "-118.0", radius: "0" }, "Bearer valid.token"));

    expect(res.status).toBe(400);
  });
});

// ─── Free-text query (q) ──────────────────────────────────────────────────────

describe("GET /api/restaurants — free-text query", () => {
  it("forwards a trimmed q to the service as `query`", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);
    mockFindNearbyRestaurants.mockResolvedValue({ data: [], total: 0, nextCursor: null });

    await GET(
      makeRequest({ lat: "34.0", lng: "-118.0", q: "  poke bowl  " }, "Bearer valid.token"),
    );

    const callArg = mockFindNearbyRestaurants.mock.calls[0]?.[0] as { query?: string };
    expect(callArg.query).toBe("poke bowl");
  });

  it("does not pass `query` when q is omitted", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);
    mockFindNearbyRestaurants.mockResolvedValue({ data: [], total: 0, nextCursor: null });

    await GET(makeRequest({ lat: "34.0", lng: "-118.0" }, "Bearer valid.token"));

    const callArg = mockFindNearbyRestaurants.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("query");
  });

  it("does not pass `query` when q is empty or whitespace-only", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);
    mockFindNearbyRestaurants.mockResolvedValue({ data: [], total: 0, nextCursor: null });

    await GET(makeRequest({ lat: "34.0", lng: "-118.0", q: "   " }, "Bearer valid.token"));

    const callArg = mockFindNearbyRestaurants.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArg).not.toHaveProperty("query");
  });

  it("returns 400 when q exceeds the max length", async () => {
    mockRequireSubscription.mockResolvedValue(VALID_PAYLOAD);

    const res = await GET(
      makeRequest({ lat: "34.0", lng: "-118.0", q: "x".repeat(101) }, "Bearer valid.token"),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/q /i);
    expect(mockFindNearbyRestaurants).not.toHaveBeenCalled();
  });
});
