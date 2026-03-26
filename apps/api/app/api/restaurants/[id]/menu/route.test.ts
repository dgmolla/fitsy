// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireAuth = jest.fn();
const mockGetRestaurantMenu = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireAuth: mockRequireAuth,
}));

jest.mock("@/lib/restaurantService", () => ({
  getRestaurantMenu: mockGetRestaurantMenu,
}));

import { GET } from "./route";
import { NextRequest, NextResponse } from "next/server";

const VALID_PAYLOAD = { sub: "user-1", email: "alice@example.com" };

const SAMPLE_MENU = {
  restaurantId: "rest-1",
  restaurantName: "Acme Eats",
  menuItems: [],
};

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockGetRestaurantMenu.mockReset();
});

function makeRequest(restaurantId: string, authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) {
    headers["Authorization"] = authHeader;
  }
  return new NextRequest(
    `http://localhost/api/restaurants/${restaurantId}/menu`,
    { method: "GET", headers },
  );
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe("GET /api/restaurants/[id]/menu — auth guard", () => {
  it("returns 401 when Authorization header is missing", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await GET(makeRequest("rest-1"), makeParams("rest-1"));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
    expect(mockGetRestaurantMenu).not.toHaveBeenCalled();
  });

  it("returns 401 when token is invalid", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await GET(
      makeRequest("rest-1", "Bearer bad.token"),
      makeParams("rest-1"),
    );

    expect(res.status).toBe(401);
    expect(mockGetRestaurantMenu).not.toHaveBeenCalled();
  });
});

// ─── Success ──────────────────────────────────────────────────────────────────

describe("GET /api/restaurants/[id]/menu — success", () => {
  it("returns 200 with menu data when authenticated", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockGetRestaurantMenu.mockResolvedValue(SAMPLE_MENU);

    const res = await GET(
      makeRequest("rest-1", "Bearer valid.token"),
      makeParams("rest-1"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: SAMPLE_MENU });
    expect(mockGetRestaurantMenu).toHaveBeenCalledWith("rest-1");
  });
});

// ─── Not found ────────────────────────────────────────────────────────────────

describe("GET /api/restaurants/[id]/menu — not found", () => {
  it("returns 404 when restaurant does not exist", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockGetRestaurantMenu.mockResolvedValue(null);

    const res = await GET(
      makeRequest("unknown-id", "Bearer valid.token"),
      makeParams("unknown-id"),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});
