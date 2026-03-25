// ─── Mock jose + bcryptjs before importing the service ────────────────────────

const mockSign = jest.fn();
const mockVerify = jest.fn();
const mockHash = jest.fn();
const mockCompare = jest.fn();

jest.mock("jose", () => ({
  SignJWT: jest.fn().mockImplementation(() => ({
    setProtectedHeader: jest.fn().mockReturnThis(),
    setSubject: jest.fn().mockReturnThis(),
    setIssuedAt: jest.fn().mockReturnThis(),
    setExpirationTime: jest.fn().mockReturnThis(),
    sign: mockSign,
  })),
  jwtVerify: mockVerify,
}));

jest.mock("bcryptjs", () => ({
  hash: mockHash,
  compare: mockCompare,
}));

import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
} from "./authService";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, JWT_SECRET: "test-secret-key" };
  mockSign.mockReset();
  mockVerify.mockReset();
  mockHash.mockReset();
  mockCompare.mockReset();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// ─── hashPassword ─────────────────────────────────────────────────────────────

describe("hashPassword", () => {
  it("calls bcrypt.hash with 12 rounds", async () => {
    mockHash.mockResolvedValue("hashed-value");
    const result = await hashPassword("mypassword");
    expect(mockHash).toHaveBeenCalledWith("mypassword", 12);
    expect(result).toBe("hashed-value");
  });
});

// ─── verifyPassword ───────────────────────────────────────────────────────────

describe("verifyPassword", () => {
  it("returns true when password matches hash", async () => {
    mockCompare.mockResolvedValue(true);
    const result = await verifyPassword("mypassword", "$2b$12$hash");
    expect(result).toBe(true);
  });

  it("returns false when password does not match", async () => {
    mockCompare.mockResolvedValue(false);
    const result = await verifyPassword("wrong", "$2b$12$hash");
    expect(result).toBe(false);
  });
});

// ─── signToken ────────────────────────────────────────────────────────────────

describe("signToken", () => {
  it("returns a signed JWT string", async () => {
    mockSign.mockResolvedValue("signed.jwt.token");
    const token = await signToken({ sub: "user-123", email: "a@b.com" });
    expect(token).toBe("signed.jwt.token");
    expect(mockSign).toHaveBeenCalledTimes(1);
  });

  it("throws when JWT_SECRET is not set", async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env["JWT_SECRET"];

    // The error is thrown synchronously inside getJwtSecret() which is called
    // inside signToken, so it surfaces as a rejected promise.
    await expect(signToken({ sub: "id", email: "e@x.com" })).rejects.toThrow(
      "JWT_SECRET environment variable is not set",
    );
  });
});

// ─── verifyToken ──────────────────────────────────────────────────────────────

describe("verifyToken", () => {
  it("returns decoded payload on valid token", async () => {
    mockVerify.mockResolvedValue({
      payload: { sub: "user-456", email: "b@c.com" },
    });
    const payload = await verifyToken("some.jwt.token");
    expect(payload).toEqual({ sub: "user-456", email: "b@c.com" });
  });

  it("throws on invalid token", async () => {
    mockVerify.mockRejectedValue(new Error("invalid signature"));
    await expect(verifyToken("bad.token")).rejects.toThrow("invalid signature");
  });
});
