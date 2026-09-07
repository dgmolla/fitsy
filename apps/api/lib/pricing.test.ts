import {
  PRICING_FALLBACK,
  fetchPricingFromAsc,
  resolveDisplayPricing,
} from "./pricing";

jest.mock("./asc", () => ({
  ascAppId: () => "123",
  ascConfigured: jest.fn(),
  ascGet: jest.fn(),
}));

import { ascConfigured, ascGet } from "./asc";
const mockedConfigured = ascConfigured as jest.Mock;
const mockedGet = ascGet as jest.Mock;

function primeAsc(prices: Record<string, string>) {
  mockedGet.mockImplementation(async (path: string) => {
    if (path.startsWith("/apps/")) return { data: [{ id: "g1" }] };
    if (path.startsWith("/subscriptionGroups/"))
      return {
        data: Object.keys(prices).map((productId, i) => ({
          id: `s${i}`,
          attributes: { productId },
        })),
      };
    const m = path.match(/^\/subscriptions\/s(\d+)\/prices/);
    const productId = Object.keys(prices)[Number(m?.[1])];
    return {
      included: [
        {
          type: "subscriptionPricePoints",
          attributes: { customerPrice: prices[productId ?? ""] },
        },
      ],
    };
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

describe("fetchPricingFromAsc", () => {
  it("maps the USA price points for the monthly and annual products", async () => {
    primeAsc({
      "com.fitsy.mobile.monthly": "7.99",
      "com.fitsy.mobile.yearly": "39.99",
      "com.fitsy.mobile.yearly_discount": "29.99",
    });
    await expect(fetchPricingFromAsc()).resolves.toEqual({
      monthly: "$7.99",
      annual: "$39.99",
      trialDays: 3,
      source: "app-store-connect",
    });
  });

  it("formats prices to two decimals", async () => {
    primeAsc({
      "com.fitsy.mobile.monthly": "8",
      "com.fitsy.mobile.yearly": "44.5",
    });
    const p = await fetchPricingFromAsc();
    expect(p.monthly).toBe("$8.00");
    expect(p.annual).toBe("$44.50");
  });

  it("throws when a product is missing so the caller can fall back", async () => {
    primeAsc({ "com.fitsy.mobile.monthly": "7.99" });
    await expect(fetchPricingFromAsc()).rejects.toThrow(/incomplete/);
  });
});

describe("resolveDisplayPricing", () => {
  it("returns the decision-record fallback when ASC is not configured", async () => {
    mockedConfigured.mockReturnValue(false);
    await expect(resolveDisplayPricing()).resolves.toBe(PRICING_FALLBACK);
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("falls back on ASC errors instead of throwing", async () => {
    mockedConfigured.mockReturnValue(true);
    mockedGet.mockRejectedValue(new Error("ASC 401"));
    await expect(resolveDisplayPricing()).resolves.toEqual(PRICING_FALLBACK);
  });

  it("uses ASC prices when available", async () => {
    mockedConfigured.mockReturnValue(true);
    primeAsc({
      "com.fitsy.mobile.monthly": "7.99",
      "com.fitsy.mobile.yearly": "39.99",
    });
    const p = await resolveDisplayPricing();
    expect(p.source).toBe("app-store-connect");
  });
});
