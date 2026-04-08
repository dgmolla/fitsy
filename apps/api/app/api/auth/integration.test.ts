/**
 * Auth Integration Tests (S-93)
 *
 * Tests the full auth → JWT → protected route flow end-to-end, exercising
 * requireAuth and verifyToken as real code. Only external service boundaries
 * are mocked: Supabase, Prisma, jose (JWKS fetch), and emailService.
 *
 * Pattern: obtain a JWT from an auth route, then pass it directly to a
 * protected route and assert the protected route accepts or rejects it.
 */

// ─── Mock external boundaries ──────────────────────────────────────────────────
//
// jose is mocked so verifyToken runs real code but jwtVerify is controlled.
// This lets us simulate valid tokens (jwtVerify resolves) and invalid tokens
// (jwtVerify rejects) without live JWKS fetch.

const mockJwtVerify = jest.fn();
const mockCreateRemoteJWKSet = jest.fn().mockReturnValue("mock-jwks");

jest.mock("jose", () => ({
  jwtVerify: mockJwtVerify,
  createRemoteJWKSet: mockCreateRemoteJWKSet,
}));

// Supabase mocks — auth routes call these to verify tokens and create users
jest.mock("@/lib/supabase", () => ({
  getSupabaseClient: jest.fn(),
  getSupabaseAdmin: jest.fn(),
}));

// Prisma mock — all DB access goes through this
jest.mock("@/lib/restaurantService", () => {
  const user = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  };
  const macroTarget = { upsert: jest.fn() };
  const savedItem = { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() };
  const menuItem = { findUnique: jest.fn() };

  return {
    prisma: {
      user,
      macroTarget,
      savedItem,
      menuItem,
      $transaction: jest.fn().mockImplementation(async (fn) =>
        fn({ user, macroTarget, savedItem, menuItem }),
      ),
    },
  };
});

// emailService — fire-and-forget, must not affect test outcomes
jest.mock("@/services/emailService", () => ({
  sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
}));

// ─── Imports ───────────────────────────────────────────────────────────────────

import { POST as applePost } from "./apple/route";
import { POST as googlePost } from "./google/route";
import { POST as registerPost } from "./register/route";
import { POST as loginPost } from "./login/route";
import { GET as profileGet, PATCH as profilePatch } from "../user/profile/route";
import { GET as savedItemsGet } from "../saved-items/route";
import { NextRequest } from "next/server";
import { getSupabaseClient, getSupabaseAdmin } from "@/lib/supabase";
import { prisma } from "@/lib/restaurantService";

// ─── Shared test fixtures ──────────────────────────────────────────────────────

const SUPABASE_JWT = "supabase.access.token.xyz";
const USER_ID = "supa-uuid-integration-1";
const USER_EMAIL = "integration@example.com";
const USER_NAME = "Integration User";

const SUPABASE_USER = {
  id: USER_ID,
  email: USER_EMAIL,
  user_metadata: { name: USER_NAME },
};
const SUPABASE_SESSION = { access_token: SUPABASE_JWT };
const DB_USER = { id: USER_ID, email: USER_EMAIL, name: USER_NAME };
const JWT_PAYLOAD = { sub: USER_ID, email: USER_EMAIL };

// Convenience: configure jose mock to accept SUPABASE_JWT as valid
function allowJwt() {
  mockJwtVerify.mockResolvedValue({ payload: JWT_PAYLOAD });
}

// Convenience: configure jose mock to reject any token
function rejectJwt(reason = "JWTExpired") {
  mockJwtVerify.mockRejectedValue(new Error(reason));
}

// ─── Request helpers ───────────────────────────────────────────────────────────

function appleRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/apple", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function googleRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function registerRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function loginRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function profileGetRequest(token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/user/profile", {
    method: "GET",
    headers,
  });
}

