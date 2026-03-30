// ─── Mock jose before importing the service ────────────────────────────────────

const mockVerify = jest.fn();
const mockJWKS = jest.fn().mockReturnValue("mock-jwks");

jest.mock("jose", () => ({
  jwtVerify: mockVerify,
  createRemoteJWKSet: mockJWKS,
}));

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, SUPABASE_URL: "https://test.supabase.co" };
  mockVerify.mockReset();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// Import AFTER env is set up
import { verifyToken } from "./authService";

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
