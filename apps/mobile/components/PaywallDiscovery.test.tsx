jest.unmock('react-native');
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import { PaywallChoiceHero } from './PaywallChoiceHero';
import { usePaywallDiscovery } from '../lib/usePaywallDiscovery';
import { clearPaywallIntent, rememberPaywallIntent } from '../lib/paywallIntent';
import { fetchGuidedPreview } from '../lib/guidedPreview';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
  return { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), startAutoRefresh() {}, stopAutoRefresh() {} } }) };
});

const area = { lat: 34.0522, lng: -118.2437 };
const targets = { calories: '600', protein: '', carbs: '', fat: '' };
const originalFetch = global.fetch;
function Harness({ focused }: { focused: boolean }) { return <PaywallChoiceHero discovery={usePaywallDiscovery(focused)} />; }
function selected(id: string, query: string) {
  return { action: 'menu' as const, restaurantId: id, restaurantName: `Restaurant ${id}`, menuItemId: `${id}-meal`, photoUrl: `https://example.com/${id}.jpg`, area, targets, query };
}
function response(id: string, selectedItemMatches = true) {
  return { ok: true, status: 200, json: async () => ({ data: [{ id, name: `Restaurant ${id}`, address: 'Test', lat: area.lat, lng: area.lng, distanceMiles: 1, cuisineTags: [], chainFlag: false,
    photoUrl: `https://example.com/${id}.jpg`, bestMatch: { menuItemId: `${id}-meal`, name: 'Test meal', calories: 600, proteinG: 40, carbsG: 60, fatG: 20, confidence: 'HIGH', matchScore: 0 } }],
    meta: { nearbyDishCount: 100, radiusMiles: 3, goalMatch: { policy: 'within-20-percent-v1', activeTargets: { calories: 600 }, matchingDishCount: 19, additionalDishCount: selectedItemMatches ? 18 : 19, selectedItemMatches } } }) } as Response;
}
beforeEach(async () => { await AsyncStorage.clear(); global.fetch = jest.fn().mockResolvedValue(response('old')); });
afterEach(() => { global.fetch = originalFetch; });

it('removes the previous restaurant and count as soon as the paywall loses focus', async () => {
  await rememberPaywallIntent(selected('old', 'blur-proof'));
  const screen = render(<Harness focused />);
  expect(await screen.findByText('+18')).toBeTruthy();
  screen.rerender(<Harness focused={false} />);
  expect(screen.queryByTestId('paywall-local-proof')).toBeNull();
  expect(screen.queryByTestId('paywall-selected-restaurant')).toBeNull();
});

it('does not retain previous proof when refocusing after a cleared intent and failed storage read', async () => {
  await rememberPaywallIntent(selected('old', 'storage-failure'));
  const screen = render(<Harness focused />);
  expect(await screen.findByText('+18')).toBeTruthy();
  screen.rerender(<Harness focused={false} />);
  await clearPaywallIntent();
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('storage unavailable'));
  await act(async () => { screen.rerender(<Harness focused />); });
  expect(screen.queryByTestId('paywall-local-proof')).toBeNull();
  expect(screen.queryByTestId('paywall-selected-restaurant')).toBeNull();
  expect(screen.queryByLabelText('Photo of Restaurant old')).toBeNull();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('retains only the newly read selection when a different context fails, never an old cached count', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(response('cached', false));
  await fetchGuidedPreview(area, 'cached-context', targets);
  await rememberPaywallIntent(selected('cached', 'cached-context'));
  const screen = render(<Harness focused />);
  expect(await screen.findByText('+18')).toBeTruthy();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  screen.rerender(<Harness focused={false} />);
  await rememberPaywallIntent(selected('new', 'new-offline-context'));
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await act(async () => { screen.rerender(<Harness focused />); });
  expect(await screen.findByLabelText('Photo of Restaurant new')).toBeTruthy();
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId('paywall-local-proof')).toBeNull();
  expect(screen.queryByLabelText('Photo of Restaurant cached')).toBeNull();
});

it('keeps the selected restaurant but removes numerical proof if it no longer belongs to the visible picks', async () => {
  await rememberPaywallIntent(selected('previous-pick', 'changed-availability'));
  (global.fetch as jest.Mock).mockResolvedValueOnce(response('replacement-pick', false));
  const screen = render(<Harness focused />);
  expect(await screen.findByLabelText('Photo of Restaurant previous-pick')).toBeTruthy();
  expect(await screen.findByLabelText('Photo of Restaurant replacement-pick')).toBeTruthy();
  expect(screen.queryByTestId('paywall-local-proof')).toBeNull();
  expect(screen.queryByText('+19')).toBeNull();
});
