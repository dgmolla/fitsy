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

type Navigation = Pick<NavigationProp<ParamListBase>, 'reset' | 'getParent'>;
function rootOf(navigation: Navigation): Navigation {
  let root = navigation;
  while (root.getParent()) root = root.getParent()!;
  return root;
}

/** These are completion actions, never Back actions. Reset the entire stack. */
export function resetWelcomeJourney(navigation: Navigation, screen: 'payment' | 'notification-permission'): void {
  rootOf(navigation).reset({ index: 0, routes: [{ name: 'welcome', state: { index: 0, routes: [{ name: screen }] } }] });
}
export async function openPurchasedDestination(navigation: Navigation): Promise<void> {
  const intent = await getPaywallIntent();
  await clearPaywallIntent();
  const routes = [{ name: '(tabs)', state: { index: 0, routes: [{ name: 'search' }] } },
    ...(intent?.restaurantId ? [{ name: 'restaurant/[id]', params: {
      id: intent.restaurantId,
      ...(intent.menuItemId ? { selectedItemId: intent.menuItemId } : {}),
      ...(intent.action === 'save' ? { saveSelected: '1' } : {}),
    } }] : []),
  ];
  rootOf(navigation).reset({ index: routes.length - 1, routes });
}
