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
  id: "supa-uuid-1",
  email: "user@icloud.com",
  user_metadata: { name: "Jane" },
};
const SUPABASE_SESSION = { access_token: "supa-jwt-token" };
const DB_USER = { id: "supa-uuid-1", email: "user@icloud.com", name: "Jane" };

beforeEach(() => {
  jest.resetAllMocks();
  (getSupabaseClient as jest.Mock).mockReturnValue({
    auth: { signInWithIdToken: mockSignInWithIdToken },
  });
});

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/apple", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── Validation ───────────────────────────────────────────────────────────────

describe("POST /api/auth/apple — validation", () => {
  it("returns 400 when identityToken is missing", async () => {
    const res = await POST(makeRequest({ authorizationCode: "code-123", nonce: "raw-nonce" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/identityToken/i);
  });

  it("returns 400 when authorizationCode is missing", async () => {
    const res = await POST(makeRequest({ identityToken: "tok", nonce: "raw-nonce" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/authorizationCode/i);
  });

  it("returns 400 when nonce is missing", async () => {
    const res = await POST(makeRequest({ identityToken: "tok", authorizationCode: "code-123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/nonce/i);
  });

  it("returns 400 on invalid JSON", async () => {
    const req = new NextRequest("http://localhost/api/auth/apple", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ─── Token verification ───────────────────────────────────────────────────────

describe("POST /api/auth/apple — Supabase token verification", () => {
  it("returns 401 when Supabase signInWithIdToken returns an error", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Invalid token" },
    });

    const res = await POST(
      makeRequest({ identityToken: "bad.identity.token", authorizationCode: "code-abc", nonce: "raw-nonce" }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid identity token/i);
  });
});

// ─── New user ─────────────────────────────────────────────────────────────────

describe("POST /api/auth/apple — new user", () => {
  it("creates a new profile and returns isNewUser=true", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.upsert as jest.Mock).mockResolvedValue(DB_USER);

    const res = await POST(
      makeRequest({ identityToken: "valid.apple.token", authorizationCode: "code-123", nonce: "raw-nonce" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNewUser).toBe(true);
    expect(body.token).toBe("supa-jwt-token");
    expect(body.user.id).toBe(DB_USER.id);
    expect(mockSignInWithIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "apple", nonce: "raw-nonce" }),
    );
  });
});

// ─── Existing user ────────────────────────────────────────────────────────────

describe("POST /api/auth/apple — existing user", () => {
  it("returns isNewUser=false when profile already exists", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: DB_USER.id });
    (prisma.user.upsert as jest.Mock).mockResolvedValue(DB_USER);

    const res = await POST(
      makeRequest({ identityToken: "valid.apple.token", authorizationCode: "code-123", nonce: "raw-nonce" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNewUser).toBe(false);
    expect(body.user.id).toBe(DB_USER.id);
  });

  it("prefers fullName from request over user_metadata for new users", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: {
        session: SUPABASE_SESSION,
        user: { ...SUPABASE_USER, user_metadata: {} },
      },
      error: null,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.upsert as jest.Mock).mockResolvedValue({ ...DB_USER, name: "John Doe" });

    const res = await POST(
      makeRequest({
        identityToken: "valid.apple.token",
        authorizationCode: "code-123",
        nonce: "raw-nonce",
        fullName: { givenName: "John", familyName: "Doe" },
      }),
    );

    expect(res.status).toBe(200);
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ name: "John Doe" }),
      }),
    );
  });
});
