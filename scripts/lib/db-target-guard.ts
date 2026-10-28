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

/** Environment flags express intent; only the provider's signature establishes identity. */
async function assertProductionIdentity(env: NodeJS.ProcessEnv): Promise<void> {
  try {
    const { createRemoteJWKSet, decodeJwt, jwtVerify } = await import("jose");
    if (env["VERCEL"] === "1") {
      const owner = "dawits-projects-74b6e00f", token = env["VERCEL_OIDC_TOKEN"] ?? "";
      const issuer = decodeJwt(token).iss;
      // Decode only to select a fixed trusted endpoint; jwtVerify authenticates it.
      if (issuer !== `https://oidc.vercel.com/${owner}` && issuer !== "https://oidc.vercel.com") throw new Error();
      const { payload } = await jwtVerify(token, createRemoteJWKSet(
        new URL(`${issuer}/.well-known/jwks`), { timeoutDuration: 5000 }), {
        issuer, audience: `https://vercel.com/${owner}`,
        subject: `owner:${owner}:project:fitsy-api:environment:production`,
        algorithms: ["RS256"], requiredClaims: ["exp", "iat", "nbf"], maxTokenAge: "1h",
      });
      if (payload["owner_id"] !== "team_VVc52BrZfx5IT2B1mDI5AuPT" ||
          payload["project_id"] !== "prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4" ||
          payload["environment"] !== "production") throw new Error();
    } else {
      // Never send the request credential to an environment-selected arbitrary host.
      const request = new URL(env["ACTIONS_ID_TOKEN_REQUEST_URL"] ?? "");
      if (env["GITHUB_ACTIONS"] !== "true" || !env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"] ||
          request.protocol !== "https:" || !request.hostname.endsWith(".actions.githubusercontent.com") ||
          request.username || request.password || request.hash || request.port) throw new Error();
      const audience = "https://fitsy.org/database-write";
      request.searchParams.set("audience", audience);
      const response = await fetch(request, { headers: { Authorization: `Bearer ${env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]}` },
        redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error();
      const body = await response.json() as { value?: unknown };
      if (typeof body.value !== "string") throw new Error();
      const { payload } = await jwtVerify(body.value, createRemoteJWKSet(
        new URL("https://token.actions.githubusercontent.com/.well-known/jwks"), { timeoutDuration: 5000 }), {
        issuer: "https://token.actions.githubusercontent.com", audience,
        subject: "repo:dgmolla/fitsy:environment:production-release", algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "nbf"], maxTokenAge: "5m",
      });
      if (payload["repository"] !== "dgmolla/fitsy" || payload["ref"] !== "refs/heads/main" ||
          payload["workflow_ref"] !== "dgmolla/fitsy/.github/workflows/prod-fixture-cleanup.yml@refs/heads/main" ||
          payload["event_name"] !== "workflow_dispatch" || payload["runner_environment"] !== "github-hosted" ||
          !/^[a-f0-9]{40}$/.test(String(payload["sha"])) || payload["workflow_sha"] !== payload["sha"]) throw new Error();
    }
  } catch {
    // Provider diagnostics can include bearer tokens. Keep the failure bounded and private.
    refuse("PRODUCTION requires a valid signed production workload identity (Vercel Git build or protected main cleanup workflow)");
  }
}

export async function assertDatabaseWriteAllowed(value: string | undefined, context: Context = {}): Promise<string> {
  const target = databaseTarget(value);
  const env = context.env ?? process.env, args = context.args ?? process.argv.slice(2);
  if (target.ref === PROD_PROJECT_REF) {
    const deploy = env["VERCEL"] === "1" && env["VERCEL_ENV"] === "production" &&
      env["VERCEL_PROJECT_ID"] === "prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4" &&
      env["VERCEL_GIT_PROVIDER"] === "github" && env["VERCEL_GIT_REPO_OWNER"] === "dgmolla" &&
      env["VERCEL_GIT_REPO_SLUG"] === "fitsy" && env["VERCEL_GIT_COMMIT_REF"] === "main" &&
      /^[0-9a-f]{40}$/.test(env["VERCEL_GIT_COMMIT_SHA"] ?? "");
    if (env["FITSY_ALLOW_PROD_WRITE"] !== "1" || !args.includes("--prod") ||
        !(env["GITHUB_ACTIONS"] === "true" || deploy) || (env["VERCEL"] === "1" && !deploy)) {
      return refuse("PRODUCTION requires FITSY_ALLOW_PROD_WRITE=1, --prod, and a signed trusted workload identity");
    }
    await assertProductionIdentity(env);
  } else if (target.ref !== DEV_PROJECT_REF && !(target.local && !target.ref)) {
    return refuse("project is outside the DEV/PROD allowlist");
  }
  return target.url;
}

/** Credential separation complements PostgreSQL grants; local test owners remain usable. */
export function assertDatabaseRole(value: string, role: 'fitsy_app' | 'pipeline_writer' | 'fitsy_audit_readonly'): string {
  const target = databaseTarget(value);
  const username = decodeURIComponent(new URL(value).username);
  if (!(target.local && !target.ref) && username !== role && username !== `${role}.${target.ref}`) {
    return refuse(`database credential must use ${role}; administrator credentials are migration-only`);
  }
  return value;
}

/** No fallback to runtime or migration credentials, even for a missing pipeline secret. */
export async function assertPipelineDatabase(value = process.env['PIPELINE_DATABASE_URL'], context: Context = {}): Promise<string> {
  return assertDatabaseRole(await assertDatabaseWriteAllowed(value, context), 'pipeline_writer');
}

/** Runtime account writes must use the same project whose Auth sessions we accept. */
export function assertRuntimeDatabase(value: string | undefined, authUrl = process.env["SUPABASE_URL"]): string {
  // Unit-only imports may lack a DB. Pin an invalid datasource so Prisma cannot
  // silently load credentials from another .env; any actual query fails closed.
  if (value === undefined) return 'unconfigured-database://missing-POSTGRES_PRISMA_URL';
  const target = databaseTarget(value);
  if (target.local && !target.ref) {
    if (!authUrl) return target.url;
    let auth: URL;
    try { auth = new URL(authUrl); } catch { return refuse("DB/Auth project mismatch: invalid SUPABASE_URL"); }
    if ((auth.origin === `https://${DEV_PROJECT_REF}.supabase.co` ||
        ((["localhost", "[::1]"].includes(auth.hostname) || (isIP(auth.hostname) === 4 && auth.hostname.split('.')[0] === '127')) &&
          ["http:", "https:"].includes(auth.protocol))) &&
        auth.pathname === "/" && !auth.username && !auth.password && !auth.search && !auth.hash) return target.url;
  } else if ([DEV_PROJECT_REF, PROD_PROJECT_REF].includes(target.ref ?? "")) {
    if (authUrl === `https://${target.ref}.supabase.co` || authUrl === `https://${target.ref}.supabase.co/`) return assertDatabaseRole(target.url, 'fitsy_app');
  }
  return refuse("DB/Auth project mismatch: POSTGRES_PRISMA_URL and SUPABASE_URL must identify the same project (local fixtures may use DEV Auth)");
}

export function assertRuntimeSupabase(value: string | undefined): string {
  if (!value) return refuse('SUPABASE_URL is required');
  assertRuntimeDatabase(process.env['POSTGRES_PRISMA_URL'], value);
  return value;
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
  void (async () => {
    const args = process.argv.slice(2), names = args.filter(arg => arg.startsWith("--env=")).map(arg => arg.slice(6));
    if (!names.length || names.some(name => !/^[A-Z][A-Z0-9_]*$/.test(name))) refuse("pass at least one --env=VARIABLE_NAME");
    for (const name of names) await (args.includes("--dev-only") ? assertDevDatabase : assertDatabaseWriteAllowed)(process.env[name]);
  })().catch(error => { console.error(error instanceof Error ? error.message : "DB_WRITE_REFUSED"); process.exitCode = 1; });
}
