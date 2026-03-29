// ─── Mock modules ─────────────────────────────────────────────────────────────

jest.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: jest.fn(),
  getSupabaseClient: jest.fn(),
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: { user: { create: jest.fn() } },
}));

jest.mock("@/services/emailService", () => ({
  sendWelcomeEmail: jest.fn(),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { getSupabaseAdmin, getSupabaseClient } from "@/lib/supabase";
import { prisma } from "@/lib/restaurantService";
import { sendWelcomeEmail } from "@/services/emailService";

const mockAdminCreateUser = jest.fn();
const mockAdminDeleteUser = jest.fn();
const mockSignInWithPassword = jest.fn();

const SUPABASE_USER = { id: "supa-uuid-1", email: "alice@example.com" };
const DB_USER = { id: "supa-uuid-1", email: "alice@example.com", name: "Alice" };
const SUPABASE_SESSION = { access_token: "supa-jwt-token" };

beforeEach(() => {
  jest.resetAllMocks();
  (getSupabaseAdmin as jest.Mock).mockReturnValue({
    auth: {
      admin: {
        createUser: mockAdminCreateUser,
        deleteUser: mockAdminDeleteUser,
      },
    },
  });
  (getSupabaseClient as jest.Mock).mockReturnValue({
    auth: { signInWithPassword: mockSignInWithPassword },
  });
  (sendWelcomeEmail as jest.Mock).mockResolvedValue(undefined);
  mockAdminDeleteUser.mockResolvedValue({ error: null });
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Success ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/register — success", () => {
  it("creates user and returns 201 with Supabase token", async () => {
    mockAdminCreateUser.mockResolvedValue({ data: { user: SUPABASE_USER }, error: null });
    (prisma.user.create as jest.Mock).mockResolvedValue(DB_USER);
    mockSignInWithPassword.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });

    const res = await POST(
      makeRequest({ email: "alice@example.com", password: "password123", name: "Alice" }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBe("supa-jwt-token");
    expect(body.user.email).toBe("alice@example.com");
  });

  it("passes email_confirm: true to Supabase admin.createUser", async () => {
    mockAdminCreateUser.mockResolvedValue({ data: { user: SUPABASE_USER }, error: null });
    (prisma.user.create as jest.Mock).mockResolvedValue(DB_USER);
    mockSignInWithPassword.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });

    await POST(makeRequest({ email: "alice@example.com", password: "password123", name: "Alice" }));

    expect(mockAdminCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ email_confirm: true }),
    );
  });

  it("lowercases and trims email", async () => {
    mockAdminCreateUser.mockResolvedValue({
      data: { user: { ...SUPABASE_USER, email: "bob@example.com" } },
      error: null,
    });
    (prisma.user.create as jest.Mock).mockResolvedValue({ ...DB_USER, email: "bob@example.com" });
    mockSignInWithPassword.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });

    await POST(makeRequest({ email: "  BOB@EXAMPLE.COM  ", password: "password123" }));

    expect(mockAdminCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "bob@example.com" }),
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

// ─── Welcome email ────────────────────────────────────────────────────────────

describe("POST /api/auth/register — welcome email", () => {
  it("triggers sendWelcomeEmail on success", async () => {
    mockAdminCreateUser.mockResolvedValue({ data: { user: SUPABASE_USER }, error: null });
    (prisma.user.create as jest.Mock).mockResolvedValue(DB_USER);
    mockSignInWithPassword.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });

    const res = await POST(
      makeRequest({ email: "alice@example.com", password: "password123", name: "Alice" }),
    );

    expect(res.status).toBe(201);
    await Promise.resolve();
    expect(sendWelcomeEmail).toHaveBeenCalledWith("alice@example.com", "Alice");
  });

  it("does not prevent 201 when sendWelcomeEmail rejects", async () => {
    mockAdminCreateUser.mockResolvedValue({ data: { user: SUPABASE_USER }, error: null });
    (prisma.user.create as jest.Mock).mockResolvedValue({ ...DB_USER, name: null });
    mockSignInWithPassword.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (sendWelcomeEmail as jest.Mock).mockRejectedValue(new Error("Email down"));

    const res = await POST(
      makeRequest({ email: "alice@example.com", password: "password123" }),
    );

    expect(res.status).toBe(201);
  });
});

// ─── Conflict ─────────────────────────────────────────────────────────────────

describe("POST /api/auth/register — conflict", () => {
  it("returns 409 when Supabase returns status 422 (email already registered)", async () => {
    mockAdminCreateUser.mockResolvedValue({
      data: { user: null },
      error: { message: "User already registered", status: 422 },
    });

    const res = await POST(
      makeRequest({ email: "dup@example.com", password: "password123" }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already registered/i);
  });
});
