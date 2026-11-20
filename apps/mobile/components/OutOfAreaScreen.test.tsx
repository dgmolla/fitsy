jest.unmock('react-native');
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import OutOfAreaScreen from '../app/welcome/out-of-area';
import { joinSavedAreaWaitlist } from '@/lib/waitlist';
import { supabase } from '@/lib/supabase';

const mockPush = jest.fn();
jest.mock('react-native-reanimated', () => {
  const { View, Text } = require('react-native');
  const chain: object = new Proxy({}, { get: () => () => chain });
  return { __esModule: true, default: { View, Text }, FadeIn: chain, FadeInDown: chain };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/AnimatedPress', () => {
  const { Pressable } = require('react-native');
  return { AnimatedPress: ({ haptic: _h, ...props }: Record<string, unknown>) => <Pressable testID={String(props.testID)} {...props} /> };
});
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), dismissTo: jest.fn() }, useLocalSearchParams: () => ({}) }));
jest.mock('@/lib/onboardingResume', () => ({ useOnboardingStep: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ trackOnboardingScreenView: jest.fn() }));
jest.mock('@/lib/waitlist', () => ({ joinSavedAreaWaitlist: jest.fn() }));
jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: jest.fn() } },
  isRealAccountSession: (s: { user?: { is_anonymous?: boolean } } | null) => !!s?.user && !s.user.is_anonymous,
}));

const session = (anonymous: boolean) => (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'u', is_anonymous: anonymous } } } });
beforeEach(() => { jest.clearAllMocks(); });

it('a signed-in visitor is saved to the waitlist automatically and told we will let them know (#1012)', async () => {
  session(false); (joinSavedAreaWaitlist as jest.Mock).mockResolvedValue(true);
  render(<OutOfAreaScreen />);
  await screen.findByTestId('waitlist-joined');
  expect(screen.getByText(/We'll let you know/)).toBeTruthy();
  expect(screen.queryByTestId('waitlist-join')).toBeNull();
  expect(joinSavedAreaWaitlist).toHaveBeenCalledTimes(1);
});

it('a visitor without an account has no email to save, so they get one sign-in button and no join call (#1012)', async () => {
  session(true);
  render(<OutOfAreaScreen />);
  fireEvent.press(await screen.findByTestId('waitlist-join'));
  expect(mockPush).toHaveBeenCalledWith('/welcome/signin?outOfArea=1');
  expect(joinSavedAreaWaitlist).not.toHaveBeenCalled();
});

it('a failed automatic join says so and the same button retries (#1012)', async () => {
  session(false); (joinSavedAreaWaitlist as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<OutOfAreaScreen />);
  fireEvent.press(await screen.findByTestId('waitlist-join'));
  await waitFor(() => expect(screen.getByTestId('waitlist-joined')).toBeTruthy());
  expect(joinSavedAreaWaitlist).toHaveBeenCalledTimes(2);
});
