import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { PrismaClient } from "@prisma/client";
import { AUDIT_ROLE } from "./prod-audit-target";
import { DEV_PROJECT_REF, PROD_PROJECT_REF } from "../lib/db-target-guard";
import { provisionProdReadonlyRole } from "./provision-prod-readonly-role";

jest.mock("@prisma/client", () => ({ PrismaClient: jest.fn() }));

const direct = (ref = PROD_PROJECT_REF) => `postgresql://postgres:synthetic-admin@db.${ref}.supabase.co/postgres`;
const pooler = `aws-0-us-west-1.pooler.supabase.com`;
let directory: string;
let file: string;
let output: string;
let input: PassThrough & { isTTY: boolean };
let terminal: PassThrough & { isTTY: boolean };
let admin: ReturnType<typeof database>;
let audit: ReturnType<typeof database>;

function database(readonly: boolean) {
  const events: string[] = [];
  const query = jest.fn(async (sql: string): Promise<unknown> => {
    if (sql.startsWith("SHOW")) return [{ default_transaction_read_only: "on" }];
    if (sql.includes("current_user AS name")) return [{ name: AUDIT_ROLE, safe: true }];
    if (sql.startsWith('SELECT "id"')) return [{ id: "synthetic-private-row" }];
    if (sql.includes('migration_name')) return [{ applied: true }];
    return [{ safe: true }];
  });
  const execute = jest.fn(async (sql: string): Promise<number> => {
    if (readonly && sql.startsWith("INSERT")) throw { meta: { code: "42501" }, message: "synthetic-driver-secret" };
    return 0;
  });
  const transaction = jest.fn(async (body: (tx: unknown) => Promise<unknown>) => {
    events.push("begin");
    try {
      const result = await body({ $queryRawUnsafe: query, $executeRawUnsafe: execute });
      events.push("commit");
      return result;
    } catch (error) { events.push("rollback"); throw error; }
  });
  return { $transaction: transaction, $disconnect: jest.fn(async () => {}), query, execute, events };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "fitsy-prod-audit-test-"));
  file = join(directory, "secrets.env");
  output = "";
  input = Object.assign(new PassThrough(), { isTTY: true });
  terminal = Object.assign(new PassThrough(), { isTTY: true });
  terminal.on("data", chunk => { output += chunk.toString(); });
  admin = database(false);
  audit = database(true);
  (PrismaClient as jest.Mock).mockReset().mockImplementationOnce(() => admin).mockImplementationOnce(() => audit);
});
afterEach(() => {
  input.destroy(); terminal.destroy();
  rmSync(directory, { recursive: true, force: true });
});

async function run({ url = direct(), args = ["--prod"], confirmation = PROD_PROJECT_REF,
  env = { PROD_DB_ADMIN_URL: url } }: { url?: string; args?: string[]; confirmation?: string; env?: NodeJS.ProcessEnv } = {}) {
  const result = provisionProdReadonlyRole({ args, env, input, output: terminal, secretsFile: file });
  input.write(confirmation + "\n");
  await result;
}

test.each([[], ["--apply"], ["--prod", "--yes"], ["--prod", "--prod"]].map(args => ({ args })))("explicit --prod alone is required: $args", async ({ args }) => {
  await expect(run({ args })).rejects.toThrow(/Use npm run/);
  expect(PrismaClient).not.toHaveBeenCalled();
  expect(existsSync(file)).toBe(false);
});

test.each(["wrong-ref", DEV_PROJECT_REF, ` ${PROD_PROJECT_REF}`, `${PROD_PROJECT_REF} `])("exact typed reference is required: %s", async confirmation => {
  await expect(run({ confirmation })).rejects.toThrow(/confirmation did not match/);
  expect(PrismaClient).not.toHaveBeenCalled();
  expect(existsSync(file + ".prod-readonly-pending")).toBe(false);
});

test.each(["input", "output"])("%s must be a terminal even with a matching ref", async side => {
  (side === "input" ? input : terminal).isTTY = false;
  await expect(run()).rejects.toThrow(/interactive terminal/);
  expect(PrismaClient).not.toHaveBeenCalled();
});

test.each([direct(DEV_PROJECT_REF), direct("abcdefghijklmnopqrst"), "postgresql://postgres:synthetic@localhost/postgres",
  direct().replace("supabase.co", "supabase.co.attacker.invalid"),
  direct() + `?options=reference%3D${DEV_PROJECT_REF}`, direct() + "?host=localhost",
  direct().replace('postgres:synthetic-admin', `${AUDIT_ROLE}:synthetic-admin`),
  direct().replace('/postgres', '/other'),
  "synthetic-secret-not-a-url"])("wrong or ambiguous routing is rejected without connecting", async url => {
  await expect(run({ url })).rejects.toThrow(/PROD/);
  expect(PrismaClient).not.toHaveBeenCalled();
  expect(output).not.toContain(url);
});

test("app environment URLs cannot substitute for a shell-scoped admin URL", async () => {
  await expect(run({ env: { POSTGRES_URL_NON_POOLING: direct(), POSTGRES_PRISMA_URL: direct() } })).rejects.toThrow(/preflight/);
  expect(PrismaClient).not.toHaveBeenCalled();
});

