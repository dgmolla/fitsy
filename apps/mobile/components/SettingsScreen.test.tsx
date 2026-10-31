import { AsyncStorage, act, fireEvent, installPurchasedAccount, renderJourney, routes,
  saveMacroTargets, saveOnboardingField, waitFor } from './OnboardingNavigationHarness';
import Profile from '../app/(tabs)/profile';
import { getOnboardingData } from '../lib/onboardingStorage';
import { getMacroTargets } from '../lib/macroStorage';

const profileRoutes = { ...routes, '(tabs)/profile': Profile };
const legacyFacts = JSON.stringify({ weightKg: 140, heightCm: 200, goal: 'build_muscle' });

it.each(['@fitsy/onboarding', '@fitsy/onboarding_unowned'])(
  'omits the retired Settings rows while preserving older facts in %s', async legacyKey => {
    await installPurchasedAccount();
    await AsyncStorage.setItem(legacyKey, legacyFacts);
    const screen = renderJourney('/profile', profileRoutes);
    await screen.findByTestId('profile-edit-goal');

    for (const label of ['Restore older profile facts', 'Notifications', 'Home Screen widget']) {
      expect(Boolean(screen.queryByText(label))).toBe(false);
    }
    for (const id of ['profile-feedback', 'profile-logout', 'profile-delete-account',
      'profile-privacy', 'profile-terms', 'profile-support']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(await getOnboardingData()).toEqual({});
    expect(await AsyncStorage.getItem(legacyKey)).toBe(legacyFacts);
    expect(jest.mocked(global.fetch).mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  },
);

it('still edits the current profile without replacing manual meal targets or older facts', async () => {
  await installPurchasedAccount();
  await saveOnboardingField('goal', 'maintain');
  await saveMacroTargets({ protein: '40', carbs: '60', fat: '20', calories: '580' });
  await AsyncStorage.setItem('@fitsy/onboarding_unowned', legacyFacts);
  const screen = renderJourney('/profile', profileRoutes);
  await screen.findByTestId('profile-edit-meal-targets');
  await act(async () => { fireEvent.press(screen.getByTestId('profile-edit-goal')); });
  await act(async () => { fireEvent.press(screen.getByTestId('profile-choice-performance')); });
  await act(async () => { fireEvent.press(screen.getByTestId('profile-edit-apply')); });
  await waitFor(() => expect(screen.getByText('Performance')).toBeTruthy());
  expect(await getOnboardingData()).toEqual({ goal: 'performance' });
  expect(await AsyncStorage.getItem('@fitsy/onboarding_unowned')).toBe(legacyFacts);
  expect(await getMacroTargets()).toEqual({ protein: '40', carbs: '60', fat: '20', calories: '580' });
  expect(screen.getByTestId('profile-edit-meal-targets')).toBeTruthy();
});
