import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FitsyLoader } from './FitsyLoader';
import { EDITORIAL, FONTS } from '@/lib/brand';

/** Both discovery entry points keep their search field mounted above this state. */
export function DiscoveryLoading() {
  return <View style={s.wrap} testID="discovery-loading" accessibilityLiveRegion="polite">
    <FitsyLoader size="md" />
    <Text style={s.label}>Finding meals for you</Text>
  </View>;
}
const s = StyleSheet.create({
  wrap: { minHeight: 230, paddingVertical: 48, gap: 12, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: FONTS.nunitoSans, fontSize: 14, lineHeight: 20, color: EDITORIAL.textMid },
});