function profilePatchRequest(body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/user/profile", {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

function savedItemsRequest(token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new NextRequest("http://localhost/api/saved-items", {
    method: "GET",
    headers,
  });
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

const mockSignInWithIdToken = jest.fn();
const mockSignInWithPassword = jest.fn();
const mockAdminCreateUser = jest.fn();
const mockAdminDeleteUser = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();

  // Default Supabase client mock (used by apple, google, login routes)
  (getSupabaseClient as jest.Mock).mockReturnValue({
    auth: {
      signInWithIdToken: mockSignInWithIdToken,
      signInWithPassword: mockSignInWithPassword,
    },
  });

  // Default Supabase admin mock (used by register route)
  (getSupabaseAdmin as jest.Mock).mockReturnValue({
    auth: {
      admin: {
        createUser: mockAdminCreateUser,
        deleteUser: mockAdminDeleteUser,
      },
    },
  });

  // Re-wire $transaction after clearAllMocks resets the implementation
  const user = (
    prisma as unknown as {
      user: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock; create: jest.Mock };
    }
  ).user;
  (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => fn({ user }));

  // Default Prisma stubs — tests override as needed
  (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.user.upsert as jest.Mock).mockResolvedValue(DB_USER);
  (prisma.user.update as jest.Mock).mockResolvedValue(DB_USER);
  (prisma.user.create as jest.Mock).mockResolvedValue(DB_USER);
  (prisma.macroTarget.upsert as jest.Mock).mockResolvedValue({});
  (prisma.savedItem.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.savedItem.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.savedItem.upsert as jest.Mock).mockResolvedValue({});
  (prisma.menuItem.findUnique as jest.Mock).mockResolvedValue(null);

  // Set SUPABASE_URL (required by verifyToken → getJwks)
  process.env["SUPABASE_URL"] = "https://test.supabase.co";
});

// ─── Group 1: Apple Sign-In → Protected Route ──────────────────────────────────

describe("Integration: Apple Sign-In → Protected Route", () => {
  it("1.1 — new Apple user: token from sign-in is accepted on GET /api/user/profile", async () => {
    // Step 1: sign in via Apple
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null); // new user

    const authRes = await applePost(
      appleRequest({ identityToken: "valid.apple.token", nonce: "raw-nonce" }),
    );
    expect(authRes.status).toBe(200);
    const authBody = await authRes.json();
    expect(authBody.token).toBe(SUPABASE_JWT);
    expect(authBody.isNewUser).toBe(true);

    // Step 2: use that token on a protected route
    allowJwt();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...DB_USER,
      birthday: null,
      heightCm: null,
      weightKg: null,
      activityLevel: null,
      goal: null,
      onboardingStep: 0,
      macroTarget: null,
    });

    const profileRes = await profileGet(profileGetRequest(authBody.token));
    expect(profileRes.status).toBe(200);
    const profileBody = await profileRes.json();
    expect(profileBody.user.id).toBe(USER_ID);
    expect(profileBody.user.email).toBe(USER_EMAIL);

    // Verify verifyToken was called with the exact JWT from the auth response
    expect(mockJwtVerify).toHaveBeenCalledWith(
      SUPABASE_JWT,
      expect.anything(),
      expect.objectContaining({ issuer: "https://test.supabase.co/auth/v1" }),
    );
  });

  it("1.2 — existing Apple user: token accepted on GET /api/saved-items", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: USER_ID }); // existing user

    const authRes = await applePost(
      appleRequest({ identityToken: "valid.apple.token", nonce: "raw-nonce" }),
    );
    expect(authRes.status).toBe(200);
    const { token, isNewUser } = await authRes.json();
    expect(isNewUser).toBe(false);

    allowJwt();
    (prisma.savedItem.findMany as jest.Mock).mockResolvedValue([]);

    const savedRes = await savedItemsGet(savedItemsRequest(token));
    expect(savedRes.status).toBe(200);
    const savedBody = await savedRes.json();
    expect(savedBody.data).toEqual([]);
  });

  it("1.3 — tampered JWT from Apple flow is rejected on protected route", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const authRes = await applePost(
      appleRequest({ identityToken: "valid.apple.token", nonce: "raw-nonce" }),
    );
    expect(authRes.status).toBe(200);
    const { token } = await authRes.json();

    // Simulate jose rejecting the tampered token
    rejectJwt("JWSInvalid");

    const profileRes = await profileGet(profileGetRequest(token));
    expect(profileRes.status).toBe(401);
    const profileBody = await profileRes.json();
    expect(profileBody.error).toBe("Unauthorized");
  });

  it("1.4 — Apple account with no email returns 400 from auth route", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: {
        session: SUPABASE_SESSION,
        user: { ...SUPABASE_USER, email: undefined },
      },
      error: null,
    });

    const authRes = await applePost(
      appleRequest({ identityToken: "valid.apple.token", nonce: "raw-nonce" }),
    );
    expect(authRes.status).toBe(400);
    const body = await authRes.json();
    expect(body.error).toMatch(/email/i);
  });
});

