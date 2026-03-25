// ─── Mock Prisma + authService ─────────────────────────────────────────────────

const mockUserFindUnique = jest.fn();
const mockVerifyPassword = jest.fn();
const mockSignToken = jest.fn();

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: { findUnique: mockUserFindUnique },
  })),
}));

jest.mock("@/services/authService", () => ({
  verifyPassword: mockVerifyPassword,
  signToken: mockSignToken,
}));

beforeEach(() => {
  const g = globalThis as unknown as { prisma?: unknown };
  delete g.prisma;
  mockUserFindUnique.mockReset();
  mockVerifyPassword.mockReset();
  mockSignToken.mockReset();
});

import { POST } from "./route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Success ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/login — success", () => {
  it("returns 200 with token on valid credentials", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      name: "Alice",
      passwordHash: "$2b$12$hash",
    });
    mockVerifyPassword.mockResolvedValue(true);
    mockSignToken.mockResolvedValue("jwt-token");

    const res = await POST(makeRequest({ email: "alice@example.com", password: "password123" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("jwt-token");
    expect(body.user.email).toBe("alice@example.com");
    expect(body.user.passwordHash).toBeUndefined();
  });

  it("normalises email before lookup", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-2",
      email: "bob@example.com",
      name: null,
      passwordHash: "$2b$12$hash",
    });
    mockVerifyPassword.mockResolvedValue(true);
    mockSignToken.mockResolvedValue("token");

    await POST(makeRequest({ email: "  BOB@EXAMPLE.COM  ", password: "password123" }));

    expect(mockUserFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "bob@example.com" },
      }),
    );
  });
});

// ─── Auth failures ────────────────────────────────────────────────────────────

describe("POST /api/auth/login — auth failures", () => {
  it("returns 401 when user not found", async () => {
    mockUserFindUnique.mockResolvedValue(null);

    const res = await POST(makeRequest({ email: "ghost@example.com", password: "password123" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid credentials");
  });

  it("returns 401 when user has no passwordHash (OAuth user)", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-3",
      email: "oauth@example.com",
      name: null,
      passwordHash: null,
    });

    const res = await POST(makeRequest({ email: "oauth@example.com", password: "password123" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when password is wrong", async () => {
    mockUserFindUnique.mockResolvedValue({
      id: "user-4",
      email: "eve@example.com",
      name: null,
      passwordHash: "$2b$12$hash",
    });
    mockVerifyPassword.mockResolvedValue(false);

    const res = await POST(makeRequest({ email: "eve@example.com", password: "wrongpassword" }));
    expect(res.status).toBe(401);
    // Should never reveal whether the email exists
    const body = await res.json();
    expect(body.error).toBe("Invalid credentials");
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("POST /api/auth/login — validation", () => {
  it("returns 400 when email is missing", async () => {
    const res = await POST(makeRequest({ password: "password123" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is missing", async () => {
    const res = await POST(makeRequest({ email: "a@b.com" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/auth/login", {
      method: "POST",
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
