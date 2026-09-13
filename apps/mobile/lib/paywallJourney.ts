import { StackRouter, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import { clearPaywallIntent, getPaywallIntent } from './paywallIntent';

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
export function resetWelcomeJourney(navigation: Navigation, screen: 'payment' | 'preview' | 'notification-permission'): void {
  resetJourney(navigation, { index: 0, routes: [nestedRoute('welcome', { index: 0, routes: [{ name: screen }] })] });
}
export async function openPurchasedDestination(navigation: Navigation): Promise<void> {
  const intent = await getPaywallIntent();
  const routes = [nestedRoute('(tabs)', { index: 0, routes: [{ name: 'search' }] }),
    ...(intent?.restaurantId ? [{ name: 'restaurant/[id]', params: {
      id: intent.restaurantId,
      ...(intent.menuItemId ? { selectedItemId: intent.menuItemId } : {}),
      ...(intent.action === 'save' ? { saveSelected: '1' } : {}),
    } }] : []),
  ];
  resetJourney(navigation, { index: routes.length - 1, routes });
  await clearPaywallIntent();
}
