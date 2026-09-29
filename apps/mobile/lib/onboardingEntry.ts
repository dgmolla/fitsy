import type { getOnboardingResume } from './onboardingResume';

type Resume = Awaited<ReturnType<typeof getOnboardingResume>>;
export type EntryDestination = Resume | '/(tabs)/search' | '/welcome/problem' | '/macro-setup' | '/welcome/resubscribe' | '/welcome/subscription-check';
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
}

/** Resolve persisted onboarding and settled account access in one precedence order. */
export function onboardingEntry(state: EntryState): EntryDestination {
  // A purchase can complete before its onboarding storage writes finish.
  // Wait for that account's verdict before resuming an old payment screen.
  if (state.signedIn && !state.purchasesReady) return null;
  if (!state.isLapsed && !state.completed && state.resume &&
    (!state.declined || (state.resume === '/welcome/preview' && state.onboardingPreviewEntry)) && state.entitled !== true) {
    return state.signedIn && state.resume === '/welcome/signin' ? '/welcome/trial' : state.resume;
  }
  if (!state.signedIn) {
    if (!state.declined) return '/welcome/problem';
    if (!state.purchasesReady) return null;
    return state.access === 'preview' ? '/welcome/preview' : '/welcome/payment';
  }
  if (state.isLapsed && state.entitled !== true) return '/welcome/resubscribe';
  if (!state.hasTargets) return '/macro-setup';
  return '/(tabs)/search';
}
