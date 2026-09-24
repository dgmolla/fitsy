jest.unmock('react-native');
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import GoalScreen from '../app/welcome/goal';
import { getOnboardingData, saveOnboardingField } from '../lib/onboardingStorage';

const mockFocus = {
  active: true,
  listeners: new Map<() => void | (() => void), (() => void) | undefined>(),
  blur() {
    this.active = false;
    for (const cleanup of this.listeners.values()) cleanup?.();
  },
  focus() {
    this.active = true;
    for (const callback of this.listeners.keys()) this.listeners.set(callback, callback() ?? undefined);
  },
};

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('expo-router', () => {
  const React = require('react') as typeof import('react');
  return {
    router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
    useNavigation: () => ({ canGoBack: () => false, isFocused: () => mockFocus.active }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(() => {
        mockFocus.listeners.set(callback, mockFocus.active ? callback() ?? undefined : undefined);
        return () => {
          mockFocus.listeners.get(callback)?.();
          mockFocus.listeners.delete(callback);
        };
      }, [callback]);
    },
  };
});
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => ({ capture: jest.fn() }));
});

beforeEach(async () => {
  mockFocus.active = true;
  mockFocus.listeners.clear();
  await AsyncStorage.clear();
});

it('refreshes a retained goal screen after assisted target tuning changes the saved goal', async () => {
  await saveOnboardingField('goal', 'lose_fat');
  const screen = render(<GoalScreen />);
  await waitFor(() => expect(screen.getByTestId('goal-lose_fat').props.accessibilityState?.selected).toBe(true));
  await act(async () => { mockFocus.blur(); });
  await saveOnboardingField('goal', 'build_muscle');
  await act(async () => { mockFocus.focus(); });
  await waitFor(() => expect(screen.getByTestId('goal-build_muscle').props.accessibilityState?.selected).toBe(true));
  expect(screen.getByTestId('goal-lose_fat').props.accessibilityState?.selected).toBe(false);
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect((await getOnboardingData()).goal).toBe('build_muscle');
});
