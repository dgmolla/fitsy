import { act, fireEvent, installPurchasedAccount, mockState, renderJourney, response, routes, saveMacroTargets,
  withAccountProfile, waitFor } from './OnboardingNavigationHarness';
import React from 'react';
import { NativeModules } from 'react-native';
import { Stack } from 'expo-router';
import WidgetScreen from '../app/widget';
import Profile from '../app/(tabs)/profile';
import { WidgetSync } from './WidgetSync';
import { PurchasesProvider } from '../lib/usePurchases';
import { saveWidgetLocation } from '../lib/widgetSync';
import { clearToken } from '../lib/authClient';

const configure = jest.fn(async (_json: string) => undefined);
const clear = jest.fn(async () => undefined);
const token = 'a'.repeat(64);
const routeMap = { ...routes, widget: WidgetScreen, '(tabs)/profile': Profile,
  _layout: () => <PurchasesProvider><WidgetSync /><Stack screenOptions={{ headerShown: false }} /></PurchasesProvider> };
beforeEach(() => {
  NativeModules.FitsyWidgetBridge = { configure, clear };
  configure.mockClear(); clear.mockClear();
});
afterEach(() => { delete NativeModules.FitsyWidgetBridge; });

function transport(active: boolean, verdict = active ? 'active' : 'never_subscribed') {
  global.fetch = jest.fn(withAccountProfile(async (_input, init) => init?.method === 'POST' && String(_input).endsWith('/api/widget/token')
    ? response({ token, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() })
    : response({ active, status: active ? 'active' : 'expired', verdict, synced: true, stale: false,
      lastRcVerifiedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString() })));
}

it('offers illustrated setup from Profile and synchronizes real account data through the root consumer', async () => {
  await installPurchasedAccount(); transport(true);
  await saveMacroTargets({ protein: '40', carbs: '60', fat: '20', calories: '580' });
  await saveWidgetLocation(34, -118);
  const screen = renderJourney('/profile', routeMap);
  await screen.findByTestId('profile-widget');
  await act(async () => fireEvent.press(screen.getByTestId('profile-widget')));
  await screen.findByTestId('widget-step-3');
  expect(screen.getByTestId('widget-step-1')).toBeTruthy();
  expect(screen.getByTestId('widget-step-2')).toBeTruthy();
  await waitFor(() => expect(configure).toHaveBeenCalled());
  expect(JSON.parse(configure.mock.calls.at(-1)![0])).toMatchObject({ owner: 'buyer', token, locked: false,
    query: { lat: '34', lng: '-118', protein: '40' } });
  await act(async () => { await clearToken(); });
  expect(mockState.session).toBeNull();
  expect(clear).toHaveBeenCalled();
});

it('keeps non-subscribers locked and opens the existing paywall from the widget deep link', async () => {
  mockState.session = { access_token: 'test-token', user: { id: 'free-account' } };
  transport(false);
  const screen = renderJourney('/widget', routeMap);
  await screen.findByTestId('widget-unlock');
  expect(screen.queryByTestId('widget-step-1')).toBeNull();
  await act(async () => fireEvent.press(screen.getByTestId('widget-unlock')));
  await screen.findByText('Payment plans');
});

it('routes an expired subscriber widget to the existing resubscribe flow', async () => {
  mockState.session = { access_token: 'test-token', user: { id: 'expired-account' } };
  transport(false, 'expired');
  const screen = renderJourney('/widget?upgrade=1', routeMap);
  await screen.findByText('Resubscribe plans');
});
