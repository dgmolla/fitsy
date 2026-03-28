// ─── Mock jose before importing (ESM-only package, not compatible with Jest CJS) ──
// In test env, appleAuth skips the real jose paths entirely — this mock just
// satisfies the import so the module loads.
jest.mock("jose", () => ({
  jwtVerify: jest.fn(),
  createRemoteJWKSet: jest.fn(),
}));

import { verifyAppleToken } from "./appleAuth";

// Tests run with NODE_ENV=test, so real JWKS verification is bypassed.
// The test-env path decodes the token payload directly without signature check.

function makeTestToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

describe("verifyAppleToken (test env — no real JWKS)", () => {
  it("returns sub from a valid test token", async () => {
    const token = makeTestToken({ sub: "apple-uid-abc", email: "user@icloud.com" });
    const claims = await verifyAppleToken(token);
    expect(claims.sub).toBe("apple-uid-abc");
  });

  it("returns email when present in token", async () => {
    const token = makeTestToken({ sub: "uid-1", email: "test@example.com" });
    const claims = await verifyAppleToken(token);
    expect(claims.email).toBe("test@example.com");
  });

  it("returns name when present in token", async () => {
    const token = makeTestToken({ sub: "uid-2", name: "Jane Doe" });
    const claims = await verifyAppleToken(token);
    expect(claims.name).toBe("Jane Doe");
  });

  it("email is undefined when absent from token", async () => {
    const token = makeTestToken({ sub: "uid-3" });
    const claims = await verifyAppleToken(token);
    expect(claims.email).toBeUndefined();
  });

  it("name is undefined when absent from token", async () => {
    const token = makeTestToken({ sub: "uid-4" });
    const claims = await verifyAppleToken(token);
    expect(claims.name).toBeUndefined();
  });

  it("throws for a malformed token (not 3 parts)", async () => {
    await expect(verifyAppleToken("not.a.valid.jwt.token")).rejects.toThrow(
      /invalid identity token/i,
    );
  });

  it("throws for a token with invalid base64 payload", async () => {
    await expect(verifyAppleToken("header.!!!.sig")).rejects.toThrow();
  });
});
