import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { computeMatchScore, restaurantResultSchema } from '@fitsy/shared';
import { macroScoreSumSql } from '../../lib/macroScoreSql';

jest.setTimeout(30_000);
const describeIfDb = process.env['POSTGRES_PRISMA_URL'] ? describe : describe.skip;

describeIfDb('search nutrition provenance (real PostgreSQL)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prisma, findNearbyRestaurants } = require('../../lib/restaurantService') as typeof import('../../lib/restaurantService');
  const restaurantId = randomUUID();
  const itemId = randomUUID();
  const targets = { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 };
  const params = { lat: 10, lng: 10, radiusMiles: 1, targets, limit: 20 };

  beforeAll(async () => {
    await prisma.restaurant.create({ data: { id: restaurantId, storeUuid: restaurantId, name: 'Provenance regression',
      address: 'Isolated test fixture', lat: 10, lng: 10, cuisineTags: [], source: 'test',
      menuItems: { create: { id: itemId, name: 'Chicken bowl', ...targets,
        macroEstimates: { create: [
          { ...targets, source: 'merchant', confidence: 'HIGH', estimatedAt: new Date('2026-01-01') },
          { ...targets, source: 'haiku', confidence: 'LOW', estimatedAt: new Date('2026-04-01') },
        ] } } } } });
  });
  afterAll(async () => {
    await prisma.restaurant.deleteMany({ where: { id: restaurantId } });
    await prisma.$disconnect();
  });

  test('multiple estimates produce one restaurant with the winning source metadata', async () => {
    const result = await findNearbyRestaurants(params);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.bestMatch).toMatchObject({ menuItemId: itemId, confidence: 'HIGH', matchScore: 0, ...targets });
    expect(restaurantResultSchema.safeParse(result.data[0]).success).toBe(true);
  });

  test('a partially missing macro record cannot become the best match', async () => {
    await prisma.menuItem.create({ data: { restaurantId, name: 'Incomplete bowl', calories: 500 } });
    const result = await findNearbyRestaurants({ ...params, targets: { calories: 500 } });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.bestMatch?.menuItemId).toBe(itemId);
  });

  test('no targets and zero targets produce the same contract-valid response', async () => {
    const a = await findNearbyRestaurants({ ...params, targets: {} });
    const b = await findNearbyRestaurants({ ...params, targets: { calories: 0 } });
    expect(b.data).toEqual(a.data);
    expect(a.data[0]?.bestMatch?.matchScore).toBeNull();
  });

  test('SQL and JavaScript score each active dimension identically', async () => {
    for (const t of [{}, { calories: 0 }, { proteinG: 45 }, targets]) {
      const [row] = await prisma.$queryRaw<{ score: number }[]>(Prisma.sql`
        SELECT ${macroScoreSumSql(t)} AS score FROM "MenuItem" m WHERE m.id = ${itemId}`);
      expect(Math.sqrt(row!.score)).toBeCloseTo(computeMatchScore(t, targets) ?? 0, 12);
    }
  });
});
