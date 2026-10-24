import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import PaymentScreen from '../app/welcome/payment';
import TrialScreen from '../app/welcome/trial';
import TrialReminderScreen from '../app/welcome/trial-reminder';
import WelcomeLayout from '../app/welcome/_layout';
import { PurchasesProvider } from '../lib/usePurchases';

export function paymentCompletionRoutes(onNotificationMount: () => void) {
  function Restaurant() {
    const params = useLocalSearchParams();
    return <Text>{JSON.stringify(params)}</Text>;
  }
  function OldNotificationScreen() {
    useEffect(() => { onNotificationMount(); }, []);
    return <Text>Old notification step</Text>;
  }
  return {
    _layout: () => <PurchasesProvider><Stack screenOptions={{ headerShown: false }} /></PurchasesProvider>,
    'welcome/_layout': WelcomeLayout, 'welcome/trial': TrialScreen, 'welcome/trial-reminder': TrialReminderScreen,
    'welcome/payment': PaymentScreen,
    'welcome/signin': () => <Text>Sign in before plans</Text>,
    'welcome/resubscribe': () => <Text>Resubscribe plans</Text>,
    'welcome/subscription-check': () => <Text>Checking subscription</Text>,
    'welcome/notification-permission': OldNotificationScreen,
    '(tabs)/_layout': () => <Stack />, '(tabs)/search': () => <Text>Meal search</Text>, 'restaurant/[id]': Restaurant,
  };
}
