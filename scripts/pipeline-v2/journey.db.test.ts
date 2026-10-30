import { randomUUID } from 'node:crypto';
import type { LookupAddress, LookupAllOptions } from 'node:dns';
import * as dns from 'node:dns/promises';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { latLngToCell } from 'h3-js';
import type { JevRequest } from '../eval/lib/jev-experiment';
import { assertTestDatabase } from '../lib/test-database-guard';
import { digest, V2Journal } from './journal';
import { PdfJobQueue } from './pdf-queue';
import { parsePdfOptions, runPdfCommand } from './pdf-worker';
import { parseQueueOptions, runQueueCommand } from './queue-worker';
import { runV2Hex, targetIdentity } from './run';
import { SharedServiceBudget } from './service-budget';
import { SharedUeRateLimiter } from './ue-rate-limiter';

const suite = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;
suite('pipeline roadmap journey with real persistence and only DNS/provider HTTP substituted', () => {
  const db = new PrismaClient(), observer = new PrismaClient(), hexId = latLngToCell(34.05, -118.25, 7);
  const table = readFileSync(join(__dirname, '../eval/pdf-finder/fixtures/table.html'), 'utf8');
  const source = { event: 'source', sourceHash: digest(['issue-600 synthetic provider fixtures']), fixture: true };
  const keyBefore = process.env['TYPESAFE_API_KEY'];
  let out: string, brandId: string, brandName: string, runId: string, target: string;
  let restaurantIds: string[], runIds: string[], paidItems: string[], researchCalls: number;
  const journals: V2Journal[] = [];
  const menus = () => db.menuItem.findMany({ where: { restaurantId: { in: restaurantIds } },
    include: { macroEstimates: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } });
  const pdfJobs = () => observer.$queryRaw<{ status: string; attempts: number }[]>`
    SELECT status, attempts FROM public.pipeline_pdf_jobs WHERE brand_id=${brandId}`;

  beforeEach(async () => {
    out = mkdtempSync(join(tmpdir(), 'pipeline-600-'));
    const id = randomUUID(); brandId = 'roadmap-' + id; brandName = 'Roadmap Chain ' + id; runId = 'journey-' + id;
    runIds = []; restaurantIds = [brandId + '-north', brandId + '-south']; paidItems = []; researchCalls = 0;
    target = targetIdentity(assertTestDatabase(process.env['POSTGRES_PRISMA_URL']));
    process.env['TYPESAFE_API_KEY'] = 'synthetic-provider-fixture';
    await db.$executeRaw`DELETE FROM public.pipeline_paid_requests`;
    await db.$executeRaw`DELETE FROM public.pipeline_service_days`;
    await new SharedServiceBudget(db).configure('jev', 5, 100000);
    await new SharedServiceBudget(db).configure('pdf_finder', 0, 10);
    await new SharedUeRateLimiter(db).configure(10);
    await db.brand.create({ data: { id: brandId, slug: brandId, displayName: brandName,
      detectionConf: 'high', menuKind: 'restaurant', officialUrl: 'https://roadmapchain.com/nutrition' } });
    for (const [index, id] of restaurantIds.entries()) await db.restaurant.create({ data: {
      id, name: `${brandName} (${index ? 'South' : 'North'})`, storeUuid: id, source: 'ue_feed',
      address: 'Synthetic fixture', lat: 34.05, lng: -118.25, homeHex: hexId, menuKind: 'restaurant',
    } });
    const allAddresses: { lookup(hostname: string, options: LookupAllOptions): Promise<LookupAddress[]> } = dns;
    jest.spyOn(allAddresses, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
    jest.spyOn(global, 'fetch').mockImplementation(async (input, options) => {
      const url = String(input);
      if (url.includes('getStoreV1')) {
        const { storeUuid } = JSON.parse(String(options?.body)) as { storeUuid: string };
        return Response.json({ status: 'success', data: { catalogSectionsMap: { fixture: [
          { payload: { standardItemsPayload: { title: { text: 'Lunch' }, catalogItems: [
            { uuid: storeUuid + '-standard', title: 'Rice & Chicken', itemDescription: '250 g', price: 1200 },
            { uuid: storeUuid + '-seasonal', title: 'Seasonal Chicken Bowl', itemDescription: '1 bowl', price: 1400 },
          ] } } },
          { payload: { standardItemsPayload: { title: { text: 'Family Meals' }, catalogItems: [
            { uuid: storeUuid + '-family', title: 'Rice & Chicken', itemDescription: '1000 g; serves four', price: 4000 },
          ] } } },
        ] } } });
      }
      if (url === 'https://api.typesafe.ai/v1/systemone') {
        const request = JSON.parse(String(options?.body)) as JevRequest;
        paidItems.push(String(request.state['itemName']));
        const answers = Object.fromEntries(Object.entries(request.questions).map(([macro, question]) => {
          const choice = Object.hasOwn(question.criteria, 'b0') ? macro === 'calories' || macro === 'carbs' ? 'b2' : macro === 'fat' ? 'b0' : 'b1' : 'r5';
          return [macro, { type: 'choice', choice, confidence: 0.9,
            probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === choice ? 1 : 0])) }];
        }));
        return Response.json({ model: 'jev-1.14.0', usage: { input_tokens: 100, output_tokens: 20 }, answers });
      }
      researchCalls++;
      if (/^https:\/\/(?:html|lite)\.duckduckgo\.com\/|^https:\/\/www\.bing\.com\//.test(url)) return new Response('<html>No results</html>');
      if (url === 'https://www.roadmapchain.com/') return new Response(`<h1>${brandName} United States</h1><a href="/nutrition.html">Current nutrition</a>`);
      if (url === 'https://www.roadmapchain.com/nutrition.html') return new Response(`<h1>${brandName} United States updated ${new Date().getUTCFullYear()}</h1>${table}`);
      throw new Error('Unexpected fixture HTTP request');
    });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    for (const journal of journals.splice(0)) journal.close();
    if (keyBefore === undefined) delete process.env['TYPESAFE_API_KEY']; else process.env['TYPESAFE_API_KEY'] = keyBefore;
    try {
      await db.$executeRaw`DELETE FROM public.pipeline_paid_requests`;
      await db.$executeRaw`DELETE FROM public.pipeline_service_days`;
      await db.hexJob.deleteMany({ where: { runId: { in: runIds } } });
      await db.pipelineCompletedHex.deleteMany({ where: { runId: { in: runIds } } });
      await db.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
      await db.brand.deleteMany({ where: { id: brandId } });
      await new SharedUeRateLimiter(db).configure(1);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
  afterAll(async () => { await Promise.all([db.$disconnect(), observer.$disconnect()]); });

  async function ingest(id = runId) {
    const enqueue = parseQueueOptions(['enqueue', '--run-id=' + id, '--hex-id=' + hexId]);
    if (!runIds.includes(enqueue.runId)) runIds.push(enqueue.runId);
    await runQueueCommand(db, enqueue, target, source);
    return runQueueCommand(db, parseQueueOptions(['worker', '--run-id=' + id, '--worker-id=journey', '--out=' + out]), target, source);
  }

  test('queued Jev menus upgrade across locations, retain partial estimates, and refresh through exact matching', async () => {
    expect(await ingest()).toMatchObject({ status: 'completed' });
    const before = await menus();
    expect(before).toHaveLength(6);
    expect(before.every(item => item.macroEstimates.length === 1 && item.macroEstimates[0]!.source === 'jev'
      && item.macroEstimates[0]!.confidence === 'LOW')).toBe(true);
    expect(await pdfJobs()).toEqual([{ status: 'pending', attempts: 0 }]);
    expect(await db.hexJob.findMany({ where: { runId: { in: runIds } } })).toMatchObject([
      { status: 'completed', leaseOwner: null, leaseExpiresAt: null },
    ]);
    expect(await db.pipelineCompletedHex.count({ where: { runId: { in: runIds } } })).toBe(1);
    expect(researchCalls).toBe(0);
    expect(paidItems).toHaveLength(12);
    expect(await ingest()).toMatchObject({ status: 'idle' });
    expect(paidItems).toHaveLength(12);
    const pdf = parsePdfOptions(['pdf-worker', '--worker-id=journey-pdf', '--out=' + out]);
    expect(await runPdfCommand(db, pdf, source)).toMatchObject({ status: 'completed',
      outcomes: [{ brandId, status: 'completed', matched: 2, catalogAdded: 1 }] });
    const upgraded = await menus();
    expect(upgraded.map(item => item.id)).toEqual(before.map(item => item.id));
    for (const item of upgraded) {
      expect(item.macroEstimates.find(estimate => estimate.source === 'jev')).toEqual(before.find(row => row.id === item.id)!.macroEstimates[0]);
      if (item.section === 'Lunch' && item.name === 'Rice & Chicken') {
        expect(item).toMatchObject({ calories: 410, proteinG: 35, carbsG: 45, fatG: 10 });
        expect(item.macroEstimates.find(estimate => estimate.source === 'official')).toMatchObject({ confidence: 'HIGH', calories: 410 });
      } else expect(item.macroEstimates).toEqual(before.find(row => row.id === item.id)!.macroEstimates);
    }
    const calls = researchCalls;
    expect(await runPdfCommand(db, pdf, source)).toMatchObject({ status: 'idle' });
    expect(researchCalls).toBe(calls);
    const paid = paidItems.length;
    expect(await ingest(runId + '-refresh')).toMatchObject({ status: 'completed', outcomes: [{ report: {
      coverage: { officialItems: 2, jevItems: 4, persistedItems: 6 },
    } }] });
    expect(paidItems.slice(paid)).toHaveLength(8);
    const refreshed = await menus();
    expect(refreshed.map(item => item.id)).toEqual(before.map(item => item.id));
    for (const item of upgraded) if (item.macroEstimates.some(estimate => estimate.source === 'official')) {
      expect(refreshed.find(row => row.id === item.id)!.macroEstimates.find(estimate => estimate.source === 'official')!.id)
        .toBe(item.macroEstimates.find(estimate => estimate.source === 'official')!.id);
    }
    expect(await pdfJobs()).toEqual([{ status: 'completed', attempts: 1 }]);
  }, 30_000);

  test('another worker cannot claim uncommitted PDF work, and rollback keeps menus, jobs and checkpoint absent', async () => {
    const options = { runId: 'pipeline-v2-dev:' + runId, hexId, capUsd: 5, out };
    runIds.push(options.runId);
    const journal = new V2Journal(join(out, 'journal.jsonl'), { runId: options.runId, hexId, target }, 5, new SharedServiceBudget(db));
    journals.push(journal); journal.append(source);
    let visibility: unknown;
    const failed = await runV2Hex(db, options, journal, { checkpointInTx: async tx => {
      visibility = { outside: await pdfJobs(), claim: await new PdfJobQueue(observer).claim('concurrent-pdf'),
        inside: await tx.$queryRaw`SELECT status FROM public.pipeline_pdf_jobs WHERE brand_id=${brandId}` };
      throw new Error('Synthetic checkpoint failure after PDF enqueue');
    } });
    expect(visibility).toEqual({ outside: [], claim: null, inside: [{ status: 'pending' }] });
    expect(failed).toMatchObject({ status: 'failed', coverage: { persistedItems: 0 } });
    expect(await pdfJobs()).toEqual([]); expect(await menus()).toEqual([]);
    expect(await db.pipelineCompletedHex.count({ where: { runId: options.runId } })).toBe(0);
    const calls = paidItems.length;
    expect(await runV2Hex(db, options, journal)).toMatchObject({ status: 'completed' });
    expect(paidItems).toHaveLength(calls);
    expect(await pdfJobs()).toEqual([{ status: 'pending', attempts: 0 }]);
    expect(await menus()).toHaveLength(6);
  }, 30_000);
});
