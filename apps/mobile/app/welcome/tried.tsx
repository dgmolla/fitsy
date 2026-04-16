import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { router } from 'expo-router';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { AnimatedPress } from '@/components/AnimatedPress';
import { EDITORIAL, FONTS } from '@/lib/brand';

const OPTIONS = [
  { id: 'meal_prep', label: 'Meal prepping', icon: '🥦' },
  { id: 'delivery', label: 'Meal delivery services', icon: '📦' },
  { id: 'calorie_apps', label: 'Calorie counting apps', icon: '📱' },
  { id: 'check_online', label: 'Looking up macros online', icon: '🔍' },
  { id: 'nothing', label: "Haven't really tried", icon: '🤷' },
];

export default function TriedScreen() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <WelcomeScreen
      progress={1 / 16}
      title={"What have you tried\nfor healthy eating?"}
      subtitle="Choose one."
      onContinue={() => {
        router.push({ pathname: '/welcome/response', params: { tried: selected! } });
      }}
      canContinue={selected !== null}
      showBack={false}
    >
      <View style={s.list}>
        {OPTIONS.map((opt, i) => {
          const on = selected === opt.id;
          return (
            <Animated.View key={opt.id} entering={FadeInDown.duration(400).delay(100 + i * 60)}>
              <AnimatedPress
                style={[s.row, on ? s.rowOn : undefined]}
                onPress={() => setSelected(opt.id)}
                haptic
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={s.icon}>{opt.icon}</Text>
                <Text style={[s.label, on ? s.labelOn : undefined]}>{opt.label}</Text>
              </AnimatedPress>
            </Animated.View>
          );
        })}
      </View>
    </WelcomeScreen>
  );
}

const s = StyleSheet.create({
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 22,
  },
  rowOn: { backgroundColor: EDITORIAL.green },
  icon: { fontSize: 20 },
  label: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 17,
    color: EDITORIAL.text,
    letterSpacing: -0.3,
    flex: 1,
  },
  labelOn: { color: EDITORIAL.cream },
});
