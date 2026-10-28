import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { PATCH } from '../../app/api/user/profile/route';
import { POST, GET } from '../../app/api/saved-items/route';
import { DELETE } from '../../app/api/saved-items/[id]/route';
import { token, userId } from './authenticated-route.fixture';
import { prisma } from '../../lib/restaurantService';

test('app role persists account changes and saves, reads and removes a menu bookmark', async () => {
  const [role] = await prisma.$queryRaw<{ name: string }[]>`SELECT current_user AS name`;
  assert.equal(role?.name, 'fitsy_app');
  const request = (path: string, method: string, body?: unknown) => new NextRequest(`http://localhost/api/${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const updated = await PATCH(request('user/profile', 'PATCH', { weightKg: 75,
    macroTarget: { calories: 2100, proteinG: 120, carbsG: 250, fatG: 69 } }));
  assert.equal(updated.status, 200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).weightKg, 75);
  assert.ok(await prisma.macroTarget.findUnique({ where: { userId } }));
  const item = await prisma.menuItem.findFirstOrThrow({ where: { retiredAt: null } });
  const saved = await POST(request('saved-items', 'POST', { menuItemId: item.id }));
  assert.equal(saved.status, 201);
  const id = (await saved.json()).data.id;
  const listed = await GET(request('saved-items', 'GET'));
  assert.equal(listed.status, 200);
  assert.ok((await listed.json()).data.some((row: { id: string }) => row.id === id));
  const removed = await DELETE(request(`saved-items/${id}`, 'DELETE'), { params: Promise.resolve({ id }) });
  assert.equal(removed.status, 204);
  assert.equal(await prisma.savedItem.count({ where: { userId } }), 0);
});
