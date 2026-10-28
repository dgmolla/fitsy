import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEV_PROJECT_REF, PROD_PROJECT_REF } from "../lib/db-target-guard";
import { assertTestDatabase } from "../lib/test-database-guard";

const root = resolve(__dirname, "../..");
const local = "postgresql://fitsy_test:synthetic@localhost:5432/fitsy_verify";
const direct = (ref: string) => `postgresql://postgres:synthetic@db.${ref}.supabase.co/postgres`;
const pooled = (ref: string) => `postgresql://postgres.${ref}:synthetic@aws-0-us-west-1.pooler.supabase.com:5432/postgres`;

const loopback = "127.0.0.1"; // loopback test fixture
test.each([local, local.replace("localhost", loopback), local.replace("localhost", "127.0.0.2"),
  local.replace("localhost", "[::1]"), local.replace("postgresql:", "postgres:"),
  local + "?schema=fixture&connect_timeout=1", local.replace("synthetic", PROD_PROJECT_REF)])(
  "disposable loopback URLs remain usable: %s", url => {
    expect(assertTestDatabase(url)).toBe(url);
  });

test.each([PROD_PROJECT_REF, DEV_PROJECT_REF, "abcdefghijklmnopqrst"].flatMap(ref => [
  direct(ref), pooled(ref), pooled(ref).replace(`.${ref}`, `%2E${ref}`),
  `postgresql://postgres:synthetic@aws-0-us-west-1.pooler.supabase.com/postgres?options=reference%3D${ref}`,
  local.replace("fitsy_test:", `postgres.${ref}:`), local + `?options=reference%3D${ref}`,
]))("remote or project-qualified routes are always refused: %s", url => {
  expect(() => assertTestDatabase(url)).toThrow(/DB_TEST_REFUSED.*disposable loopback/);
});

test.each([undefined, "", "synthetic-invalid-url", "https://localhost/test",
  "postgresql://localhost.attacker.invalid/test", "postgresql://shared.example/test",
  local + "?host=shared.example", local + `?hostaddr=${loopback}`, local + "?options=-hshared.example",
  local + "?schema=fixture&schema=public", local + "#synthetic",
  pooled(DEV_PROJECT_REF) + `?options=reference%3D${PROD_PROJECT_REF}`])(
  "invalid, ambiguous and rerouted URLs fail without exposing credentials", url => {
    expect(() => assertTestDatabase(url)).toThrow("DB_TEST_REFUSED");
    try { assertTestDatabase(url); } catch (error) { expect(String(error)).not.toContain("synthetic"); }
  });

describe.each(["apps/api", "scripts"])("%s real Jest entrypoint", workspace => {
  let directory: string;
  let marker: string;
  let fixture: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "fitsy-test-db-"));
    marker = join(directory, "suite-imported");
    fixture = join(directory, "guard-probe.test.ts");
    symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
    writeFileSync(fixture, `import { test, expect } from '@jest/globals';
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'suite imported');
test('the test body executes', () => expect(2 + 2).toBe(4));
`);
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  function jest(env: NodeJS.ProcessEnv = {}) {
    const environment = { ...process.env };
    // Do not inherit a real datasource or an unrelated parent Jest selection.
    for (const key of ["POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING", "NODE_OPTIONS"]) delete environment[key];
    return spawnSync(process.execPath, [join(root, "node_modules/jest/bin/jest.js"),
      "--config", join(root, workspace, "jest.config.js"), "--runInBand",
      "--roots", directory, "--runTestsByPath", fixture],
    { cwd: root, env: { ...environment, ...env }, encoding: "utf8", timeout: 20_000 });
  }

  test.each([
    { POSTGRES_PRISMA_URL: direct(PROD_PROJECT_REF) },
    { POSTGRES_PRISMA_URL: pooled(DEV_PROJECT_REF) },
    { POSTGRES_PRISMA_URL: local.replace("fitsy_test:", `postgres.${PROD_PROJECT_REF}:`) },
    { POSTGRES_URL_NON_POOLING: pooled(DEV_PROJECT_REF) },
    { POSTGRES_PRISMA_URL: local, POSTGRES_URL_NON_POOLING: direct(PROD_PROJECT_REF) },
    { POSTGRES_PRISMA_URL: local, POSTGRES_URL_NON_POOLING: pooled(DEV_PROJECT_REF) },
  ])("refuses unsafe URLs before importing the suite: %j", env => {
    const result = jest({ ...env, FITSY_ALLOW_PROD_WRITE: "1", FITSY_ALLOW_PROD: "1",
      GITHUB_ACTIONS: "true", NODE_ENV: "test", FITSY_LOCAL_DB: "1" });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DB_TEST_REFUSED");
    expect(result.stderr).toContain(env.POSTGRES_URL_NON_POOLING ? "POSTGRES_URL_NON_POOLING" : "POSTGRES_PRISMA_URL");
    expect(result.stderr).not.toContain("synthetic");
    expect(existsSync(marker)).toBe(false);
  });

  test.each([{}, { POSTGRES_PRISMA_URL: "", POSTGRES_URL_NON_POOLING: "" },
    { POSTGRES_PRISMA_URL: local, POSTGRES_URL_NON_POOLING: local }])(
    "runs the suite with no DB or a disposable local target: %j", env => {
      const result = jest(env);
      expect(result.error).toBeUndefined();
      expect({ status: result.status, output: result.status === 0 ? "" : result.stdout + result.stderr })
        .toEqual({ status: 0, output: "" });
      expect(existsSync(marker)).toBe(true);
      expect(result.stderr).toContain("1 passed");
    });
});
