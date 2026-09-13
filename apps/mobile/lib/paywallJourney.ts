import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { z } from 'zod';

const KEY = '@fitsy/paywallIntent';
const schema = z.object({
  restaurantId: z.string().min(1).optional(),
  menuItemId: z.string().min(1).optional(),
  mealName: z.string().optional(),
  action: z.enum(['menu', 'save', 'discovery']),
  nearbyDishCount: z.number().int().nonnegative().optional(),
  areaName: z.string().optional(),
});
export type PaywallIntent = z.infer<typeof schema>;
export async function rememberPaywallIntent(intent: PaywallIntent): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(schema.parse(intent)));
}
export async function getPaywallIntent(): Promise<PaywallIntent | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? schema.parse(JSON.parse(raw)) : null;
  } catch { return null; }
}
export async function clearPaywallIntent(): Promise<void> { await AsyncStorage.removeItem(KEY); }

type Navigation = Pick<NavigationProp<ParamListBase>, 'reset' | 'getParent'> & {
  getState: () => ReturnType<NavigationProp<ParamListBase>['getState']> | undefined;
};
function appStackOf(navigation: Navigation): Navigation {
  // Expo has an outer navigator whose only app route is __root.
  // Reset the stack that actually owns Fitsy's routes, not that wrapper.
  let current: Navigation | undefined = navigation;
  while (current) {
    const names = current.getState()?.routeNames;
    if (names?.includes('welcome') && names.includes('(tabs)')) return current;
    current = current.getParent();
  }
  throw new Error('Fitsy application navigator is unavailable');
}

/** These are completion actions, never Back actions. Reset the entire stack. */
export function resetWelcomeJourney(navigation: Navigation, screen: 'payment' | 'notification-permission'): void {
  appStackOf(navigation).reset({ index: 0, routes: [{ name: 'welcome', state: { index: 0, routes: [{ name: screen }] } }] });
}
export async function openPurchasedDestination(navigation: Navigation): Promise<void> {
  const intent = await getPaywallIntent();
  const routes = [{ name: '(tabs)', state: { index: 0, routes: [{ name: 'search' }] } },
    ...(intent?.restaurantId ? [{ name: 'restaurant/[id]', params: {
      id: intent.restaurantId,
      ...(intent.menuItemId ? { selectedItemId: intent.menuItemId } : {}),
      ...(intent.action === 'save' ? { saveSelected: '1' } : {}),
    } }] : []),
  ];
  appStackOf(navigation).reset({ index: routes.length - 1, routes });
  await clearPaywallIntent();
}
