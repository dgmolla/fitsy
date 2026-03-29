// ─── Mock @supabase/supabase-js before importing ─────────────────────────────

const mockCreateClient = jest.fn().mockReturnValue({ auth: {} });

jest.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

import { getSupabaseAdmin, getSupabaseClient } from "./supabase";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  mockCreateClient.mockClear();
  process.env = {
    ...ORIGINAL_ENV,
    SUPABASE_URL: "https://test.supabase.co",
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
      "https://test.supabase.co",
      "test-service-role-key",
      { auth: { autoRefreshToken: false, persistSession: false } },
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
      "https://test.supabase.co",
      "test-anon-key",
      { auth: { autoRefreshToken: false, persistSession: false } },
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
