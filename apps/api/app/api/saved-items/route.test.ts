// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireAuth = jest.fn();
const mockSavedItemFindMany = jest.fn();
const mockSavedItemFindUnique = jest.fn();
const mockSavedItemUpsert = jest.fn();
const mockMenuItemFindUnique = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireAuth: mockRequireAuth,
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    savedItem: {
      findMany: mockSavedItemFindMany,
      findUnique: mockSavedItemFindUnique,
      upsert: mockSavedItemUpsert,
    },
    menuItem: {
      findUnique: mockMenuItemFindUnique,
    },
  },
}));

import { GET, POST } from "./route";
import { NextRequest, NextResponse } from "next/server";

const VALID_PAYLOAD = { sub: "user-1", email: "alice@example.com" };

const MOCK_MACRO = {
  id: "macro-1",
  calories: 500,
  proteinG: 30,
  carbsG: 60,
  fatG: 15,
  confidence: "HIGH",
  hadPhoto: true,
  estimatedAt: new Date("2024-01-01T00:00:00Z"),
};

const MOCK_RESTAURANT = {
  id: "rest-1",
  name: "Test Burger",
  address: "123 Main St",
};

const MOCK_MENU_ITEM = {
  id: "item-1",
  name: "Big Burger",
  description: "A tasty burger",
  category: "Burgers",
  price: 12.99,
  restaurantId: "rest-1",
  restaurant: MOCK_RESTAURANT,
  macroEstimates: [MOCK_MACRO],
};

function makeSavedItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "saved-1",
    menuItemId: "item-1",
    restaurantId: "rest-1",
    itemType: "menu_item",
    createdAt: new Date("2024-06-01T00:00:00Z"),
    menuItem: MOCK_MENU_ITEM,
    ...overrides,
  };
}

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockSavedItemFindMany.mockReset();
  mockSavedItemFindUnique.mockReset();
  mockSavedItemUpsert.mockReset();
  mockMenuItemFindUnique.mockReset();
});

function makeGetRequest(
  query: Record<string, string> = {},
  authHeader?: string,
): NextRequest {
  const url = new URL("http://localhost/api/saved-items");
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers["Authorization"] = authHeader;
  return new NextRequest(url.toString(), { method: "GET", headers });
}

function makePostRequest(
  body: unknown,
  authHeader?: string,
): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authHeader !== undefined) headers["Authorization"] = authHeader;
  return new NextRequest("http://localhost/api/saved-items", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

// ─── GET — auth guard ─────────────────────────────────────────────────────────

describe("GET /api/saved-items — auth guard", () => {
  it("returns 401 when Authorization header is missing", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(401);
    expect(mockSavedItemFindMany).not.toHaveBeenCalled();
  });
});

// ─── GET — success ────────────────────────────────────────────────────────────

describe("GET /api/saved-items — success", () => {
  it("returns 200 with empty list", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockSavedItemFindMany.mockResolvedValue([]);

    const res = await GET(makeGetRequest({}, "Bearer valid.token"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ data: [], meta: { hasMore: false } });
  });

  it("returns 200 with saved items mapped correctly", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockSavedItemFindMany.mockResolvedValue([makeSavedItem()]);

    const res = await GET(makeGetRequest({}, "Bearer valid.token"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: "saved-1",
      menuItemId: "item-1",
      restaurantId: "rest-1",
      itemType: "menu_item",
      menuItem: {
        id: "item-1",
        name: "Big Burger",
        macros: {
          calories: 500,
          proteinG: 30,
          confidence: "HIGH",
        },
        restaurant: {
          id: "rest-1",
          name: "Test Burger",
        },
      },
    });
    expect(body.meta.hasMore).toBe(false);
  });

  it("handles cursor pagination — returns hasMore and next cursor", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    // Return limit+1 items to signal there are more
    const items = Array.from({ length: 51 }, (_, i) =>
      makeSavedItem({ id: `saved-${i + 1}` }),
    );
    mockSavedItemFindMany.mockResolvedValue(items);

    const res = await GET(makeGetRequest({}, "Bearer valid.token"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(50);
    expect(body.meta.hasMore).toBe(true);
    expect(body.meta.cursor).toBe("saved-50");
  });

  it("passes cursor param to Prisma query", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockSavedItemFindMany.mockResolvedValue([]);

    await GET(makeGetRequest({ cursor: "saved-10" }, "Bearer valid.token"));

    expect(mockSavedItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "saved-10" },
        skip: 1,
      }),
    );
  });

  it("returns 500 on Prisma error", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockSavedItemFindMany.mockRejectedValue(new Error("DB error"));

    const res = await GET(makeGetRequest({}, "Bearer valid.token"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/internal server error/i);
  });
});

// ─── POST — auth guard ────────────────────────────────────────────────────────

describe("POST /api/saved-items — auth guard", () => {
  it("returns 401 when Authorization header is missing", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await POST(makePostRequest({ menuItemId: "item-1" }));

    expect(res.status).toBe(401);
    expect(mockMenuItemFindUnique).not.toHaveBeenCalled();
  });
});

// ─── POST — validation ────────────────────────────────────────────────────────

describe("POST /api/saved-items — validation", () => {
  it("returns 400 when menuItemId is missing", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);

    const res = await POST(makePostRequest({}, "Bearer valid.token"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/menuItemId/i);
  });

  it("returns 400 when body is invalid JSON", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    const headers: Record<string, string> = {
      Authorization: "Bearer valid.token",
      "Content-Type": "application/json",
    };
    const req = new NextRequest("http://localhost/api/saved-items", {
      method: "POST",
      headers,
      body: "not-json",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid json/i);
  });

  it("returns 404 when menuItem does not exist", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockMenuItemFindUnique.mockResolvedValue(null);

    const res = await POST(
      makePostRequest({ menuItemId: "nonexistent" }, "Bearer valid.token"),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/menu item not found/i);
  });
});

// ─── POST — success ───────────────────────────────────────────────────────────

describe("POST /api/saved-items — success", () => {
  it("returns 201 on new save", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockMenuItemFindUnique.mockResolvedValue({
      id: "item-1",
      restaurantId: "rest-1",
    });
    mockSavedItemFindUnique.mockResolvedValue(null); // not already saved
    mockSavedItemUpsert.mockResolvedValue(makeSavedItem());

    const res = await POST(
      makePostRequest({ menuItemId: "item-1" }, "Bearer valid.token"),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: "saved-1", menuItemId: "item-1" });
    expect(mockSavedItemUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_menuItemId: { userId: "user-1", menuItemId: "item-1" } },
        create: expect.objectContaining({
          userId: "user-1",
          menuItemId: "item-1",
          restaurantId: "rest-1",
          itemType: "menu_item",
        }),
      }),
    );
  });

  it("returns 200 when item already saved (idempotent)", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockMenuItemFindUnique.mockResolvedValue({
      id: "item-1",
      restaurantId: "rest-1",
    });
    mockSavedItemFindUnique.mockResolvedValue(makeSavedItem()); // already exists
    mockSavedItemUpsert.mockResolvedValue(makeSavedItem());

    const res = await POST(
      makePostRequest({ menuItemId: "item-1" }, "Bearer valid.token"),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ id: "saved-1" });
  });

  it("returns 500 on Prisma error", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockMenuItemFindUnique.mockRejectedValue(new Error("DB error"));

    const res = await POST(
      makePostRequest({ menuItemId: "item-1" }, "Bearer valid.token"),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/internal server error/i);
  });
});
