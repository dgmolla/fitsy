/**
 * Axiom Setup & Test Script
 *
 * Single dataset (fitsy-pipeline) with type field to distinguish events.
 * Free tier limits us to 2 writable datasets — one is used by Vercel.
 *
 * Event types:
 *   type: "run"        — one per pipeline run (full report)
 *   type: "restaurant"  — one per restaurant processed
 *   type: "error"       — emitted immediately on failure
 *
 * Run: AXIOM_TOKEN=... SLACK_WEBHOOK_URL=... npx tsx scripts/axiom-setup.ts
 */

const AXIOM_TOKEN = process.env["AXIOM_TOKEN"] ?? "";
const SLACK_WEBHOOK_URL = process.env["SLACK_WEBHOOK_URL"] ?? "";
const AXIOM_API_V1 = "https://api.axiom.co/v1";
const AXIOM_API_V2 = "https://api.axiom.co/v2";
const DATASET = "fitsy-pipeline";

if (!AXIOM_TOKEN) {
  console.error("Missing AXIOM_TOKEN");
  process.exit(1);
}
if (!SLACK_WEBHOOK_URL) {
  console.error("Missing SLACK_WEBHOOK_URL");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${AXIOM_TOKEN}`,
  "Content-Type": "application/json",
};

function log(msg: string) {
  console.log(`[axiom-setup] ${msg}`);
}

async function axiomRequest(
  method: string,
  path: string,
  body?: unknown,
  apiVersion: "v1" | "v2" = "v2",
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const base = apiVersion === "v1" ? AXIOM_API_V1 : AXIOM_API_V2;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

// ── Send dummy events ───────────────────────────────────────────────────────

async function sendDummyEvents() {
  log("Sending dummy events to fitsy-pipeline dataset...\n");

  const now = new Date().toISOString();
  const runId = "test-2026-04-13T19:00:00Z";

  const events = [
    // Run report
    {
      _time: now,
      type: "run",
      runId,
      duration: { total: "4h 12m" },
      coverage: {
        hexesTotal: 100,
        hexesCompleted: 100,
        hexesSkipped: 0,
        restaurantsDiscovered: 25000,
        restaurantsPersisted: 24200,
        restaurantsSkipped: 0,
        restaurantsFailed: 800,
        itemsTotal: 312000,
      },
      sourceBreakdown: {
        byRestaurant: { fatsecret: 5000, ubereats: 12000, yelp: 4000, brave_website: 2500, name_only: 700 },
      },
      dataQuality: {
        lowItemCount: { total: 45 },
        missingPrices: { total: 8200, bySource: { fatsecret: 6000, ubereats: 500, yelp: 1200, brave_website: 500 } },
        nonFoodRejected: { total: 120 },
        macroMismatch: { total: 35 },
      },
      cost: {
        googlePlaces: { calls: 300, cost: 1.5 },
        braveSearch: { queries: 17500, cost: 78 },
        firecrawl: { scrapes: 1500, cost: 4.5 },
        haiku: { calls: 10500, inputTokens: 8400000, outputTokens: 4200000, cost: 63 },
        total: 147,
      },
    },

    // Restaurant events
    { _time: now, type: "restaurant", runId, hexId: "hex_001", name: "Sqirl", placeId: "ChIJ_test_001", source: "ubereats", itemCount: 35, durationMs: 4200 },
    { _time: now, type: "restaurant", runId, hexId: "hex_001", name: "Pine & Crane", placeId: "ChIJ_test_002", source: "ubereats", itemCount: 28, durationMs: 3800 },
    { _time: now, type: "restaurant", runId, hexId: "hex_001", name: "Chick-fil-A", placeId: "ChIJ_test_003", source: "fatsecret", itemCount: 85, durationMs: 1200 },
    { _time: now, type: "restaurant", runId, hexId: "hex_002", name: "Guisados", placeId: "ChIJ_test_004", source: "ubereats", itemCount: 22, durationMs: 5100 },
    { _time: now, type: "restaurant", runId, hexId: "hex_002", name: "Masa of Echo Park", placeId: "ChIJ_test_005", source: "yelp", itemCount: 15, durationMs: 7800 },

    // Error events
    { _time: now, type: "error", runId, hexId: "hex_050", restaurant: "Guisados", placeId: "ChIJ_test_004", stage: "menu_fetch", source: "ubereats", error: "HTTP 403 — rate limited", retryable: true, retriesAttempted: 2 },
    { _time: now, type: "error", runId, hexId: "hex_050", restaurant: "Masa of Echo Park", placeId: "ChIJ_test_005", stage: "macro_estimation", source: "haiku", error: "timeout after 30s", retryable: true, retriesAttempted: 2 },
    { _time: now, type: "error", runId, hexId: "hex_051", restaurant: "Bad Restaurant Data", placeId: "ChIJ_test_006", stage: "persistence", source: "db", error: "unique constraint violation on MenuItem(restaurantId, name)", retryable: false, retriesAttempted: 0 },
  ];

  const res = await axiomRequest("POST", `/datasets/${DATASET}/ingest`, events, "v1");
  if (res.ok) {
    log(`  Sent ${events.length} events (1 run + 5 restaurants + 3 errors)`);
    log(`  Response: ${JSON.stringify(res.data)}`);
  } else {
    log(`  Failed (${res.status}): ${JSON.stringify(res.data)}`);
  }
}

// ── Create Slack notifier + monitors ────────────────────────────────────────

async function setupMonitors() {
  log("\nSetting up notifier + monitors...\n");

  // Create notifier
  const existingNotifiers = await axiomRequest("GET", "/notifiers");
  let notifierId: string | null = null;

  if (existingNotifiers.ok && Array.isArray(existingNotifiers.data)) {
    const found = (existingNotifiers.data as Array<{ id: string; name: string }>).find(
      (n) => n.name === "fitsy-pipeline-slack",
    );
    if (found) {
      notifierId = found.id;
      log(`  Notifier already exists: ${notifierId}`);
    }
  }

  if (!notifierId) {
    const res = await axiomRequest("POST", "/notifiers", {
      name: "fitsy-pipeline-slack",
      properties: {
        slack: { slackUrl: SLACK_WEBHOOK_URL },
      },
    });
    if (res.ok && res.data && typeof res.data === "object" && "id" in res.data) {
      notifierId = (res.data as { id: string }).id;
      log(`  Created notifier: ${notifierId}`);
    } else {
      log(`  Failed to create notifier (${res.status}): ${JSON.stringify(res.data)}`);
      log(`  Note: API token may need 'create notifiers' permission — check Settings → API Tokens`);
      log(`  Skipping monitors. You can create them manually in Axiom UI.\n`);
      logManualMonitorInstructions();
      return;
    }
  }

  // Create monitors (S-129: Run failed, Cost overrun, Zero output use MatchEvent; cost_checkpoint added)
  const monitors = [
    {
      name: "Pipeline: Error spike",
      description: "More than 50 errors in 5 minutes — likely rate limiting or API outage",
      aplQuery: `['${DATASET}'] | where type == "error"`,
      intervalMinutes: 5,
      operator: "Above",
      threshold: 50,
      rangeMinutes: 5,
    },
    {
      name: "Pipeline: Run failed",
      description: "Pipeline run had more failures than successes",
      aplQuery: `['${DATASET}'] | where type == "run" and restaurantsFailed > restaurantsPersisted`,
      intervalMinutes: 60,
      operator: "MatchEvent",
      threshold: 1,
      rangeMinutes: 300,
    },
    {
      name: "Pipeline: Cost overrun",
      description: "Pipeline run exceeded $200 budget",
      aplQuery: `['${DATASET}'] | where type == "run" and costTotal > 200`,
      intervalMinutes: 60,
      operator: "MatchEvent",
      threshold: 1,
      rangeMinutes: 300,
    },
    {
      name: "Pipeline: Zero output",
      description: "Pipeline run persisted zero restaurants",
      aplQuery: `['${DATASET}'] | where type == "run" and restaurantsPersisted == 0`,
      intervalMinutes: 60,
      operator: "MatchEvent",
      threshold: 1,
      rangeMinutes: 300,
    },
    {
      name: "Pipeline: Cost checkpoint spike",
      description: "Single hex exceeded $5 cumulative cost — investigate before it scales",
      aplQuery: `['${DATASET}'] | where type == "cost_checkpoint" and cumulativeCost > 5`,
      intervalMinutes: 15,
      operator: "MatchEvent",
      threshold: 1,
      rangeMinutes: 60,
    },
  ];

  const existing = await axiomRequest("GET", "/monitors");
  const existingNames = new Set<string>();
  if (existing.ok && Array.isArray(existing.data)) {
    for (const m of existing.data as Array<{ name: string }>) {
      existingNames.add(m.name);
    }
  }

  for (const m of monitors) {
    if (existingNames.has(m.name)) {
      log(`  Monitor already exists: ${m.name}`);
      continue;
    }

    const res = await axiomRequest("POST", "/monitors", {
      ...m,
      notifierIds: [notifierId],
      disabledUntil: "0001-01-01T00:00:00Z",
    });

    if (res.ok) {
      log(`  Created monitor: ${m.name}`);
    } else {
      log(`  Failed: ${m.name} (${res.status}) — ${JSON.stringify(res.data)}`);
    }
  }
}

function logManualMonitorInstructions() {
  log("  Manual monitor setup (Axiom UI → Monitors → New Monitor):\n");
  log("  1. Error spike:");
  log(`     Query: ['${DATASET}'] | where type == "error"`);
  log("     Trigger: count > 50 in 5 min\n");
  log("  2. Run failed (MatchEvent):");
  log(`     Query: ['${DATASET}'] | where type == "run" and restaurantsFailed > restaurantsPersisted`);
  log("     Trigger: MatchEvent, threshold 1 in 5 hours\n");
  log("  3. Cost overrun (MatchEvent):");
  log(`     Query: ['${DATASET}'] | where type == "run" and costTotal > 200`);
  log("     Trigger: MatchEvent, threshold 1 in 5 hours\n");
  log("  4. Zero output (MatchEvent):");
  log(`     Query: ['${DATASET}'] | where type == "run" and restaurantsPersisted == 0`);
  log("     Trigger: MatchEvent, threshold 1 in 5 hours\n");
  log("  5. Cost checkpoint spike (MatchEvent):");
  log(`     Query: ['${DATASET}'] | where type == "cost_checkpoint" and cumulativeCost > 5`);
  log("     Trigger: MatchEvent, threshold 1 in 1 hour\n");
}

// ── Test Slack ──────────────────────────────────────────────────────────────

async function testSlack() {
  log("\nTesting Slack webhook...");
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `:test_tube: *Fitsy Pipeline — Axiom setup complete*\n\nDataset: \`${DATASET}\`\nEvent types: \`run\`, \`restaurant\`, \`error\`\nMonitors: error spike, run failed, cost overrun, zero output\n\nDummy data sent. Check <https://app.axiom.co|Axiom> to verify.`,
    }),
  });
  log(`  Slack: ${res.ok ? "sent" : `failed (${res.status})`}`);
}

