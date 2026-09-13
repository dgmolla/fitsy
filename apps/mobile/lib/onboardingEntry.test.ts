import { onboardingEntry } from './onboardingEntry';

type State = Parameters<typeof onboardingEntry>[0];
const baseline: State = {
  signedIn: false, purchasesReady: false, entitled: null, isLapsed: false,
  completed: false, declined: false, resume: null, hasTargets: false, access: 'hard',
};
const resolve = (state: Partial<State>) => onboardingEntry({ ...baseline, ...state });

it('shows a fresh welcome without waiting for store pricing', () => {
  expect(resolve({})).toBe('/welcome/problem');
});
it('resumes unfinished anonymous setup', () => {
  expect(resolve({ resume: '/welcome/tuning' })).toBe('/welcome/tuning');
});
it('waits for a signed-in buyer before considering a stale payment checkpoint', () => {
  const interruptedPurchase: Partial<State> = { signedIn: true, resume: '/welcome/payment', hasTargets: true };
  expect(resolve(interruptedPurchase)).toBeNull();
  expect(resolve({ ...interruptedPurchase, purchasesReady: true, entitled: true })).toBe('/(tabs)/search');
  expect(resolve({ ...interruptedPurchase, purchasesReady: true, entitled: false })).toBe('/welcome/payment');
});
it('continues an already signed-in onboarding user beyond the sign-in checkpoint', () => {
  expect(resolve({ signedIn: true, purchasesReady: true, entitled: false, resume: '/welcome/signin' })).toBe('/welcome/trial');
});
it('waits for the assigned access policy after anonymous decline', () => {
  expect(resolve({ declined: true, resume: '/welcome/preview' })).toBeNull();
  expect(resolve({ declined: true, purchasesReady: true, access: 'hard' })).toBe('/welcome/payment');
  expect(resolve({ declined: true, purchasesReady: true, access: 'preview' })).toBe('/welcome/preview');
});
it('routes a lapsed account to resubscribe while the server-confirmed subscriber enters search', () => {
  const lapsed: Partial<State> = { signedIn: true, purchasesReady: true, hasTargets: true, isLapsed: true, entitled: false, resume: '/welcome/payment' };
  expect(resolve(lapsed)).toBe('/welcome/resubscribe');
  expect(resolve({ ...lapsed, entitled: true })).toBe('/(tabs)/search');
});
it('requires missing meal targets before entering the app', () => {
  expect(resolve({ signedIn: true, purchasesReady: true, entitled: true, completed: true })).toBe('/macro-setup');
});
