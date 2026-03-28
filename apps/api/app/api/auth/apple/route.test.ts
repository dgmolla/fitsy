// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrismaUserFindUnique = jest.fn();
const mockPrismaUserCreate = jest.fn();
const mockPrismaUserUpdate = jest.fn();
const mockVerifyAppleToken = jest.fn();
const mockSignToken = jest.fn();

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    user: {
      findUnique: mockPrismaUserFindUnique,
      create: mockPrismaUserCreate,
      update: mockPrismaUserUpdate,
    },
  },
}));

jest.mock("@/services/appleAuth", () => ({
  verifyAppleToken: mockVerifyAppleToken,
}));

jest.mock("@/services/authService", () => ({
  signToken: mockSignToken,
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

// Helper to build a minimal Apple identity token for test env
function makeTestToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/apple", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const APPLE_CLAIMS = { sub: "apple-uid-123", email: "user@icloud.com" };
const MOCK_TOKEN = "signed.jwt.token";
const EXISTING_USER = { id: "user-1", email: "user@icloud.com", name: "Jane" };

beforeEach(() => {
  jest.resetAllMocks();
  mockSignToken.mockResolvedValue(MOCK_TOKEN);
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe("POST /api/auth/apple — validation", () => {
  it("returns 400 when identityToken is missing", async () => {
    const res = await POST(makeRequest({ authorizationCode: "code-123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/identityToken/i);
  });

  it("returns 400 when authorizationCode is missing", async () => {
    const res = await POST(makeRequest({ identityToken: "tok" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/authorizationCode/i);
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

describe("POST /api/auth/apple — Apple token verification", () => {
  it("returns 401 when verifyAppleToken throws", async () => {
    mockVerifyAppleToken.mockRejectedValue(new Error("Invalid token"));
    const res = await POST(
      makeRequest({ identityToken: "bad.token.sig", authorizationCode: "code-abc" }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid identity token/i);
  });
});

// ─── New user creation ────────────────────────────────────────────────────────

describe("POST /api/auth/apple — new user", () => {
  it("creates a new user and returns isNewUser=true", async () => {
    mockVerifyAppleToken.mockResolvedValue(APPLE_CLAIMS);
    mockPrismaUserFindUnique.mockResolvedValue(null); // not found by appleUserId
    // second call — not found by email either
    mockPrismaUserFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    mockPrismaUserCreate.mockResolvedValue(EXISTING_USER);

    const res = await POST(
      makeRequest({
        identityToken: makeTestToken(APPLE_CLAIMS),
        authorizationCode: "code-123",
        email: "user@icloud.com",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNewUser).toBe(true);
    expect(body.token).toBe(MOCK_TOKEN);
    expect(body.user.id).toBe(EXISTING_USER.id);
    expect(mockPrismaUserCreate).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when no email available for new user", async () => {
    mockVerifyAppleToken.mockResolvedValue({ sub: "apple-uid-123" }); // no email
    mockPrismaUserFindUnique.mockResolvedValue(null);

    const res = await POST(
      makeRequest({
        identityToken: makeTestToken({ sub: "apple-uid-123" }),
        authorizationCode: "code-123",
      }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/email/i);
  });
});

// ─── Existing user ────────────────────────────────────────────────────────────

describe("POST /api/auth/apple — existing user", () => {
  it("finds existing user by appleUserId and returns isNewUser=false", async () => {
    mockVerifyAppleToken.mockResolvedValue(APPLE_CLAIMS);
    mockPrismaUserFindUnique.mockResolvedValue(EXISTING_USER);

    const res = await POST(
      makeRequest({
        identityToken: makeTestToken(APPLE_CLAIMS),
        authorizationCode: "code-123",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNewUser).toBe(false);
    expect(body.user.id).toBe(EXISTING_USER.id);
    expect(mockPrismaUserCreate).not.toHaveBeenCalled();
  });

  it("finds existing user by email and links appleUserId", async () => {
    mockVerifyAppleToken.mockResolvedValue(APPLE_CLAIMS);
    // Not found by appleUserId
    mockPrismaUserFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(EXISTING_USER); // found by email
    mockPrismaUserUpdate.mockResolvedValue(EXISTING_USER);

    const res = await POST(
      makeRequest({
        identityToken: makeTestToken(APPLE_CLAIMS),
        authorizationCode: "code-123",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNewUser).toBe(false);
    expect(mockPrismaUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXISTING_USER.id },
        data: { appleUserId: "apple-uid-123" },
      }),
    );
  });
});
