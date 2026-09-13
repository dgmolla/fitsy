jest.unmock('react-native');
import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { usePreviewTour } from '../lib/usePreviewTour';
import { resetPreviewSample } from '../lib/teaserGate';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('../lib/supabase', () => ({ supabase: { auth: {} } }));
jest.mock('../lib/purchases', () => ({ fetchCustomerInfo: jest.fn(), hasLapsedEntitlement: jest.fn() }));

function Preview({ ready }: { ready: boolean }) {
  const tour = usePreviewTour(ready);
  return <><Text>{tour.visible ? 'Story visible' : 'Browsing'}</Text><Pressable testID="replay" onPress={tour.start} /><Pressable testID="finish" onPress={tour.finish} /></>;
}
beforeEach(() => { jest.useFakeTimers(); mockFocused = true; resetPreviewSample(); });
afterEach(() => jest.useRealTimers());

it('retries a cancelled start after a filter closes, and keeps replay available after completion', async () => {
  const screen = render(<Preview ready />);
  await act(async () => {});
  act(() => { jest.advanceTimersByTime(300); });
  screen.rerender(<Preview ready={false} />);
  act(() => { jest.advanceTimersByTime(1000); });
  expect(screen.getByText('Browsing')).toBeTruthy();
  screen.rerender(<Preview ready />);
  act(() => { jest.advanceTimersByTime(600); });
  expect(screen.getByText('Story visible')).toBeTruthy();
  fireEvent.press(screen.getByTestId('finish'));
  screen.unmount();
  const restarted = render(<Preview ready />);
  await act(async () => {});
  act(() => { jest.advanceTimersByTime(1000); });
  expect(restarted.getByText('Browsing')).toBeTruthy();
  fireEvent.press(restarted.getByTestId('replay'));
  expect(restarted.getByText('Story visible')).toBeTruthy();
});

it('does not show over another screen, then starts when the preview regains focus', async () => {
  const screen = render(<Preview ready />);
  await act(async () => {});
  act(() => { jest.advanceTimersByTime(300); });
  mockFocused = false;
  screen.rerender(<Preview ready />);
  act(() => { jest.advanceTimersByTime(1000); });
  fireEvent.press(screen.getByTestId('replay'));
  expect(screen.getByText('Browsing')).toBeTruthy();
  mockFocused = true;
  screen.rerender(<Preview ready />);
  act(() => { jest.advanceTimersByTime(600); });
  expect(screen.getByText('Story visible')).toBeTruthy();
});
