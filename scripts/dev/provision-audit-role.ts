/** DEV-only credential provisioning. No management API or production path. */
import { randomBytes } from "node:crypto";
import { openSync, closeSync, readFileSync, writeFileSync, fsyncSync, renameSync, chmodSync, constants, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertDevDatabase, databaseTarget, DEV_PROJECT_REF } from "../lib/db-target-guard";

const credentialKeys = { fitsy_app: 'dev_app_database_url', pipeline_writer: 'dev_pipeline_database_url', fitsy_audit_readonly: 'dev_db_readonly_url' } as const;
async function main() {
  const args = process.argv.slice(2);
  const role = (args.find(arg => arg.startsWith('--role='))?.slice(7) ?? 'fitsy_audit_readonly') as keyof typeof credentialKeys;
  if (!args.includes('--apply') || args.length !== new Set(args).size || args.length > 2 ||
      args.some(arg => arg !== '--apply' && arg !== `--role=${role}`) || !Object.hasOwn(credentialKeys, role)) {
    throw new Error('Use provision-audit-role.ts --apply [--role=fitsy_app|pipeline_writer|fitsy_audit_readonly] with the DEV environment loaded');
  }
  const credentialKey = credentialKeys[role];
  const url = assertDevDatabase(process.env["POSTGRES_URL_NON_POOLING"]);
  if (databaseTarget(url).ref !== DEV_PROJECT_REF) throw new Error("Audit provisioning requires the exact DEV project");
  const file = join(homedir(), "Desktop/secrets.env");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let original: string;
  try { original = readFileSync(fd, "utf8"); } finally { closeSync(fd); }
  const names = new Set([...original.matchAll(/^\s*(?:export\s+)?([a-zA-Z_][a-zA-Z_0-9]*)\s*=/gm)].map(match => match[1]));
  if (names.has(credentialKey)) throw new Error(`${credentialKey} already exists; verify it rather than rotating a credential implicitly`);
  const password = randomBytes(32).toString("hex");
  const readonly = new URL(url);
  readonly.username = readonly.hostname.endsWith(".pooler.supabase.com") ? `${role}.${DEV_PROJECT_REF}` : role;
  readonly.password = password;
  readonly.search = "";
  readonly.searchParams.set("sslmode", "require");
  const additions = [...(!names.has("dev_db_url") ? [`dev_db_url=${JSON.stringify(url)}`] : []),
    `${credentialKey}=${JSON.stringify(readonly.toString())}`];
  const pending = `${file}.guardrails-pending`;
  const out = openSync(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(out, original + (original.endsWith("\n") ? "" : "\n") + additions.join("\n") + "\n"); fsyncSync(out); }
  finally { closeSync(out); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  let applied = false;
  let stage = "verify-migration";
  try {
    await prisma.$transaction(async tx => {
      const applied = await tx.$queryRawUnsafe<{ applied: boolean }[]>(`SELECT EXISTS (
        SELECT FROM public._prisma_migrations WHERE migration_name = '20261028120000_pipeline_writer_roles'
          AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied`);
      if (!applied[0]?.applied) throw new Error('Apply the database role migration in DEV before provisioning credentials');
      const [attributes] = await tx.$queryRawUnsafe<{ safe: boolean }[]>(`SELECT NOT
        (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)
        AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member = pg_roles.oid) AS safe
        FROM pg_roles WHERE rolname = '${role}'`);
      if (!attributes?.safe) throw new Error('Migrated role has unexpected privileges');
      stage = 'activate-login';
      // Role is allowlisted and password is fresh hex; neither can contain SQL.
      await tx.$executeRawUnsafe(`ALTER ROLE ${role} LOGIN PASSWORD '${password}'`);
    }, { timeout: 30_000 });
    applied = true;
    if (readFileSync(file, "utf8") !== original) throw new Error("Secrets file changed concurrently; recover the private pending file before continuing");
    renameSync(pending, file); chmodSync(file, 0o600);
    process.stdout.write(JSON.stringify({ target: "DEV", role, saved: additions.map(line => line.split("=")[0]) }) + "\n");
  } catch (error) {
    if (!applied) unlinkSync(pending);
    const code = (error as { meta?: { code?: string } }).meta?.code;
    const sqlstate = typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? ` SQLSTATE=${code}` : "";
    throw new Error(applied ? "DEV role activated; private pending credential file retained for recovery" : `DEV audit provisioning failed at ${stage}${sqlstate}; driver details withheld`);
  } finally { await prisma.$disconnect(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "DEV provisioning failed"); process.exitCode = 1; });
