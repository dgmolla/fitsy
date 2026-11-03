import { onboardingEntry } from './onboardingEntry';

type State = Parameters<typeof onboardingEntry>[0];
const baseline: State = {
  signedIn: false, purchasesReady: false, entitled: null, isLapsed: false,
  completed: false, hasAccountHistory: false, newAccountOnboarding: false, declined: false, resume: null, hasTargets: false, access: 'hard',
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
it('preserves intentional first-time account setup until it completes or access changes', () => {
  const firstTime: Partial<State> = { signedIn: true, purchasesReady: true, entitled: false, newAccountOnboarding: true };
  expect(resolve({ ...firstTime, resume: '/welcome/goal' })).toBe('/welcome/goal');
  expect(resolve({ ...firstTime, resume: '/welcome/signin' })).toBe('/welcome/trial');
  expect(resolve({ ...firstTime, resume: '/welcome/signin', paymentSignInContinuation: true })).toBe('/welcome/payment');
  expect(resolve({ ...firstTime, resume: '/welcome/goal', completed: true })).toBe('/welcome/payment');
  expect(resolve({ ...firstTime, resume: '/welcome/goal', declined: true })).toBe('/welcome/payment');
  expect(resolve({ ...firstTime, resume: '/welcome/goal', isLapsed: true })).toBe('/welcome/resubscribe');
  expect(resolve({ ...firstTime, resume: '/welcome/goal', entitled: true })).toBe('/macro-setup');
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
it('routes an already signed-in account beyond the sign-in checkpoint to its plan', () => {
  expect(resolve({ signedIn: true, purchasesReady: true, entitled: false, resume: '/welcome/signin' })).toBe('/welcome/payment');
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
  expect(resolve({ declined: true, purchasesReady: true, resume: '/welcome/preview', onboardingPreviewEntry: true, isLapsed: true, entitled: false, signedIn: true, hasTargets: true })).toBe('/welcome/resubscribe');
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

it('keeps an unknown signed-in subscription in recovery instead of restarting onboarding', () => {
  expect(resolve({ signedIn: true, purchasesReady: true, resume: '/welcome/signin' })).toBe('/welcome/subscription-check');
});

it.each([
  { hasAccountHistory: true },
  { completed: true },
])('offers login for a prior account without waiting for store pricing: %j', history => {
  for (const resume of [null, '/welcome/signin', '/welcome/location-permission', '/welcome/payment', '/welcome/out-of-area'] as const) {
    expect(resolve({ ...history, resume, paymentSignInContinuation: true })).toBe('/auth/login');
  }
});

it.each([
  ['lapsed', { entitled: false, isLapsed: true, hasTargets: true }, '/welcome/resubscribe'],
  ['unentitled', { entitled: false, hasTargets: false }, '/welcome/payment'],
  ['missing targets', { entitled: true, hasTargets: false }, '/macro-setup'],
  ['ready', { entitled: true, hasTargets: true }, '/(tabs)/search'],
] as const)('routes the %s signed-in account ahead of stale onboarding state', (_name, account, destination) => {
  for (const resume of [null, '/welcome/location-permission', '/welcome/tuning', '/welcome/signin', '/welcome/preview'] as const) {
    for (const declined of [false, true]) {
      expect(resolve({ signedIn: true, purchasesReady: true, hasAccountHistory: true,
        ...account, resume, declined })).toBe(destination);
    }
  }
});
