import { verifyGoogleToken } from "./googleAuth";

// NODE_ENV is 'test' in Jest, so the test-mode path (decode without fetch) is used.

function makeTestToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.fakesig`;
}

describe("verifyGoogleToken (test-mode decode)", () => {
  it("returns claims from a well-formed token", async () => {
    const payload = { sub: "google-uid-1", email: "user@gmail.com", name: "Jane" };
    const claims = await verifyGoogleToken(makeTestToken(payload));
    expect(claims.sub).toBe("google-uid-1");
    expect(claims.email).toBe("user@gmail.com");
    expect(claims.name).toBe("Jane");
  });

  it("returns claims without name when name is absent", async () => {
    const payload = { sub: "google-uid-2", email: "anon@gmail.com" };
    const claims = await verifyGoogleToken(makeTestToken(payload));
    expect(claims.sub).toBe("google-uid-2");
    expect(claims.name).toBeUndefined();
  });

  it("throws when token does not have 3 parts", async () => {
    await expect(verifyGoogleToken("bad.token")).rejects.toThrow(
      "Invalid ID token format",
    );
  });
});
