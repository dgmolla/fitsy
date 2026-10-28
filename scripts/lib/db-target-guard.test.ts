import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertDatabaseWriteAllowed, assertDevDatabase, assertDevSupabase, DEV_PROJECT_REF, PROD_PROJECT_REF } from "./db-target-guard";

const loopback = "127.0.0.1"; // loopback test fixture
const direct = (ref: string) => `postgresql://postgres:synthetic@db.${ref}.supabase.co/postgres`;
const pooled = (ref: string) => `postgresql://postgres.${ref}:synthetic@aws-0-us-west-1.pooler.supabase.com:5432/postgres`;
const options = (ref: string) => `postgresql://postgres:synthetic@aws-0-us-west-1.pooler.supabase.com/postgres?options=reference%3D${ref}`;
const ci = { FITSY_ALLOW_PROD_WRITE: "1", GITHUB_ACTIONS: "true" };

test.each([direct(PROD_PROJECT_REF), pooled(PROD_PROJECT_REF), options(PROD_PROJECT_REF),
  pooled(PROD_PROJECT_REF).replace(`.${PROD_PROJECT_REF}`, `%2E${PROD_PROJECT_REF}`)])("production routing requires all three intentions: %s", async url => {
  for (const [env, args] of [[{}, []], [ci, []], [{ FITSY_ALLOW_PROD_WRITE: "1" }, ["--prod"]],
    [{ GITHUB_ACTIONS: "true" }, ["--prod"]], [{ FITSY_ALLOW_PROD: "1", CI: "true" }, ["--prod"]]] as const) {
    await expect(assertDatabaseWriteAllowed(url, { env, args })).rejects.toThrow(/DB_WRITE_REFUSED/);
  }
  await expect(assertDatabaseWriteAllowed(url, { env: ci, args: ["--prod"] })).rejects.toThrow(/signed.*identity/);
  expect(() => assertDevDatabase(url)).toThrow(/DEV-only/);
});

test("pinned deploy markers alone cannot establish a production identity", async () => {
  const env = { FITSY_ALLOW_PROD_WRITE: "1", VERCEL: "1", VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4", VERCEL_GIT_PROVIDER: "github",
    VERCEL_GIT_REPO_OWNER: "dgmolla", VERCEL_GIT_REPO_SLUG: "fitsy", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_COMMIT_SHA: "a".repeat(40) };
  await expect(assertDatabaseWriteAllowed(direct(PROD_PROJECT_REF), { env, args: ["--prod"] })).rejects.toThrow(/signed.*identity/);
  for (const key of Object.keys(env)) await expect(assertDatabaseWriteAllowed(direct(PROD_PROJECT_REF), {
    env: { ...env, [key]: "" }, args: ["--prod"],
  })).rejects.toThrow(/DB_WRITE_REFUSED/);
});

test.each([direct(DEV_PROJECT_REF), pooled(DEV_PROJECT_REF), options(DEV_PROJECT_REF),
  `postgresql://postgres:synthetic@${loopback}:5432/fitsy_verify`, "postgresql://postgres:synthetic@[::1]/fitsy_verify"])("DEV and loopback stay usable: %s", async url => {
  expect(await assertDatabaseWriteAllowed(url, { env: {}, args: [] })).toBe(url);
  expect(assertDevDatabase(url)).toBe(url);
});

test.each([undefined, "garbage-synthetic-secret", "https://localhost", "postgresql://localhost/postgres?host=db.production",
  "postgresql://postgres:synthetic@db.abcdefghijklmnopqrst.supabase.co/postgres",
  pooled(DEV_PROJECT_REF) + `?options=reference%3D${PROD_PROJECT_REF}`,
  options(DEV_PROJECT_REF) + "&options=reference%3Dother", options(DEV_PROJECT_REF) + "&user=postgres",
  direct(PROD_PROJECT_REF).replace("supabase.co", "supabase.co.attacker.invalid")])("unknown or ambiguous targets fail closed", async url => {
  await expect(assertDatabaseWriteAllowed(url, { env: ci, args: ["--prod"] })).rejects.toThrow(/DB_WRITE_REFUSED/);
  try { await assertDatabaseWriteAllowed(url); } catch (error) { expect(String(error)).not.toContain("synthetic"); }
});

test("a password containing a production ref is not a production route", async () => {
  const url = direct(DEV_PROJECT_REF).replace("synthetic", PROD_PROJECT_REF);
  expect(await assertDatabaseWriteAllowed(url, { env: {}, args: [] })).toBe(url);
});

test("auth mutations are pinned to the DEV API and cannot inherit database overrides", () => {
  expect(assertDevSupabase(`https://${DEV_PROJECT_REF}.supabase.co`)).toBe(`https://${DEV_PROJECT_REF}.supabase.co`);
  for (const url of [`https://${PROD_PROJECT_REF}.supabase.co`, `https://${DEV_PROJECT_REF}.supabase.co.attacker.invalid`,
    `https://${DEV_PROJECT_REF}.supabase.co/?host=prod`, undefined]) expect(() => assertDevSupabase(url)).toThrow(/DB_WRITE_REFUSED/);
});

const root = resolve(__dirname, "../..");
async function cli(file: string, args: string[], url: string, extra: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; output: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, POSTGRES_PRISMA_URL: url, POSTGRES_URL_NON_POOLING: url };
  for (const name of ['GITHUB_ACTIONS', 'VERCEL', 'VERCEL_OIDC_TOKEN',
    'ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN']) delete env[name];
  Object.assign(env, extra);
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, ["--import", require.resolve("tsx"), file, ...args], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("CLI target preflight timed out")); }, 8000);
    child.stdout.on("data", data => output += data); child.stderr.on("data", data => output += data);
    child.on("error", reject); child.on("close", code => { clearTimeout(timer); done({ code, output }); });
  });
}

test("actual backfill CLI refuses forged CI before constructing a database client", async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-write-guard-'));
  const log = join(directory, 'connections');
  const transport = { NODE_OPTIONS: `--require=${join(root, 'scripts/test-fixtures/database-client-recorder.cjs')}`,
    FITSY_TEST_DB_CLIENT_LOG: log };
  try {
    const url = `postgresql://postgres.${PROD_PROJECT_REF}:synthetic@${loopback}:1/postgres`;
    const result = await cli("scripts/backfill-chain-flag.ts", ["--dry-run", "--prod"], url, {
      ...transport, GITHUB_ACTIONS: "true", FITSY_ALLOW_PROD_WRITE: "1",
    });
    expect(result.code).toBe(1); expect(result.output).toContain("DB_WRITE_REFUSED");
    expect(result.output).not.toContain("synthetic@"); expect(existsSync(log)).toBe(false);
    // Positive recorder control: the actual external driver export reaches this boundary.
    await cli('-e', ["const {PrismaClient}=require('@prisma/client'); new PrismaClient();"], url, transport);
    expect(readFileSync(log, 'utf8')).toBe('client constructed\n');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test.each(["--apply", "--apply=true"])("retired landing %s refuses before aliases, files or database access", async arg => {
  const result = await cli("scripts/phase1-land.ts", [arg], "not-a-database-synthetic-secret");
  expect(result.code).toBe(1); expect(result.output).toContain("DEPRECATED");
  expect(result.output).toContain("chainWriteGuard/chainPilotPlan");
  expect(result.output).not.toContain("synthetic-secret");
});
