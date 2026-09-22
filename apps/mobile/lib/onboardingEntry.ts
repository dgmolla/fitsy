import type { getOnboardingResume } from './onboardingResume';

type Resume = Awaited<ReturnType<typeof getOnboardingResume>>;
export type EntryDestination = Resume | '/(tabs)/search' | '/welcome/problem' | '/macro-setup' | '/welcome/resubscribe';
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
}

/** Resolve persisted onboarding and settled account access in one precedence order. */
export function onboardingEntry(state: EntryState): EntryDestination {
  // A purchase can complete before its onboarding storage writes finish.
  // Wait for that account's verdict before resuming an old payment screen.
  if (state.signedIn && !state.purchasesReady) return null;
  if (!state.isLapsed && !state.completed && state.resume && !state.declined && state.entitled !== true) {
    return state.signedIn && state.resume === '/welcome/signin' ? '/welcome/payment' : state.resume;
  }
  if (!state.signedIn) {
    if (!state.declined) return '/welcome/problem';
    if (!state.purchasesReady) return null;
    return state.access === 'preview' ? '/welcome/preview' : '/welcome/payment';
  }
  if (!state.hasTargets) return '/macro-setup';
  return state.entitled === true || !state.isLapsed ? '/(tabs)/search' : '/welcome/resubscribe';
}
