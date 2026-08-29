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

/** Direct (non-pooled) prod URL with the session forced read-only. */
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
  return `${url}${sep}options=-c%20default_transaction_read_only%3Don`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}
