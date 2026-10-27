import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { assertDatabaseWriteAllowed, assertDevDatabase, assertDevSupabase, DEV_PROJECT_REF, PROD_PROJECT_REF } from "./db-target-guard";

const loopback = "127.0.0.1"; // loopback test fixture
const direct = (ref: string) => `postgresql://postgres:synthetic@db.${ref}.supabase.co/postgres`;
const pooled = (ref: string) => `postgresql://postgres.${ref}:synthetic@aws-0-us-west-1.pooler.supabase.com:5432/postgres`;
const options = (ref: string) => `postgresql://postgres:synthetic@aws-0-us-west-1.pooler.supabase.com/postgres?options=reference%3D${ref}`;
const ci = { FITSY_ALLOW_PROD_WRITE: "1", GITHUB_ACTIONS: "true" };

test.each([direct(PROD_PROJECT_REF), pooled(PROD_PROJECT_REF), options(PROD_PROJECT_REF),
  pooled(PROD_PROJECT_REF).replace(`.${PROD_PROJECT_REF}`, `%2E${PROD_PROJECT_REF}`)])("production routing requires all three intentions: %s", url => {
  for (const [env, args] of [[{}, []], [ci, []], [{ FITSY_ALLOW_PROD_WRITE: "1" }, ["--prod"]],
    [{ GITHUB_ACTIONS: "true" }, ["--prod"]], [{ FITSY_ALLOW_PROD: "1", CI: "true" }, ["--prod"]]] as const) {
    expect(() => assertDatabaseWriteAllowed(url, { env, args })).toThrow(/DB_WRITE_REFUSED/);
  }
  expect(assertDatabaseWriteAllowed(url, { env: ci, args: ["--prod"] })).toBe(url);
  expect(() => assertDevDatabase(url)).toThrow(/DEV-only/);
});

test("the pinned deploy is allowed only with explicit production intent", () => {
  const env = { FITSY_ALLOW_PROD_WRITE: "1", VERCEL: "1", VERCEL_ENV: "production",
    VERCEL_PROJECT_ID: "prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4", VERCEL_GIT_PROVIDER: "github",
    VERCEL_GIT_REPO_OWNER: "dgmolla", VERCEL_GIT_REPO_SLUG: "fitsy", VERCEL_GIT_COMMIT_REF: "main", VERCEL_GIT_COMMIT_SHA: "a".repeat(40) };
  expect(assertDatabaseWriteAllowed(direct(PROD_PROJECT_REF), { env, args: ["--prod"] })).toBe(direct(PROD_PROJECT_REF));
  for (const key of Object.keys(env)) expect(() => assertDatabaseWriteAllowed(direct(PROD_PROJECT_REF), {
    env: { ...env, [key]: "" }, args: ["--prod"],
  })).toThrow(/DB_WRITE_REFUSED/);
});

test.each([direct(DEV_PROJECT_REF), pooled(DEV_PROJECT_REF), options(DEV_PROJECT_REF),
  `postgresql://postgres:synthetic@${loopback}:5432/fitsy_verify`, "postgresql://postgres:synthetic@[::1]/fitsy_verify"])("DEV and loopback stay usable: %s", url => {
  expect(assertDatabaseWriteAllowed(url, { env: {}, args: [] })).toBe(url);
  expect(assertDevDatabase(url)).toBe(url);
});

test.each([undefined, "garbage-synthetic-secret", "https://localhost", "postgresql://localhost/postgres?host=db.production",
  "postgresql://postgres:synthetic@db.abcdefghijklmnopqrst.supabase.co/postgres",
  pooled(DEV_PROJECT_REF) + `?options=reference%3D${PROD_PROJECT_REF}`,
  options(DEV_PROJECT_REF) + "&options=reference%3Dother", options(DEV_PROJECT_REF) + "&user=postgres",
  direct(PROD_PROJECT_REF).replace("supabase.co", "supabase.co.attacker.invalid")])("unknown or ambiguous targets fail closed", url => {
  expect(() => assertDatabaseWriteAllowed(url, { env: ci, args: ["--prod"] })).toThrow(/DB_WRITE_REFUSED/);
  try { assertDatabaseWriteAllowed(url); } catch (error) { expect(String(error)).not.toContain("synthetic"); }
});

test("a password containing a production ref is not a production route", () => {
  const url = direct(DEV_PROJECT_REF).replace("synthetic", PROD_PROJECT_REF);
  expect(assertDatabaseWriteAllowed(url, { env: {}, args: [] })).toBe(url);
});

test("auth mutations are pinned to the DEV API and cannot inherit database overrides", () => {
  expect(assertDevSupabase(`https://${DEV_PROJECT_REF}.supabase.co`)).toBe(`https://${DEV_PROJECT_REF}.supabase.co`);
  for (const url of [`https://${PROD_PROJECT_REF}.supabase.co`, `https://${DEV_PROJECT_REF}.supabase.co.attacker.invalid`,
    `https://${DEV_PROJECT_REF}.supabase.co/?host=prod`, undefined]) expect(() => assertDevSupabase(url)).toThrow(/DB_WRITE_REFUSED/);
});

const root = resolve(__dirname, "../..");
async function cli(file: string, args: string[], url: string): Promise<{ code: number | null; output: string }> {
  const env: NodeJS.ProcessEnv = { ...process.env, POSTGRES_PRISMA_URL: url, POSTGRES_URL_NON_POOLING: url };
  delete env["GITHUB_ACTIONS"]; delete env["VERCEL"];
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, ["--import", require.resolve("tsx"), file, ...args], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("CLI target preflight timed out")); }, 8000);
    child.stdout.on("data", data => output += data); child.stderr.on("data", data => output += data);
    child.on("error", reject); child.on("close", code => { clearTimeout(timer); done({ code, output }); });
  });
}

test("actual backfill CLI refuses the synthetic production route before connecting", async () => {
  let connections = 0;
  const server = createServer(socket => { connections++; socket.destroy(); });
  await new Promise<void>(done => server.listen(0, loopback, done));
  try {
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture port");
    const url = `postgresql://postgres.${PROD_PROJECT_REF}:synthetic@${loopback}:${address.port}/postgres`;
    const result = await cli("scripts/backfill-chain-flag.ts", ["--dry-run"], url);
    expect(result.code).toBe(1); expect(result.output).toContain("DB_WRITE_REFUSED");
    expect(result.output).not.toContain("synthetic@"); expect(connections).toBe(0);
  } finally { await new Promise<void>(done => server.close(() => done())); }
});

test.each(["--apply", "--apply=true"])("retired landing %s refuses before aliases, files or database access", async arg => {
  const result = await cli("scripts/phase1-land.ts", [arg], "not-a-database-synthetic-secret");
  expect(result.code).toBe(1); expect(result.output).toContain("DEPRECATED");
  expect(result.output).toContain("chainWriteGuard/chainPilotPlan");
  expect(result.output).not.toContain("synthetic-secret");
});
