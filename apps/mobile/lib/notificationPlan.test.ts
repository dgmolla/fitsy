import { DEFAULT_REMINDER_PREFERENCES, planReminders } from './notificationPlan';

const now = new Date(2026, 8, 7, 9); // Monday, local time.
const active = { isActive: true, periodType: 'TRIAL' as const, willRenew: true, expirationDate: new Date(2026, 8, 14, 12).toISOString() };
const input = { now, userId: 'synthetic-account', entitled: true, preferences: { meals: true, trial: true }, subscription: active };

test('reminders are opt-in and never scheduled for signed-out or unentitled users', () => {
  expect(planReminders({ ...input, preferences: DEFAULT_REMINDER_PREFERENCES })).toEqual([]);
  expect(planReminders({ ...input, userId: null })).toEqual([]);
  expect(planReminders({ ...input, entitled: false })).toEqual([]);
});
test('inactive store entitlement stops every reminder even while the server verdict is stale', () => {
  expect(planReminders({ ...input, subscription: { ...active, isActive: false } })).toEqual([]);
});
test('trial timing follows actual expiry rather than a hardcoded trial length', () => {
  for (const days of [7, 14]) {
    const end = new Date(2026, 8, 7 + days, 12);
    const reminder = planReminders({ ...input, subscription: { ...active, expirationDate: end.toISOString() } }).find(r => r.kind === 'trial');
    expect(reminder?.date.getTime()).toBe(end.getTime() - 48 * 3_600_000);
  }
});
test.each([
  { ...active, isActive: false }, { ...active, willRenew: false },
  { ...active, periodType: 'NORMAL' as const }, { ...active, expirationDate: null },
  { ...active, expirationDate: 'invalid' }, { ...active, expirationDate: new Date(2026, 8, 6).toISOString() },
])('canceled, paid, unknown or expired trials do not receive renewal reminders: %j', subscription => {
  expect(planReminders({ ...input, subscription }).filter(r => r.kind === 'trial')).toEqual([]);
});
test('quiet-hour trial reminders move to daytime with at least a day to cancel', () => {
  const end = new Date(2026, 8, 14, 22);
  const reminder = planReminders({ ...input, subscription: { ...active, expirationDate: end.toISOString() } }).find(r => r.kind === 'trial');
  expect(reminder?.date.getHours()).toBe(9);
  expect(reminder?.date.getDate()).toBe(13);
  expect(end.getTime() - reminder!.date.getTime()).toBeGreaterThanOrEqual(24 * 3_600_000);
});
test('late opt-in never schedules a stale reminder', () => {
  expect(planReminders({ ...input, now: new Date(2026, 8, 14, 10) }).filter(r => r.kind === 'trial')).toEqual([]);
});
test('meal reminders stay at 11:30 Tuesday/Friday and stop at known expiry', () => {
  const meals = planReminders(input).filter(r => r.kind === 'meal');
  expect(meals.map(r => r.date.getDate())).toEqual([8, 11]);
  for (const meal of meals) {
    expect(meal.date.getHours()).toBe(11); expect(meal.date.getMinutes()).toBe(30);
  }
  expect(planReminders({ ...input, subscription: null }).filter(r => r.kind === 'meal')).toHaveLength(4);
});
test('a trial reminder replaces a meal nudge on the same local day', () => {
  const reminders = planReminders({ ...input, subscription: { ...active, expirationDate: new Date(2026, 8, 13, 12).toISOString() } });
  expect(reminders.filter(r => r.date.getDate() === 11).map(r => r.kind)).toEqual(['trial']);
});
test('no meal nudge fires immediately after opt-in, and toggles work independently', () => {
  const reminders = planReminders({ ...input, now: new Date(2026, 8, 8, 10), preferences: { meals: true, trial: false } });
  expect(reminders.map(r => r.kind)).toEqual(['meal']);
  expect(reminders[0].date.getDate()).toBe(11);
  expect(planReminders({ ...input, preferences: { meals: false, trial: true } }).map(r => r.kind)).toEqual(['trial']);
});
