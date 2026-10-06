jest.unmock('react-native');
jest.unmock('expo-router');
import React from 'react';
import { dailyMacroTarget } from '../lib/profileTargetBody';
import { Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import Tuning from '../app/welcome/tuning';
import Trust from '../app/welcome/how-it-works';
import Goal from '../app/welcome/goal';
import Targets from '../app/welcome/target-setup';
import MacroSetup from '../app/macro-setup';
import { saveOnboardingField } from '../lib/onboardingStorage';
import { getMacroTargets, saveMacroTargets } from '../lib/macroStorage';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock('@fitsy/shared', () => ({ calculateAge: () => 28 }));
jest.mock('../lib/profileSync', () => ({ syncSavedProfileToServer: jest.fn(), queueSavedProfileToServer: jest.fn(), deliverQueuedProfile: jest.fn(), replayPendingProfileSync: jest.fn() }));
jest.mock('posthog-react-native', () => {
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY = 'unit-test-analytics';
  return jest.fn().mockImplementation(() => ({ capture: jest.fn() }));
});

const routes = { 'welcome/tuning': Tuning, 'welcome/how-it-works': Trust,
  'welcome/goal': Goal, 'welcome/target-setup': Targets,
  'macro-setup': MacroSetup, '(tabs)/search': () => <Text>Search for meals</Text> };
beforeEach(async () => {
  jest.mocked(AsyncStorage.setItem).mockImplementation((key, value) => AsyncStorage.multiSet([[key, value]]));
  await AsyncStorage.clear();
});

it('settles both tuning edit directions before save and restores one energy total', async () => {
  await saveOnboardingField('goal', 'build_muscle');
  await saveOnboardingField('targetMode', 'known');
  const screen = renderRouter(routes, { initialUrl: '/welcome/tuning' });
  const calorie = await screen.findByTestId('meal-target-calories');
  await act(async () => {
    fireEvent.changeText(calorie, '600');
    fireEvent(calorie, 'blur');
  });
  await waitFor(() => expect(Number(screen.getByTestId('meal-target-protein').props.value)).toBeGreaterThan(0));
  const protein = screen.getByTestId('meal-target-protein');
  await act(async () => {
    fireEvent.changeText(protein, '85');
    fireEvent(protein, 'blur');
  });
  await waitFor(() => expect(Number(screen.getByTestId('meal-target-calories').props.value)).toBeGreaterThan(600));
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('meal-target-calories'), '700');
    fireEvent(screen.getByTestId('meal-target-calories'), 'blur');
  });
  const fields = ['protein', 'carbs', 'fat'] as const;
  const grams = fields.map(key => Number(screen.getByTestId(`meal-target-${key}`).props.value));
  const expected = grams[0] * 4 + grams[1] * 4 + grams[2] * 9;
  expect(screen.getByTestId('meal-target-calories').props.value).toBe(String(expected));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/how-it-works'));
  expect((await getMacroTargets())?.calories).toBe(String(expected));
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  expect(screen.getByTestId('meal-target-calories').props.value).toBe(String(expected));
});

it('keeps an empty tuning calorie draft invalid', async () => {
  await saveOnboardingField('goal', 'lose_fat');
  await saveOnboardingField('targetMode', 'known');
  const screen = renderRouter(routes, { initialUrl: '/welcome/tuning' });
  const calorie = await screen.findByTestId('meal-target-calories');
  await act(async () => { fireEvent.changeText(calorie, ''); fireEvent(calorie, 'blur'); });
  expect(screen.getByTestId('welcome-continue').props.accessibilityState?.disabled).toBe(true);
  expect(await getMacroTargets()).toBeNull();
});

it('derives untouched calories from macro-only entry, saves and restores the same target', async () => {
  await saveOnboardingField('goal', 'build_muscle');
  await saveOnboardingField('targetMode', 'known');
  const screen = renderRouter(routes, { initialUrl: '/welcome/tuning' });
  await screen.findByTestId('meal-target-protein');
  for (const [key, value] of [['protein', '40'], ['carbs', '65'], ['fat', '20']]) {
    await act(async () => {
      fireEvent.changeText(screen.getByTestId(`meal-target-${key}`), value);
      fireEvent(screen.getByTestId(`meal-target-${key}`), 'blur');
    });
  }
  expect(screen.getByTestId('meal-target-calories').props.value).toBe('600');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/how-it-works'));
  expect(await getMacroTargets()).toEqual({ calories: '600', protein: '40', carbs: '65', fat: '20' });
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  expect(screen.getByTestId('meal-target-calories').props.value).toBe('600');
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('meal-target-calories'), '');
    fireEvent.changeText(screen.getByTestId('meal-target-protein'), '55');
    fireEvent(screen.getByTestId('meal-target-protein'), 'blur');
  });
  expect(screen.getByTestId('meal-target-calories').props.value).toBe('');
  expect(screen.getByTestId('welcome-continue').props.accessibilityState?.disabled).toBe(true);
});

