import type { getOnboardingResume } from './onboardingResume';

type Resume = Awaited<ReturnType<typeof getOnboardingResume>>;
export type EntryDestination = Resume | '/auth/login' | '/(tabs)/search' | `/restaurant/${string}` | '/welcome/problem' | '/welcome/signin?returnTo=payment' | '/macro-setup' | '/welcome/resubscribe' | '/welcome/subscription-check';
interface EntryState {
  signedIn: boolean;
  purchasesReady: boolean;
  entitled: boolean | null;
  isLapsed: boolean;
  completed: boolean;
  hasAccountHistory: boolean;
  newAccountOnboarding: boolean;
  declined: boolean;
  resume: Resume;
  hasTargets: boolean;
  access: 'hard' | 'preview';
  onboardingPreviewEntry: boolean;
  paymentSignInContinuation: boolean;
  pendingMealClaim: boolean;
}

/** Resolve persisted onboarding and settled account access in one precedence order. */
export function onboardingEntry(state: EntryState): EntryDestination {
  // A purchase can complete before its onboarding storage writes finish.
  // Wait for that account's verdict before resuming an old payment screen.
  if (state.signedIn && !state.purchasesReady) return null;
  if (!state.signedIn && (state.hasAccountHistory || state.completed)) return '/auth/login';
  // A waitlist checkpoint belongs to the selected area, even if an older
  // checkout marker survived authentication or the account is subscribed.
  if (state.resume === '/welcome/out-of-area') return '/welcome/out-of-area';
  // Once authenticated, account state outranks an old intro or decline.
  if (state.signedIn) {
    if (state.entitled === null) return '/welcome/subscription-check';
    if (state.isLapsed && !state.entitled) return '/welcome/resubscribe';
    if (!state.entitled && state.newAccountOnboarding && !state.completed && !state.declined) {
      if (state.paymentSignInContinuation) return '/welcome/payment';
      if (state.resume === '/welcome/signin') return '/welcome/trial';
      if (state.resume) return state.resume;
    }
    if (!state.entitled) return '/welcome/payment';
    if (!state.hasTargets) return '/macro-setup';
    return '/(tabs)/search';
  }
  // A saved payment checkpoint is stronger than an anonymous preview cohort.
  if (state.resume === '/welcome/payment') return '/welcome/signin?returnTo=payment';
  if (state.paymentSignInContinuation) return '/welcome/signin?returnTo=payment';
  // The meal can persist before sign-in focus saves its navigation checkpoint.
  if (state.pendingMealClaim) return '/welcome/signin';
  if (!state.isLapsed && !state.completed && state.resume &&
    (!state.declined || (state.resume === '/welcome/preview' && state.onboardingPreviewEntry)) && state.entitled !== true) {
    return state.resume;
  }
  if (!state.declined) return '/welcome/problem';
  if (!state.purchasesReady) return null;
  return state.access === 'preview' ? '/welcome/preview' : '/welcome/signin?returnTo=payment';
}
