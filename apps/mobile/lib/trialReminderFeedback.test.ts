import { Alert } from 'react-native';
import { explainMissedTrialReminder, missedTrialReminderWindow } from './trialReminderFeedback';
import { TRIAL_CATALOG_POLICY, trialReminderDate } from '../../../packages/shared/src/contracts/trialPolicy';
import { devLateTrialReminderFixture } from './devLateTrialReminderFixture';

const expiry = new Date(2026, 9, 21, 8);
const now = new Date(2026, 9, 18, 20);
const trial = { isActive: true, periodType: 'TRIAL', willRenew: true,
  latestPurchaseDate: new Date(2026, 9, 7, 8).toISOString(), expirationDate: expiry.toISOString() };

test('late opt-in explains a missed adjusted target without claiming the future nominal target passed', () => {
  const nominal = expiry.getTime() - TRIAL_CATALOG_POLICY.reminderLeadHours * 3_600_000;
  expect(nominal).toBeGreaterThan(now.getTime());
  expect(trialReminderDate(expiry).getTime()).toBeLessThan(now.getTime());
  expect(missedTrialReminderWindow(trial, now.getTime())).toBe(true);
  explainMissedTrialReminder();
  const message = (Alert.alert as jest.Mock).mock.calls.at(-1)[1];
  expect(message).not.toMatch(/48-hour reminder time.*has passed/);
  expect(message).toMatch(/quiet.hour/i);
});

test.each([7, 14, 21])('%i-day actual entitlements share the adjusted target', days => {
  const actual = { ...trial, latestPurchaseDate: new Date(expiry.getTime() - days * 86_400_000).toISOString() };
  expect(missedTrialReminderWindow(actual, trialReminderDate(expiry).getTime() - 1)).toBe(false);
  expect(missedTrialReminderWindow(actual, now.getTime())).toBe(true);
});

test.each([
  undefined,
  { ...trial, isActive: false },
  { ...trial, willRenew: false },
  { ...trial, periodType: 'NORMAL' },
  { ...trial, expirationDate: 'invalid' },
  { ...trial, latestPurchaseDate: 'invalid' },
  { ...trial, latestPurchaseDate: new Date(expiry.getTime() - 2 * 86_400_000).toISOString() },
  { ...trial, latestPurchaseDate: new Date(expiry.getTime() - 49 * 3_600_000).toISOString() },
])('ineligible or never-useful targets do not claim a missed reminder', actual => {
  expect(missedTrialReminderWindow(actual, now.getTime())).toBe(false);
});

test('an expired entitlement does not report a missed trial reminder', () => {
  expect(missedTrialReminderWindow(trial, expiry.getTime())).toBe(false);
});

test.each([
  new Date(2026, 9, 29), new Date(2026, 9, 30), new Date(2026, 9, 31),
  new Date(2026, 2, 6), new Date(2026, 2, 7),
])('controlled late opt-in stays between adjusted and nominal targets across DST: %s', anchor => {
  const fixture = devLateTrialReminderFixture(anchor);
  const expiration = new Date(fixture.trial.expirationDate);
  const nominal = expiration.getTime() - TRIAL_CATALOG_POLICY.reminderLeadHours * 3_600_000;
  expect(trialReminderDate(expiration).getTime()).toBeLessThan(fixture.now.getTime());
  expect(nominal).toBeGreaterThan(fixture.now.getTime());
  expect(missedTrialReminderWindow(fixture.trial, fixture.now.getTime())).toBe(true);
});
