import { assertNotProd, isProdUrl, prodReadOnlyUrl, PROD_PROJECT_REF } from "./guard";

const PROD = `postgresql://postgres:x@db.${PROD_PROJECT_REF}.supabase.co:5432/postgres`;
const DEV = "postgresql://postgres:x@db.abcdefghijklmnopqrst.supabase.co:5432/postgres";

describe("guard", () => {
  const saved = process.env["FITSY_ALLOW_PROD"];
  afterEach(() => {
    if (saved === undefined) delete process.env["FITSY_ALLOW_PROD"];
    else process.env["FITSY_ALLOW_PROD"] = saved;
  });

  it("detects the prod project ref", () => {
    expect(isProdUrl(PROD)).toBe(true);
    expect(isProdUrl(DEV)).toBe(false);
  });

  it("refuses prod as a mutation target", () => {
    delete process.env["FITSY_ALLOW_PROD"];
    expect(() => assertNotProd(PROD, "X")).toThrow(/PRODUCTION/);
    expect(assertNotProd(DEV, "X")).toBe(DEV);
  });

  it("allows prod only with FITSY_ALLOW_PROD=1", () => {
    process.env["FITSY_ALLOW_PROD"] = "1";
    expect(assertNotProd(PROD, "X")).toBe(PROD);
  });

  it("fails with a fix hint when unset", () => {
    expect(() => assertNotProd(undefined, "POSTGRES_URL_NON_POOLING")).toThrow(/vercel env pull/);
  });

  it("forces prod source connections read-only", () => {
    expect(prodReadOnlyUrl(PROD)).toContain("default_transaction_read_only");
    expect(() => prodReadOnlyUrl(DEV)).toThrow(/prod project/);
  });
});