// ─── Group 2: Google Sign-In → Protected Route ────────────────────────────────

describe("Integration: Google Sign-In → Protected Route", () => {
  it("2.1 — new Google user: token accepted on GET /api/user/profile", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const authRes = await googlePost(googleRequest({ idToken: "valid.google.token" }));
    expect(authRes.status).toBe(200);
    const { token, isNewUser } = await authRes.json();
    expect(isNewUser).toBe(true);

    allowJwt();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...DB_USER,
      birthday: null,
      heightCm: null,
      weightKg: null,
      activityLevel: null,
      goal: null,
      onboardingStep: 0,
      macroTarget: null,
    });

    const profileRes = await profileGet(profileGetRequest(token));
    expect(profileRes.status).toBe(200);
    const profileBody = await profileRes.json();
    expect(profileBody.user.id).toBe(USER_ID);
  });

  it("2.2 — Google account-link path: linked user token accepted on protected route", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    // First findUnique (by new ID) → null; second findUnique (by email) → old user
    (prisma.user.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "old-email-provider-id" });
    (prisma.user.update as jest.Mock).mockResolvedValue({ id: USER_ID });
    (prisma.user.upsert as jest.Mock).mockResolvedValue(DB_USER);

    const authRes = await googlePost(googleRequest({ idToken: "valid.google.token" }));
    expect(authRes.status).toBe(200);
    const { token, isNewUser } = await authRes.json();
    // Account was linked — should NOT be isNewUser
    expect(isNewUser).toBe(false);

    allowJwt();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...DB_USER,
      birthday: null,
      heightCm: null,
      weightKg: null,
      activityLevel: null,
      goal: null,
      onboardingStep: 0,
      macroTarget: null,
    });

    const profileRes = await profileGet(profileGetRequest(token));
    expect(profileRes.status).toBe(200);
  });

  it("2.3 — Supabase rejects Google token: auth route returns 401 (never reaches protected route)", async () => {
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: null, user: null },
      error: { message: "Invalid token" },
    });

    const authRes = await googlePost(googleRequest({ idToken: "bad.google.token" }));
    expect(authRes.status).toBe(401);
    const body = await authRes.json();
    expect(body.error).toMatch(/invalid google id token/i);
  });
});

// ─── Group 3: Email/Password → Protected Route ────────────────────────────────

