import React, { useCallback, useRef, useState } from 'react';
import {
  Pressable,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { clearToken, getStoredToken } from '@/lib/authClient';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenBackground } from '@/components/ScreenBackground';
import { decodeEmailFromToken } from '@/lib/jwtUtils';
import type { MacroValues } from '@/lib/macroPresets';
import { getMacroTargets, saveMacroTargets } from '@/lib/macroStorage';
import { getOnboardingData, type OnboardingData } from '@/lib/onboardingStorage';
import { calculateAge } from '@fitsy/shared';
import { pushProfileToServer } from '@/lib/profileSync';
import { useTheme } from '@/lib/theme';
import { FilterPopup } from '@/components/FilterPopup';
import { EDITORIAL, FONTS } from '@/lib/brand';

const GOAL_ICONS: Record<string, string> = {
  lose_fat: 'flame-outline',
  build_muscle: 'barbell-outline',
  maintain: 'shield-checkmark-outline',
  explore: 'compass-outline',
  eat_healthier: 'leaf-outline',
};

function formatGoal(g?: string) {
  if (!g) return 'Not set';
  return g.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function ProfileScreen() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>('—');
  const [macroTargets, setMacroTargets] = useState<MacroValues | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);
  const [profile, setProfile] = useState<OnboardingData>({});
  const prevProfile = useRef<string>('');

  useFocusEffect(
    useCallback(() => {
      async function load() {
        try {
          const [token, stored, onboarding] = await Promise.all([
            getStoredToken(),
            getMacroTargets(),
            getOnboardingData(),
          ]);
          if (token) setEmail(decodeEmailFromToken(token));
          if (stored) setMacroTargets(stored as unknown as MacroValues);
          setProfile(onboarding);
          const snapshot = JSON.stringify(onboarding);
          if (prevProfile.current && prevProfile.current !== snapshot) {
            pushProfileToServer();
          }
          prevProfile.current = snapshot;
        } catch {
        } finally {
          setLoading(false);
        }
      }
      void load();
    }, []),
  );

  const handleLogout = useCallback(async () => {
    await clearToken();
    router.replace('/welcome/problem');
  }, []);

  const initials = email !== '—' ? email.charAt(0).toUpperCase() : '?';
  const age = profile.birthday ? calculateAge(profile.birthday) : null;
  const goalIcon = GOAL_ICONS[profile.goal ?? ''] ?? 'flag-outline';

  if (loading) {
    return (
      <ScreenBackground>
        <ActivityIndicator size="large" color={colors.spinnerColor} style={{ flex: 1, alignSelf: 'center' }} />
      </ScreenBackground>
    );
  }

  return (
    <>
    <ScreenBackground>
      <ScreenHeader />
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Hero identity card */}
        <View style={s.heroCard}>
          <View style={s.heroAvatar}>
            <Text style={s.heroInitial}>{initials}</Text>
          </View>
          <View style={s.heroInfo}>
            <Text style={s.heroEmail} numberOfLines={1}>{email}</Text>
          </View>
        </View>

        {/* Goal banner */}
        <Pressable style={s.goalBanner} onPress={() => router.push('/welcome/goal')}>
          <View style={s.goalIconCircle}>
            <Ionicons name={goalIcon as any} size={18} color={EDITORIAL.greenAccent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.goalBannerLabel}>YOUR GOAL</Text>
            <Text style={s.goalBannerValue}>{formatGoal(profile.goal)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={EDITORIAL.creamDeep} />
        </Pressable>

        {/* Body stats row */}
        <View style={s.statsCard}>
          <StatBlock label="Age" value={age ? `${age}` : '—'} />
          <View style={s.statDivider} />
          <StatBlock label="Height" value={profile.heightCm ? `${profile.heightCm}cm` : '—'} />
          <View style={s.statDivider} />
          <StatBlock label="Weight" value={profile.weightKg ? `${profile.weightKg}kg` : '—'} />
          <View style={s.statDivider} />
          <StatBlock label="Activity" value={profile.activity ? profile.activity.replace(/_/g, ' ').split(' ')[0]!.charAt(0).toUpperCase() + profile.activity.replace(/_/g, ' ').split(' ')[0]!.slice(1) : '—'} small />
        </View>

        {/* Per-meal targets */}
        {macroTargets && (
          <Pressable onPress={() => setFilterVisible(true)} style={s.macroCard}>
            <View style={s.macroHeader}>
              <Text style={s.macroTitle}>Per-Meal Targets</Text>
              <View style={s.editChip}>
                <Ionicons name="pencil" size={10} color={EDITORIAL.greenAccent} />
                <Text style={s.editChipText}>Edit</Text>
              </View>
            </View>

            <View style={s.macroRow}>
              <MacroBlock label="Protein" value={macroTargets.protein || '—'} unit="g" color="#5B7C6B" />
              <MacroBlock label="Carbs" value={macroTargets.carbs || '—'} unit="g" color="#8B7355" />
              <MacroBlock label="Fat" value={macroTargets.fat || '—'} unit="g" color="#7B6B8A" />
              <MacroBlock label="Calories" value={macroTargets.calories || '—'} unit="" color={EDITORIAL.text} />
            </View>
          </Pressable>
        )}

        {/* Edit sections */}
        <View style={s.linksCard}>
          <LinkRow icon="body-outline" label="Edit body stats" onPress={() => router.push('/welcome/height')} />
          <LinkRow icon="walk-outline" label="Update activity level" onPress={() => router.push('/welcome/activity')} last />
        </View>

        {/* Logout */}
        <Pressable style={s.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={16} color="#B85450" />
          <Text style={s.logoutText}>Log out</Text>
        </Pressable>

      </ScrollView>
    </ScreenBackground>

    <FilterPopup
      visible={filterVisible}
      values={macroTargets ?? { protein: '', carbs: '', fat: '', calories: '' }}
      onApply={async (updated) => {
        setFilterVisible(false);
        setMacroTargets(updated);
        await saveMacroTargets(updated);
        pushProfileToServer();
      }}
      onClose={() => setFilterVisible(false)}
    />
    </>
  );
}

