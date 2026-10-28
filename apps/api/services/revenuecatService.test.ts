import { fetchProEntitlement, isRevenueCatConfigured } from "./revenuecatService";

const ENV = process.env;
const realFetch = global.fetch;
let info: jest.SpyInstance;

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
  info = jest.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  process.env = ENV;
  global.fetch = realFetch;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("fetchProEntitlement", () => {
  it('never uses a Test Store key in production', async () => {
    process.env['VERCEL_ENV'] = 'production';
    process.env['REVENUECAT_PUBLIC_API_KEY'] = 'test_fixture';
    global.fetch = jest.fn();
    expect(await fetchProEntitlement('u1')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([true, undefined, false])('production accepts an active platform-store entitlement with is_sandbox=%s', async sandbox => {
    process.env['VERCEL_ENV'] = 'production';
    mockFetch(200, { subscriber: {
      entitlements: { pro: { product_identifier: 'monthly', expires_date: new Date(Date.now() + 60_000).toISOString() } },
      subscriptions: { monthly: { is_sandbox: sandbox } },
    } });
    const state = await fetchProEntitlement('u1');
    expect(state).toMatchObject({ active: true, hadProEntitlement: true, plan: 'monthly' });
    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { authorization: 'Bearer appl_test', 'x-platform': 'ios' },
    }));
    if (sandbox === true) {
      expect(info).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith(JSON.stringify({
        event: 'revenuecat.sandbox_entitlement_accepted', userId: 'u1',
      }));
    } else {
      expect(info).not.toHaveBeenCalled();
    }
  });

  it.each([-60_000, 0])('rejects a production sandbox entitlement expiring %s ms from now without logging acceptance', async offset => {
    process.env['VERCEL_ENV'] = 'production';
    jest.spyOn(Date, 'now').mockReturnValue(Date.now());
    mockFetch(200, { subscriber: {
      entitlements: { pro: { product_identifier: 'monthly', expires_date: new Date(Date.now() + offset).toISOString() } },
      subscriptions: { monthly: { is_sandbox: true } },
    } });
    expect(await fetchProEntitlement('u1')).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  it.each([false, undefined])('retains the inactive state for an expired production entitlement with is_sandbox=%s', async sandbox => {
    process.env['VERCEL_ENV'] = 'production';
    mockFetch(200, { subscriber: {
      entitlements: { pro: { product_identifier: 'monthly', expires_date: new Date(Date.now() - 60_000).toISOString() } },
      subscriptions: { monthly: { is_sandbox: sandbox } },
    } });
    expect(await fetchProEntitlement('u1')).toMatchObject({ active: false, hadProEntitlement: true });
    expect(info).not.toHaveBeenCalled();
  });

  it.each(['preview', 'development'])('does not log sandbox acceptance in %s', async environment => {
    process.env['VERCEL_ENV'] = environment;
    mockFetch(200, { subscriber: {
      entitlements: { pro: { product_identifier: 'monthly', expires_date: null } },
      subscriptions: { monthly: { is_sandbox: true } },
    } });
    expect(await fetchProEntitlement('u1')).toMatchObject({ active: true });
    expect(info).not.toHaveBeenCalled();
  });

  it('logs every production sandbox acceptance, including a non-expiring grant', async () => {
    process.env['VERCEL_ENV'] = 'production';
    mockFetch(200, { subscriber: {
      entitlements: { pro: { product_identifier: 'monthly', expires_date: null } },
      subscriptions: { monthly: { is_sandbox: true } },
    } });
    for (let read = 0; read < 2; read++) {
      expect(await fetchProEntitlement('u1')).toMatchObject({ active: true, expiresAt: null });
    }
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenNthCalledWith(1, JSON.stringify({ event: 'revenuecat.sandbox_entitlement_accepted', userId: 'u1' }));
    expect(info).toHaveBeenNthCalledWith(2, JSON.stringify({ event: 'revenuecat.sandbox_entitlement_accepted', userId: 'u1' }));
  });

  it('does not accept or log a production sandbox entitlement with a malformed expiry', async () => {
    process.env['VERCEL_ENV'] = 'production';
    mockFetch(200, { subscriber: {
      entitlements: { pro: { product_identifier: 'monthly', expires_date: 'not-a-date' } },
      subscriptions: { monthly: { is_sandbox: true } },
    } });
    expect(await fetchProEntitlement('u1')).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

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
      request_date_ms: 1_800_000_000_000,
      subscriber: {
        entitlements: { pro: { expires_date: expires, product_identifier: "com.fitsy.mobile.yearly" } },
        subscriptions: { "com.fitsy.mobile.yearly": { original_transaction_id: "2000001" } },
      },
    });
    const state = await fetchProEntitlement("u1");
    expect(state).toEqual({
      active: true,
      hadProEntitlement: true,
      plan: "com.fitsy.mobile.yearly",
      expiresAt: new Date(expires),
      transactionId: "2000001",
      billingIssue: false,
      requestDate: new Date(1_800_000_000_000),
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.revenuecat.com/v1/subscribers/u1");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer appl_test");
    expect((init.headers as Record<string, string>)["x-is-sandbox"]).toBeUndefined();
  });

  it("uses sandbox routing for a Test Store key and looks up the authenticated UUID", async () => {
    process.env["REVENUECAT_PUBLIC_API_KEY"] = "test_fixture";
    mockFetch(200, { subscriber: { entitlements: { pro: { expires_date: null, product_identifier: "monthly" } } } });
    expect(await fetchProEntitlement("auth/uuid")).toMatchObject({ active: true, hadProEntitlement: true });
    expect(global.fetch).toHaveBeenCalledWith("https://api.revenuecat.com/v1/subscribers/auth%2Fuuid", expect.objectContaining({
      headers: { authorization: "Bearer test_fixture", "x-platform": "ios", "x-is-sandbox": "true" },
    }));
  });

  it("reports a lapsed entitlement as inactive (not unknown)", async () => {
    const expires = new Date(Date.now() - 60_000).toISOString();
    mockFetch(200, {
      subscriber: { entitlements: { pro: { expires_date: expires, product_identifier: "p" } } },
    });
    expect(await fetchProEntitlement("u1")).toMatchObject({ active: false, hadProEntitlement: true, plan: "p" });
  });

  it("reports a null requestDate when the response has no request_date_ms", async () => {
    mockFetch(200, {
      subscriber: { entitlements: { pro: { expires_date: null, product_identifier: "p" } } },
    });
    expect(await fetchProEntitlement("u1")).toMatchObject({ active: true, requestDate: null });
  });

  it("treats a malformed expiry as unknown rather than a lifetime grant", async () => {
    mockFetch(200, { subscriber: { entitlements: { pro: { expires_date: "not-a-date", product_identifier: "p" } } } });
    expect(await fetchProEntitlement("u1")).toBeNull();
  });

  it("reports no entitlement as inactive (not unknown)", async () => {
    mockFetch(200, { subscriber: { entitlements: {}, subscriptions: {} } });
    expect(await fetchProEntitlement("u1")).toEqual({
      active: false,
      hadProEntitlement: false,
      plan: null,
      expiresAt: null,
      transactionId: null,
      billingIssue: false,
      requestDate: null,
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

  it('aborts a subscriber lookup after eight seconds without accepting an entitlement', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
      }),
    ) as typeof fetch;
    const lookup = fetchProEntitlement('u1');
    const init = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
    jest.advanceTimersByTime(7_999);
    expect(init.signal?.aborted).toBe(false);
    jest.advanceTimersByTime(1);
    expect(init.signal?.aborted).toBe(true);
    expect(await lookup).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  it("returns null on a malformed body", async () => {
    mockFetch(200, { nope: true });
    expect(await fetchProEntitlement("u1")).toBeNull();
  });
});
