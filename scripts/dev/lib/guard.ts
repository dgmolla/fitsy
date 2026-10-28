/**
 * Environment guard for scripts/dev.
 *
 * Every script under scripts/dev mutates a database. This module makes it
 * structurally impossible to point one at production by accident: the prod
 * Supabase project ref is hardcoded, and any target URL containing it is
 * refused unconditionally, including when legacy override variables are set.
 *
 * Source (read-only) connections to prod are allowed via `prodReadOnlyUrl()`,
 * which appends a session-level read-only flag so a bug cannot write.
 */

import { assertDatabaseRole, assertDevDatabase, databaseTarget, PROD_PROJECT_REF } from "../../lib/db-target-guard";
export { PROD_PROJECT_REF } from "../../lib/db-target-guard";

export function isProdUrl(url: string): boolean {
  try {
    return databaseTarget(url).ref === PROD_PROJECT_REF;
  } catch {
    try { return new URL(url).hostname === `${PROD_PROJECT_REF}.supabase.co`; } catch { return false; }
  }
}

export function assertNotProd(url: string | undefined, label: string): string {
  if (!url) {
    throw new Error(
      `${label} is not set. Run: vercel env pull --environment=preview .env.dev  (then: export $(grep -v '^#' .env.dev | xargs))`,
    );
  }
  return assertDevDatabase(url);
}

/**
 * Prod URL pinned to a single connection so `applyReadOnly` covers every query.
 * (Supabase's "non-pooling" URL is a Supavisor session-mode pooler; a
 * `?options=` startup parameter breaks its tenant lookup, so read-only is set
 * per session instead of at connect time.)
 */
export function prodReadOnlyUrl(url: string | undefined): string {
  if (!url) {
    throw new Error(
      "PROD_DATABASE_URL is not set. Run: vercel env pull --environment=production .env.prod.local " +
        "and export PROD_DATABASE_URL=<fitsy_audit_readonly credential>",
    );
  }
  if (!isProdUrl(url)) {
    throw new Error(`PROD_DATABASE_URL does not look like the prod project (${PROD_PROJECT_REF}).`);
  }
  assertDatabaseRole(url, 'fitsy_audit_readonly');
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}connection_limit=1`;
}

/** Make the (single) session read-only. Call right after constructing the client. */
export async function applyReadOnly(client: { $executeRawUnsafe(q: string): Promise<unknown> }): Promise<void> {
  await client.$executeRawUnsafe("SET default_transaction_read_only = on");
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}
