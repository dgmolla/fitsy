import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { PATCH, GET } from '../../app/api/user/profile/route';
import { token, userId } from './authenticated-route.fixture';
import { prisma } from '../../lib/restaurantService';

const request = (body?: unknown) => new NextRequest('http://localhost/api/user/profile', {
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
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { macroTarget: true } });
  assert.equal(stored.goal, 'performance');
  assert.ok(stored.macroTarget);
  assert.equal(stored.macroTarget.proteinG, Math.round(stored.macroTarget.calories * 0.2 / 4));
  assert.equal(stored.macroTarget.carbsG, Math.round(stored.macroTarget.calories * 0.55 / 4));
  assert.equal(stored.macroTarget.fatG, Math.round(stored.macroTarget.calories * 0.25 / 9));

  const macroTarget = { calories: 2100, proteinG: 120, carbsG: 250, fatG: 69 };
  assert.equal((await PATCH(request({ goal: 'performance', macroTarget }))).status, 200);
  const refreshed = await GET(request());
  assert.equal(refreshed.status, 200);
  const profile = await refreshed.json();
  assert.equal(profile.user.goal, 'performance');
  assert.deepEqual(profile.macroTarget, macroTarget);
});
