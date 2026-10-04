import { generateKeyPairSync } from "crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { getDisplayPricing } from "@/lib/pricing";
import { Faq } from "./Sections";

jest.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
jest.mock("@/lib/errorAlert", () => ({ reportServerError: jest.fn() }));
jest.mock("@/app/landing-sections.module.css", () => ({}));
jest.mock("@/components/landing/WaitlistForm", () => ({ WaitlistForm: () => null }));

describe("landing FAQ pricing", () => {
  it("renders safe copy after the exact ASC agreement failure", async () => {
    const previous = [process.env.ASC_KEY_ID, process.env.ASC_ISSUER_ID, process.env.ASC_P8_BASE64];
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    process.env.ASC_KEY_ID = "K";
    process.env.ASC_ISSUER_ID = "I";
    process.env.ASC_P8_BASE64 = Buffer.from(
      privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    ).toString("base64");
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ errors: [{ code: "FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED" }] }),
    } as Response);
    try {
      const html = renderToStaticMarkup(<Faq pricing={await getDisplayPricing()} />);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(html).toContain("See current subscription prices and any available introductory offer in the app");
      expect(html).not.toMatch(/\$7\.99|\$39\.99|3-day free trial/);
    } finally {
      fetchMock.mockRestore();
      for (const [index, key] of ["ASC_KEY_ID", "ASC_ISSUER_ID", "ASC_P8_BASE64"].entries()) {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
      }
    }
  });

  it("does not advertise an unverified price or trial", () => {
    const html = renderToStaticMarkup(<Faq pricing={null} />);
    expect(html).toContain("See current subscription prices and any available introductory offer in the app");
    expect(html).not.toMatch(/\$7\.99|\$39\.99|3-day free trial/);
  });

  it("renders live ASC prices and trial duration", () => {
    const html = renderToStaticMarkup(<Faq pricing={{ monthly: "$8.99", annual: "$49.99", trialDays: 7 }} />);
    expect(html).toContain("7-day free trial, then $8.99 a month or $49.99 a year");
  });
});
