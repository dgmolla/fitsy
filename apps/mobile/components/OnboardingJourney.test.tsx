jest.unmock('react-native');
jest.unmock('expo-router');
import React from 'react';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import Tried from '../app/welcome/tried';
import Response from '../app/welcome/response';
import Payoff from '../app/welcome/value-payoff';
import Targets from '../app/welcome/target-setup';
import Tuning from '../app/welcome/tuning';
import Trust from '../app/welcome/how-it-works';
import Goal from '../app/welcome/goal';
import Height from '../app/welcome/height';
import { getOnboardingData } from '../lib/onboardingStorage';
import { getMacroTargets } from '../lib/macroStorage';
import { getOnboardingResume } from '../lib/onboardingResume';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => ({ capture: jest.fn() }));
});

const routes = {
  'welcome/tried': Tried, 'welcome/response': Response, 'welcome/value-payoff': Payoff,
  'welcome/target-setup': Targets, 'welcome/tuning': Tuning, 'welcome/how-it-works': Trust,
  'welcome/goal': Goal, 'welcome/height': Height,
  'welcome/preview': () => <Text>Discovery preview</Text>,
};
beforeEach(async () => { await AsyncStorage.clear(); });

it('updates the fitness payoff after going back and choosing another prior approach', async () => {
  const screen = renderRouter(routes, { initialUrl: '/welcome/tried' });
  await act(async () => { fireEvent.press(screen.getByTestId('tried-meal_prep')); });
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/response'));
  expect(screen.getByText('Keep your goals in reach when cooking isn’t in the plan.')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(await screen.findByText('The same fitness goal')).toBeTruthy();
  expect(screen.getByText('A meal at home')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await act(async () => { fireEvent.press(screen.getByTestId('tried-calorie_apps')); });
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(await screen.findByText('Choose before you order')).toBeTruthy();
  expect(screen.queryByText('A meal at home')).toBeNull();
  expect((await getOnboardingData()).tried).toBe('calorie_apps');
  expect(await getOnboardingResume()).toBe('/welcome/value-payoff');
});

it('keeps own meal targets through trust, Back, and the saved-target shortcut without body questions', async () => {
  const screen = renderRouter(routes, { initialUrl: '/welcome/target-setup' });
  await waitFor(() => expect(screen.getByTestId('welcome-continue').props.accessibilityState?.disabled).not.toBe(true));
  await act(async () => { fireEvent.press(screen.getByTestId('target-mode-known')); });
  expect(screen.getPathname()).toBe('/welcome/target-setup');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/tuning'));
  const values = { calories: '650', protein: '42', carbs: '68', fat: '23' };
  await act(async () => { for (const [key, value] of Object.entries(values)) fireEvent.changeText(screen.getByTestId(`meal-target-${key}`), value); });
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/how-it-works'));
  expect(screen.getByTestId('nutrition-source-estimated')).toBeTruthy();
  expect(await getMacroTargets()).toEqual(values);
  expect(await getOnboardingData()).toEqual(expect.objectContaining({ targetMode: 'known' }));
  expect((await getOnboardingData()).heightCm).toBeUndefined();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  expect(await screen.findByDisplayValue('650')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await act(async () => { fireEvent.press(await screen.findByTestId('target-use-saved')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/how-it-works'));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(await screen.findByText('Discovery preview')).toBeTruthy();
});

it('opens the assisted questions only after explicitly confirming that choice', async () => {
  const screen = renderRouter(routes, { initialUrl: '/welcome/target-setup' });
  await act(async () => {});
  await act(async () => { fireEvent.press(screen.getByTestId('target-mode-estimate')); });
  expect(screen.getPathname()).toBe('/welcome/target-setup');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/goal'));
  await act(async () => { fireEvent.press(screen.getByTestId('goal-build_muscle')); });
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/height'));
  expect(await getOnboardingData()).toEqual(expect.objectContaining({ targetMode: 'estimate', goal: 'build_muscle' }));
});
