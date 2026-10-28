/** Script mutation boundary. Never include a connection string in an error. */
import { isIP } from "node:net";
export const PROD_PROJECT_REF = "zaxkmjqozvmbifiwbxps";
export const DEV_PROJECT_REF = "kegycybiruksmrzvniha";

type Context = { env?: NodeJS.ProcessEnv; args?: readonly string[] };
export const allowedParameters: ReadonlySet<string> = new Set([
  "schema", "sslmode", "pgbouncer", "connection_limit", "pool_timeout",
  "connect_timeout", "statement_cache_size", "socket_timeout", "application_name", "options",
]);
const refuse = (reason: string): never => { throw new Error(`DB_WRITE_REFUSED: ${reason}`); };

/** Parse routing fields, including Supavisor's encoded username/options routes. */
export function databaseTarget(value: string | undefined): { url: string; ref: string | undefined; local: boolean } {
  if (!value) return refuse("database URL is required; load the DEV environment explicitly");
  let url: URL, username: string;
  try { url = new URL(value); username = decodeURIComponent(url.username); }
  catch { return refuse("invalid database URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) return refuse("expected a PostgreSQL URL");
  const hostRef = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname)?.[1];
  const userRef = /\.([a-z0-9]{20})$/.exec(username)?.[1];
  const options = url.searchParams.getAll("options");
  const optionRef = options.length === 1 ? /^reference=([a-z0-9]{20})$/.exec(options[0]!)?.[1] : undefined;
  const refs = [hostRef, userRef, optionRef].filter((ref): ref is string => !!ref);
  if (new Set(refs).size > 1) return refuse("conflicting database project routes");
  const keys = [...url.searchParams.keys()];
  if (keys.some(key => !allowedParameters.has(key)) || new Set(keys).size !== keys.length ||
      (options.length && !optionRef) || url.hash) return refuse("unsupported database routing parameters");
  const local = ["localhost", "[::1]"].includes(url.hostname) ||
    (isIP(url.hostname) === 4 && url.hostname.split(".")[0] === "127");
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname);
  if (!local && !hostRef && !(pooler && (userRef || optionRef))) return refuse("target must be an identified Supabase project or loopback database");
  return { url: value, ref: refs[0], local };
}

export function assertDatabaseWriteAllowed(value: string | undefined, context: Context = {}): string {
  const target = databaseTarget(value);
  const env = context.env ?? process.env, args = context.args ?? process.argv.slice(2);
  if (target.ref === PROD_PROJECT_REF) {
    const deploy = env["VERCEL"] === "1" && env["VERCEL_ENV"] === "production" &&
      env["VERCEL_PROJECT_ID"] === "prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4" &&
      env["VERCEL_GIT_PROVIDER"] === "github" && env["VERCEL_GIT_REPO_OWNER"] === "dgmolla" &&
      env["VERCEL_GIT_REPO_SLUG"] === "fitsy" && env["VERCEL_GIT_COMMIT_REF"] === "main" &&
      /^[0-9a-f]{40}$/.test(env["VERCEL_GIT_COMMIT_SHA"] ?? "");
    if (env["FITSY_ALLOW_PROD_WRITE"] !== "1" || !args.includes("--prod") ||
        !(env["GITHUB_ACTIONS"] === "true" || deploy)) {
      return refuse("PRODUCTION requires FITSY_ALLOW_PROD_WRITE=1, --prod, and GitHub Actions or the verified production deploy");
    }
  } else if (target.ref !== DEV_PROJECT_REF && !(target.local && !target.ref)) {
    return refuse("project is outside the DEV/PROD allowlist");
  }
  return target.url;
}

/** Fixtures, resets and DEV provisioning cannot opt into production. */
export function assertDevDatabase(value: string | undefined): string {
  const target = databaseTarget(value);
  if (target.ref !== DEV_PROJECT_REF && !(target.local && !target.ref)) return refuse("DEV-only operation; PRODUCTION and unknown projects are forbidden");
  return target.url;
}

export function assertDevSupabase(value: string | undefined): string {
  let url: URL;
  try { url = new URL(value ?? ""); } catch { return refuse("DEV SUPABASE_URL is required"); }
  if (url.origin !== `https://${DEV_PROJECT_REF}.supabase.co` || url.pathname !== "/" ||
      url.username || url.password || url.search || url.hash) return refuse("auth mutations require the DEV Supabase project");
  return value!;
}

// Shell callers supply environment variable names, never credential values in argv.
if (process.argv[1] && /[/\\]db-target-guard\.ts$/.test(process.argv[1])) {
  try {
    const args = process.argv.slice(2), names = args.filter(arg => arg.startsWith("--env=")).map(arg => arg.slice(6));
    if (!names.length || names.some(name => !/^[A-Z][A-Z0-9_]*$/.test(name))) refuse("pass at least one --env=VARIABLE_NAME");
    for (const name of names) (args.includes("--dev-only") ? assertDevDatabase : assertDatabaseWriteAllowed)(process.env[name]);
  } catch (error) { console.error(error instanceof Error ? error.message : "DB_WRITE_REFUSED"); process.exitCode = 1; }
}
