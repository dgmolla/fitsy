// ─── Mock modules ─────────────────────────────────────────────────────────────

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: jest.fn(),
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: { user: { upsert: jest.fn() } },
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { prisma } from "@/lib/restaurantService";

const mockSignInWithPassword = jest.fn();

const SUPABASE_USER = {
  id: "supa-uuid-1",
  email: "alice@example.com",
  user_metadata: { name: "Alice" },
};
const SUPABASE_SESSION = { access_token: "supa-jwt-token" };
const DB_USER = { id: "supa-uuid-1", email: "alice@example.com", name: "Alice" };

beforeEach(() => {
  jest.resetAllMocks();
  (getSupabaseClient as jest.Mock).mockReturnValue({
    auth: { signInWithPassword: mockSignInWithPassword },
  });
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Success ──────────────────────────────────────────────────────────────────

describe("POST /api/auth/login — success", () => {
  it("returns 200 with Supabase access token on valid credentials", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.upsert as jest.Mock).mockResolvedValue(DB_USER);

    const res = await POST(
      makeRequest({ email: "alice@example.com", password: "password123" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("supa-jwt-token");
    expect(body.user.email).toBe("alice@example.com");
    expect(body.user.passwordHash).toBeUndefined();
  });

  it("normalises email before passing to Supabase", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.upsert as jest.Mock).mockResolvedValue(DB_USER);

    await POST(makeRequest({ email: "  ALICE@EXAMPLE.COM  ", password: "password123" }));

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: "alice@example.com",
      password: "password123",
    });
  });
});

// ─── Auth failures ────────────────────────────────────────────────────────────

describe("POST /api/auth/login — auth failures", () => {
  it("returns 401 when Supabase returns an error", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Invalid login credentials" },
    });

    const res = await POST(
      makeRequest({ email: "ghost@example.com", password: "password123" }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Invalid credentials");
  });

  it("returns 401 when session is null", async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    });

    const res = await POST(
      makeRequest({ email: "eve@example.com", password: "wrongpassword" }),
    );
    expect(res.status).toBe(401);
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
