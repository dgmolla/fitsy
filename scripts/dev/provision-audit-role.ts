/** DEV-only credential provisioning. No management API or production path. */
import { randomBytes } from "node:crypto";
import { openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, chmodSync, constants, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertDevDatabase, databaseTarget, DEV_PROJECT_REF } from "../lib/db-target-guard";

const role = "fitsy_audit_readonly";
async function main() {
  if (process.argv.slice(2).join(" ") !== "--apply") throw new Error("Use provision-audit-role.ts --apply with the DEV environment loaded");
  const url = assertDevDatabase(process.env["POSTGRES_URL_NON_POOLING"]);
  if (databaseTarget(url).ref !== DEV_PROJECT_REF) throw new Error("Audit provisioning requires the exact DEV project");
  const file = join(homedir(), "Desktop/secrets.env");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let original: string;
  try { original = readFileSync(fd, "utf8"); } finally { closeSync(fd); }
  const names = new Set([...original.matchAll(/^\s*(?:export\s+)?([a-zA-Z_][a-zA-Z_0-9]*)\s*=/gm)].map(match => match[1]));
  if (names.has("dev_db_readonly_url")) throw new Error("dev_db_readonly_url already exists; verify it rather than rotating a credential implicitly");
  const password = randomBytes(32).toString("hex");
  const readonly = new URL(url);
  readonly.username = readonly.hostname.endsWith(".pooler.supabase.com") ? `${role}.${DEV_PROJECT_REF}` : role;
  readonly.password = password;
  readonly.search = "";
  readonly.searchParams.set("sslmode", "require");
  const additions = [...(!names.has("dev_db_url") ? [`dev_db_url=${JSON.stringify(url)}`] : []),
    `dev_db_readonly_url=${JSON.stringify(readonly.toString())}`];
  const pending = `${file}.guardrails-pending`;
  const out = openSync(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(out, original + (original.endsWith("\n") ? "" : "\n") + additions.join("\n") + "\n"); fsyncSync(out); }
  finally { closeSync(out); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  let applied = false;
  let stage = "create-role";
  try {
    await prisma.$transaction(async tx => {
      // password is fresh hex, never caller SQL and never printed or retained in source.
      await tx.$executeRawUnsafe(`CREATE ROLE ${role} LOGIN NOINHERIT PASSWORD '${password}'`);
      const [attributes] = await tx.$queryRawUnsafe<{ safe: boolean }[]>(`SELECT NOT
        (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit) AS safe
        FROM pg_roles WHERE rolname = '${role}'`);
      if (!attributes?.safe) throw new Error("New audit role has unexpected privileges");
      const sql = readFileSync(join(__dirname, "sql/audit-role.sql"), "utf8");
      // Preserve the DO block as one statement, then split ordinary utility statements.
      const [prefix, block] = sql.split("DO $audit$");
      for (const [index, statement] of prefix!.replace(/^--.*$/gm, "").split(";").filter(part => part.trim()).entries()) {
        stage = `grant-statement-${index + 1}`;
        await tx.$executeRawUnsafe(statement);
      }
      if (!block) throw new Error("DEV audit SQL is incomplete");
      stage = "select-policies";
      await tx.$executeRawUnsafe("DO $audit$" + block);
    }, { timeout: 30_000 });
    applied = true;
    if (readFileSync(file, "utf8") !== original) throw new Error("Secrets file changed concurrently; recover the private pending file before continuing");
    renameSync(pending, file); chmodSync(file, 0o600);
    process.stdout.write(JSON.stringify({ target: "DEV", role, saved: additions.map(line => line.split("=")[0]) }) + "\n");
  } catch (error) {
    if (!applied) unlinkSync(pending);
    const code = (error as { meta?: { code?: string } }).meta?.code;
    const sqlstate = typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? ` SQLSTATE=${code}` : "";
    throw new Error(applied ? "DEV role created; private pending credential file retained for recovery" : `DEV audit provisioning failed at ${stage}${sqlstate}; driver details withheld`);
  } finally { await prisma.$disconnect(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "DEV provisioning failed"); process.exitCode = 1; });
