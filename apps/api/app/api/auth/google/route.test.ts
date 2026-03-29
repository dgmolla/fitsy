// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrismaUserFindFirst = jest.fn();
const mockPrismaUserFindUnique = jest.fn();
const mockPrismaUserCreate = jest.fn();
const mockPrismaUserUpdate = jest.fn();
const mockVerifyGoogleToken = jest.fn();
const mockSignToken = jest.fn();

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    user: {
      findFirst: mockPrismaUserFindFirst,
      findUnique: mockPrismaUserFindUnique,
      create: mockPrismaUserCreate,
      update: mockPrismaUserUpdate,
    },
  },
}));

jest.mock("@/services/googleAuth", () => ({
  verifyGoogleToken: mockVerifyGoogleToken,
}));

jest.mock("@/services/authService", () => ({
  signToken: mockSignToken,
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

// Encode a payload as a minimal JWT-shaped token (header.payload.sig)
function makeTestToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const GOOGLE_CLAIMS = { sub: "google-uid-456", email: "user@gmail.com", name: "Jane" };
const MOCK_TOKEN = "signed.jwt.token";
const EXISTING_USER = { id: "user-1", email: "user@gmail.com", name: "Jane" };

beforeEach(() => {
  jest.resetAllMocks();
  mockSignToken.mockResolvedValue(MOCK_TOKEN);
});

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

describe("POST /api/auth/google — Google token verification", () => {
  it("returns 401 when verifyGoogleToken throws", async () => {
    mockVerifyGoogleToken.mockRejectedValue(new Error("Invalid token"));
    const res = await POST(makeRequest({ idToken: "bad.token.sig" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid google id token/i);
  });
});

// ─── New user creation ────────────────────────────────────────────────────────

describe("POST /api/auth/google — new user", () => {
  it("creates a new user and returns isNewUser=true", async () => {
    mockVerifyGoogleToken.mockResolvedValue(GOOGLE_CLAIMS);
    mockPrismaUserFindFirst.mockResolvedValue(null);
    mockPrismaUserFindUnique.mockResolvedValue(null);
    mockPrismaUserCreate.mockResolvedValue(EXISTING_USER);

    const res = await POST(makeRequest({ idToken: makeTestToken(GOOGLE_CLAIMS) }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNewUser).toBe(true);
    expect(body.token).toBe(MOCK_TOKEN);
    expect(body.user.id).toBe(EXISTING_USER.id);
    expect(mockPrismaUserCreate).toHaveBeenCalledTimes(1);
  });
});

// ─── Existing user ────────────────────────────────────────────────────────────

describe("POST /api/auth/google — existing user", () => {
  it("finds existing user by googleUserId and returns isNewUser=false", async () => {
    mockVerifyGoogleToken.mockResolvedValue(GOOGLE_CLAIMS);
    mockPrismaUserFindFirst.mockResolvedValue(EXISTING_USER);

    const res = await POST(makeRequest({ idToken: makeTestToken(GOOGLE_CLAIMS) }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNewUser).toBe(false);
    expect(body.user.id).toBe(EXISTING_USER.id);
    expect(mockPrismaUserCreate).not.toHaveBeenCalled();
  });

  it("finds existing user by email and links googleUserId", async () => {
    mockVerifyGoogleToken.mockResolvedValue(GOOGLE_CLAIMS);
    mockPrismaUserFindFirst.mockResolvedValue(null);
    mockPrismaUserFindUnique.mockResolvedValue(EXISTING_USER);
    mockPrismaUserUpdate.mockResolvedValue(EXISTING_USER);

    const res = await POST(makeRequest({ idToken: makeTestToken(GOOGLE_CLAIMS) }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isNewUser).toBe(false);
    expect(mockPrismaUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXISTING_USER.id },
        data: { googleUserId: "google-uid-456" },
      }),
    );
    expect(mockPrismaUserCreate).not.toHaveBeenCalled();
  });
});
