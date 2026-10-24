jest.unmock('react-native');
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import NotificationSettingsScreen from '../app/notification-settings';

const mockShowManageSubscriptions = jest.fn(async () => {});
jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.mock('../lib/useReminders', () => ({ useReminders: () => ({
  userId: null, preferences: { meals: false, trial: false }, scheduled: [], save: jest.fn(),
}) }));
jest.mock('../lib/usePurchases', () => ({ usePurchases: () => ({
  entitled: true,
  customerInfo: { managementURL: 'https://apps.apple.com/account/subscriptions', entitlements: { all: {} } },
  showManageSubscriptions: mockShowManageSubscriptions,
}) }));
jest.mock('../lib/useNotifications', () => ({ getNotificationPermission: async () => 'denied' }));
jest.mock('../lib/devTrialReminderProbe', () => ({ clearDevTrialReminder: jest.fn(), scheduleDevTrialReminder: jest.fn() }));

test('notification settings manages a subscription through the owning-store action', async () => {
  const screen = render(<NotificationSettingsScreen />);
  await waitFor(() => expect(screen.getByText('Device notifications are off')).toBeTruthy());
  fireEvent.press(screen.getByTestId('reminders-manage-subscription'));
  expect(mockShowManageSubscriptions).toHaveBeenCalledTimes(1);
});
