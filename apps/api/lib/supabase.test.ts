// ─── Mock @supabase/supabase-js before importing ─────────────────────────────

const mockCreateClient = jest.fn().mockReturnValue({ auth: {} });

jest.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

import { getSupabaseAdmin, getSupabaseClient } from "./supabase";

const ORIGINAL_ENV = process.env;
const AUTH_URL = "http://localhost:54321"; // loopback test fixture

beforeEach(() => {
  jest.resetModules();
  mockCreateClient.mockClear();
  process.env = {
    ...ORIGINAL_ENV,
    // Exercise CI's DB/Auth binding even without a running local database.
    POSTGRES_PRISMA_URL: "postgresql://fixture:synthetic@localhost:1/fitsy_verify", // loopback test fixture
    SUPABASE_URL: AUTH_URL,
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    SUPABASE_ANON_KEY: "test-anon-key",
  };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

// ─── getSupabaseAdmin ─────────────────────────────────────────────────────────

describe("getSupabaseAdmin", () => {
  it("creates a client with the service role key", () => {
    getSupabaseAdmin();
    expect(mockCreateClient).toHaveBeenCalledWith(
      AUTH_URL,
      "test-service-role-key",
      { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: expect.any(Function) } },
    );
  });

  it("throws when SUPABASE_URL is not set", () => {
    delete process.env["SUPABASE_URL"];
    expect(() => getSupabaseAdmin()).toThrow(
      "SUPABASE_URL environment variable is not set",
    );
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is not set", () => {
    delete process.env["SUPABASE_SERVICE_ROLE_KEY"];
    expect(() => getSupabaseAdmin()).toThrow(
      "SUPABASE_SERVICE_ROLE_KEY environment variable is not set",
    );
  });
});

// ─── getSupabaseClient ────────────────────────────────────────────────────────

describe("getSupabaseClient", () => {
  it("creates a client with the anon key", () => {
    getSupabaseClient();
    expect(mockCreateClient).toHaveBeenCalledWith(
      AUTH_URL,
      "test-anon-key",
      { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: expect.any(Function) } },
    );
  });

  it("throws when SUPABASE_URL is not set", () => {
    delete process.env["SUPABASE_URL"];
    expect(() => getSupabaseClient()).toThrow(
      "SUPABASE_URL environment variable is not set",
    );
  });

  it("throws when SUPABASE_ANON_KEY is not set", () => {
    delete process.env["SUPABASE_ANON_KEY"];
    expect(() => getSupabaseClient()).toThrow(
      "SUPABASE_ANON_KEY environment variable is not set",
    );
  });
});

it.each([getSupabaseAdmin, getSupabaseClient])("rejects foreign Auth before constructing a client (%#)", create => {
  process.env["SUPABASE_URL"] = "https://foreign.supabase.co";
  expect(() => create()).toThrow("DB/Auth project mismatch");
  expect(mockCreateClient).not.toHaveBeenCalled();
});
