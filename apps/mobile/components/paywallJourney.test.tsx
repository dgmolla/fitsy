jest.unmock('react-native');

import React, { useEffect } from 'react';
import { Button, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer, createNavigatorFactory, useNavigation, useNavigationBuilder, useRoute } from '@react-navigation/native';
import { StackRouter, TabRouter } from '@react-navigation/routers';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { getPaywallIntent, openPurchasedDestination, rememberPaywallIntent, resetWelcomeJourney } from '../lib/paywallJourney';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

type NavigatorProps = { children: React.ReactNode; initialRouteName?: string };
function StackNavigator(props: NavigatorProps) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, props);
  return <NavigationContent>{descriptors[state.routes[state.index]!.key]!.render()}</NavigationContent>;
}
function TabNavigator(props: NavigatorProps) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, props);
  return <NavigationContent>{descriptors[state.routes[state.index]!.key]!.render()}</NavigationContent>;
}
const Root = createNavigatorFactory(StackNavigator)();
const App = createNavigatorFactory(StackNavigator)();
const Welcome = createNavigatorFactory(StackNavigator)();
const Tabs = createNavigatorFactory(TabNavigator)();
let action: 'payment' | 'notification' | 'purchased';
let paymentRenders = 0;
function Payment() {
  const navigation = useNavigation();
  paymentRenders++;
  if (paymentRenders > 8) throw new Error('Payment remounted in a navigation loop');
  useEffect(() => {
    if (action === 'notification') resetWelcomeJourney(navigation, 'notification-permission');
    if (action === 'purchased') void openPurchasedDestination(navigation);
  }, [navigation]);
  return <Button title="Decline subscription" onPress={() => resetWelcomeJourney(navigation, 'payment')} />;
}
function Notifications() { return <Text>Optional reminders</Text>; }
function Search() { return <Text>Meal search</Text>; }
function Saved() { return <Text>Saved tab</Text>; }
function Meal() {
  const route = useRoute();
  return <Text>{JSON.stringify(route.params)}</Text>;
}
function WelcomeScreens() {
  return <Welcome.Navigator><Welcome.Screen name="payment" component={Payment} /><Welcome.Screen name="notification-permission" component={Notifications} /></Welcome.Navigator>;
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
  return <NavigationContainer><Root.Navigator><Root.Screen name="__root" component={AppScreens}
    initialParams={{ screen: 'welcome', params: { screen: 'payment' } }} /></Root.Navigator></NavigationContainer>;
}
beforeEach(async () => { await AsyncStorage.clear(); paymentRenders = 0; });

it('shows optional reminders without replaying stale parent payment params', async () => {
  action = 'notification';
  const screen = render(<Journey />);
  await waitFor(() => expect(screen.getByText('Optional reminders')).toBeTruthy());
  expect(screen.queryByText('Decline subscription')).toBeNull();
  expect(paymentRenders).toBeLessThan(4);
});

it('keeps a deliberate hard decline on a single payment destination', async () => {
  action = 'payment';
  const screen = render(<Journey />);
  fireEvent.press(await screen.findByText('Decline subscription'));
  await waitFor(() => expect(screen.getAllByText('Decline subscription')).toHaveLength(1));
  expect(paymentRenders).toBeLessThan(4);
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
