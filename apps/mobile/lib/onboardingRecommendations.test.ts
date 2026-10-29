import { calculateSuggestedCalories } from './onboardingRecommendations';

test('performance preserves maintenance energy and legacy maintain remains supported', () => {
  expect(calculateSuggestedCalories({ goal: 'performance' })).toBe(2214);
  expect(calculateSuggestedCalories({ goal: 'maintain' })).toBe(2214);
  expect(calculateSuggestedCalories({})).toBe(2214);
});

test.each([NaN, Infinity, -Infinity, 0, -1])('invalid persisted measurement %s uses defaults without storage', value => {
  expect(calculateSuggestedCalories({ heightCm: value, weightKg: value })).toBe(2214);
});

test('invalid persisted birthday uses default age', () => {
  expect(calculateSuggestedCalories({ birthday: 'invalid' })).toBe(2214);
});

test('a birthday changes the recommendation on the birthday, with a fixed clock', () => {
  jest.useFakeTimers();
  try {
    jest.setSystemTime(new Date(2026, 5, 14, 12));
    const before = calculateSuggestedCalories({ birthday: '1996-06-15T12:00:00' });
    jest.setSystemTime(new Date(2026, 5, 15, 12));
    expect(before).toBe(2186);
    expect(calculateSuggestedCalories({ birthday: '1996-06-15T12:00:00' })).toBe(2179);
  } finally { jest.useRealTimers(); }
});
