import { before, after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/restaurantService';
export { userId, token, request } from './authenticated-route.fixture';

export const restaurantIds = Array.from({ length: 4 }, () => randomUUID());
export const targets = { calories: 600, proteinG: 40, carbsG: 60, fatG: 20 };
before(async () => {
  for (const id of restaurantIds) {
    await prisma.restaurant.create({ data: { id, storeUuid: id, name: 'Menu regression',
      address: 'Local fixture', lat: 12, lng: 12, source: 'test', cuisineTags: [],
      menuItems: { create: Array.from({ length: 251 }, (_, i) => ({
        id: `${id}-${String(i + 1).padStart(3, '0')}`,
        name: i === 250 ? 'Zucchini chicken' : `A dish ${i + 1}`,
        ...(i === 250 ? targets : { calories: 900, proteinG: 10, carbsG: 100, fatG: 50 }),
        macroEstimates: { create: { ...targets, source: 'haiku', confidence: 'MEDIUM' } },
      })) } } });
    await prisma.macroEstimate.create({ data: { menuItemId: `${id}-251`, ...targets,
      source: 'merchant', confidence: 'HIGH', estimatedAt: new Date('2026-01-01') } });
  }
});
after(async () => {
  await prisma.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
  await prisma.$disconnect();
});
