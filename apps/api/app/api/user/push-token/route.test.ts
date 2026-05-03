// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequireAuth = jest.fn();
const mockPrismaUserUpdate = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireAuth: mockRequireAuth,
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    user: {
      update: mockPrismaUserUpdate,
    },
  },
}));

import { POST } from "./route";
import { NextRequest, NextResponse } from "next/server";

const VALID_PAYLOAD = { sub: "user-1", email: "alice@example.com" };
const VALID_TOKEN = "ExponentPushToken[abcdef0123456789abcdef]";
const VALID_TOKEN_2 = "ExponentPushToken[zzzzzz9999999999zzzzzz]";

function makeRequest(body: unknown, authHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/user/push-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe("POST /api/user/push-token — auth guard", () => {
  it("returns 401 when not authenticated", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await POST(makeRequest({ token: VALID_TOKEN }));

    expect(res.status).toBe(401);
    expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("POST /api/user/push-token — validation", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await POST(makeRequest("{not-json", "Bearer valid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/json/i);
    expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when body is null", async () => {
    const res = await POST(makeRequest(null, "Bearer valid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required/i);
    expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when token is missing", async () => {
    const res = await POST(makeRequest({}, "Bearer valid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/token/);
    expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when token is not a string", async () => {
    const res = await POST(makeRequest({ token: 123 }, "Bearer valid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/token/);
    expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when token is empty string", async () => {
    const res = await POST(makeRequest({ token: "" }, "Bearer valid"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/token/);
    expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when token exceeds max length", async () => {
    const res = await POST(
      makeRequest({ token: "x".repeat(513) }, "Bearer valid"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/512/);
    expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
  });
});

// ─── Success ──────────────────────────────────────────────────────────────────

describe("POST /api/user/push-token — success", () => {
  beforeEach(() => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
  });

  it("writes pushToken to DB and returns { ok: true }", async () => {
    mockPrismaUserUpdate.mockResolvedValue({ id: "user-1" });

    const res = await POST(makeRequest({ token: VALID_TOKEN }, "Bearer valid"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    expect(mockPrismaUserUpdate).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { pushToken: VALID_TOKEN },
    });
  });

  // Idempotency: re-registering from the same user must not error.
  // Prisma `update` on the same value is a no-op at the DB layer; this
  // test pins the contract that the route doesn't add its own dedup or
  // 409-on-duplicate logic. Latest token wins.
  it("is idempotent: same user posting twice succeeds; latest token wins", async () => {
    mockPrismaUserUpdate.mockResolvedValue({ id: "user-1" });

    // First registration
    const res1 = await POST(
      makeRequest({ token: VALID_TOKEN }, "Bearer valid"),
    );
    expect(res1.status).toBe(200);
    expect(await res1.json()).toEqual({ ok: true });

    // Second registration with the SAME token — must not error
    const res2 = await POST(
      makeRequest({ token: VALID_TOKEN }, "Bearer valid"),
    );
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({ ok: true });

    // Third registration with a DIFFERENT token — latest wins
    const res3 = await POST(
      makeRequest({ token: VALID_TOKEN_2 }, "Bearer valid"),
    );
    expect(res3.status).toBe(200);
    expect(await res3.json()).toEqual({ ok: true });

    expect(mockPrismaUserUpdate).toHaveBeenCalledTimes(3);
    expect(mockPrismaUserUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: "user-1" },
      data: { pushToken: VALID_TOKEN },
    });
    expect(mockPrismaUserUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: "user-1" },
      data: { pushToken: VALID_TOKEN },
    });
    expect(mockPrismaUserUpdate).toHaveBeenNthCalledWith(3, {
      where: { id: "user-1" },
      data: { pushToken: VALID_TOKEN_2 },
    });
  });
});

// ─── Failure ──────────────────────────────────────────────────────────────────

describe("POST /api/user/push-token — failure", () => {
  it("returns 500 when Prisma update throws", async () => {
    mockRequireAuth.mockResolvedValue(VALID_PAYLOAD);
    mockPrismaUserUpdate.mockRejectedValue(new Error("DB error"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeRequest({ token: VALID_TOKEN }, "Bearer valid"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/save push token/i);
    errorSpy.mockRestore();
  });
});
