jest.unmock('react-native');
jest.unmock('expo-router');
import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import { router } from 'expo-router';
import Tried from '../app/welcome/tried';
import Response from '../app/welcome/response';
import Payoff from '../app/welcome/value-payoff';
import GoalPayoff from '../app/welcome/goal-payoff';
import Targets from '../app/welcome/target-setup';
import Tuning from '../app/welcome/tuning';
import Trust from '../app/welcome/how-it-works';
import Goal from '../app/welcome/goal';
import Height from '../app/welcome/height';
import Weight from '../app/welcome/weight';
import Age from '../app/welcome/age';
import Sex from '../app/welcome/sex';
import Activity from '../app/welcome/activity';
import MacrosIntro from '../app/welcome/macros-intro';
import MacroSetup from '../app/macro-setup';
import { getOnboardingData, saveOnboardingField } from '../lib/onboardingStorage';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('@fitsy/shared', () => ({ calculateAge: () => 28 }));
jest.mock('../lib/profileSync', () => ({ pushProfileToServer: jest.fn() }));
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => ({ capture: jest.fn() }));
});

const routes = {
  'welcome/tried': Tried, 'welcome/response': Response, 'welcome/value-payoff': Payoff,
  'welcome/target-setup': Targets, 'welcome/tuning': Tuning, 'welcome/how-it-works': Trust,
  'welcome/goal': Goal, 'welcome/height': Height, 'welcome/goal-payoff': GoalPayoff,
  'welcome/weight': Weight, 'welcome/age': Age, 'welcome/sex': Sex,
  'welcome/activity': Activity, 'welcome/macros-intro': MacrosIntro,
  'welcome/preview': () => <Text>Discovery preview</Text>,
  'welcome/location-permission': () => <Text>Choose your area</Text>,
  'macro-setup': MacroSetup,
  '(tabs)/search': () => <Text>Search for meals</Text>,
};
beforeEach(async () => {
  jest.mocked(AsyncStorage.setItem).mockImplementation((key, value) => AsyncStorage.multiSet([[key, value]]));
  await AsyncStorage.clear();
});

it('keeps the chosen screen after leaving goal choice during a pending save', async () => {
  let releaseSave!: () => void;
  let saveStarted!: () => void;
  const pendingSave = new Promise<void>(resolve => { releaseSave = resolve; });
  const started = new Promise<void>(resolve => { saveStarted = resolve; });
  const storage = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    if (key === '@fitsy/onboarding' && JSON.parse(value).goal === 'build_muscle') {
      saveStarted();
      await pendingSave;
    }
    await AsyncStorage.multiSet([[key, value]]);
  });
  try {
    const screen = renderRouter(routes, { initialUrl: '/welcome/location-permission' });
    await act(async () => { router.push('/welcome/goal'); });
    await act(async () => { fireEvent.press(screen.getByTestId('goal-build_muscle')); });
    await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
    await started;
    await act(async () => { router.back(); });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/location-permission'));
    await act(async () => { releaseSave(); });
    await waitFor(() => expect((getOnboardingData())).resolves.toEqual(expect.objectContaining({ goal: 'build_muscle' })));
    expect(screen.getPathname()).toBe('/welcome/location-permission');
  } finally {
    releaseSave();
    storage.mockRestore();
  }
});

it('does not leave a prior-approach screen after Back during a pending save', async () => {
  let releaseSave!: () => void;
  let saveStarted!: () => void;
  const pendingSave = new Promise<void>(resolve => { releaseSave = resolve; });
  const started = new Promise<void>(resolve => { saveStarted = resolve; });
  const storage = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    if (key === '@fitsy/onboarding' && JSON.parse(value).tried === 'meal_prep') {
      saveStarted();
      await pendingSave;
    }
    await AsyncStorage.multiSet([[key, value]]);
  });
  try {
    const screen = renderRouter(routes, { initialUrl: '/welcome/goal' });
    await act(async () => {});
    await act(async () => { fireEvent.press(screen.getByTestId('goal-build_muscle')); });
    await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/tried'));
    await screen.findByTestId('tried-meal_prep');
    await act(async () => { fireEvent.press(screen.getByTestId('tried-meal_prep')); });
    await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
    await started;
    await act(async () => { router.back(); });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/goal'));
    await act(async () => { releaseSave(); });
    await waitFor(() => expect(getOnboardingData()).resolves.toEqual(expect.objectContaining({ tried: 'meal_prep' })));
    expect(screen.getPathname()).toBe('/welcome/goal');
  } finally {
    releaseSave();
    storage.mockRestore();
  }
});

it.each([
  ['/welcome/target-setup', '@fitsy/onboarding'],
  ['/welcome/tuning', '@fitsy/macro_targets'],
] as const)('keeps Back on the prior-approach screen when %s finishes a pending save', async (route, heldKey) => {
  let releaseSave!: () => void;
  let saveStarted!: () => void;
  const pendingSave = new Promise<void>(resolve => { releaseSave = resolve; });
  const started = new Promise<void>(resolve => { saveStarted = resolve; });
  await saveOnboardingField('goal', 'build_muscle');
  expect((await getOnboardingData()).goal).toBe('build_muscle');
  const screen = renderRouter(routes, { initialUrl: '/welcome/tried' });
  await screen.findByTestId('tried-meal_prep');
  await act(async () => { router.push(route); });
  await waitFor(() => expect(screen.getPathname()).toBe(route));
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityState?.disabled).not.toBe(true));
  const storage = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    if (key === heldKey && (heldKey !== '@fitsy/onboarding' || JSON.parse(value).targetMode === 'known')) {
      saveStarted();
      await pendingSave;
    }
    await AsyncStorage.multiSet([[key, value]]);
  });
  try {
    await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
    await started;
    await act(async () => { router.back(); });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/tried'));
    await act(async () => { releaseSave(); });
    await waitFor(async () => {
      const saved = await AsyncStorage.getItem(heldKey);
      expect(saved).not.toBeNull();
      if (heldKey === '@fitsy/onboarding') expect(JSON.parse(saved!).targetMode).toBe('known');
    });
    expect(screen.getPathname()).toBe('/welcome/tried');
  } finally {
    releaseSave();
    storage.mockRestore();
  }
});