test.each([direct(), `postgresql://postgres.${PROD_PROJECT_REF}:synthetic-admin@${pooler}:5432/postgres`,
  `postgresql://postgres%2E${PROD_PROJECT_REF}:synthetic-admin@${pooler}:6543/postgres`,
  `postgresql://postgres.${PROD_PROJECT_REF}:synthetic-admin@${pooler}:6543/postgres?pgbouncer=true`,
  `postgresql://postgres.${PROD_PROJECT_REF}:synthetic-admin@${pooler}:6543/postgres?pgbouncer=false`,
  direct() + "?pgbouncer=true",
  `postgresql://postgres:synthetic-admin@${pooler}/postgres?options=reference%3D${PROD_PROJECT_REF}`])(
  "activates a migrated role, verifies as the generated login and saves only its private URL", async url => {
    const env = { PROD_DB_ADMIN_URL: url };
    await run({ env });
    expect(env.PROD_DB_ADMIN_URL).toBeUndefined();
    expect(admin.events).toEqual(["begin", "commit"]);
    const saved = readFileSync(file, "utf8");
    const readonly = new URL(JSON.parse(saved.slice(saved.indexOf("=") + 1)));
    expect(readonly.username).toBe(readonly.hostname === pooler ? `${AUDIT_ROLE}.${PROD_PROJECT_REF}` : AUDIT_ROLE);
    expect(readonly.password).toMatch(/^[a-f0-9]{64}$/);
    expect(admin.execute.mock.calls.map(([sql]) => sql)).toEqual([
      "SELECT pg_advisory_xact_lock(hashtext('fitsy_audit_readonly_activation'))",
      `ALTER ROLE fitsy_audit_readonly LOGIN PASSWORD '${readonly.password}'`,
    ]);
    expect(readonly.searchParams.get("sslmode")).toBe("require");
    expect(readonly.searchParams.has("options")).toBe(false);
    const compatibility = (readonly.hostname === pooler && readonly.port === "6543") ||
      new URL(url).searchParams.get("pgbouncer") === "true" ? "true" : null;
    expect(readonly.searchParams.get("pgbouncer")).toBe(compatibility);
    const adminUrl = new URL((PrismaClient as jest.Mock).mock.calls[0]?.[0].datasources.db.url);
    expect(adminUrl.searchParams.get("pgbouncer")).toBe(compatibility);
    const auditUrl = (PrismaClient as jest.Mock).mock.calls[1]?.[0].datasources.db.url;
    expect(auditUrl).toBe(readonly.toString());
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(file + ".prod-readonly-pending")).toBe(false);
    expect(audit.query.mock.calls.some(([sql]) => sql === 'SELECT "id" FROM public."MacroEstimate" LIMIT 1')).toBe(true);
    expect(audit.execute.mock.calls.map(([sql]) => sql)).toEqual(["SET TRANSACTION READ WRITE",
      'INSERT INTO public."MacroEstimate" ("id") SELECT "id" FROM public."MacroEstimate" WHERE false']);
    expect(audit.events).toEqual(["begin", "commit", "begin", "rollback"]);
    expect(output).toContain("INSERT denied (42501)");
    for (const secret of [readonly.password, readonly.toString(), "synthetic-admin", "synthetic-private-row"]) expect(output).not.toContain(secret);
    expect(admin.$disconnect).toHaveBeenCalled();
    expect(audit.$disconnect).toHaveBeenCalled();
  });

test("upserts duplicate readonly assignments and preserves unrelated secrets without retaining admin URL", async () => {
  writeFileSync(file, '# private\nprovider="synthetic-provider"\nexport prod_db_readonly_url="old"\ndev_db_readonly_url="synthetic-dev"\nprod_db_readonly_url="duplicate"');
  chmodSync(file, 0o644);
  await run();
  const saved = readFileSync(file, "utf8");
  expect(saved.match(/^prod_db_readonly_url=/gm)).toHaveLength(1);
  expect(saved).toContain('provider="synthetic-provider"\n');
  expect(saved).toContain('dev_db_readonly_url="synthetic-dev"\n');
  expect(saved).not.toContain("synthetic-admin");
  expect(saved).not.toContain('"old"');
  expect(saved).not.toContain('"duplicate"');
  expect(statSync(file).mode & 0o777).toBe(0o600);
});

test("an unexpectedly allowed INSERT always rolls back and cannot publish a credential", async () => {
  audit.execute.mockImplementation(async () => 0);
  writeFileSync(file, 'provider="unchanged"\n');
  await expect(run()).rejects.toThrow(/verification.*pending/);
  expect(audit.events).toEqual(["begin", "commit", "begin", "rollback"]);
  expect(readFileSync(file, "utf8")).toBe('provider="unchanged"\n');
  expect(statSync(file + ".prod-readonly-pending").mode & 0o777).toBe(0o600);
  expect(output).not.toContain("saved privately");
});

