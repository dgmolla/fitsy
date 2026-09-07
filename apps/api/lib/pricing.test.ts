import { generateKeyPairSync } from "crypto";
import {
  fetchPricingFromAsc,
  getDisplayPricing,
  PRICING_FALLBACK,
} from "./pricing";

// The cache wrapper is Next runtime plumbing; run the loader directly.
jest.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
jest.mock("./errorAlert", () => ({ reportServerError: jest.fn() }));
import { reportServerError } from "./errorAlert";

const ENV = ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_P8_BASE64"] as const;
const saved: Record<string, string | undefined> = {};

function primeCreds() {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  process.env["ASC_KEY_ID"] = "K";
  process.env["ASC_ISSUER_ID"] = "I";
  process.env["ASC_P8_BASE64"] = Buffer.from(
    privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  ).toString("base64");
}

type Sub = {
  productId: string;
  /** [customerPrice, startDate | null, preserved] rows, order irrelevant */
  prices: Array<[string, string | null, boolean]>;
  offers?: Array<{
    offerMode: string;
    duration: string;
    startDate?: string;
    endDate?: string | null;
  }>;
};

/** Fake ASC: routes by URL, builds ids itself, only external fetch is mocked. */
function primeAsc(subs: Sub[]) {
  return jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const path = url.replace("https://api.appstoreconnect.apple.com/v1", "");
    let body: unknown;
    if (path.startsWith("/apps/")) body = { data: [{ id: "g1" }] };
    else if (path.startsWith("/subscriptionGroups/"))
      body = {
        data: subs.map((s, i) => ({
          id: `s${i}`,
          attributes: { productId: s.productId },
        })),
      };
    else {
      const idx = Number(/\/subscriptions\/s(\d+)\//.exec(path)?.[1]);
      const sub = subs[idx]!;
      if (path.includes("/prices")) {
        body = {
          data: sub.prices.map(([, startDate, preserved], j) => ({
            id: `row${j}`,
            attributes: { startDate, preserved },
            relationships: {
              subscriptionPricePoint: { data: { id: `pp${idx}-${j}` } },
            },
          })),
          included: sub.prices.map(([price], j) => ({
            id: `pp${idx}-${j}`,
            type: "subscriptionPricePoints",
            attributes: { customerPrice: price },
          })),
        };
      } else if (path.includes("/introductoryOffers")) {
        body = {
          data: (sub.offers ?? []).map((o) => ({
            attributes: { endDate: null, ...o },
          })),
        };
      }
    }
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      json: async () => body,
    } as Response;
  });
}

const TODAY = new Date("2026-09-06T12:00:00Z");
const TRIAL = [
  { offerMode: "FREE_TRIAL", duration: "THREE_DAYS", startDate: "2026-06-09" },
];

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
  jest.restoreAllMocks();
});

describe("fetchPricingFromAsc", () => {
  it("maps the USA price and trial for the monthly and annual products", async () => {
    primeCreds();
    primeAsc([
      {
        productId: "com.fitsy.mobile.monthly",
        prices: [["7.99", null, false]],
        offers: TRIAL,
      },
      {
        productId: "com.fitsy.mobile.yearly",
        prices: [["39.99", null, false]],
        offers: TRIAL,
      },
      {
        productId: "com.fitsy.mobile.yearly_discount",
        prices: [["29.99", null, false]],
      },
    ]);
    await expect(fetchPricingFromAsc(TODAY)).resolves.toEqual({
      monthly: "$7.99",
      annual: "$39.99",
      trialDays: 3,
    });
  });

  it("ignores scheduled and preserved price rows and formats to two decimals", async () => {
    primeCreds();
    primeAsc([
      {
        productId: "com.fitsy.mobile.monthly",
        prices: [
          ["9.99", "2026-10-01", false], // scheduled increase, not yet effective
          ["6.99", null, true], // grandfathered
          ["8", "2026-08-01", false], // current
          ["7.49", "2026-01-01", false], // superseded
        ],
        offers: TRIAL,
      },
      {
        productId: "com.fitsy.mobile.yearly",
        prices: [["44.5", null, false]],
        offers: TRIAL,
      },
    ]);
    const p = await fetchPricingFromAsc(TODAY);
    expect(p.monthly).toBe("$8.00");
    expect(p.annual).toBe("$44.50");
  });

  it("reports no trial when there is no live free-trial offer, and the shorter one if plans differ", async () => {
    primeCreds();
    primeAsc([
      {
        productId: "com.fitsy.mobile.monthly",
        prices: [["7.99", null, false]],
        offers: [],
      },
      {
        productId: "com.fitsy.mobile.yearly",
        prices: [["39.99", null, false]],
        offers: [
          {
            offerMode: "FREE_TRIAL",
            duration: "ONE_WEEK",
            startDate: "2026-01-01",
          },
        ],
      },
    ]);
    await expect(fetchPricingFromAsc(TODAY)).resolves.toMatchObject({
      trialDays: 0,
    });
    primeAsc([
      {
        productId: "com.fitsy.mobile.monthly",
        prices: [["7.99", null, false]],
        offers: TRIAL,
      },
      {
        productId: "com.fitsy.mobile.yearly",
        prices: [["39.99", null, false]],
        offers: [
          {
            offerMode: "FREE_TRIAL",
            duration: "ONE_WEEK",
            startDate: "2026-01-01",
          },
        ],
      },
    ]);
    await expect(fetchPricingFromAsc(TODAY)).resolves.toMatchObject({
      trialDays: 3,
    });
  });

  it("throws when a product is missing so the caller can fall back", async () => {
    primeCreds();
    primeAsc([
      {
        productId: "com.fitsy.mobile.monthly",
        prices: [["7.99", null, false]],
        offers: TRIAL,
      },
    ]);
    await expect(fetchPricingFromAsc(TODAY)).rejects.toThrow(/incomplete/);
  });

  it("mints one token for the whole walk", async () => {
    primeCreds();
    const fetchMock = primeAsc([
      {
        productId: "com.fitsy.mobile.monthly",
        prices: [["7.99", null, false]],
        offers: TRIAL,
      },
      {
        productId: "com.fitsy.mobile.yearly",
        prices: [["39.99", null, false]],
        offers: TRIAL,
      },
    ]);
    await fetchPricingFromAsc(TODAY);
    const tokens = new Set(
      fetchMock.mock.calls.map(
        (c) => (c[1]!.headers as Record<string, string>).Authorization,
      ),
    );
    expect(tokens.size).toBe(1);
  });
});

describe("getDisplayPricing", () => {
  it("returns the decision-record fallback quietly when ASC is not configured", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    await expect(getDisplayPricing()).resolves.toBe(PRICING_FALLBACK);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reportServerError).not.toHaveBeenCalled();
  });

  it("falls back AND reports when ASC is configured but fails", async () => {
    primeCreds();
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({}),
      } as Response);
    await expect(getDisplayPricing()).resolves.toEqual(PRICING_FALLBACK);
    expect(reportServerError).toHaveBeenCalledWith(
      "landing pricing (ASC)",
      expect.any(Error),
    );
  });

  it("uses ASC prices when available", async () => {
    primeCreds();
    primeAsc([
      {
        productId: "com.fitsy.mobile.monthly",
        prices: [["7.99", null, false]],
        offers: TRIAL,
      },
      {
        productId: "com.fitsy.mobile.yearly",
        prices: [["39.99", null, false]],
        offers: TRIAL,
      },
    ]);
    await expect(getDisplayPricing()).resolves.toEqual({
      monthly: "$7.99",
      annual: "$39.99",
      trialDays: 3,
    });
  });
});
