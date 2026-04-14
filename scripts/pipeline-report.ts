/**
 * Pipeline Report Script (S-119)
 *
 * Queries Axiom for all events with a given runId, aggregates into
 * coverage/source breakdown/errors/cost/data quality summary.
 *
 * Usage:
 *   npx tsx scripts/pipeline-report.ts --run-id "2026-04-13T10:30:00Z"
 *   npx tsx scripts/pipeline-report.ts --latest
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

function parseArgs(): { runId: string | null; latest: boolean } {
  const args = process.argv.slice(2);
  let runId: string | null = null;
  let latest = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--run-id" && args[i + 1]) {
      runId = args[i + 1]!;
      i++;
    } else if (args[i] === "--latest") {
      latest = true;
    }
  }

  if (!runId && !latest) {
    console.error("Usage: npx tsx scripts/pipeline-report.ts --run-id <id>");
    console.error("   or: npx tsx scripts/pipeline-report.ts --latest");
    process.exit(1);
  }

  return { runId, latest };
}

// ─── Axiom query helper ─────────────────────────────────────────────────────

interface AplResult {
  tables?: Array<{
    columns?: Array<{ name: string; values?: unknown[] }>;
  }>;
}

async function queryApl(apl: string): Promise<AplResult> {
  const res = await fetch(`${AXIOM_API_V1}/datasets/_apl?format=legacy`, {
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
  return (result.tables?.[0]?.columns?.[0]?.values?.[0] as number) ?? 0;
}

function extractRows(result: AplResult): Record<string, unknown>[] {
  const table = result.tables?.[0];
  if (!table?.columns || table.columns.length === 0) return [];

  const colNames = table.columns.map((c) => c.name);
  const colValues = table.columns.map((c) => c.values ?? []);
  const rowCount = colValues[0]?.length ?? 0;

  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < rowCount; i++) {
    const row: Record<string, unknown> = {};
    for (let j = 0; j < colNames.length; j++) {
      row[colNames[j]!] = colValues[j]![i];
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

async function generateReport(runId: string): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Pipeline Report — runId: ${runId}`);
  console.log(`${"=".repeat(60)}\n`);

  // Coverage
  const coverageResult = await queryApl(
    `['${DATASET}'] | where type == "restaurant" and runId == "${runId}" | summarize total=count(), persisted=countif(status == "ok"), skipped_no_source=countif(status == "skipped_no_source"), skipped_haiku=countif(status == "skipped_haiku_failed"), skipped_validation=countif(status == "skipped_validation_empty"), skipped_regression=countif(status == "skipped_regression"), skipped_db=countif(status == "skipped_db_error")`,
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

  // Source breakdown
  console.log("\n  SOURCE BREAKDOWN");
  const sourceResult = await queryApl(
    `['${DATASET}'] | where type == "restaurant" and runId == "${runId}" and status == "ok" | summarize count=count() by source`,
  );
  const sources = extractRows(sourceResult);
  for (const row of sources) {
    console.log(`    ${row["source"]}: ${row["count"]}`);
  }
  if (sources.length === 0) console.log("    (no data)");

  // Source misses
  console.log("\n  SOURCE MISS RATES");
  const missResult = await queryApl(
    `['${DATASET}'] | where type == "restaurant" and runId == "${runId}" | mv-expand sourcesFailed | summarize count=count() by tostring(sourcesFailed)`,
  );
  const misses = extractRows(missResult);
  for (const row of misses) {
    console.log(`    ${row["sourcesFailed"]}: ${row["count"]} misses`);
  }
  if (misses.length === 0) console.log("    (no data)");

  // Errors
  console.log("\n  ERRORS");
  const errorResult = await queryApl(
    `['${DATASET}'] | where type == "error" and runId == "${runId}" | summarize count=count() by stage, source`,
  );
  const errors = extractRows(errorResult);
  for (const row of errors) {
    console.log(`    ${row["stage"]}/${row["source"]}: ${row["count"]}`);
  }
  if (errors.length === 0) console.log("    (none)");

  // Name mismatches
  console.log("\n  NAME MISMATCHES");
  const mismatchResult = await queryApl(
    `['${DATASET}'] | where type == "restaurant" and runId == "${runId}" and nameMismatch == true | project name, source`,
  );
  const mismatches = extractRows(mismatchResult);
  for (const row of mismatches) {
    console.log(`    ${row["name"]} (source: ${row["source"]})`);
  }
  if (mismatches.length === 0) console.log("    (none)");

  // Macro mismatches
  console.log("\n  MACRO MATH MISMATCHES (>20% deviation)");
  const macroResult = await queryApl(
    `['${DATASET}'] | where type == "restaurant" and runId == "${runId}" and macroMismatchCount > 0 | summarize total=sum(macroMismatchCount)`,
  );
  const macroCount = extractRows(macroResult)[0];
  console.log(`    Total flagged items: ${macroCount?.["total"] ?? 0}`);

  // Cost
  console.log("\n  COST");
  const costResult = await queryApl(
    `['${DATASET}'] | where type == "cost_checkpoint" and runId == "${runId}" | summarize maxCost=max(cumulativeCost)`,
  );
  const cost = extractRows(costResult)[0];
  console.log(`    Cumulative: $${cost?.["maxCost"] ?? 0}`);

  // Low item count
  console.log("\n  DATA QUALITY");
  const lowItemResult = await queryApl(
    `['${DATASET}'] | where type == "restaurant" and runId == "${runId}" and status == "ok" and itemCount < 10 | summarize count=count()`,
  );
  const lowItem = extractRows(lowItemResult)[0];
  console.log(`    Restaurants with < 10 items: ${lowItem?.["count"] ?? 0}`);

  // Run event
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

  console.log(`\n${"=".repeat(60)}\n`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { runId, latest } = parseArgs();

  const resolvedRunId = latest ? await findLatestRunId() : runId!;
  await generateReport(resolvedRunId);
}

main().catch((err) => {
  console.error("[pipeline-report] Fatal:", err);
  process.exit(1);
});
