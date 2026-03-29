// ─── Mock jose before importing the service ────────────────────────────────────

const mockVerify = jest.fn();

jest.mock("jose", () => ({
  jwtVerify: mockVerify,
}));

import { verifyToken } from "./authService";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV, SUPABASE_JWT_SECRET: "test-secret-key" };
  mockVerify.mockReset();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
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

  it("throws when SUPABASE_JWT_SECRET is not set", async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env["SUPABASE_JWT_SECRET"];
    delete process.env["JWT_SECRET"];

    await expect(verifyToken("some.token")).rejects.toThrow(
      "SUPABASE_JWT_SECRET environment variable is not set",
    );
  });
});
