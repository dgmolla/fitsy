/**
 * Pipeline Report Script (S-119)
 *
 * Queries Axiom for all events with a given runId, aggregates into
 * coverage/source breakdown/errors/cost/data quality summary.
 *
 * Usage:
 *   npx tsx scripts/pipeline-report.ts --run-id "2026-04-13T10:30:00Z"
 *   npx tsx scripts/pipeline-report.ts --latest
 *   npx tsx scripts/pipeline-report.ts --latest --hex 8729a1c25ffffff
 *
 * Environment:
 *   AXIOM_TOKEN — required
 */

const AXIOM_TOKEN = process.env["AXIOM_TOKEN"] ?? "";
const AXIOM_API_V1 = "https://api.axiom.co/v1";
const DATASET = "fitsy-pipeline";

if (!AXIOM_TOKEN) {
  console.error("Missing AXIOM_TOKEN");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${AXIOM_TOKEN}`,
  "Content-Type": "application/json",
};

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(): { runId: string | null; latest: boolean; hex: string | null } {
  const args = process.argv.slice(2);
  let runId: string | null = null;
  let latest = false;
  let hex: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--run-id" && args[i + 1]) {
      runId = args[i + 1]!;
      i++;
    } else if (args[i] === "--latest") {
      latest = true;
    } else if (args[i] === "--hex" && args[i + 1]) {
      hex = args[i + 1]!;
      i++;
    }
  }

  if (!runId && !latest) {
    console.error("Usage: npx tsx scripts/pipeline-report.ts --run-id <id> [--hex <hexId>]");
    console.error("   or: npx tsx scripts/pipeline-report.ts --latest  [--hex <hexId>]");
    process.exit(1);
  }

  return { runId, latest, hex };
}

// ─── Axiom query helper ─────────────────────────────────────────────────────

interface AplResult {
  tables?: Array<{
    fields?: Array<{ name: string }>;
    columns?: unknown[][];
  }>;
}

async function queryApl(apl: string): Promise<AplResult> {
  const res = await fetch(`${AXIOM_API_V1}/datasets/_apl?format=tabular`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      apl,
      startTime: "2026-01-01T00:00:00Z",
      endTime: "2030-01-01T00:00:00Z",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Axiom query failed (${res.status}): ${text}`);
  }

  return (await res.json()) as AplResult;
}

function extractCount(result: AplResult): number {
  return (result.tables?.[0]?.columns?.[0]?.[0] as number) ?? 0;
}

function extractRows(result: AplResult): Record<string, unknown>[] {
  const table = result.tables?.[0];
  if (!table?.fields || !table?.columns || table.columns.length === 0) return [];

  const colNames = table.fields.map((f) => f.name);
  const colValues = table.columns;
  const rowCount = (colValues[0] as unknown[])?.length ?? 0;

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < rowCount; i++) {
    const row: Record<string, unknown> = {};
    for (let j = 0; j < colNames.length; j++) {
      row[colNames[j]!] = (colValues[j] as unknown[])?.[i];
    }
    rows.push(row);
  }
  return rows;
}

// ─── Report generation ──────────────────────────────────────────────────────

async function findLatestRunId(): Promise<string> {
  const result = await queryApl(
    `['${DATASET}'] | where type == "run" | sort by _time desc | take 1 | project runId`,
  );
  const rows = extractRows(result);
  if (rows.length === 0) throw new Error("No run events found in Axiom");
  return rows[0]!["runId"] as string;
}

