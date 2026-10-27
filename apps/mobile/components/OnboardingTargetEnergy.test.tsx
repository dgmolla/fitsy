jest.unmock('react-native');
jest.unmock('expo-router');
import React from 'react';
import { dailyMacroTarget } from '../lib/profileTargetBody';
import { Text } from 'react-native';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, waitFor } from 'expo-router/testing-library';
import Tuning from '../app/welcome/tuning';
import Trust from '../app/welcome/how-it-works';
import Goal from '../app/welcome/goal';
import Targets from '../app/welcome/target-setup';
import MacroSetup from '../app/macro-setup';
import { saveOnboardingField } from '../lib/onboardingStorage';
import { getMacroTargets, getMacroTargetSource, saveMacroTargets } from '../lib/macroStorage';

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

it('the saved ranked-search journey replaces generated grams and queries with its persisted targets', async () => {
  const { loadAll } = require('js-yaml') as { loadAll(source: string): unknown[] };
  type Step = { tapOn?: { id?: string; text?: string }; inputText?: string; eraseText?: number;
    copyTextFrom?: { id: string }; evalScript?: string; assertTrue?: string; assertVisible?: string; runScript?: string };
  const [, commands] = loadAll(readFileSync(resolve(__dirname, '../e2e/flows/onboarding-target-ranked-search.yaml'), 'utf8')) as [unknown, Step[]];
  const start = commands.findIndex(step => step.assertVisible === 'What works.*for one meal.*');
  const request = commands.findIndex(step => step.runScript === '../helpers/data-api.mjs');
  expect(start).toBeGreaterThan(-1);
  expect(request).toBeGreaterThan(start);
  await saveOnboardingField('goal', 'lose_fat');
  await saveOnboardingField('targetMode', 'known');
  const screen = renderRouter(routes, { initialUrl: '/welcome/tuning' });
  await waitFor(() => expect(screen.getByTestId('meal-target-calories').props.editable).toBe(true));
  const context = { maestro: { copiedText: '' }, output: {} as Record<string, unknown> };
  const evaluate = (script: string) => runInNewContext(script.slice(2, -1), context);
  let focused: string | undefined;
  for (const step of commands.slice(start + 1, request)) {
    if (step.tapOn) {
      const { id, text } = step.tapOn;
      if (id?.startsWith('meal-target-') || text) {
        await act(async () => { if (focused) fireEvent(screen.getByTestId(focused), 'blur'); });
        focused = id;
        if (id) await act(async () => { fireEvent(screen.getByTestId(id), 'focus'); });
        else expect(screen.getByText(text!)).toBeTruthy();
      } else if (id) {
        await act(async () => { fireEvent.press(screen.getByTestId(id)); });
        focused = undefined;
        if (id === 'welcome-back') await waitFor(() => expect(screen.getByTestId('meal-target-calories').props.editable).toBe(true));
      }
    }
    if (step.eraseText !== undefined || step.inputText !== undefined) {
      const input = screen.getByTestId(focused!);
      // Native calorie rebalancing can invalidate selectTextOnFocus. Replay
      // the observed append behavior, rather than assuming a selection survives.
      const value = step.eraseText === undefined ? input.props.value + step.inputText
        : input.props.value.slice(0, Math.max(0, input.props.value.length - step.eraseText));
      await act(async () => { fireEvent.changeText(input, value); });
    }
    if (step.copyTextFrom) context.maestro.copiedText = screen.getByTestId(step.copyTextFrom.id).props.value;
    if (step.evalScript) evaluate(step.evalScript);
    if (step.assertTrue) expect({ expression: step.assertTrue, value: evaluate(step.assertTrue), copied: context.maestro.copiedText })
      .toEqual({ expression: step.assertTrue, value: true, copied: context.maestro.copiedText });
  }
  const saved = await getMacroTargets();
  expect(saved).toEqual({ calories: '502', protein: '50', carbs: '44', fat: '14' });
  expect(await getMacroTargetSource()).toBe('manual');
  const url = new URL(String(context.output.rankedUrl));
  expect(url.origin + url.pathname).toBe('https://dev.fitsy.org/api/restaurants/preview');
  expect(Object.fromEntries(url.searchParams)).toEqual({ guided: '1', lat: '34.0407', lng: '-118.2468', ...saved });
});

it.each((['known', 'estimate'] as const).flatMap(targetMode =>
  (['calories', 'protein', 'carbs', 'fat'] as const).map(field => ({ targetMode, field })),
))('saves $targetMode targets after a $field edit through Continue without blurring first', async ({ targetMode, field }) => {
  await saveOnboardingField('goal', 'build_muscle');
  await saveOnboardingField('targetMode', targetMode);
  if (targetMode === 'known') await saveMacroTargets({ calories: '836', protein: '31', carbs: '115', fat: '28' });
  const screen = renderRouter(routes, { initialUrl: '/welcome/tuning' });
  await waitFor(() => expect(screen.getByTestId('meal-target-calories').props.editable).toBe(true));
  const value = { calories: '700', protein: '40', carbs: '100', fat: '20' }[field];
  // Native decimal keyboards have no Done key. Continue must settle the draft itself.
  await act(async () => { fireEvent.changeText(screen.getByTestId(`meal-target-${field}`), value); });
  expect(screen.getByTestId(`meal-target-${field}`).props.value).toBe(value);
  expect(screen.getByTestId('welcome-continue').props.accessibilityState?.disabled).not.toBe(true);
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  await waitFor(() => expect(screen.getPathname()).toBe('/welcome/how-it-works'));
  const saved = (await getMacroTargets())!;
  expect(Number(saved.calories)).toBe(4 * Number(saved.protein) + 4 * Number(saved.carbs) + 9 * Number(saved.fat));
  if (field === 'calories') expect(Math.abs(Number(saved.calories) - 700)).toBeLessThanOrEqual(9);
  else expect(saved[field]).toBe(value);
  expect(await getMacroTargetSource()).toBe('manual');
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-back')); });
  await waitFor(() => {
    for (const [key, target] of Object.entries(saved))
      expect(screen.getByTestId(`meal-target-${key}`).props.value).toBe(target);
  });
});

it.each([
  ['calories', ''], ['calories', '0'], ['calories', '5000'], ['calories', '1.2.3'],
  ['protein', ''], ['protein', '501'], ['carbs', ''], ['fat', ''],
])('keeps an invalid %s draft "%s" disabled without blurring', async (field, value) => {
  await saveOnboardingField('goal', 'build_muscle');
  await saveOnboardingField('targetMode', 'known');
  const saved = { calories: '836', protein: '31', carbs: '115', fat: '28' };
  await saveMacroTargets(saved);
  const screen = renderRouter(routes, { initialUrl: '/welcome/tuning' });
  await waitFor(() => expect(screen.getByTestId('meal-target-calories').props.editable).toBe(true));
  await act(async () => { fireEvent.changeText(screen.getByTestId(`meal-target-${field}`), value); });
  expect(screen.getByTestId('welcome-continue').props.accessibilityState?.disabled).toBe(true);
  await act(async () => { fireEvent.press(screen.getByTestId('welcome-continue')); });
  expect(screen.getPathname()).toBe('/welcome/tuning');
  expect(await getMacroTargets()).toEqual(saved);
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
