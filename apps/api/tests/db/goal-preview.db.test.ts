import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { guidedPreviewResponseSchema } from '@fitsy/shared';

const testIfDb = process.env['POSTGRES_PRISMA_URL'] ? test : test.skip;
testIfDb('target-ranked preview through real API handlers, JWT and Postgres', () => {
  let output: string;
  try { output = execFileSync(process.execPath, [require.resolve('tsx/cli'),
    '--tsconfig', resolve(__dirname, '../../tsconfig.json'), '--test', '--test-reporter=tap',
    resolve(__dirname, 'goal-preview.integration.ts')], {
    encoding: 'utf8', timeout: 30_000, env: process.env,
  }); } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    throw new Error(`Goal-preview endpoint tests failed:\n${e.stdout ?? ''}\n${e.stderr ?? ''}`);
  }
  expect(Number(output.match(/^# tests (\d+)$/m)?.[1])).toBe(11);
  expect(output).toMatch(/^# fail 0$/m);
  expect(output).toMatch(/^# skipped 0$/m);
}, 35_000);

testIfDb('guided service preserves complete-nutrition coverage, target ranking and no-target contracts', async () => {
  // Lazy load keeps database-less runs isolated while measuring the actual service under Jest coverage.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { findGuidedPreview } = require('../../lib/guidedPreviewService') as typeof import('../../lib/guidedPreviewService');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prisma } = require('../../lib/restaurantService') as typeof import('../../lib/restaurantService');
  const id = randomUUID();
  await prisma.restaurant.create({ data: { id, storeUuid: id, name: 'Coverage fixture', address: 'Synthetic',
    source: 'test', lat: 48, lng: 48, cuisineTags: [], menuItems: { create: [
      { id: `${id}-fit`, name: 'Ramen', calories: 600, proteinG: 40, carbsG: 60, fatG: 20 },
      { id: `${id}-off`, name: 'Ramen extra', calories: 900, proteinG: 10, carbsG: 60, fatG: 20 },
      { name: 'Incomplete ramen', calories: 600 },
    ] } } });
  const params = { lat: 48, lng: 48, query: 'ramen', targets: { calories: 600 } };
  try {
    const result = guidedPreviewResponseSchema.parse(await findGuidedPreview({ ...params, selectedItemId: `${id}-fit` }));
    expect(result.data.map(row => row.bestMatch!.menuItemId)).toEqual([`${id}-fit`]);
    expect(result.meta.nearbyDishCount).toBe(2);
    expect(result.meta.goalMatch).toBeNull();
    const noTargets = guidedPreviewResponseSchema.parse(await findGuidedPreview({ ...params, targets: {} }));
    expect(noTargets.data).toHaveLength(1);
    expect(noTargets.meta.goalMatch).toBeNull();
    const noMatch = guidedPreviewResponseSchema.parse(await findGuidedPreview({ ...params, targets: { calories: 50 } }));
    expect(noMatch.data.map(row => row.bestMatch!.menuItemId)).toEqual([`${id}-fit`]);
    expect(noMatch.meta.nearbyDishCount).toBe(2);
    expect(noMatch.meta.goalMatch).toBeNull();
  } finally { await prisma.restaurant.delete({ where: { id } }); await prisma.$disconnect(); }
});