async function generateReport(runId: string, hex: string | null): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Pipeline Report — runId: ${runId}`);
  if (hex) console.log(`  Hex filter:          ${hex}`);
  console.log(`${"=".repeat(60)}\n`);

  const hexClause = hex ? ` and hexId == "${hex}"` : "";

  // Coverage
  const coverageResult = await queryApl(
    `['${DATASET}'] | where type == "restaurant" and runId == "${runId}"${hexClause} | summarize total=count(), persisted=countif(status == "ok"), skipped_no_source=countif(status == "skipped_no_source"), skipped_haiku=countif(status == "skipped_haiku_failed"), skipped_validation=countif(status == "skipped_validation_empty"), skipped_regression=countif(status == "skipped_regression"), skipped_db=countif(status == "skipped_db_error"), skipped_incremental=countif(status == "skipped_incremental"), name_mismatch=countif(nameMismatch == true)`,
  );
  const coverage = extractRows(coverageResult)[0] ?? {};
  console.log("  COVERAGE");
  console.log(`    Total restaurants:   ${coverage["total"] ?? 0}`);
  console.log(`    Persisted:           ${coverage["persisted"] ?? 0}`);
  console.log(`    Skipped (no source): ${coverage["skipped_no_source"] ?? 0}`);
  console.log(`    Skipped (Haiku):     ${coverage["skipped_haiku"] ?? 0}`);
  console.log(`    Skipped (validation):${coverage["skipped_validation"] ?? 0}`);
  console.log(`    Skipped (regression):${coverage["skipped_regression"] ?? 0}`);
  console.log(`    Skipped (DB error):  ${coverage["skipped_db"] ?? 0}`);
  console.log(`    Skipped (cache hit): ${coverage["skipped_incremental"] ?? 0}`);

  // Phase-loss breakdown — where does data loss happen?
  const total = Number(coverage["total"] ?? 0);
  const persisted = Number(coverage["persisted"] ?? 0);
  const cacheHit = Number(coverage["skipped_incremental"] ?? 0);
  const discoveryLoss = Number(coverage["skipped_no_source"] ?? 0);
  const extractionLoss = Number(coverage["skipped_validation"] ?? 0);
  const macrosLoss = Number(coverage["skipped_haiku"] ?? 0);
  const regressionLoss = Number(coverage["skipped_regression"] ?? 0);
  const dbLoss = Number(coverage["skipped_db"] ?? 0);
  const processed = total - cacheHit;
  const nameMismatch = Number(coverage["name_mismatch"] ?? 0);

  console.log("\n  PHASE LOSS BREAKDOWN");
  console.log(`    Total:                    ${total}`);
  console.log(`    Cache hits (no re-scrape):${String(cacheHit).padStart(4)}  (not a loss)`);
  console.log(`    Processed:                ${String(processed).padStart(4)}`);
  console.log(`    ─────────────────────────────────`);
  const pct = (n: number) => (processed > 0 ? `${((n / processed) * 100).toFixed(0)}%` : "—");
  console.log(`    Discovery (no URL/all miss):${String(discoveryLoss).padStart(3)}  (${pct(discoveryLoss)})`);
  console.log(`    Extraction (empty items):   ${String(extractionLoss).padStart(3)}  (${pct(extractionLoss)})`);
  console.log(`    Macros (Haiku failed):      ${String(macrosLoss).padStart(3)}  (${pct(macrosLoss)})`);
  console.log(`    Regression guard:           ${String(regressionLoss).padStart(3)}  (${pct(regressionLoss)})`);
  console.log(`    DB error:                   ${String(dbLoss).padStart(3)}  (${pct(dbLoss)})`);
  console.log(`    ─────────────────────────────────`);
  console.log(`    Persisted:                  ${String(persisted).padStart(3)}  (${pct(persisted)})`);
  if (nameMismatch > 0) {
    console.log(`\n    Name mismatches flagged:  ${nameMismatch}  (discovery quality signal — wrong restaurant URL returned)`);
  }

  // Source breakdown
  console.log("\n  SOURCE BREAKDOWN");
  const sourceResult = await queryApl(
    `['${DATASET}'] | where type == "restaurant" and runId == "${runId}"${hexClause} and status == "ok" | summarize count=count() by source`,
  );
  const sources = extractRows(sourceResult);
  for (const row of sources) {
    console.log(`    ${row["source"]}: ${row["count"]}`);
  }
  if (sources.length === 0) console.log("    (no data)");

  // Per-source attempt breakdown (S-133)
  console.log("\n  PER-SOURCE ATTEMPTS (from sourceAttempts)");
  const attemptResult = await queryApl(
    `['${DATASET}'] | where type == "restaurant" and runId == "${runId}"${hexClause} | mv-expand sourceAttempts | extend sa = sourceAttempts | summarize ok=countif(tostring(sa.status) == "ok"), not_found=countif(tostring(sa.status) == "not_found"), errors=countif(tostring(sa.status) == "error"), avg_ms=avg(todouble(sa.durationMs)) by tostring(sa.sourceId)`,
  );
  const attemptRows = extractRows(attemptResult);
  for (const row of attemptRows) {
    const src = row["sa_sourceId"] ?? row["sourceId"] ?? "?";
    const avgMs = typeof row["avg_ms"] === "number" ? Math.round(row["avg_ms"] as number) : "?";
    console.log(`    ${src}: ok=${row["ok"]} not_found=${row["not_found"]} error=${row["errors"]} avg=${avgMs}ms`);
  }
  if (attemptRows.length === 0) console.log("    (no data)");

  // Source misses (legacy — from sourcesFailed array)
  console.log("\n  SOURCE MISS RATES");
  const missResult = await queryApl(
    `['${DATASET}'] | where type == "restaurant" and runId == "${runId}"${hexClause} | mv-expand sourcesFailed | summarize count=count() by tostring(sourcesFailed)`,
  );
  const misses = extractRows(missResult);
  for (const row of misses) {
    console.log(`    ${row["sourcesFailed"]}: ${row["count"]} misses`);
  }
  if (misses.length === 0) console.log("    (no data)");

  // Errors
  console.log("\n  ERRORS");
  const errorResult = await queryApl(
    `['${DATASET}'] | where type == "error" and runId == "${runId}"${hexClause} | summarize count=count() by stage, source`,
  );
  const errors = extractRows(errorResult);
  for (const row of errors) {
    console.log(`    ${row["stage"]}/${row["source"]}: ${row["count"]}`);
  }
  if (errors.length === 0) console.log("    (none)");

  // Name mismatches
  console.log("\n  NAME MISMATCHES");
  const mismatchResult = await queryApl(
    `['${DATASET}'] | where type == "restaurant" and runId == "${runId}"${hexClause} and nameMismatch == true | project name, source`,
  );
  const mismatches = extractRows(mismatchResult);
  for (const row of mismatches) {
    console.log(`    ${row["name"]} (source: ${row["source"]})`);
  }
  if (mismatches.length === 0) console.log("    (none)");

  // Macro mismatches
  console.log("\n  MACRO MATH MISMATCHES (>20% deviation)");
  const macroResult = await queryApl(
    `['${DATASET}'] | where type == "restaurant" and runId == "${runId}"${hexClause} and macroMismatchCount > 0 | summarize total=sum(macroMismatchCount)`,
  );
  const macroCount = extractRows(macroResult)[0];
  console.log(`    Total flagged items: ${macroCount?.["total"] ?? 0}`);

  // Cost
  console.log("\n  COST");
  const costResult = await queryApl(
    `['${DATASET}'] | where type == "cost_checkpoint" and runId == "${runId}"${hexClause} | summarize maxCost=max(cumulativeCost)`,
  );
  const cost = extractRows(costResult)[0];
  console.log(`    Cumulative: $${cost?.["maxCost"] ?? 0}`);

  // Low item count
  console.log("\n  DATA QUALITY");
  const lowItemResult = await queryApl(
    `['${DATASET}'] | where type == "restaurant" and runId == "${runId}"${hexClause} and status == "ok" and itemCount < 10 | summarize count=count()`,
  );
  const lowItem = extractRows(lowItemResult)[0];
  console.log(`    Restaurants with < 10 items: ${lowItem?.["count"] ?? 0}`);

  // Run event (not hex-filtered — single event per run)
  if (!hex) {
    const runResult = await queryApl(
      `['${DATASET}'] | where type == "run" and runId == "${runId}" | project durationTotal, restaurantsDiscovered, restaurantsPersisted, restaurantsFailed`,
    );
    const runRow = extractRows(runResult)[0];
    if (runRow) {
      console.log(`\n  RUN SUMMARY`);
      console.log(`    Duration:   ${runRow["durationTotal"]}`);
      console.log(`    Discovered: ${runRow["restaurantsDiscovered"]}`);
      console.log(`    Persisted:  ${runRow["restaurantsPersisted"]}`);
      console.log(`    Failed:     ${runRow["restaurantsFailed"]}`);
    }
  }

  console.log(`\n${"=".repeat(60)}\n`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { runId, latest, hex } = parseArgs();

  const resolvedRunId = latest ? await findLatestRunId() : runId!;
  await generateReport(resolvedRunId, hex);
}

main().catch((err) => {
  console.error("[pipeline-report] Fatal:", err);
  process.exit(1);
});