describe("Integration: Email/Password Register + Login → Protected Route", () => {
  it("3.1 — register new user: token from register accepted on GET /api/user/profile", async () => {
    const REGISTER_JWT = "register.supa.token";
    const REGISTER_SESSION = { access_token: REGISTER_JWT };

    mockAdminCreateUser.mockResolvedValue({
      data: { user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.create as jest.Mock).mockResolvedValue(DB_USER);
    mockSignInWithPassword.mockResolvedValue({
      data: { session: REGISTER_SESSION, user: SUPABASE_USER },
      error: null,
    });

    const authRes = await registerPost(
      registerRequest({ email: USER_EMAIL, password: "password123", name: USER_NAME }),
    );
    expect(authRes.status).toBe(201);
    const { token } = await authRes.json();
    expect(token).toBe(REGISTER_JWT);

    // verifyToken should accept REGISTER_JWT
    mockJwtVerify.mockResolvedValue({ payload: JWT_PAYLOAD });

    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      ...DB_USER,
      birthday: null,
      heightCm: null,
      weightKg: null,
      activityLevel: null,
      goal: null,
      onboardingStep: 0,
      macroTarget: null,
    });

    const profileRes = await profileGet(profileGetRequest(token));
    expect(profileRes.status).toBe(200);
    const profileBody = await profileRes.json();
    expect(profileBody.user.email).toBe(USER_EMAIL);
  });

  it("3.2 — login existing user: token from login accepted on GET /api/saved-items", async () => {
    const LOGIN_JWT = "login.supa.token";

    mockSignInWithPassword.mockResolvedValue({
      data: { session: { access_token: LOGIN_JWT }, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.upsert as jest.Mock).mockResolvedValue(DB_USER);

    const authRes = await loginPost(
      loginRequest({ email: USER_EMAIL, password: "password123" }),
    );
    expect(authRes.status).toBe(200);
    const { token } = await authRes.json();
    expect(token).toBe(LOGIN_JWT);

    mockJwtVerify.mockResolvedValue({ payload: JWT_PAYLOAD });
    (prisma.savedItem.findMany as jest.Mock).mockResolvedValue([]);

    const savedRes = await savedItemsGet(savedItemsRequest(token));
    expect(savedRes.status).toBe(200);
    const savedBody = await savedRes.json();
    expect(savedBody.data).toEqual([]);
  });
});

// ─── Group 4: Protected Route JWT Enforcement ─────────────────────────────────

describe("Integration: Protected Route JWT Enforcement", () => {
  it("4.1 — no Authorization header → 401 on GET /api/user/profile", async () => {
    const res = await profileGet(profileGetRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("4.1b — no Authorization header → 401 on GET /api/saved-items", async () => {
    const res = await savedItemsGet(savedItemsRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("4.2 — malformed Authorization header (no Bearer prefix) → 401", async () => {
    const req = new NextRequest("http://localhost/api/user/profile", {
      method: "GET",
      headers: { Authorization: "Token some.opaque.token" },
    });
    const res = await profileGet(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("4.3 — expired JWT → 401 on GET /api/user/profile", async () => {
    rejectJwt("JWTExpired");
    const res = await profileGet(profileGetRequest("expired.token.here"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("4.4 — wrong issuer → 401 on GET /api/user/profile", async () => {
    rejectJwt("JWTClaimValidationFailed: issuer claim check failed");
    const res = await profileGet(profileGetRequest("wrong-issuer.token"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("4.5 — valid JWT but user not found in DB → 404 on GET /api/user/profile", async () => {
    allowJwt();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await profileGet(profileGetRequest(SUPABASE_JWT));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("User not found");
  });

  it("4.6 — valid JWT accepted on GET /api/saved-items → 200", async () => {
    allowJwt();
    (prisma.savedItem.findMany as jest.Mock).mockResolvedValue([]);

    const res = await savedItemsGet(savedItemsRequest(SUPABASE_JWT));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ data: [], meta: { hasMore: false } });
  });

  it("4.7 — valid JWT accepted on PATCH /api/user/profile → 200", async () => {
    allowJwt();
    (prisma.user.update as jest.Mock).mockResolvedValue({
      id: USER_ID,
      email: USER_EMAIL,
      name: USER_NAME,
      birthday: null,
      heightCm: null,
      weightKg: null,
      activityLevel: null,
      goal: null,
      onboardingStep: 1,
    });

    const res = await profilePatch(
      profilePatchRequest({ onboardingStep: 1 }, SUPABASE_JWT),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.onboardingStep).toBe(1);
  });

  it("4.8 — Bearer header with empty token string → 401", async () => {
    const req = new NextRequest("http://localhost/api/user/profile", {
      method: "GET",
      headers: { Authorization: "Bearer " },
    });
    const res = await profileGet(req);
    expect(res.status).toBe(401);
  });
});

// ─── Group 5: Cross-Route Token Portability ───────────────────────────────────

describe("Integration: Token Portability — any valid auth token works on any protected route", () => {
  it("5.1 — Apple-issued token works on GET /api/saved-items", async () => {
    // Get token via Apple auth
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.upsert as jest.Mock).mockResolvedValue(DB_USER);

    const authRes = await applePost(
      appleRequest({ identityToken: "valid.apple.token", nonce: "raw-nonce" }),
    );
    const { token } = await authRes.json();

    // Use on saved-items route
    allowJwt();
    (prisma.savedItem.findMany as jest.Mock).mockResolvedValue([]);

    const res = await savedItemsGet(savedItemsRequest(token));
    expect(res.status).toBe(200);
  });

  it("5.2 — Google-issued token works on PATCH /api/user/profile", async () => {
    // Get token via Google auth
    mockSignInWithIdToken.mockResolvedValue({
      data: { session: SUPABASE_SESSION, user: SUPABASE_USER },
      error: null,
    });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.upsert as jest.Mock).mockResolvedValue(DB_USER);

    const authRes = await googlePost(googleRequest({ idToken: "valid.google.token" }));
    const { token } = await authRes.json();

    // Use on profile PATCH route
    allowJwt();
    (prisma.user.update as jest.Mock).mockResolvedValue({
      id: USER_ID,
      email: USER_EMAIL,
      name: USER_NAME,
      birthday: null,
      heightCm: null,
      weightKg: null,
      activityLevel: null,
      goal: null,
      onboardingStep: 2,
    });

    const res = await profilePatch(
      profilePatchRequest({ onboardingStep: 2 }, token),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.onboardingStep).toBe(2);
  });
});
