/** Verify the saved DEV audit credential without printing values or application rows. */
import { PrismaClient } from "@prisma/client";
import { assertDevDatabase, databaseTarget, DEV_PROJECT_REF } from "../lib/db-target-guard";

async function main() {
  const value = assertDevDatabase(process.env["dev_db_readonly_url"]);
  if (databaseTarget(value).ref !== DEV_PROJECT_REF) throw new Error("Audit acceptance requires the exact DEV project");
  const url = new URL(value); url.searchParams.set("connection_limit", "1");
  const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    const defaults = await prisma.$queryRawUnsafe<{ default_transaction_read_only: string }[]>("SHOW default_transaction_read_only");
    const [role] = await prisma.$queryRawUnsafe<{ name: string; safe: boolean }[]>(`SELECT current_user AS name,
      NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls) AS safe
      FROM pg_roles WHERE rolname=current_user`);
    const tables = await prisma.$queryRawUnsafe<{ name: string; rls: boolean; readable: boolean; writable: boolean }[]>(`
      SELECT c.relname AS name,c.relrowsecurity AS rls,has_table_privilege(current_user,c.oid,'SELECT') AS readable,
        (has_table_privilege(current_user,c.oid,'INSERT') OR has_table_privilege(current_user,c.oid,'UPDATE') OR
         has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE') OR
         has_table_privilege(current_user,c.oid,'TRIGGER') OR has_table_privilege(current_user,c.oid,'REFERENCES')) AS writable
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`);
    if (defaults[0]?.default_transaction_read_only !== "on" || role?.name !== "fitsy_audit_readonly" || !role.safe ||
        !tables.length || tables.some(table => !table.readable || table.writable)) throw new Error("Audit role permissions failed acceptance");
    const [counts] = await prisma.$queryRawUnsafe<{ rows: number }[]>("SELECT count(*)::int AS rows FROM public._prisma_migrations");
    const probes: { readonly: boolean; operation: string; sqlstate: string }[] = [];
    if (process.argv.includes("--verify-denials")) {
      // Every probe selects zero rows. Even a broken grant cannot change data.
      const statements = ["INSERT INTO public._review_watch(key) SELECT 'guardrails-noop' WHERE false",
        "UPDATE public._review_watch SET value=value WHERE false", "DELETE FROM public._review_watch WHERE false"];
      for (const readonly of [true, false]) {
        await prisma.$executeRawUnsafe(`SET default_transaction_read_only=${readonly ? "on" : "off"}`);
        for (const sql of statements) {
          let state: string | undefined;
          try { await prisma.$executeRawUnsafe(sql); } catch (error) { state = (error as { meta?: { code?: string } }).meta?.code; }
          if (state !== "25006" && state !== "42501") throw new Error("Audit mutation denial failed acceptance");
          probes.push({ readonly, operation: sql.split(" ")[0]!, sqlstate: state });
        }
      }
    }
    process.stdout.write(JSON.stringify({ target: "DEV", credential: "dev_db_readonly_url", role, readOnlyDefault: true,
      tables, migrationRowsReadable: counts?.rows, probes }) + "\n");
  } finally {
    try { await prisma.$executeRawUnsafe("SET default_transaction_read_only=on"); } finally { await prisma.$disconnect(); }
  }
}
void main().catch(() => { console.error("DEV audit acceptance failed; driver details withheld"); process.exitCode = 1; });
