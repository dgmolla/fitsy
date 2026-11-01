/** Operator-only provisioning. Never loads env files or management credentials. */
import { randomBytes } from "node:crypto";
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { PrismaClient } from "@prisma/client";
import { AUDIT_ROLE, confirmedProdAuditUrl } from "./prod-audit-target";
import { databaseTarget, PROD_PROJECT_REF } from "../lib/db-target-guard";

const key = "prod_db_readonly_url";
const rollbackProbe = new Error("Rollback successful zero-row write probe");
class ProvisionError extends Error {}

type TerminalInput = Readable & { isTTY?: boolean };
type TerminalOutput = Writable & { isTTY?: boolean };
type Options = {
  args?: string[];
  env?: NodeJS.ProcessEnv;
  input?: TerminalInput;
  output?: TerminalOutput;
  secretsFile?: string;
};

function privateSnapshot(file: string) {
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { content: "", ino: undefined, dev: undefined };
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.()) {
      throw new ProvisionError("Secrets destination must be a regular, singly linked file owned by this user");
    }
    fchmodSync(fd, 0o600);
    return { content: readFileSync(fd, "utf8"), ino: stat.ino, dev: stat.dev };
  } finally { closeSync(fd); }
}

function upsert(original: string, url: string): string {
  let replaced = false;
  const line = `${key}=${JSON.stringify(url)}\n`;
  const content = original.replace(/^[\t ]*(?:export[\t ]+)?prod_db_readonly_url[\t ]*=.*(?:\r?\n|$)/gm, () => {
    if (replaced) return "";
    replaced = true;
    return line;
  });
  return replaced ? content : content + (content && !content.endsWith("\n") ? "\n" : "") + line;
}

async function verifyReadonly(prisma: PrismaClient) {
  await prisma.$transaction(async tx => {
    const defaults = await tx.$queryRawUnsafe<{ default_transaction_read_only: string }[]>("SHOW default_transaction_read_only");
    const [identity] = await tx.$queryRawUnsafe<{ name: string; safe: boolean }[]>(`SELECT current_user AS name,
      NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls) AS safe
      FROM pg_roles WHERE rolname = current_user`);
    if (defaults[0]?.default_transaction_read_only !== "on" || identity?.name !== AUDIT_ROLE || !identity.safe) {
      throw new Error("Unexpected audit role identity or defaults");
    }
    // Read actual application data, but never return rows to the terminal.
    await tx.$queryRawUnsafe('SELECT "id" FROM public."MacroEstimate" LIMIT 1');
  }, { timeout: 30_000 });

  let insertAttempted = false;
  try {
    await prisma.$transaction(async tx => {
      // Test ACL enforcement independently of the user-changeable session default.
      await tx.$executeRawUnsafe("SET TRANSACTION READ WRITE");
      // Zero rows and unconditional rollback also protect data if permissions regress.
      insertAttempted = true;
      await tx.$executeRawUnsafe('INSERT INTO public."MacroEstimate" ("id") SELECT "id" FROM public."MacroEstimate" WHERE false');
      throw rollbackProbe;
    }, { timeout: 30_000 });
  } catch (error) {
    if (insertAttempted && (error as { meta?: { code?: string } }).meta?.code === "42501") return;
    throw new Error("Audit insert was not denied by table permissions");
  }
}

