import { fetchProEntitlement, isRevenueCatConfigured } from "./revenuecatService";

const ENV = process.env;
const realFetch = global.fetch;

function mockFetch(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env = { ...ENV, REVENUECAT_PUBLIC_API_KEY: "appl_test" };
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  process.env = ENV;
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe("fetchProEntitlement", () => {
  it("returns null (unknown) when no key is configured, without calling out", async () => {
    delete process.env["REVENUECAT_PUBLIC_API_KEY"];
    global.fetch = jest.fn() as unknown as typeof fetch;
    expect(isRevenueCatConfigured()).toBe(false);
    expect(await fetchProEntitlement("u1")).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reads an active pro entitlement with plan, expiry and transaction id", async () => {
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    mockFetch(200, {
      subscriber: {
        entitlements: { pro: { expires_date: expires, product_identifier: "com.fitsy.mobile.yearly" } },
        subscriptions: { "com.fitsy.mobile.yearly": { original_transaction_id: "2000001" } },
      },
    });
    const state = await fetchProEntitlement("u1");
    expect(state).toEqual({
      active: true,
      plan: "com.fitsy.mobile.yearly",
      expiresAt: new Date(expires),
      transactionId: "2000001",
      billingIssue: false,
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.revenuecat.com/v1/subscribers/u1");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer appl_test");
  });

  it("reports a lapsed entitlement as inactive (not unknown)", async () => {
    const expires = new Date(Date.now() - 60_000).toISOString();
    mockFetch(200, {
      subscriber: { entitlements: { pro: { expires_date: expires, product_identifier: "p" } } },
    });
    expect(await fetchProEntitlement("u1")).toMatchObject({ active: false, plan: "p" });
  });

  it("reports no entitlement as inactive (not unknown)", async () => {
    mockFetch(200, { subscriber: { entitlements: {}, subscriptions: {} } });
    expect(await fetchProEntitlement("u1")).toEqual({
      active: false,
      plan: null,
      expiresAt: null,
      transactionId: null,
      billingIssue: false,
    });
  });

  it("flags a grace-period billing issue while keeping the entitlement active", async () => {
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    mockFetch(200, {
      subscriber: {
        entitlements: { pro: { expires_date: expires, product_identifier: "p" } },
        subscriptions: { p: { billing_issues_detected_at: "2026-09-01T00:00:00Z" } },
      },
    });
    expect(await fetchProEntitlement("u1")).toMatchObject({ active: true, billingIssue: true });
  });

  it("treats a missing expiry as a non-expiring (active) grant", async () => {
    mockFetch(200, {
      subscriber: { entitlements: { pro: { expires_date: null, product_identifier: "lifetime" } } },
    });
    expect(await fetchProEntitlement("u1")).toMatchObject({ active: true, expiresAt: null });
  });

  it("returns null on a non-2xx response", async () => {
    mockFetch(500, {});
    expect(await fetchProEntitlement("u1")).toBeNull();
  });

  it("returns null on a network error", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;
    expect(await fetchProEntitlement("u1")).toBeNull();
  });

  it("returns null on a malformed body", async () => {
    mockFetch(200, { nope: true });
    expect(await fetchProEntitlement("u1")).toBeNull();
  });
});
