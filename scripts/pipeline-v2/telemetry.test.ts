import { installDashboard, dashboard } from './dashboard';
import { V2Telemetry } from './telemetry';
import type { BudgetState } from './service-budget';
const ingest = jest.fn(), flush = jest.fn().mockResolvedValue(undefined);
jest.mock('@axiomhq/js',()=>({ Axiom:jest.fn().mockImplementation(()=>({ ingest,flush })) }));
const priorToken = process.env['AXIOM_TOKEN'];
afterEach(()=>{ if (priorToken===undefined) delete process.env['AXIOM_TOKEN']; else process.env['AXIOM_TOKEN']=priorToken; jest.clearAllMocks(); });

test('Axiom receives safe service snapshots, committed source mix, coverage, throttles and an exit flush', async () => {
  process.env['AXIOM_TOKEN']='fixture-token';
  const telemetry = new V2Telemetry();
  telemetry.budgets([{ service:'google',day:'2026-10-28',capUsd:5,capCalls:'1000',calls:'2',costUsd:0.039,
    reservedUsd:0.032,throttles:'1',observedAt:'2026-10-28T12:00:00Z' } satisfies BudgetState]);
  telemetry.hex({ runId:'run',hexId:'hex',status:'completed',coverage:{ restaurants:2,menus:2,uniqueItems:5,persistedItems:4 },
    officialCoverage:0.2,persistedCoverage:0.8,sourceMix:{ official:1,jev:3,other:0 },matches:[{ private:'not telemetry' }] });
  telemetry.hex({ runId:'run',hexId:'other',status:'failed',coverage:{ persistedItems:0 },sourceMix:{ official:1,jev:3 } });
  telemetry.throttle('uber_eats',{ status:429,runId:'run',hexId:'hex' });
  await telemetry.flush();
  const events = ingest.mock.calls.flatMap(([,events]:[string,Record<string,unknown>[]])=>events);
  expect(events).toHaveLength(4);
  expect(events[0]).toMatchObject({ type:'v2_service_budget',pipelineVersion:2,service:'google',reservedUsd:0.032 });
  expect(events[1]).toMatchObject({ type:'v2_hex',persistedItems:4,sourceMix:{ official:1,jev:3,other:0 } });
  expect(events[1]).not.toHaveProperty('matches');
  expect(events[2]).toMatchObject({ sourceMix:{} });
  expect(events[3]).toMatchObject({ type:'v2_throttle',service:'uber_eats',status:429 });
  expect(flush).toHaveBeenCalledTimes(1);
});

test('the dashboard installer sends the maintained definition without alerts or dummy data', async () => {
  process.env['AXIOM_TOKEN']='fixture-token';
  const http = jest.fn().mockResolvedValue(new Response('{}',{ status:201 }));
  await installDashboard(http);
  expect(http).toHaveBeenCalledTimes(1);
  const [url,request] = http.mock.calls[0]!;
  expect(url).toBe('https://api.axiom.co/v2/dashboards');
  expect(JSON.parse(request.body)).toMatchObject({ uid:'fitsy-pipeline-v2',dashboard });
  expect(dashboard.charts).toHaveLength(4);
  const queries = dashboard.charts.map(chart=>chart.query.apl);
  expect(queries[0]).toContain('arg_max(_time, *) by service, day');
  expect(queries[1]).toContain('arg_max(_time, *) by runId, hexId');
  for (const source of ['official', 'jev', 'other']) {
    expect(queries[2]).toContain(`${source}=sum(toint(['sourceMix.${source}']))`);
  }
  expect(queries[2]).toContain('status == "completed"');
});

test('installation fails with safe diagnostics for denied API access and requires the existing token', async () => {
  process.env['AXIOM_TOKEN']='fixture-token';
  const http = jest.fn().mockResolvedValue(new Response('private response',{ status:403 }));
  await expect(installDashboard(http)).rejects.toThrow('HTTP 403');
  delete process.env['AXIOM_TOKEN'];
  await expect(installDashboard(http)).rejects.toThrow('AXIOM_TOKEN');
  expect(http).toHaveBeenCalledTimes(1);
});
