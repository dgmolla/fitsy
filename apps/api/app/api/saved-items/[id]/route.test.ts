// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireAuth = jest.fn();
const mockSavedItemFindUnique = jest.fn();
const mockSavedItemDelete = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireAuth: mockRequireAuth,
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    savedItem: {
      findUnique: mockSavedItemFindUnique,
      delete: mockSavedItemDelete,
    },
  },
}));

import { DELETE } from "./route";
import { NextRequest, NextResponse } from "next/server";

const VALID_PAYLOAD = { sub: "user-1", email: "alice@example.com" };

beforeEach(() => {
  mockRequireAuth.mockReset();
  mockSavedItemFindUnique.mockReset();
  mockSavedItemDelete.mockReset();
});

function makeDeleteRequest(id: string, authHeader?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers["Authorization"] = authHeader;
  return new NextRequest(`http://localhost/api/saved-items/${id}`, {
    method: "DELETE",
    headers,
  });
}

async function callDelete(id: string, authHeader?: string) {
  return DELETE(makeDeleteRequest(id, authHeader), {
    params: Promise.resolve({ id }),
  });
}

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe("DELETE /api/saved-items/[id] — auth guard", () => {
  it("returns 401 when Authorization header is missing", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await callDelete("saved-1");

    expect(res.status).toBe(401);
    expect(mockSavedItemFindUnique).not.toHaveBeenCalled();
  });
});

// ─── Not found ────────────────────────────────────────────────────────────────

describe("DELETE /api/saved-items/[id] — not found", () => {
  it("returns 404 when saved item does not exist", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockSavedItemFindUnique.mockResolvedValue(null);

    const res = await callDelete("nonexistent", "Bearer valid.token");

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
    expect(mockSavedItemDelete).not.toHaveBeenCalled();
  });
});

// ─── Ownership check ─────────────────────────────────────────────────────────

describe("DELETE /api/saved-items/[id] — ownership check", () => {
  it("returns 403 when saved item belongs to a different user", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockSavedItemFindUnique.mockResolvedValue({
      id: "saved-1",
      userId: "user-2", // different user
    });

    const res = await callDelete("saved-1", "Bearer valid.token");

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/forbidden/i);
    expect(mockSavedItemDelete).not.toHaveBeenCalled();
  });
});

// ─── Success ──────────────────────────────────────────────────────────────────

describe("DELETE /api/saved-items/[id] — success", () => {
  it("returns 204 and deletes the item", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockSavedItemFindUnique.mockResolvedValue({
      id: "saved-1",
      userId: "user-1",
    });
    mockSavedItemDelete.mockResolvedValue({});

    const res = await callDelete("saved-1", "Bearer valid.token");

    expect(res.status).toBe(204);
    expect(mockSavedItemDelete).toHaveBeenCalledWith({
      where: { id: "saved-1" },
    });
  });

  it("returns 500 on Prisma error", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockSavedItemFindUnique.mockResolvedValue({
      id: "saved-1",
      userId: "user-1",
    });
    mockSavedItemDelete.mockRejectedValue(new Error("DB error"));

    const res = await callDelete("saved-1", "Bearer valid.token");

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/internal server error/i);
  });
});
