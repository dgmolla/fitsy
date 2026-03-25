// ─── Mock Prisma + authService ─────────────────────────────────────────────────

const mockUserCreate = jest.fn();
const mockHashPassword = jest.fn();
const mockSignToken = jest.fn();

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    user: { create: mockUserCreate },
  })),
}));

jest.mock("@/services/authService", () => ({
  hashPassword: mockHashPassword,
  signToken: mockSignToken,
}));

// Clear Prisma singleton before each test
beforeEach(() => {
  const g = globalThis as unknown as { prisma?: unknown };
  delete g.prisma;
  mockUserCreate.mockReset();
  mockHashPassword.mockReset();
  mockSignToken.mockReset();
});

import { POST } from "./route";
import { NextRequest } from "next/server";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Success ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/register — success", () => {
  it("creates user and returns 201 with token", async () => {
    mockHashPassword.mockResolvedValue("$2b$12$hash");
    mockUserCreate.mockResolvedValue({
      id: "user-1",
      email: "alice@example.com",
      name: "Alice",
    });
    mockSignToken.mockResolvedValue("jwt-token");

    const res = await POST(
      makeRequest({ email: "alice@example.com", password: "password123", name: "Alice" }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBe("jwt-token");
    expect(body.user.email).toBe("alice@example.com");
  });

  it("lowercases and trims email before creation", async () => {
    mockHashPassword.mockResolvedValue("$2b$12$hash");
    mockUserCreate.mockResolvedValue({
      id: "user-2",
      email: "bob@example.com",
      name: null,
    });
    mockSignToken.mockResolvedValue("token");

    await POST(makeRequest({ email: "  BOB@EXAMPLE.COM  ", password: "password123" }));

    expect(mockUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: "bob@example.com" }),
      }),
    );
  });
});

// ─── Validation errors ────────────────────────────────────────────────────────

describe("POST /api/auth/register — validation", () => {
  it("returns 400 when email is missing", async () => {
    const res = await POST(makeRequest({ password: "password123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/email/i);
  });

  it("returns 400 when email has no @", async () => {
    const res = await POST(makeRequest({ email: "notanemail", password: "password123" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is too short", async () => {
    const res = await POST(makeRequest({ email: "a@b.com", password: "short" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/8/);
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/auth/register", {
      method: "POST",
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ─── Conflict ─────────────────────────────────────────────────────────────────

describe("POST /api/auth/register — conflict", () => {
  it("returns 409 when email already exists", async () => {
    mockHashPassword.mockResolvedValue("$2b$12$hash");
    mockUserCreate.mockRejectedValue({ code: "P2002" });

    const res = await POST(makeRequest({ email: "dup@example.com", password: "password123" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already registered/i);
  });
});
