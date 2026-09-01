// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockOptionalSubscription = jest.fn();
const mockGetRestaurantMenu = jest.fn();

// Route gates on optionalSubscription; entitlement logic is unit-tested in
// lib/subscription.test.ts. Mock the gate to focus on route behavior.
jest.mock("@/lib/subscription", () => ({
  optionalSubscription: mockOptionalSubscription,
}));

jest.mock("@/lib/restaurantService", () => ({
  getRestaurantMenu: mockGetRestaurantMenu,
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

const VALID_PAYLOAD = { sub: "user-1", email: "alice@example.com" };
const ENTITLED = { payload: VALID_PAYLOAD, entitled: true };
const UNENTITLED = { payload: null, entitled: false };

const SAMPLE_MENU = {
  restaurantId: "rest-1",
  restaurantName: "Acme Eats",
  locked: false,
  totalItemCount: 5,
  menuItems: [
    { id: "mi-1", name: "Item 1", macros: null },
    { id: "mi-2", name: "Item 2", macros: null },
    { id: "mi-3", name: "Item 3", macros: null },
    { id: "mi-4", name: "Item 4", macros: null },
    { id: "mi-5", name: "Item 5", macros: null },
  ],
};

beforeEach(() => {
  mockOptionalSubscription.mockReset();
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

// ─── Unentitled callers get a truncated, not a blocked, response ──────────────

describe("GET /api/restaurants/[id]/menu — unentitled callers", () => {
  it("returns 200 with a truncated menu and no Authorization header", async () => {
    mockOptionalSubscription.mockResolvedValue(UNENTITLED);
    mockGetRestaurantMenu.mockResolvedValue(SAMPLE_MENU);

    const res = await GET(makeRequest("rest-1"), makeParams("rest-1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.locked).toBe(true);
    expect(body.data.menuItems).toHaveLength(3);
    expect(body.data.menuItems.map((i: { id: string }) => i.id)).toEqual([
      "mi-1",
      "mi-2",
      "mi-3",
    ]);
  });

  it("truncates the menu when authenticated but not subscribed", async () => {
    mockOptionalSubscription.mockResolvedValue(UNENTITLED);
    mockGetRestaurantMenu.mockResolvedValue(SAMPLE_MENU);

    const res = await GET(
      makeRequest("rest-1", "Bearer valid.token"),
      makeParams("rest-1"),
    );

    const body = await res.json();
    expect(body.data.locked).toBe(true);
    expect(body.data.menuItems).toHaveLength(3);
  });

  it("keeps real macro data on the sampled items — never fakes precision", async () => {
    const menuWithMacros = {
      ...SAMPLE_MENU,
      menuItems: [
        { id: "mi-1", name: "Bowl", macros: { calories: 500, proteinG: 40, carbsG: 30, fatG: 10, confidence: "HIGH", hadPhoto: true, estimatedAt: "2026-01-01T00:00:00.000Z" } },
      ],
    };
    mockOptionalSubscription.mockResolvedValue(UNENTITLED);
    mockGetRestaurantMenu.mockResolvedValue(menuWithMacros);

    const res = await GET(makeRequest("rest-1"), makeParams("rest-1"));

    const body = await res.json();
    expect(body.data.menuItems[0].macros).toEqual(menuWithMacros.menuItems[0]!.macros);
  });
});

// ─── Success ──────────────────────────────────────────────────────────────────

describe("GET /api/restaurants/[id]/menu — success", () => {
  it("returns 200 with the full, unlocked menu when entitled", async () => {
    mockOptionalSubscription.mockResolvedValue(ENTITLED);
    mockGetRestaurantMenu.mockResolvedValue(SAMPLE_MENU);

    const res = await GET(
      makeRequest("rest-1", "Bearer valid.token"),
      makeParams("rest-1"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: SAMPLE_MENU });
    expect(body.data.menuItems).toHaveLength(5);
    expect(mockGetRestaurantMenu).toHaveBeenCalledWith("rest-1");
  });
});

// ─── Not found ────────────────────────────────────────────────────────────────

describe("GET /api/restaurants/[id]/menu — not found", () => {
  it("returns 404 when restaurant does not exist", async () => {
    mockOptionalSubscription.mockResolvedValue(ENTITLED);
    mockGetRestaurantMenu.mockResolvedValue(null);

    const res = await GET(
      makeRequest("unknown-id", "Bearer valid.token"),
      makeParams("unknown-id"),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 404 for an unentitled caller too (no restaurant existence leak either way)", async () => {
    mockOptionalSubscription.mockResolvedValue(UNENTITLED);
    mockGetRestaurantMenu.mockResolvedValue(null);

    const res = await GET(makeRequest("unknown-id"), makeParams("unknown-id"));

    expect(res.status).toBe(404);
  });
});
