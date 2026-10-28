import { databaseTarget } from "./db-target-guard";

const refusal = "DB_TEST_REFUSED: database tests require a disposable loopback PostgreSQL database; " +
  "production, shared DEV and other remote databases are forbidden. " +
  "Use the owned database via npm run verify -- --only=test.";

/** Test fixtures cannot inherit the write guard's DEV or production permissions. */
export function assertTestDatabase(value: string | undefined): string {
  let target: ReturnType<typeof databaseTarget>;
  try { target = databaseTarget(value); }
  catch { throw new Error(refusal); }
  if (!target.local || target.ref) throw new Error(refusal);
  return target.url;
}

/** Jest runs this before importing any suite, including direct workspace runs. */
export default function guardTestDatabases(): void {
  for (const name of ["POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"] as const) {
    const value = process.env[name];
    // With no database configured, existing DB suites remain skipped.
    if (value !== undefined && value !== "") {
      try { assertTestDatabase(value); }
      catch { throw new Error(`${name}: ${refusal}`); }
    }
  }
}
