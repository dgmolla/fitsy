import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { trialPresentation, elapsedCalendarDays } from '@/lib/trialPresentation';
export { projectedChargeDate } from '@/lib/trialPresentation';
import type { purchaseTerms } from '@/lib/purchaseTerms';

type Terms = ReturnType<typeof purchaseTerms>;
export type ReminderAvailability = 'enabled' | 'opt-in' | 'permission-off' | 'unavailable';

export const PAYWALL_BENEFITS = [
  'Discover meals in Los Angeles',
  'Find nearby options for your goals',
  'Compare estimated nutrition',
] as const;

function Step({ icon, title, detail, last = false, testID, onTop }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; title: string; detail: string; last?: boolean; testID: string; onTop?: (top: number) => void;
}) {
  const step = useRef<View>(null);
  return <View ref={step} style={[s.step, last && s.lastStep]} testID={testID}
    onLayout={onTop ? () => requestAnimationFrame(() => step.current?.measureInWindow((_, top) => onTop(top))) : undefined}>
    {!last && <View style={s.connector} testID={`${testID}-connector`} />}
    <View style={s.icon} testID={`${testID}-circle`}><Ionicons name={icon} size={17} color={EDITORIAL.cream} /></View>
    <View style={s.copy}><Text style={s.when}>{title}</Text><Text style={s.detail}>{detail}</Text></View>
  </View>;
}

export function PaywallOfferTimeline({ terms, now, reminderAvailability = 'unavailable', onFirstStepTop }: {
  terms: Terms; now: Date; reminderAvailability?: ReminderAvailability; onFirstStepTop?: (top: number) => void;
}) {
  const presentation = trialPresentation(terms, now);
  const chargeDate = presentation.projectedChargeDate;
  if (!terms?.trial || !chargeDate) {
    return <View style={s.benefits} testID="paywall-offer-paid">
      {PAYWALL_BENEFITS.map(benefit => <View key={benefit} style={s.benefitRow}>
        <Ionicons name="checkmark-circle" size={17} color={EDITORIAL.greenMid} />
        <Text style={s.benefit}>{benefit}</Text>
      </View>)}
    </View>;
  }

  const reminderDate = presentation.reminderDate;
  const usefulReminder = !!reminderDate;
  const chargeDay = elapsedCalendarDays(now, chargeDate);
  // Quiet hours can move delivery to an earlier calendar day than the
  // nominal 48-hour lead, so label the date the scheduler actually chose.
  const reminderDay = presentation.reminderDay;
  const reminderCopy = reminderAvailability === 'enabled' && usefulReminder
    ? "We'll send you a reminder that your trial is ending soon if the store confirms this trial end after purchase."
    : reminderAvailability === 'permission-off'
      ? 'Notifications off. Enable them in settings.'
      : reminderAvailability === 'opt-in'
        ? 'Optional; turn on reminders after purchase.'
        : 'Unavailable; check your trial end in settings.';

  const chargeDateLabel = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(chargeDate);
  return <View style={s.panel} testID="paywall-offer-timeline">
    <Step icon="lock-open-outline" title="Today" detail="Unlock our library of Los Angeles restaurant nutrition, tailored to you" testID="paywall-step-today" onTop={onFirstStepTop} />
    <Step icon="notifications-outline"
      title={usefulReminder ? `In ${reminderDay} days` : 'Reminder unavailable'}
      detail={reminderCopy} testID="paywall-step-reminder" />
    <Step icon="calendar-outline" title={`In ${chargeDay} days`}
      detail={`Estimated first charge: ${chargeDateLabel}, if you start today. The store confirms your actual date after purchase.`}
      last testID="paywall-step-charge" />
  </View>;
}

const s = StyleSheet.create({
  panel: { alignSelf: 'stretch', marginHorizontal: 5, marginTop: 14, paddingHorizontal: 17, paddingTop: 20, paddingBottom: 18 },
  benefits: { alignSelf: 'center', gap: 15, marginTop: 28, marginBottom: 12 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  benefit: { fontFamily: FONTS.nunitoSansSemiBold, fontSize: 16, lineHeight: 22, color: EDITORIAL.green },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, position: 'relative', paddingBottom: 28, minHeight: 72 },
  lastStep: { paddingBottom: 0 },
  // The rail spans the actual row height, including wrapped copy and spacing.
  // The next circle begins at this row's bottom edge.
  connector: { position: 'absolute', left: 15, top: 32, bottom: 0, width: 2, backgroundColor: EDITORIAL.greenMid },
  icon: { width: 32, height: 32, borderRadius: 16, backgroundColor: EDITORIAL.greenMid, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  copy: { flex: 1, minWidth: 0, minHeight: 32 },
  when: { fontFamily: FONTS.nunitoSansSemiBold, color: EDITORIAL.green, fontSize: 16, lineHeight: 21 },
  detail: { fontFamily: FONTS.nunitoSans, color: EDITORIAL.textMid, fontSize: 12, lineHeight: 17 },
});
