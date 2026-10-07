import { onboardingEntry } from './onboardingEntry';

type State = Parameters<typeof onboardingEntry>[0];
const baseline: State = {
  signedIn: false, purchasesReady: false, entitled: null, isLapsed: false,
  completed: false, declined: false, resume: null, hasTargets: false, access: 'hard',
  onboardingPreviewEntry: false,
  paymentSignInContinuation: false,
  pendingMealClaim: false,
};
const resolve = (state: Partial<State>) => onboardingEntry({ ...baseline, ...state });

it('shows a fresh welcome without waiting for store pricing', () => {
  expect(resolve({})).toBe('/welcome/problem');
});
it('resumes a pending anonymous meal before sign-in saved a checkpoint', () => {
  expect(resolve({ pendingMealClaim: true })).toBe('/welcome/signin');
  expect(resolve({ pendingMealClaim: true, resume: '/welcome/preview' })).toBe('/welcome/signin');
  expect(resolve({ pendingMealClaim: true, paymentSignInContinuation: true })).toBe('/welcome/signin?returnTo=payment');
  expect(resolve({ pendingMealClaim: true, resume: '/welcome/out-of-area' })).toBe('/welcome/out-of-area');
});
it('resumes unfinished anonymous setup', () => {
  expect(resolve({ resume: '/welcome/tuning' })).toBe('/welcome/tuning');
  expect(resolve({ resume: '/welcome/payment' })).toBe('/welcome/signin?returnTo=payment');
});
it.each([
  ['/welcome/preview', '/welcome/signin?returnTo=payment'],
  ['/welcome/tuning', '/welcome/signin?returnTo=payment'],
  ['/welcome/payment', '/welcome/signin?returnTo=payment'],
  ['/welcome/out-of-area', '/welcome/out-of-area'],
] as const)('resolves anonymous checkout against saved %s checkpoint', (resume, destination) => {
  expect(resolve({ purchasesReady: true, resume, paymentSignInContinuation: true,
    onboardingPreviewEntry: true })).toBe(destination);
});
it('waits for a signed-in buyer before considering a stale payment checkpoint', () => {
  const interruptedPurchase: Partial<State> = { signedIn: true, resume: '/welcome/payment', hasTargets: true };
  expect(resolve(interruptedPurchase)).toBeNull();
  expect(resolve({ ...interruptedPurchase, purchasesReady: true, entitled: true })).toBe('/(tabs)/search');
  expect(resolve({ ...interruptedPurchase, purchasesReady: true, entitled: false })).toBe('/welcome/payment');
  expect(resolve({ ...interruptedPurchase, purchasesReady: true, entitled: false, declined: true })).toBe('/welcome/payment');
});
it('continues an already signed-in onboarding user beyond the sign-in checkpoint', () => {
  expect(resolve({ signedIn: true, purchasesReady: true, entitled: false, resume: '/welcome/signin' })).toBe('/welcome/trial');
  expect(resolve({ signedIn: true, purchasesReady: true, entitled: false, resume: '/welcome/signin',
    paymentSignInContinuation: true })).toBe('/welcome/payment');
  expect(resolve({ signedIn: true, purchasesReady: true, entitled: false, declined: true,
    resume: '/welcome/signin', paymentSignInContinuation: true })).toBe('/welcome/payment');
  expect(resolve({ signedIn: true, purchasesReady: true, entitled: false, declined: true, isLapsed: true,
    resume: '/welcome/signin', paymentSignInContinuation: true })).toBe('/welcome/resubscribe');
});
it('keeps an interrupted signed-in waitlist signup ahead of stale checkout and subscription routes', () => {
  for (const entitled of [false, true, null]) {
    expect(resolve({ signedIn: true, purchasesReady: true, resume: '/welcome/out-of-area',
      paymentSignInContinuation: true, declined: true, completed: true, isLapsed: true,
      entitled })).toBe('/welcome/out-of-area');
  }
});
it('waits for the assigned access policy after anonymous decline', () => {
  expect(resolve({ declined: true, resume: '/welcome/preview' })).toBeNull();
  expect(resolve({ declined: true, purchasesReady: true, access: 'hard' })).toBe('/welcome/signin?returnTo=payment');
  expect(resolve({ declined: true, purchasesReady: true, access: 'preview' })).toBe('/welcome/preview');
  expect(resolve({ declined: true, purchasesReady: true, access: 'preview', resume: '/welcome/payment' })).toBe('/welcome/signin?returnTo=payment');
  expect(resolve({ declined: true, purchasesReady: true, access: 'preview', resume: '/welcome/signin',
    paymentSignInContinuation: true })).toBe('/welcome/signin?returnTo=payment');
  expect(resolve({ declined: true, purchasesReady: true, resume: '/welcome/preview', onboardingPreviewEntry: true })).toBe('/welcome/preview');
  expect(resolve({ declined: true, purchasesReady: true, resume: '/welcome/preview', onboardingPreviewEntry: false })).toBe('/welcome/signin?returnTo=payment');
  expect(resolve({ declined: true, purchasesReady: true, resume: '/welcome/preview', onboardingPreviewEntry: true, isLapsed: true, signedIn: true, hasTargets: true })).toBe('/welcome/resubscribe');
});
it('routes a lapsed account to resubscribe while the server-confirmed subscriber enters search', () => {
  const lapsed: Partial<State> = { signedIn: true, purchasesReady: true, hasTargets: true, isLapsed: true, entitled: false, resume: '/welcome/payment' };
  expect(resolve(lapsed)).toBe('/welcome/resubscribe');
  expect(resolve({ ...lapsed, hasTargets: false })).toBe('/welcome/resubscribe');
  expect(resolve({ ...lapsed, entitled: true })).toBe('/(tabs)/search');
});
it('requires missing meal targets before entering the app', () => {
  expect(resolve({ signedIn: true, purchasesReady: true, entitled: true, completed: true })).toBe('/macro-setup');
});
