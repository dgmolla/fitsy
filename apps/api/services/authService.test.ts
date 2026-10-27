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
      payload: { sub: "user-456", email: "b@c.com", role: "authenticated" },
    });
    const payload = await verifyToken("some.jwt.token");
    expect(payload).toEqual({ sub: "user-456", email: "b@c.com" });
  });

  it("throws on invalid token", async () => {
    mockVerify.mockRejectedValue(new Error("invalid signature"));
    await expect(verifyToken("bad.token")).rejects.toThrow("invalid signature");
  });

  it.each([
    { sub: '', email: 'b@c.com', role: 'authenticated' },
    { email: 'b@c.com', role: 'authenticated' },
    { sub: 'user', role: 'authenticated' },
    { sub: 'user', email: '', role: 'authenticated' },
    { sub: 'user', email: 'b@c.com', role: 'service_role' },
    { sub: 'user', email: 'b@c.com', role: 'authenticated', is_anonymous: true },
  ])('rejects non-account claims: %j', async payload => {
    mockVerify.mockResolvedValue({ payload });
    await expect(verifyToken('signed.but.not.a.user')).rejects.toThrow('signed-in Supabase account');
  });

  it('requires issuer, authenticated audience and expiring identified tokens', async () => {
    mockVerify.mockResolvedValue({ payload: { sub: 'user', email: 'b@c.com', role: 'authenticated' } });
    await verifyToken('token');
    expect(mockVerify).toHaveBeenCalledWith('token', expect.anything(), {
      issuer: 'https://test.supabase.co/auth/v1', audience: 'authenticated', requiredClaims: ['sub', 'exp', 'iat'],
    });
  });
});
