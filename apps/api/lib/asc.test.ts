import { createPublicKey, generateKeyPairSync, verify } from "crypto";
import {
  ascAppId,
  ascConfigured,
  ascGet,
  ascToken,
  DEFAULT_APP_ID,
} from "./asc";

const ENV = [
  "ASC_KEY_ID",
  "ASC_ISSUER_ID",
  "ASC_P8_BASE64",
  "ASC_APP_ID",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function primeCreds() {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env["ASC_KEY_ID"] = "KEY123";
  process.env["ASC_ISSUER_ID"] = "issuer-abc";
  process.env["ASC_P8_BASE64"] = Buffer.from(pem).toString("base64");
  return privateKey;
}

describe("ascConfigured / ascAppId", () => {
  it("is false until all three credentials are present", () => {
    expect(ascConfigured()).toBe(false);
    primeCreds();
    expect(ascConfigured()).toBe(true);
  });

  it("defaults the app id and honours the override", () => {
    expect(ascAppId()).toBe(DEFAULT_APP_ID);
    process.env["ASC_APP_ID"] = "999";
    expect(ascAppId()).toBe("999");
  });
});

describe("ascToken", () => {
  it("throws without credentials", () => {
    expect(() => ascToken()).toThrow(/not configured/);
  });

  it("mints an ES256 JWT that verifies against the key", () => {
    const privateKey = primeCreds();
    const token = ascToken();
    const [h, p, s] = token.split(".");
    const header = JSON.parse(Buffer.from(h!, "base64url").toString());
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(header).toEqual({ alg: "ES256", kid: "KEY123", typ: "JWT" });
    expect(payload.iss).toBe("issuer-abc");
    expect(payload.aud).toBe("appstoreconnect-v1");
    expect(payload.exp - payload.iat).toBe(600);
    const ok = verify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" },
      Buffer.from(s!, "base64url"),
    );
    expect(ok).toBe(true);
  });
});

describe("ascGet", () => {
  it("sends the bearer token and parses JSON", async () => {
    primeCreds();
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(ascGet("/apps/1/subscriptionGroups")).resolves.toEqual({
      data: [],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.appstoreconnect.apple.com/v1/apps/1/subscriptionGroups",
    );
    expect(init.headers.Authorization).toMatch(/^Bearer ey/);
  });

  it("throws on non-2xx", async () => {
    primeCreds();
    global.fetch = jest
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({}),
      }) as unknown as typeof fetch;
    await expect(ascGet("/x")).rejects.toThrow(/ASC 401/);
  });
});
