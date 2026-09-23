import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { PATCH, GET } from '../../app/api/user/profile/route';
import { token, userId } from './authenticated-route.fixture';
import { prisma } from '../../lib/restaurantService';

const request = (body?: unknown, schema?: string) => new NextRequest(`http://localhost/api/user/profile${schema ? '?goalSchema=' + schema : ''}`, {
  method: body ? 'PATCH' : 'GET',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('performance profile persists, calculates balanced macros and preserves explicit targets', async () => {
  const response = await PATCH(request({
    birthday: '1996-01-15', heightCm: 175, weightKg: 75,
    activityLevel: 'active', goal: 'performance', sex: 'male',
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.goal, 'maintain');
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { macroTarget: true } });
  assert.equal(stored.goal, 'performance');
  assert.ok(stored.macroTarget);
  assert.equal(stored.macroTarget.proteinG, Math.round(stored.macroTarget.calories * 0.2 / 4));
  assert.equal(stored.macroTarget.carbsG, Math.round(stored.macroTarget.calories * 0.55 / 4));
  assert.equal(stored.macroTarget.fatG, Math.round(stored.macroTarget.calories * 0.25 / 9));

  const macroTarget = { calories: 2100, proteinG: 120, carbsG: 250, fatG: 69 };
  for (const schema of [undefined, '999', '2']) {
    const patched = await PATCH(request({ goal: 'performance', macroTarget }, schema));
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).user.goal, schema === '2' ? 'performance' : 'maintain');
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).goal, 'performance');
  }
  const legacy = await GET(request());
  assert.equal(legacy.status, 200);
  const legacyProfile = await legacy.json();
  assert.equal(legacyProfile.user.goal, 'maintain', 'old clients receive a supported goal');
  assert.deepEqual(legacyProfile.macroTarget, macroTarget);
  const unknownSchema = await GET(request(undefined, '999'));
  assert.equal((await unknownSchema.json()).user.goal, 'maintain');
  const refreshed = await GET(request(undefined, '2'));
  assert.equal(refreshed.status, 200);
  const profile = await refreshed.json();
  assert.equal(profile.user.goal, 'performance');
  assert.deepEqual(profile.macroTarget, macroTarget);
  const persisted = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(persisted.goal, 'performance', 'compatibility serialization must not overwrite the stored goal');
  // The old client pushes its aliased goal alongside a weight-only edit.
  const legacyEdit = await PATCH(request({ goal: legacyProfile.user.goal, weightKg: 76, macroTarget }));
  assert.equal(legacyEdit.status, 200);
  const afterLegacyEdit = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  assert.equal(afterLegacyEdit.weightKg, 76);
  assert.equal(afterLegacyEdit.goal, 'performance');
  // An updated client can deliberately switch performance to maintenance.
  assert.equal((await PATCH(request({ goal: 'maintain', macroTarget }, '2'))).status, 200);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).goal, 'maintain');
  for (const goal of ['lose_fat', 'build_muscle', 'maintain']) {
    assert.equal((await PATCH(request({ goal, macroTarget }))).status, 200);
    for (const schema of [undefined, '2']) {
      const unchanged = await GET(request(undefined, schema));
      assert.equal((await unchanged.json()).user.goal, goal);
    }
  }
});
