// ─── Mock modules ─────────────────────────────────────────────────────────────

jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: jest.fn(),
}));

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { getSupabaseClient } from "@/lib/supabase";
import { prisma } from "@/lib/restaurantService";

const mockSignInWithIdToken = jest.fn();

const SUPABASE_USER = {
  id: "supa-uuid-2",
  email: "user@gmail.com",
  user_metadata: { name: "Jane" },
};
const SUPABASE_SESSION = { access_token: "supa-jwt-token" };
const DB_USER = { id: "supa-uuid-2", email: "user@gmail.com", name: "Jane" };

beforeEach(() => {
  jest.resetAllMocks();
  (getSupabaseClient as jest.Mock).mockReturnValue({
    auth: { signInWithIdToken: mockSignInWithIdToken },
  });
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Validation ───────────────────────────────────────────────────────────────

describe("POST /api/auth/google — validation", () => {
  it("returns 400 when idToken is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/idToken/i);
  });

  it("returns 400 on invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ─── Token verification ───────────────────────────────────────────────────────

describe("POST /api/auth/google — Supabase token verification", () => {
  it("returns 401 when Supabase signInWithIdToken returns an error", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Invalid token" },
    });

    const res = await POST(makeRequest({ idToken: "bad.token.sig" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid google id token/i);
  });
});

// ─── New user ─────────────────────────────────────────────────────────────────

describe("POST /api/auth/google — new user", () => {
  it("creates a new profile and returns isNewUser=true", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.upsert as jest.Mock).mockResolvedValue(DB_USER);

    const res = await POST(makeRequest({ idToken: "valid.google.token" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNewUser).toBe(true);
    expect(body.token).toBe("supa-jwt-token");
    expect(body.user.id).toBe(DB_USER.id);
  });
});

// ─── Existing user ────────────────────────────────────────────────────────────

describe("POST /api/auth/google — existing user", () => {
  it("returns isNewUser=false when profile already exists", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: DB_USER.id });
    (prisma.user.upsert as jest.Mock).mockResolvedValue(DB_USER);

    const res = await POST(makeRequest({ idToken: "valid.google.token" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNewUser).toBe(false);
    expect(body.user.id).toBe(DB_USER.id);
  });

  it("passes provider google to signInWithIdToken", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: DB_USER.id });
    (prisma.user.upsert as jest.Mock).mockResolvedValue(DB_USER);

    await POST(makeRequest({ idToken: "valid.google.token" }));

    expect(mockSignInWithIdToken).toHaveBeenCalledWith({
      provider: "google",
      token: "valid.google.token",
    });
  });
});
