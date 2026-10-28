import { readFileSync } from "node:fs";
import { join } from "node:path";

export const AUDIT_ROLE = "fitsy_audit_readonly";

/** Both provisioners execute the same reviewed grants and RLS policies. */
export function auditRoleStatements(): string[] {
  const sql = readFileSync(join(__dirname, "../dev/sql/audit-role.sql"), "utf8");
  const parts = sql.split("DO $audit$");
  if (parts.length !== 2 || !parts[1]?.trim().endsWith("$audit$;")) {
    throw new Error("Audit role SQL is incomplete");
  }
  // Preserve the entire dollar-quoted block, including its internal semicolons.
  return [...parts[0]!.replace(/^--.*$/gm, "").split(";").filter(part => part.trim()), "DO $audit$" + parts[1]];
}
