import { StackRouter, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { clearPaywallIntent, getPaywallIntent, getPurchasedContinuation, markPurchasedContinuation } from './paywallIntent';
import { getMacroTargets } from './macroStorage';
import { recordOnboardingComplete } from './onboardingCompletion';

type Navigation = Pick<NavigationProp<ParamListBase>, 'reset' | 'getParent'> & {
  getState: () => ReturnType<NavigationProp<ParamListBase>['getState']> | undefined;
};
function appStackOf(navigation: Navigation): Navigation {
  let current: Navigation | undefined = navigation;
  while (current) {
    const names = current.getState()?.routeNames;
    if (names?.includes('welcome') && names.includes('(tabs)')) return current;
    current = current.getParent();
  }
  throw new Error('Fitsy application navigator is unavailable');
}

type JourneyState = { index: number; routes: { name: string; params?: Record<string, unknown>; state?: JourneyState }[] };
function nestedRoute(name: string, state: JourneyState) {
  // Keep React Navigation's nested destination params consistent with state.
  // An old screen=payment param otherwise recreates the paywall after reset.
  return { name, params: { state }, state };
}
function resetJourney(navigation: Navigation, state: JourneyState): void {
  let current = appStackOf(navigation);
  let parent = current.getParent();
  while (parent) {
    const parentState = parent.getState();
    const route = parentState?.routes.find(candidate => candidate.state?.key === current.getState()?.key)
      ?? (parentState && parentState.routes[parentState.index]);
    if (!route) throw new Error('Fitsy parent navigator is unavailable');
    state = { index: 0, routes: [nestedRoute(route.name, state)] };
    current = parent;
    parent = current.getParent();
  }
  // Reset from the top, replacing parent deep-link params as well as history.
  const root = current.getState();
  if (!root || root.type !== 'stack') throw new Error('Fitsy root stack is unavailable');
  // Give the root a complete state before old child navigators unmount.
  // Their cleanup can otherwise read the previous hydrated state and replay it.
  const next = StackRouter({}).getRehydratedState(state, {
    routeNames: root.routeNames, routeParamList: {}, routeGetIdList: {},
  });
  current.reset(next);
}

/** These are completion actions, never Back actions. Reset the entire stack. */
export function resetWelcomeJourney(navigation: Navigation, screen: 'payment' | 'resubscribe' | 'problem' | 'preview' | 'notification-permission'): void {
  resetJourney(navigation, { index: 0, routes: [nestedRoute('welcome', { index: 0, routes: [{ name: screen }] })] });
}
export async function openPurchasedDestination(navigation: Navigation, options?: { resumeOnly: true; isCurrent: () => boolean } | { requireTargets: true; isCurrent?: () => boolean }): Promise<boolean> {
  const resume = options && 'resumeOnly' in options;
  const isCurrent = options?.isCurrent ?? (() => true);
  const intent = resume ? await getPurchasedContinuation() : await getPaywallIntent();
  if (!isCurrent() || (resume && !intent)) return false;
  if (options && 'requireTargets' in options && !(await getMacroTargets())) {
    if (!isCurrent()) return false;
    // An entitled account may need targets before opening the selected meal.
    // Persist the owned selection for that final setup step and cold resumes.
    await markPurchasedContinuation();
    if (!isCurrent()) return false;
    resetJourney(navigation, { index: 0, routes: [{ name: 'macro-setup' }] });
    return true;
  }
  const routes = [nestedRoute('(tabs)', { index: 0, routes: [{ name: 'search', ...(intent?.query ? { params: { query: intent.query } } : {}) }] }),
    ...(intent?.restaurantId ? [{ name: 'restaurant/[id]', params: {
      id: intent.restaurantId,
      ...(intent.menuItemId ? { selectedItemId: intent.menuItemId } : {}),
      ...(intent.action === 'save' ? { saveSelected: '1' } : {}),
    } }] : []),
  ];
  if (!isCurrent()) return false;
  // Every active-account route that opens a purchased destination completes
  // onboarding, including sign-in and cold-resume paths that skip the paywall.
  await recordOnboardingComplete(false);
  if (!isCurrent()) return false;
  resetJourney(navigation, { index: routes.length - 1, routes });
  await clearPaywallIntent();
  return true;
}
