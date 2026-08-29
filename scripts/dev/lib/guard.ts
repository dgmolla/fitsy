/**
 * Environment guard for scripts/dev.
 *
 * Every script under scripts/dev mutates a database. This module makes it
 * structurally impossible to point one at production by accident: the prod
 * Supabase project ref is hardcoded, and any target URL containing it is
 * refused unless FITSY_ALLOW_PROD=1 is set explicitly in the environment.
 *
 * Source (read-only) connections to prod are allowed via `prodReadOnlyUrl()`,
 * which appends a session-level read-only flag so a bug cannot write.
 */

export const PROD_PROJECT_REF = "zaxkmjqozvmbifiwbxps";

export function isProdUrl(url: string): boolean {
  return url.includes(PROD_PROJECT_REF);
}

export function assertNotProd(url: string | undefined, label: string): string {
  if (!url) {
    throw new Error(
      `${label} is not set. Run: vercel env pull --environment=preview .env.dev  (then: export $(grep -v '^#' .env.dev | xargs))`,
    );
  }
  if (isProdUrl(url) && process.env["FITSY_ALLOW_PROD"] !== "1") {
    throw new Error(
      `${label} points at PRODUCTION (${PROD_PROJECT_REF}). Refusing. ` +
        `This script is for the dev environment. If you really mean prod, set FITSY_ALLOW_PROD=1.`,
    );
  }
  return url;
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
        "and export PROD_DATABASE_URL=<POSTGRES_URL_NON_POOLING from that file>",
    );
  }
  if (!isProdUrl(url)) {
    throw new Error(`PROD_DATABASE_URL does not look like the prod project (${PROD_PROJECT_REF}).`);
  }
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