// ── Verify data landed ──────────────────────────────────────────────────────

async function verifyData() {
  log("\nVerifying data in Axiom...");

  const queries = [
    { label: "runs", apl: `['${DATASET}'] | where type == "run" | count` },
    { label: "restaurants", apl: `['${DATASET}'] | where type == "restaurant" | count` },
    { label: "errors", apl: `['${DATASET}'] | where type == "error" | count` },
  ];

  for (const q of queries) {
    const res = await axiomRequest("POST", `/datasets/_apl?format=legacy`, {
      apl: q.apl,
      startTime: "2026-04-13T00:00:00Z",
      endTime: "2026-04-15T00:00:00Z",
    }, "v1");
    if (res.ok) {
      const data = res.data as { tables?: Array<{ columns?: Array<{ values?: number[] }> }> };
      const count = data?.tables?.[0]?.columns?.[0]?.values?.[0] ?? "?";
      log(`  ${q.label}: ${count} events`);
    } else {
      log(`  ${q.label}: query failed (${res.status})`);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log("Starting Axiom setup...\n");
  log(`Dataset: ${DATASET}`);
  log(`Token: ${AXIOM_TOKEN.slice(0, 10)}...`);
  log("");

  await sendDummyEvents();
  await setupMonitors();
  await testSlack();
  await verifyData();

  log("\nDone!");
}

main().catch((err) => {
  console.error("[axiom-setup] Fatal:", err);
  process.exit(1);
});
