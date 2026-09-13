import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions, StackRouter } from '@react-navigation/routers';
import { getPaywallIntent, openPurchasedDestination, rememberPaywallIntent, resetWelcomeJourney } from '../lib/paywallJourney';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

type Navigation = Parameters<typeof resetWelcomeJourney>[0];
function navigator(routeNames: string[], parent?: Navigation) {
  const router = StackRouter({});
  const options = { routeNames, routeParamList: {}, routeGetIdList: {} };
  let state = router.getInitialState(options);
  const navigation = {
    getState: () => state,
    getParent: () => parent,
    reset: (payload: Parameters<Navigation['reset']>[0]) => {
      const next = router.getStateForAction(state, CommonActions.reset(payload), options);
      if (!next) throw new Error('Reset was rejected by this navigator');
      state = router.getRehydratedState(next, options);
    },
  } as Navigation;
  return navigation;
}
function nestedStack() {
  const wrapper = navigator(['__root', '+not-found']);
  const app = navigator(['index', 'welcome', '(tabs)', 'restaurant/[id]'], wrapper);
  const welcome = navigator(['preview', 'trial', 'payment', 'notification-permission'], app);
  return { wrapper, app, welcome };
}
beforeEach(() => AsyncStorage.clear());

it.each(['payment', 'notification-permission'] as const)('completes into %s without resetting the Expo wrapper', screen => {
  const { app, welcome, wrapper } = nestedStack();
  resetWelcomeJourney(welcome, screen);
  expect(app.getState()!.routes).toHaveLength(1);
  expect(app.getState()!.routes[0]).toMatchObject({ name: 'welcome', state: { index: 0, routes: [{ name: screen }] } });
  expect(wrapper.getState()!.routes[0].name).toBe('__root');
});

it('opens the chosen meal and save action above search, then consumes the intent', async () => {
  const { app, welcome } = nestedStack();
  await rememberPaywallIntent({ restaurantId: 'restaurant', menuItemId: 'meal', action: 'save' });
  await openPurchasedDestination(welcome);
  expect(app.getState()!.index).toBe(1);
  expect(app.getState()!.routes.map(route => route.name)).toEqual(['(tabs)', 'restaurant/[id]']);
  expect(app.getState()!.routes[1].params).toEqual({ id: 'restaurant', selectedItemId: 'meal', saveSelected: '1' });
  expect(await getPaywallIntent()).toBeNull();
});

it('retains the meal intent if the application navigator is unavailable', async () => {
  await rememberPaywallIntent({ restaurantId: 'restaurant', action: 'menu' });
  await expect(openPurchasedDestination(navigator(['__root']))).rejects.toThrow('application navigator');
  expect(await getPaywallIntent()).toMatchObject({ restaurantId: 'restaurant' });
});
