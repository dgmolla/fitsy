jest.unmock('react-native');
import React from 'react';
import { Pressable, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render } from '@testing-library/react-native';
import { usePreviewTour } from '../lib/usePreviewTour';
import { resetPreviewSample } from '../lib/teaserGate';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('@supabase/supabase-js', () => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://preview-tour.example.test';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'preview-tour-unit-test';
  return jest.requireActual('../__mocks__/supabase-js');
});
jest.mock('react-native-url-polyfill/auto', () => ({}));
jest.mock('react-native-purchases', () => jest.requireActual('../__mocks__/react-native-purchases'));
jest.mock('react-native-purchases-ui', () => jest.requireActual('../__mocks__/react-native-purchases-ui'));

function Preview({ ready, enabled = ready }: { ready: boolean; enabled?: boolean }) {
  const tour = usePreviewTour(ready, enabled);
  return <><Text>{tour.visible ? 'Story visible' : 'Browsing'}</Text><Pressable testID="replay" onPress={tour.start} /><Pressable testID="finish" onPress={tour.finish} /></>;
}
// React Native loads its host components lazily on the first render.
// Initialize that test harness once, outside the timed asynchronous journey.
// The cold parallel suite otherwise spent over 10 seconds in render itself.
beforeAll(() => {
  const native = render(<><Text>Native harness ready</Text><Pressable testID="native-harness-button" /></>);
  native.unmount();
});

beforeEach(async () => {
  jest.useRealTimers();
  mockFocused = true;
  resetPreviewSample();
  await AsyncStorage.clear();
  // Only the tour delay needs a fake clock. React's async act completion uses
  // immediate tasks and microtasks, which must still run under suite load.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask'] });
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

async function advanceTourClock(milliseconds: number) {
  await act(async () => { await jest.advanceTimersByTimeAsync(milliseconds); });
}

it('retries a cancelled start after a filter closes, and keeps replay available after completion', async () => {
  const screen = render(<Preview ready />);
  await act(async () => {});
  await advanceTourClock(300);
  screen.rerender(<Preview ready={false} />);
  await advanceTourClock(1000);
  expect(screen.getByText('Browsing')).toBeTruthy();
  screen.rerender(<Preview ready />);
  await advanceTourClock(600);
  expect(screen.getByText('Story visible')).toBeTruthy();
  fireEvent.press(screen.getByTestId('finish'));
  screen.unmount();
  const restarted = render(<Preview ready />);
  await act(async () => {});
  await advanceTourClock(1000);
  expect(restarted.getByText('Browsing')).toBeTruthy();
  fireEvent.press(restarted.getByTestId('replay'));
  expect(restarted.getByText('Story visible')).toBeTruthy();
});

it('does not show over another screen, then starts when the preview regains focus', async () => {
  const screen = render(<Preview ready />);
  await act(async () => {});
  await advanceTourClock(300);
  mockFocused = false;
  screen.rerender(<Preview ready />);
  await advanceTourClock(1000);
  fireEvent.press(screen.getByTestId('replay'));
  expect(screen.getByText('Browsing')).toBeTruthy();
  mockFocused = true;
  screen.rerender(<Preview ready />);
  await advanceTourClock(600);
  expect(screen.getByText('Story visible')).toBeTruthy();
});


it('keeps an active story visible while its real search is loading, but closes when disabled or blurred', async () => {
  const screen = render(<Preview ready enabled />);
  await act(async () => {});
  await advanceTourClock(600);
  expect(screen.getByText('Story visible')).toBeTruthy();
  screen.rerender(<Preview ready={false} enabled />);
  await advanceTourClock(1000);
  expect(screen.getByText('Story visible')).toBeTruthy();
  screen.rerender(<Preview ready enabled={false} />);
  expect(screen.getByText('Browsing')).toBeTruthy();
  screen.rerender(<Preview ready enabled />);
  fireEvent.press(screen.getByTestId('replay'));
  expect(screen.getByText('Story visible')).toBeTruthy();
  mockFocused = false;
  screen.rerender(<Preview ready enabled />);
  expect(screen.getByText('Browsing')).toBeTruthy();
});