function StatBlock({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <View style={s.statBlock}>
      <Text style={[s.statValue, small && { fontSize: 14 }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function MacroBlock({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <View style={s.macroBlock}>
      <View style={[s.macroDot, { backgroundColor: color }]} />
      <Text style={[s.macroValue, { color }]}>{value}<Text style={s.macroUnit}>{unit}</Text></Text>
      <Text style={s.macroLabel}>{label}</Text>
    </View>
  );
}

function LinkRow({ icon, label, onPress, last }: { icon: string; label: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable style={[s.linkRow, !last && { borderBottomWidth: 1, borderBottomColor: EDITORIAL.border }]} onPress={onPress}>
      <Ionicons name={icon as any} size={16} color={EDITORIAL.greenAccent} />
      <Text style={s.linkText}>{label}</Text>
      <Ionicons name="chevron-forward" size={14} color={EDITORIAL.creamDeep} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingBottom: 100 },
  // Hero
  heroCard: {
    backgroundColor: EDITORIAL.green,
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  heroAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(253,251,247,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroInitial: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 22,
    color: '#FDFBF7',
  },
  heroInfo: { flex: 1 },
  heroEmail: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FDFBF7',
    letterSpacing: -0.2,
  },
  // Goal banner
  goalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    padding: 14,
    marginBottom: 12,
  },
  goalIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: EDITORIAL.creamCard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goalBannerLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: EDITORIAL.textSoft,
    letterSpacing: 1,
    marginBottom: 2,
  },
  goalBannerValue: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 18,
    color: EDITORIAL.text,
    letterSpacing: -0.4,
  },
  // Stats
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    paddingVertical: 14,
    paddingHorizontal: 4,
    marginBottom: 12,
  },
  statBlock: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: {
    fontFamily: FONTS.newsreaderBold,
    fontSize: 18,
    color: EDITORIAL.text,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: EDITORIAL.textSoft,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statDivider: { width: 1, height: 24, backgroundColor: EDITORIAL.border },
  // Macros
  macroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    padding: 16,
    marginBottom: 12,
  },
  macroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  macroTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: EDITORIAL.textSoft,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  editChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: EDITORIAL.creamCard,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  editChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: EDITORIAL.greenAccent,
  },
  macroRow: { flexDirection: 'row' },
  macroBlock: { flex: 1, alignItems: 'center', gap: 3 },
  macroDot: { width: 6, height: 6, borderRadius: 3 },
  macroValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.8 },
  macroUnit: { fontSize: 13, fontWeight: '500', color: EDITORIAL.textSoft },
  macroLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: EDITORIAL.textSoft,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  // Links
  linksCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: EDITORIAL.border,
    overflow: 'hidden',
    marginBottom: 12,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  linkText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: EDITORIAL.text,
    letterSpacing: -0.2,
  },
  // Logout
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#F0D4D3',
    backgroundColor: '#FDF5F5',
    marginTop: 4,
  },
  logoutText: { fontSize: 14, fontWeight: '600', color: '#B85450' },
});