test.each(["25006", "23502", "08006"])("only permission denied passes, not SQLSTATE %s", async code => {
  audit.execute.mockImplementation(async (sql: string) => {
    if (sql.startsWith("INSERT")) throw { meta: { code }, message: direct() };
    return 0;
  });
  await expect(run()).rejects.toThrow(/verification/);
  expect(existsSync(file)).toBe(false);
  expect(output).not.toContain("synthetic-admin");
});

test("a permission error before the INSERT cannot masquerade as a successful denial probe", async () => {
  audit.execute.mockRejectedValue({ meta: { code: "42501" } });
  await expect(run()).rejects.toThrow(/verification/);
  expect(existsSync(file)).toBe(false);
});

test.each(["select", "identity", "defaults"])("a failed %s check cannot publish an unverified credential", async failure => {
  const query = audit.query.getMockImplementation()!;
  audit.query.mockImplementation(async (sql: string) => {
    if (failure === "select" && sql.startsWith('SELECT "id"')) throw new Error(direct());
    if (failure === "identity" && sql.includes("current_user AS name")) return [{ name: "postgres", safe: false }];
    if (failure === "defaults" && sql.startsWith("SHOW")) return [{ default_transaction_read_only: "off" }];
    return query(sql);
  });
  await expect(run()).rejects.toThrow(/verification/);
  expect(existsSync(file)).toBe(false);
  expect(audit.$disconnect).toHaveBeenCalled();
});

test("login activation failure preserves recovery bytes and withholds driver SQL and credentials", async () => {
  admin.execute.mockImplementation(async (sql: string) => {
    if (sql.startsWith('ALTER ROLE')) throw { meta: { code: "42710" }, message: direct() };
    return 0;
  });
  await expect(run()).rejects.toThrow(/login activation; details withheld/);
  expect(admin.events).toEqual(["begin", "rollback"]);
  expect(PrismaClient).toHaveBeenCalledTimes(1);
  expect(existsSync(file)).toBe(false);
  expect(statSync(file + ".prod-readonly-pending").mode & 0o777).toBe(0o600);
  expect(admin.$disconnect).toHaveBeenCalled();
  expect(output).not.toContain("synthetic-admin");
});

test.each([false, undefined])("refuses an incomplete or absent role migration (%s) without any mutation", async applied => {
  admin.query.mockResolvedValue(applied === undefined ? [] : [{ applied }]);
  await expect(run()).rejects.toThrow(/migration and disabled-role verification/);
  expect(admin.execute).not.toHaveBeenCalled();
  expect(PrismaClient).toHaveBeenCalledTimes(1);
  expect(existsSync(file)).toBe(false);
  expect(admin.events).toContain("rollback");
});

test.each([false, undefined])("refuses unsafe, already active or missing migrated roles (%s) without rotation", async safe => {
  const query = admin.query.getMockImplementation()!;
  admin.query.mockImplementation(async (sql: string) => sql.includes('FROM pg_roles')
    ? safe === undefined ? [] : [{ safe }] : query(sql));
  await expect(run()).rejects.toThrow(/migration and disabled-role verification/);
  expect(admin.execute.mock.calls.some(([sql]) => /^(ALTER|CREATE|GRANT|REVOKE)\b/.test(sql))).toBe(false);
  expect(PrismaClient).toHaveBeenCalledTimes(1);
  expect(existsSync(file)).toBe(false);
  expect(admin.events).toContain("rollback");
});

test("concurrent edits are preserved with the recovery credential retained privately", async () => {
  writeFileSync(file, "provider=original\n");
  const query = audit.query.getMockImplementation()!;
  audit.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT "id"')) writeFileSync(file, "provider=concurrent\n");
    return query(sql);
  });
  await expect(run()).rejects.toThrow(/publication.*pending/);
  expect(readFileSync(file, "utf8")).toBe("provider=concurrent\n");
  expect(statSync(file + ".prod-readonly-pending").mode & 0o777).toBe(0o600);
});

test.each(["symlink", "pending"])("refuses a %s destination before DB construction", async kind => {
  const other = join(directory, "other.env");
  writeFileSync(other, "provider=unchanged\n");
  if (kind === "symlink") symlinkSync(other, file);
  else writeFileSync(file + ".prod-readonly-pending", "prior-recovery\n");
  await expect(run()).rejects.toThrow(/private credential preparation/);
  expect(PrismaClient).not.toHaveBeenCalled();
  expect(readFileSync(other, "utf8")).toBe("provider=unchanged\n");
  if (kind === "pending") expect(readFileSync(file + ".prod-readonly-pending", "utf8")).toBe("prior-recovery\n");
});

test("real CLI rejects piped confirmation and never echoes the supplied credential", () => {
  const result = spawnSync(process.execPath, ["--import", require.resolve("tsx"),
    "scripts/maintenance/provision-prod-readonly-role.ts", "--prod"], {
    cwd: resolve(__dirname, "../.."), encoding: "utf8", input: PROD_PROJECT_REF + "\n", timeout: 10_000,
    env: { PATH: process.env.PATH, PROD_DB_ADMIN_URL: direct() },
  });
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain("interactive terminal");
  expect(result.stdout + result.stderr).not.toContain("synthetic-admin");
});
