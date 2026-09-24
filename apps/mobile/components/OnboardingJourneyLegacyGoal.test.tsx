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
import { getOnboardingResume } from '../lib/onboardingResume';

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

it('clears a signed-in goal checkpoint when macro setup is skipped', async () => {
  await saveOnboardingField('goal', 'performance');
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'goal');
  const screen = renderRouter(routes, { initialUrl: '/macro-setup' });
  await screen.findByTestId('macro-setup-skip');
  await act(async () => { fireEvent.press(screen.getByTestId('macro-setup-skip')); });
  await waitFor(() => expect(screen.getByText('Search for meals')).toBeTruthy());
  expect(await getOnboardingResume()).toBeNull();
});


it.each([
  ['lose_fat', 'Consistency with your fat-loss plan'],
  ['build_muscle', 'Consistency with your muscle-building plan'],
  ['performance', 'Consistency with your training nutrition'],
] as const)('carries %s through the complete personalized story and into target setup', async (goal, graphLabel) => {
  const screen = renderRouter(routes, { initialUrl: '/welcome/goal' });
  await act(async () => {});
  expect(screen.getByTestId('welcome-continue').props.accessibilityState?.disabled).toBe(true);
  await act(async () => { fireEvent.press(screen.getByTestId(`goal-${goal}`)); });
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/tried'));
  await act(async () => { fireEvent.press(screen.getByTestId('tried-check_online')); });
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(await screen.findByTestId('story-check_online')).toBeTruthy();
  expect(screen.getByText('One place to compare')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(await screen.findByTestId('payoff-check_online')).toBeTruthy();
  expect(screen.getByText('Protein target')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(await screen.findByText(graphLabel)).toBeTruthy();
  expect(screen.getByText(/Illustration only/)).toBeTruthy();
  expect(await getOnboardingResume()).toBe('/welcome/goal-payoff');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/target-setup'));
  expect(await getOnboardingData()).toEqual(expect.objectContaining({ goal, tried: 'check_online' }));
});

it('requires a visible goal choice when an old maintenance goal is saved', async () => {
  await saveOnboardingField('goal', 'maintain');
  const screen = renderRouter(routes, { initialUrl: '/welcome/goal' });
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityState?.disabled).toBe(true));
  for (const goal of ['lose_fat', 'build_muscle', 'performance']) {
    expect(screen.getByTestId(`goal-${goal}`).props.accessibilityState?.selected).toBe(false);
  }
  await act(async () => { fireEvent.press(screen.getByTestId('goal-performance')); });
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/tried'));
  expect((await getOnboardingData()).goal).toBe('performance');
});

it('returns a missing-goal legacy payoff to its saved destination after goal selection', async () => {
  await saveOnboardingField('tried', 'check_online');
  await AsyncStorage.setItem('@fitsy/onboardingStep', 'value-payoff');
  expect(await getOnboardingResume()).toBe('/welcome/goal');
  const screen = renderRouter(routes, { initialUrl: '/welcome/goal' });
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityState?.disabled).toBe(true));
  await act(async () => { fireEvent.press(screen.getByTestId('goal-lose_fat')); });
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(await screen.findByTestId('payoff-check_online')).toBeTruthy();
  expect(screen.getPathname()).toBe('/welcome/value-payoff');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(await screen.findByText('Consistency with your fat-loss plan')).toBeTruthy();
});

it.each(['Back button', 'navigation gesture'] as const)(
  'drops a legacy payoff destination when the user leaves its goal detour with %s', async exit => {
    const screen = renderRouter(routes, { initialUrl: '/welcome/location-permission' });
    await act(async () => { router.push('/welcome/goal-payoff'); });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/goal'));
    await act(async () => {
      if (exit === 'Back button') fireEvent.press(screen.getByTestId('welcome-back'));
      else router.back();
    });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/location-permission'));
    await act(async () => { router.push('/welcome/goal'); });
    await act(async () => { fireEvent.press(screen.getByTestId('goal-build_muscle')); });
    await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
    await waitFor(() => expect(screen.getPathname()).toBe('/welcome/tried'));
  },
);
