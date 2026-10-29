const latestBudgets = `['fitsy-pipeline'] | where type == "v2_service_budget" and environment == "dev" | summarize arg_max(_time, *) by service, day`;
const latestHexes = `['fitsy-pipeline'] | where type == "v2_hex" and environment == "dev" | summarize arg_max(_time, *) by runId, hexId`;
export const dashboard = {
  name: 'Pipeline v2 budgets and coverage', owner: 'X-AXIOM-EVERYONE', schemaVersion: 2, refreshTime: 60,
  description: 'UTC daily fleet caps. Jev costs use measured tokens; Google uses conservative list prices. Reservations include unknown charges. Source counts include committed valid items only.',
  timeWindowStart: 'qr-now-7d', timeWindowEnd: 'qr-now',
  charts: [
    { id: 'cost', type: 'Table', name: 'Cost and in-flight reservations per service and UTC day',
      query: { apl: `${latestBudgets} | project service, day, costUsd, reservedUsd, capUsd, calls, capCalls, throttles` } },
    { id: 'coverage', type: 'Table', name: 'Coverage per hex (latest attempt)',
      query: { apl: `${latestHexes} | project runId, hexId, status, restaurants, menus, uniqueItems, persistedItems, officialCoverage, persistedCoverage` } },
    // Axiom's default ingestion flattens nested JSON into literal dotted fields.
    // https://axiom.co/docs/apl/data-types/map-fields#map-fields-and-flattened-fields
    { id: 'sources', type: 'Table', name: 'Persisted items by estimate source and run',
      query: { apl: `${latestHexes} | where status == "completed" | summarize official=sum(toint(['sourceMix.official'])), jev=sum(toint(['sourceMix.jev'])), other=sum(toint(['sourceMix.other'])) by runId` } },
    { id: 'throttles', type: 'Table', name: 'Provider throttles',
      query: { apl: `['fitsy-pipeline'] | where type == "v2_throttle" and environment == "dev" | summarize throttles=count() by service, reason, status, bin(_time, 1h)` } },
  ],
  layout: ['cost','coverage','sources','throttles'].map((id,i) => ({ i: id, x: 0, y: i * 6, w: 12, h: 6 })),
};

/** Explicit apply only; no dummy billing data, Slack messages, monitors or credentials in output. */
export async function installDashboard(transport: typeof fetch = fetch): Promise<void> {
  const token = process.env['AXIOM_TOKEN'];
  if (!token) throw new Error('AXIOM_TOKEN is required to install the pipeline dashboard');
  const response = await transport('https://api.axiom.co/v2/dashboards', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid: 'fitsy-pipeline-v2', overwrite: true, dashboard }),
  });
  if (!response.ok) throw new Error(`Axiom dashboard installation failed (HTTP ${response.status})`);
}

export async function runDashboardCommand(args: string[]): Promise<void> {
  if (args.length===1) { process.stdout.write(JSON.stringify(dashboard,null,2) + '\n'); return; }
  if (args.length!==2 || args[1]!=='--apply') throw new Error('Use preload:v2:dev -- dashboard [--apply]');
  await installDashboard();
  process.stdout.write('Pipeline v2 Axiom dashboard installed\n');
}
