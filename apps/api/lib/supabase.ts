import { createClient } from "@supabase/supabase-js";

function getSupabaseUrl(): string {
  const url = process.env["SUPABASE_URL"];
  if (!url) throw new Error("SUPABASE_URL environment variable is not set");
  return url;
}

/**
 * Admin client using the service role key.
 * Bypasses RLS — only use server-side for privileged operations.
 */
export function getSupabaseAdmin() {
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key)
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY environment variable is not set",
    );
  return createClient(getSupabaseUrl(), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Anon client using the public API key.
 * Use for user-level auth operations (signIn, signUp, signInWithIdToken).
 */
export function getSupabaseClient() {
  const key = process.env["SUPABASE_ANON_KEY"];
  if (!key) throw new Error("SUPABASE_ANON_KEY environment variable is not set");
  return createClient(getSupabaseUrl(), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
