/** Manual synthetic density benchmark: POSTGRES_PRISMA_URL=... POSTGRES_URL_NON_POOLING=... tsx --tsconfig apps/api/tsconfig.json apps/api/tests/db/goal-preview.performance.ts */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Prisma, PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';

async function main() {
  const url = new URL(process.env['POSTGRES_PRISMA_URL'] ?? '');
  assert.equal(url.hostname, 'localhost', 'Synthetic benchmark requires an explicitly local database');
  const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = prisma;
  const { GET } = await import('../../app/api/restaurants/preview/route');
  const { findNearbyRestaurants } = await import('../../lib/restaurantService');
  const { guidedPreviewSql } = await import('../../lib/guidedPreviewService');
  const queries: string[] = [];
  prisma.$on('query', event => queries.push(event.query));
  const prefix = `goal-bench-${randomUUID()}`;
  const restaurantCount = Number(process.env['GOAL_BENCH_RESTAURANTS'] ?? 400);
  assert.ok([400, 2_000].includes(restaurantCount));
  const dishCount = restaurantCount * 80, matchingCount = restaurantCount * 4;
  const ids = Array.from({ length: restaurantCount }, (_, i) => `${prefix}-${String(i).padStart(3, '0')}`);
  const params = { lat: 47, lng: 47, targets: { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 }, query: 'ramen' };
  try {
    await prisma.$transaction(async tx => {
      await tx.restaurant.createMany({ data: ids.map((id, i) => ({ id, storeUuid: id, name: `Ramen Benchmark ${i}`,
        address: 'Synthetic density fixture', source: 'test', lat: 47 + (i % 20) / 1000, lng: 47 + Math.floor((i % 400) / 20) / 1000,
        cuisineTags: ['japanese'] })) });
      for (let start = 0; start < ids.length; start += 25) {
        await tx.menuItem.createMany({ data: ids.slice(start, start + 25).flatMap(restaurantId =>
          Array.from({ length: 80 }, (_, i) => ({ id: `${restaurantId}-${i}`, restaurantId,
            name: `${i % 5 === 0 ? 'Ramen' : 'Grain bowl'} ${i}`,
            ...(i % 4 === 0 ? params.targets : { calories: 900, proteinG: 10, carbsG: 100, fatG: 50 }),
          }))) });
      }
    }, { timeout: 30_000 });
    await prisma.$executeRaw`ANALYZE "Restaurant"`;
    await prisma.$executeRaw`ANALYZE "MenuItem"`;
    const samples: number[] = [];
    const standardSamples: number[] = [];
    const connectionHealthChecks: number[] = [];
    const dataQueries = () => queries.filter(query => query.trim() !== 'SELECT 1');
    let selectedItemId: string | undefined;
    for (let i = 0; i < 12; i++) {
      // Prisma emits query events asynchronously; drain setup/previous-call events before counting.
      await new Promise<void>(resolve => setImmediate(resolve));
      queries.length = 0;
      const start = performance.now();
      const response = await GET(new NextRequest(`http://localhost/api/restaurants/preview?lat=47&lng=47&guided=1&calories=600&protein=40&carbs=60&fat=20&q=ramen${selectedItemId ? `&selectedItemId=${selectedItemId}` : ''}`, {
        headers: { 'x-forwarded-for': '192.0.2.240' },
      }));
      const result = await response.json();
      samples.push(performance.now() - start);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(response.status, 200);
      connectionHealthChecks.push(queries.length - dataQueries().length);
      assert.equal(dataQueries().length, 1, 'Exactly one application data query per preview handler call');
      assert.equal(result.data.length, 3);
      assert.equal(result.meta.nearbyDishCount, dishCount);
      assert.equal(result.meta.goalMatch.matchingDishCount, matchingCount);
      assert.equal(result.meta.goalMatch.additionalDishCount, selectedItemId ? matchingCount - 1 : matchingCount);
      selectedItemId = result.data[0].bestMatch.menuItemId;
      queries.length = 0;
      const searchStart = performance.now();
      // Measure the entitled query implementation directly; JWT/entitlement are covered by endpoint tests.
      const page = await findNearbyRestaurants({ ...params, radiusMiles: 50, goalMatched: true, limit: 3 });
      standardSamples.push(performance.now() - searchStart);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(dataQueries().length, 1, 'Opt-in main search uses one application data query');
      assert.deepEqual(page.data.map((row: { id: string }) => row.id), result.data.map((row: { id: string }) => row.id));
    }
    const plan = await prisma.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${guidedPreviewSql({ ...params, selectedItemId })}`);
    const warm = samples.slice(2).sort((a, b) => a - b);
    const receipt = { fixture: 'synthetic local density, not production latency', restaurants: ids.length, dishes: dishCount,
      responseRows: 3, matchingDishCount: matchingCount, applicationDataQueries: 1, connectionHealthChecks, cache: 'none',
      firstRequestMs: samples[0], warmMedianMs: warm[Math.floor(warm.length / 2)], warmP95Ms: warm[Math.ceil(warm.length * .95) - 1], samplesMs: samples,
      standardSearchMeasurement: 'query service with goalMatched true, radius 50; auth excluded', standardSearchSamplesMs: standardSamples,
      postgresPlan: plan };
    mkdirSync('.evidence/goal-preview', { recursive: true });
    writeFileSync(`.evidence/goal-preview/performance-${dishCount}.json`, JSON.stringify(receipt, null, 2) + '\n');
    process.stdout.write(JSON.stringify({ ...receipt, postgresPlan: `saved in .evidence/goal-preview/performance-${dishCount}.json` }, null, 2) + '\n');
  } finally {
    await prisma.restaurant.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
}

main().catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
