import { Alert } from 'react-native';
import type { PurchasesEntitlementInfo } from 'react-native-purchases';
import { schedulableTrialReminder } from '../../../packages/shared/src/contracts/trialPolicy';

type Trial = Pick<PurchasesEntitlementInfo, 'isActive' | 'periodType' | 'willRenew' | 'expirationDate' | 'latestPurchaseDate'>;

export function missedTrialReminderWindow(subscription: Trial | undefined, now: number): boolean {
  if (!subscription?.isActive || subscription.periodType !== 'TRIAL' || !subscription.willRenew) return false;
  const expiration = new Date(subscription.expirationDate ?? '');
  const start = new Date(subscription.latestPurchaseDate ?? '');
  // A target must have been useful at the verified trial's start before it can
  // become a missed window. The shared policy owns lead time and quiet hours.
  const target = schedulableTrialReminder(expiration, start, start);
  return !!target && expiration.getTime() > now && target.getTime() <= now;
}

export function explainMissedTrialReminder() {
  Alert.alert('Trial reminder time passed',
    'The reminder time for this trial, including any quiet-hour adjustment, has passed, so Fitsy cannot schedule it now. Check your trial end date and renewal in subscription settings.');
}
