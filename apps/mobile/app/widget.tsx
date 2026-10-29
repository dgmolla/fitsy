import React, { useEffect } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { EDITORIAL, TEXT } from '@/lib/brand';
import { usePurchases } from '@/lib/usePurchases';
import { routeToPaywall } from '@/lib/teaserGate';
import { widgetAvailable } from '@/lib/widgetSync';

const steps = [
  { icon: 'hand-left-outline', title: 'Touch and hold your Home Screen', detail: 'Hold an empty space until the apps jiggle.' },
  { icon: 'add-circle-outline', title: 'Find Fitsy in the widget gallery', detail: 'Tap Edit, then Add Widget, and search for Fitsy.' },
  { icon: 'grid-outline', title: 'Choose your size', detail: 'Swipe for small or medium, tap Add Widget, then Done.' },
] as const;

export default function WidgetScreen() {
  const { entitled, ready } = usePurchases();
  const { upgrade } = useLocalSearchParams<{ upgrade?: string }>();
  useEffect(() => {
    if (upgrade === '1' && ready && entitled === false) void routeToPaywall({ replace: true });
  }, [upgrade, ready, entitled]);
  const available = Platform.OS === 'ios' && widgetAvailable();
  return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.content}>
    <Pressable testID="widget-back" style={s.action} accessibilityRole="button"
      onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/search'); }}>
      <Text style={s.link}>Back</Text>
    </Pressable>
    <Text style={TEXT.headline}>Your next meal, at a glance.</Text>
    <Text style={s.body}>A fitting dish on your Home Screen, using your meal targets and last search area.</Text>
    {!available ? <Text style={s.body} testID="widget-unavailable">{Platform.OS === 'ios'
      ? 'The widget is available in the latest iOS app. Update Fitsy to get started.'
      : 'The Fitsy Home Screen widget is available on iPhone.'}</Text>
      : entitled === true ? <>
        <View style={s.preview} accessibilityLabel="Fitsy widget preview">
          <Ionicons name="shuffle" size={24} color={EDITORIAL.green} />
          <Text style={s.title}>A little meal inspiration.</Text>
          <Text style={s.body}>A dish that fits, right where you need it.</Text>
        </View>
        {steps.map((step, index) => <View key={step.title} style={s.step} testID={`widget-step-${index + 1}`}>
          <View style={s.illustration}><Ionicons name={step.icon} size={32} color={EDITORIAL.green} /></View>
          <View style={s.stepText}><Text style={s.title}>{index + 1}. {step.title}</Text><Text style={s.body}>{step.detail}</Text></View>
        </View>)}
        <Text style={s.body}>It refreshes about every two hours. iOS chooses the exact timing. When offline, your last dish stays visible.</Text>
        <Pressable testID="widget-search" style={s.action} accessibilityRole="button" onPress={() => router.push('/(tabs)/search')}>
          <Text style={s.link}>Update my targets or area</Text>
        </Pressable>
      </> : <View style={s.preview}>
        <Ionicons name="lock-closed-outline" size={30} color={EDITORIAL.green} />
        <Text style={s.title}>{ready ? 'A little extra with Fitsy.' : 'Checking your subscription…'}</Text>
        <Text style={s.body}>Home Screen meal inspiration is included with an active Fitsy subscription.</Text>
        {ready && <Pressable testID="widget-unlock" style={s.action} accessibilityRole="button" onPress={() => { void routeToPaywall(); }}>
          <Text style={s.link}>Explore Fitsy</Text>
        </Pressable>}
      </View>}
  </ScrollView></SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: EDITORIAL.cream }, content: { padding: 24, gap: 20 },
  action: { minHeight: 44, justifyContent: 'center' },
  body: { ...TEXT.bodySmall, color: EDITORIAL.textMid }, title: { ...TEXT.subtitle, color: EDITORIAL.text },
  link: { ...TEXT.body, color: EDITORIAL.green },
  preview: { padding: 22, gap: 12, borderRadius: 22, backgroundColor: EDITORIAL.creamCard, borderWidth: 1, borderColor: EDITORIAL.border },
  step: { flexDirection: 'row', alignItems: 'center', gap: 16 }, stepText: { flex: 1, gap: 6 },
  illustration: { width: 64, height: 76, borderRadius: 16, backgroundColor: EDITORIAL.creamCard, alignItems: 'center', justifyContent: 'center' },
});
