import { generateKeyPairSync } from "crypto";
import { getDisplayPricing } from "./pricing";

jest.mock("next/cache", () => {
  const entries = new Map<string, { until: number; value: Promise<unknown> }>();
  let now = 0;
  return {
    unstable_cache: <T>(fn: () => Promise<T>, keys: string[], options: { revalidate: number }) =>
      () => {
        const key = keys.join(":");
        const entry = entries.get(key);
        if (entry && entry.until > now) return entry.value as Promise<T>;
        const value = fn().catch((err: unknown) => {
          entries.delete(key);
          throw err;
        });
        entries.set(key, { until: now + options.revalidate * 1000, value });
        return value;
      },
    reset: () => { entries.clear(); now = 0; },
    advance: (ms: number) => { now += ms; },
  };
});
jest.mock("./errorAlert", () => ({ reportServerError: jest.fn() }));
import { reportServerError } from "./errorAlert";

const keys = ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_P8_BASE64"] as const;
const previous: Record<string, string | undefined> = {};
const cache = () => jest.requireMock("next/cache") as { reset: () => void; advance: (ms: number) => void };

function primeCreds() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  process.env.ASC_KEY_ID = "K";
  process.env.ASC_ISSUER_ID = "I";
  process.env.ASC_P8_BASE64 = Buffer.from(
    privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  ).toString("base64");
}

const errorResponse = (status: number, code: string) => ({
  ok: false,
  status,
  json: async () => ({ errors: [{ code }] }),
}) as Response;

function liveAscResponse(url: string): Response {
  const path = url.replace("https://api.appstoreconnect.apple.com/v1", "");
  let data: unknown;
  if (path.startsWith("/apps/")) data = { data: [{ id: "g1" }] };
  else if (path.startsWith("/subscriptionGroups/")) data = {
    data: [
      { id: "monthly", attributes: { productId: "com.fitsy.mobile.monthly" } },
      { id: "yearly", attributes: { productId: "com.fitsy.mobile.yearly" } },
    ],
  };
  else if (path.endsWith("/introductoryOffers?filter[territory]=USA")) data = {
    data: [{ attributes: { offerMode: "FREE_TRIAL", duration: "ONE_WEEK" } }],
  };
  else if (path.includes("/prices?")) data = {
    data: [{ relationships: { subscriptionPricePoint: { data: { id: "price" } } } }],
    included: [{ id: "price", attributes: { customerPrice: path.includes("/monthly/") ? "8.99" : "49.99" } }],
  };
  return { ok: true, status: 200, json: async () => data } as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  cache().reset();
  for (const key of keys) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  jest.restoreAllMocks();
});

describe("getDisplayPricing", () => {
  it("omits unverified terms quietly when ASC is not configured", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    await expect(getDisplayPricing()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reportServerError).not.toHaveBeenCalled();
  });

  it("bounds repeated agreement failures across requests and retries after six hours", async () => {
    primeCreds();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      errorResponse(403, "FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED"),
    );
    await expect(getDisplayPricing()).resolves.toBeNull();
    await expect(getDisplayPricing()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(reportServerError).toHaveBeenCalledTimes(1);
    expect(reportServerError).toHaveBeenCalledWith(
      "landing pricing (ASC)",
      expect.objectContaining({ message: expect.stringContaining("FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED") }),
    );
    cache().advance(6 * 60 * 60 * 1000);
    await expect(getDisplayPricing()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports a changed failure, recovers, and retains the 24-hour success cache", async () => {
    primeCreds();
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(
      errorResponse(403, "FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED"),
    );
    await expect(getDisplayPricing()).resolves.toBeNull();
    cache().advance(6 * 60 * 60 * 1000);
    fetchMock.mockResolvedValue(errorResponse(500, "INTERNAL_ERROR"));
    await expect(getDisplayPricing()).resolves.toBeNull();
    expect(reportServerError).toHaveBeenCalledTimes(2);
    expect(reportServerError).toHaveBeenLastCalledWith(
      "landing pricing (ASC)",
      expect.objectContaining({ message: expect.stringContaining("ASC 500 INTERNAL_ERROR") }),
    );
    cache().advance(6 * 60 * 60 * 1000);
    fetchMock.mockImplementation(async (input) => liveAscResponse(String(input)));
    await expect(getDisplayPricing()).resolves.toEqual({
      monthly: "$8.99", annual: "$49.99", trialDays: 7,
    });
    const callsAfterRecovery = fetchMock.mock.calls.length;
    cache().advance(6 * 60 * 60 * 1000);
    await expect(getDisplayPricing()).resolves.toMatchObject({ monthly: "$8.99" });
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterRecovery);
  });
});