export async function provisionProdReadonlyRole(options: Options = {}): Promise<void> {
  const args = options.args ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  let stage = "preflight";
  let pending: string | undefined;
  let databaseStarted = false;
  let admin: PrismaClient | undefined;
  let audit: PrismaClient | undefined;
  // Consume only this explicit shell-run credential; never fall back to app URLs.
  const supplied = env["PROD_DB_ADMIN_URL"];
  delete env["PROD_DB_ADMIN_URL"];
  try {
    if (args.length !== 1 || args[0] !== "--prod") throw new ProvisionError("Use npm run db:provision-prod-readonly -w scripts -- --prod");
    if (!input.isTTY || !output.isTTY) throw new ProvisionError("PROD provisioning requires an interactive terminal; piped confirmation is refused");
    const target = databaseTarget(supplied);
    if (target.local || target.ref !== PROD_PROJECT_REF) throw new ProvisionError("PROD_DB_ADMIN_URL must target the exact PROD project");
    const terminal = createInterface({ input, output });
    let confirmation: string;
    try {
      confirmation = await terminal.question(`PROD: activate the migrated ${AUDIT_ROLE} login. Type project ref ${PROD_PROJECT_REF}: `);
    } finally { terminal.close(); }
    if (confirmation !== PROD_PROJECT_REF) throw new ProvisionError("PROD confirmation did not match; no database connection was made");
    const url = confirmedProdAuditUrl(target.url, confirmation);

    stage = "private credential preparation";
    const file = options.secretsFile ?? join(homedir(), "Desktop/secrets.env");
    const original = privateSnapshot(file);
    const password = randomBytes(32).toString("hex");
    const readonly = new URL(url);
    readonly.username = readonly.hostname.endsWith(".pooler.supabase.com") ? `${AUDIT_ROLE}.${PROD_PROJECT_REF}` : AUDIT_ROLE;
    readonly.password = password;
    readonly.search = "?sslmode=require&connection_limit=1&connect_timeout=10&pool_timeout=10";
    if (url.searchParams.get("pgbouncer") === "true") readonly.searchParams.set("pgbouncer", "true");
    const candidate = `${file}.prod-readonly-pending`;
    const fd = openSync(candidate, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    pending = candidate;
    try {
      fchmodSync(fd, 0o600);
      writeFileSync(fd, upsert(original.content, readonly.toString()));
      fsyncSync(fd);
    } finally { closeSync(fd); }

    stage = "approved migration and disabled-role verification";
    admin = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    databaseStarted = true;
    await admin.$transaction(async tx => {
      const [migration] = await tx.$queryRawUnsafe<{ applied: boolean }[]>(`SELECT EXISTS (
        SELECT FROM public._prisma_migrations WHERE migration_name = '20261028120000_pipeline_writer_roles'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied`);
      if (!migration?.applied) throw new Error("The approved role migration must complete before credential provisioning");
      // Serialize this command's concurrent activations before inspecting LOGIN.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('${AUDIT_ROLE}_activation'))`);
      const [attributes] = await tx.$queryRawUnsafe<{ safe: boolean }[]>(`SELECT NOT
        (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit OR rolcanlogin)
        AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member = pg_roles.oid)
        AND NOT EXISTS (SELECT FROM pg_class WHERE relowner = pg_roles.oid)
        AND NOT EXISTS (SELECT FROM pg_namespace WHERE nspowner = pg_roles.oid)
        AND NOT EXISTS (SELECT FROM pg_database WHERE datdba = pg_roles.oid) AS safe
        FROM pg_roles WHERE rolname = '${AUDIT_ROLE}'`);
      if (!attributes?.safe) throw new Error("Audit role must be migrated, unprivileged and NOLOGIN; existing logins cannot be rotated");
      stage = "migrated audit login activation";
      // Only credentials change here. The approved migration owns all grants/policies.
      // Password is locally generated hex, never caller-provided SQL.
      await tx.$executeRawUnsafe(`ALTER ROLE ${AUDIT_ROLE} LOGIN PASSWORD '${password}'`);
    }, { timeout: 30_000 });

    stage = "new-login SELECT and denied INSERT verification";
    audit = new PrismaClient({ datasources: { db: { url: readonly.toString() } } });
    await verifyReadonly(audit);
    stage = "atomic credential publication";
    const current = privateSnapshot(file);
    if (current.content !== original.content || current.ino !== original.ino || current.dev !== original.dev) {
      throw new Error("Secrets destination changed concurrently");
    }
    renameSync(pending, file);
    pending = undefined;
    output.write(`PROD ${AUDIT_ROLE} verified: SELECT succeeded; INSERT denied (42501); ${key} saved privately (0600).\n`);
  } catch (error) {
    if (pending && !databaseStarted) { unlinkSync(pending); pending = undefined; }
    if (error instanceof ProvisionError) throw error;
    throw new ProvisionError(`PROD provisioning failed during ${stage}; details withheld.${pending ? " Private unverified .prod-readonly-pending file retained; reconcile role state before retrying." : ""}`);
  } finally {
    // Never allow disconnect/driver errors to disclose credentials or query text.
    await Promise.allSettled([audit?.$disconnect(), admin?.$disconnect()]);
  }
}

if (process.argv[1] && /[/\\]provision-prod-readonly-role\.ts$/.test(process.argv[1])) {
  void provisionProdReadonlyRole().catch(error => {
    console.error(error instanceof ProvisionError ? error.message : "PROD provisioning failed; details withheld");
    process.exitCode = 1;
  });
}