it.each(['restored', 'generated'])('keeps a cleared macro invalid after a %s allocation', async source => {
  await saveOnboardingField('goal', 'build_muscle');
  await saveOnboardingField('targetMode', 'known');
  const saved = { calories: '600', protein: '40', carbs: '65', fat: '20' };
  if (source === 'restored') await saveMacroTargets(saved);
  const screen = renderRouter(routes, { initialUrl: '/welcome/tuning' });
  await screen.findByTestId('meal-target-calories');
  if (source === 'generated') await act(async () => {
    fireEvent.changeText(screen.getByTestId('meal-target-calories'), '600');
    fireEvent(screen.getByTestId('meal-target-calories'), 'blur');
  });
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('meal-target-protein'), '');
    fireEvent.changeText(screen.getByTestId('meal-target-calories'), '700');
    fireEvent(screen.getByTestId('meal-target-calories'), 'blur');
  });
  expect(screen.getByTestId('meal-target-protein').props.value).toBe('');
  expect(screen.getByTestId('welcome-continue').props.accessibilityState?.disabled).toBe(true);
  expect(await getMacroTargets()).toEqual(source === 'restored' ? saved : null);
});

it('explains when calories cannot cover an entered macro', async () => {
  await saveOnboardingField('goal', 'build_muscle');
  await saveOnboardingField('targetMode', 'known');
  const screen = renderRouter(routes, { initialUrl: '/welcome/tuning' });
  await screen.findByTestId('meal-target-protein');
  await act(async () => { fireEvent.changeText(screen.getByTestId('meal-target-protein'), '80'); });
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('meal-target-calories'), '200');
    fireEvent(screen.getByTestId('meal-target-calories'), 'blur');
  });
  expect(screen.getByText('Calories must cover the macros you entered.')).toBeTruthy();
  expect(screen.getByTestId('meal-target-protein').props.value).toBe('80');
  expect(screen.getByTestId('welcome-continue').props.accessibilityState?.disabled).toBe(true);
});

it('allows a coherent zero-protein target through Continue', async () => {
  await saveOnboardingField('goal', 'lose_fat');
  await saveOnboardingField('targetMode', 'known');
  const screen = renderRouter(routes, { initialUrl: '/welcome/tuning' });
  await screen.findByTestId('meal-target-calories');
  const values = { calories: '440', protein: '0', carbs: '65', fat: '20' };
  await act(async () => { for (const [key, value] of Object.entries(values)) fireEvent.changeText(screen.getByTestId(`meal-target-${key}`), value); });
  expect(screen.getByTestId('welcome-continue').props.accessibilityState?.disabled).not.toBe(true);
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/how-it-works'));
  expect(await getMacroTargets()).toEqual(values);
});

it('settles the supported performance picker total to exactly the daily API energy', async () => {
  await saveOnboardingField('goal', 'performance');
  await saveOnboardingField('birthday', '1990-01-01');
  await saveOnboardingField('heightCm', 190);
  await saveOnboardingField('weightKg', 180);
  await saveOnboardingField('activity', 'very_active');
  const screen = renderRouter(routes, { initialUrl: '/macro-setup' });
  await screen.findByText(/We recommend ~3500 kcal\/day/);
  expect(screen.getByText('3530 kcal')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('macro-setup-save')); });
  await waitFor(() => expect(screen.getByText('Search for meals')).toBeTruthy());
  const target = await getMacroTargets();
  expect(target).not.toBeNull();
  expect(Number(target!.protein)).toBeLessThanOrEqual(40);
  expect(Number(target!.calories)).toBe(4 * Number(target!.protein) + 4 * Number(target!.carbs) + 9 * Number(target!.fat));
  expect(dailyMacroTarget(target!, 'automatic')).toMatchObject({ proteinG: 116, carbsG: 546, fatG: 98, calories: 3530 });
});
