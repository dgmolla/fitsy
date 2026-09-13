jest.unmock('react-native');

import React, { useEffect } from 'react';
import { Button, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, createNavigatorFactory, useNavigation, useNavigationBuilder, useRoute } from '@react-navigation/native';
import { StackActions, StackRouter, TabRouter } from '@react-navigation/routers';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { openPurchasedDestination, resetWelcomeJourney } from '../lib/paywallJourney';
import { getPaywallIntent, rememberPaywallIntent } from '../lib/paywallIntent';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: null } }),
  startAutoRefresh: () => undefined,
  stopAutoRefresh: () => undefined,
  } }) };
});

type NavigatorProps = { children: React.ReactNode; initialRouteName?: string };
function StackNavigator(props: NavigatorProps) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, props);
  const key = state.routes[state.index]!.key;
  return <NavigationContent><React.Fragment key={key}>{descriptors[key]!.render()}</React.Fragment></NavigationContent>;
}
function TabNavigator(props: NavigatorProps) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, props);
  const key = state.routes[state.index]!.key;
  return <NavigationContent><React.Fragment key={key}>{descriptors[key]!.render()}</React.Fragment></NavigationContent>;
}
const Root = createNavigatorFactory(StackNavigator)();
const App = createNavigatorFactory(StackNavigator)();
const Welcome = createNavigatorFactory(StackNavigator)();
const Tabs = createNavigatorFactory(TabNavigator)();
let action: 'payment' | 'notification' | 'purchased';
let declineDestination: 'payment' | 'preview';
let paymentRenders = 0;
function Payment() {
  const navigation = useNavigation();
  paymentRenders++;
  if (paymentRenders > 8) throw new Error('Payment remounted in a navigation loop');
  useEffect(() => {
    if (action === 'notification') resetWelcomeJourney(navigation, 'notification-permission');
    if (action === 'purchased') void openPurchasedDestination(navigation);
  }, [navigation]);
  return <>
    <Text>{navigation.canGoBack() ? 'Earlier screens remain' : 'No earlier screens'}</Text>
    <Button title="Browse meal preview" onPress={() => navigation.dispatch(StackActions.push('preview'))} />
    <Button title="Decline subscription" onPress={() => resetWelcomeJourney(navigation, declineDestination)} />
  </>;
}
function Preview() {
  const navigation = useNavigation();
  return <>
    <Text>{navigation.canGoBack() ? 'Earlier screens remain' : 'No earlier screens'}</Text>
    <Button title="See meal plans" onPress={() => navigation.dispatch(StackActions.push('payment'))} />
  </>;
}
function Notifications() { return <Text>Optional reminders</Text>; }
function Search() { return <Text>Meal search</Text>; }
function Saved() { return <Text>Saved tab</Text>; }
function Meal() {
  const route = useRoute();
  return <Text>{JSON.stringify(route.params)}</Text>;
}
function WelcomeScreens() {
  return <Welcome.Navigator><Welcome.Screen name="payment" component={Payment} /><Welcome.Screen name="preview" component={Preview} /><Welcome.Screen name="notification-permission" component={Notifications} /></Welcome.Navigator>;
}
function TabScreens() {
  return <Tabs.Navigator><Tabs.Screen name="saved" component={Saved} /><Tabs.Screen name="search" component={Search} /></Tabs.Navigator>;
}
function AppScreens() {
  return <App.Navigator><App.Screen name="welcome" component={WelcomeScreens} /><App.Screen name="(tabs)" component={TabScreens} /><App.Screen name="restaurant/[id]" component={Meal} /></App.Navigator>;
}
function Journey() {
  // Expo wraps the app and carries deep-link destination params on its parent.
  // Resetting only the inner state must not replay this old payment destination.
  return <NavigationContainer initialState={{ index: 0, routes: [
    { name: '__root', params: { screen: 'welcome', params: { screen: 'payment' } } },
  ] }}><Root.Navigator><Root.Screen name="__root" component={AppScreens} /></Root.Navigator></NavigationContainer>;
}
beforeEach(async () => { await AsyncStorage.clear(); paymentRenders = 0; declineDestination = 'payment'; });

it('shows optional reminders without replaying stale parent payment params', async () => {
  action = 'notification';
  const screen = render(<Journey />);
  await waitFor(() => expect(screen.getByText('Optional reminders')).toBeTruthy());
  expect(screen.queryByText('Decline subscription')).toBeNull();
  expect(paymentRenders).toBeLessThan(4);
});

it.each(['payment', 'preview'] as const)('ends a deliberate decline on a single %s destination', async (destination) => {
  action = 'payment';
  declineDestination = destination;
  const screen = render(<Journey />);
  await act(async () => { fireEvent.press(screen.getByText('Browse meal preview')); });
  await act(async () => { fireEvent.press(screen.getByText('See meal plans')); });
  expect(await screen.findByText('Earlier screens remain')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('Decline subscription')); });
  await waitFor(() => expect(screen.getAllByText(destination === 'payment' ? 'Decline subscription' : 'See meal plans')).toHaveLength(1));
  await waitFor(() => expect(screen.getByText('No earlier screens')).toBeTruthy());
  expect(screen.queryByText('Earlier screens remain')).toBeNull();
  expect(screen.queryByText(destination === 'payment' ? 'See meal plans' : 'Decline subscription')).toBeNull();
});

it('uses the real TabRouter to select search when no meal intent exists', async () => {
  action = 'purchased';
  const screen = render(<Journey />);
  await waitFor(() => expect(screen.getByText('Meal search')).toBeTruthy());
  expect(screen.queryByText('Saved tab')).toBeNull();
  expect(screen.queryByText('Decline subscription')).toBeNull();
});

it('opens the chosen meal and save action and consumes the intent', async () => {
  action = 'purchased';
  await rememberPaywallIntent({ restaurantId: 'restaurant', menuItemId: 'meal', action: 'save' });
  const screen = render(<Journey />);
  await waitFor(() => expect(screen.getByText(JSON.stringify({ id: 'restaurant', selectedItemId: 'meal', saveSelected: '1' }))).toBeTruthy());
  expect(await getPaywallIntent()).toBeNull();
});
