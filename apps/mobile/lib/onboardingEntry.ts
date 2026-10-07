import type { getOnboardingResume } from './onboardingResume';

type Resume = Awaited<ReturnType<typeof getOnboardingResume>>;
export type EntryDestination = Resume | '/(tabs)/search' | '/welcome/problem' | '/welcome/signin?returnTo=payment' | '/macro-setup' | '/welcome/resubscribe' | '/welcome/subscription-check';
interface EntryState {
  signedIn: boolean;
  purchasesReady: boolean;
  entitled: boolean | null;
  isLapsed: boolean;
  completed: boolean;
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
  // A waitlist checkpoint belongs to the selected area, even if an older
  // checkout marker survived authentication or the account is subscribed.
  if (state.resume === '/welcome/out-of-area') return '/welcome/out-of-area';
  // A prior anonymous decline suppresses the ordinary onboarding resume,
  // but an authenticated checkout continuation must still reach its plan.
  if (state.signedIn && state.paymentSignInContinuation && !state.isLapsed && state.entitled !== true) return '/welcome/payment';
  // A saved payment checkpoint is stronger than an anonymous preview cohort.
  if (!state.signedIn && state.resume === '/welcome/payment') return '/welcome/signin?returnTo=payment';
  if (!state.signedIn && state.paymentSignInContinuation) return '/welcome/signin?returnTo=payment';
  // The meal can persist before sign-in focus saves its navigation checkpoint.
  if (!state.signedIn && state.pendingMealClaim) return '/welcome/signin';
  if (state.signedIn && state.resume === '/welcome/payment' && !state.isLapsed && state.entitled !== true) return '/welcome/payment';
  if (!state.isLapsed && !state.completed && state.resume &&
    (!state.declined || (state.resume === '/welcome/preview' && state.onboardingPreviewEntry)) && state.entitled !== true) {
    if (state.signedIn && state.resume === '/welcome/signin') return '/welcome/trial';
    return state.resume;
  }
  if (!state.signedIn) {
    // A checkout interrupted before authentication must resume at sign-in
    // even when the anonymous preview cohort and an older decline remain.
    if (!state.declined) return '/welcome/problem';
    if (!state.purchasesReady) return null;
    return state.access === 'preview' ? '/welcome/preview' : '/welcome/signin?returnTo=payment';
  }
  if (state.isLapsed && state.entitled !== true) return '/welcome/resubscribe';
  if (!state.hasTargets) return '/macro-setup';
  return '/(tabs)/search';
}
