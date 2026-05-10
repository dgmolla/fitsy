import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
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
import { api } from '@/lib/api';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenBackground } from '@/components/ScreenBackground';
import { decodeEmailFromToken } from '@/lib/jwtUtils';
import type { MacroValues } from '@/lib/macroPresets';
import { getMacroTargets, saveMacroTargets } from '@/lib/macroStorage';
import { getOnboardingData, saveOnboardingField, type OnboardingData, type ActivityLevel, type Goal } from '@/lib/onboardingStorage';
import { calculateAge } from '@fitsy/shared';
import { pushProfileToServer } from '@/lib/profileSync';
import { useTheme } from '@/lib/theme';
import { FilterPopup } from '@/components/FilterPopup';
import { ProfileEditSheet, type ProfileEditSheetProps } from '@/components/ProfileEditSheet';
import { calculateMacros, macrosToStored } from '@/lib/macroCalculator';
import {
  trackMacroTargetsEdited,
  trackProfileAccountDeleted,
  trackProfileFieldEdited,
  trackProfileLogoutTapped,
  type ProfileField,
} from '@/lib/analytics';
import { EDITORIAL, FONTS } from '@/lib/brand';

const GOAL_OPTIONS = [
  { id: 'lose_fat', label: 'Lose Weight', icon: 'flame-outline', description: 'Calorie deficit for fat loss' },
  { id: 'build_muscle', label: 'Build Muscle', icon: 'barbell-outline', description: 'Calorie surplus for growth' },
  { id: 'maintain', label: 'Maintain', icon: 'shield-checkmark-outline', description: 'Stay at current weight' },
  { id: 'eat_healthier', label: 'Eat Healthier', icon: 'leaf-outline', description: 'Better food choices' },
];

const ACTIVITY_OPTIONS = [
  { id: 'sedentary', label: 'Low', icon: 'desktop-outline', description: 'Desk job, little exercise' },
  { id: 'lightly_active', label: 'Light', icon: 'walk-outline', description: '1-3 days per week' },
  { id: 'active', label: 'Moderate', icon: 'bicycle-outline', description: '3-5 days per week' },
  { id: 'very_active', label: 'Intense', icon: 'fitness-outline', description: '6-7 days per week' },
];

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

type EditField = 'goal' | 'activity' | 'height' | 'weight' | 'age' | null;

export default function ProfileScreen() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>('—');
  const [macroTargets, setMacroTargets] = useState<MacroValues | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);
  const [profile, setProfile] = useState<OnboardingData>({});
  const [editField, setEditField] = useState<EditField>(null);
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
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('profile load failed', err);
        } finally {
          setLoading(false);
        }
      }
      void load();
    }, []),
  );

  const handleLogout = useCallback(async () => {
    trackProfileLogoutTapped();
    await clearToken();
    router.replace('/welcome/problem');
  }, []);

  const handleDelete = useCallback(async () => {
    try {
      await api.del('/api/user');
      trackProfileAccountDeleted({ success: true });
      await clearToken();
      router.replace('/welcome/problem');
    } catch {
      trackProfileAccountDeleted({ success: false });
      Alert.alert('Error', 'Could not delete your account. Please try again.');
    }
  }, []);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      'Delete account?',
      'This permanently removes your account, saved items, and subscription. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: handleDelete },
      ],
    );
  }, [handleDelete]);

  async function updateFieldAndRecalc<K extends keyof OnboardingData>(field: K, value: OnboardingData[K]) {
    await saveOnboardingField(field, value);
    const updated = await getOnboardingData();
    setProfile(updated);
    const newMacros = calculateMacros(updated);
    const stored = macrosToStored(newMacros);
    await saveMacroTargets(stored);
    setMacroTargets(stored);
    pushProfileToServer();
  }

  // `editField` is the key used internally by ProfileEditSheet, but the
  // `birthday` field is exposed in the UI as "age". We map back to the UI
  // label for the analytics event so dashboards group by what users see.
  function openEditField(field: ProfileField) {
    trackProfileFieldEdited({ field });
    setEditField(field);
  }

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

  function getEditSheetProps(): ProfileEditSheetProps | null {
    switch (editField) {
      case 'goal':
        return {
          type: 'choice',
          visible: true,
          title: 'Your Goal',
          options: GOAL_OPTIONS,
          value: profile.goal ?? 'maintain',
          onApply: (v) => { setEditField(null); updateFieldAndRecalc('goal', v as Goal); },
          onClose: () => setEditField(null),
        };
      case 'activity':
        return {
          type: 'choice',
          visible: true,
          title: 'Activity Level',
          options: ACTIVITY_OPTIONS,
          value: profile.activity ?? 'lightly_active',
          onApply: (v) => { setEditField(null); updateFieldAndRecalc('activity', v as ActivityLevel); },
          onClose: () => setEditField(null),
        };
      case 'height':
        return {
          type: 'height',
          visible: true,
          title: 'Height',
          valueCm: profile.heightCm ? String(profile.heightCm) : '',
          onApply: (v) => { setEditField(null); updateFieldAndRecalc('heightCm', parseInt(v) || undefined); },
          onClose: () => setEditField(null),
        };
      case 'weight':
        return {
          type: 'numeric',
          visible: true,
          title: 'Weight',
          value: profile.weightKg ? String(Math.round(profile.weightKg * 2.20462)) : '',
          unit: 'lbs',
          placeholder: '70',
          onApply: (v) => { setEditField(null); updateFieldAndRecalc('weightKg', Math.round(((parseInt(v) || 0) * 0.453592) * 10) / 10 || undefined); },
          onClose: () => setEditField(null),
        };
      case 'age':
        return {
          type: 'numeric',
          visible: true,
          title: 'Age',
          value: age ? String(age) : '',
          unit: 'years',
          placeholder: '25',
          onApply: (v) => {
            setEditField(null);
            const ageNum = parseInt(v) || 25;
            const year = new Date().getFullYear() - ageNum;
            updateFieldAndRecalc('birthday', `${year}-01-01`);
          },
          onClose: () => setEditField(null),
        };
      default:
        return null;
    }
  }

  const sheetProps = getEditSheetProps();

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
        <Pressable style={s.goalBanner} onPress={() => openEditField('goal')}>
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
          <Pressable style={s.statBlock} onPress={() => openEditField('age')}>
            <Text style={s.statValue}>{age ?? '—'}</Text>
            <Text style={s.statLabel}>Age</Text>
          </Pressable>
          <View style={s.statDivider} />
          <Pressable style={s.statBlock} onPress={() => openEditField('height')}>
            <Text style={s.statValue}>{profile.heightCm ? `${Math.floor(profile.heightCm / 2.54 / 12)}'${Math.round(profile.heightCm / 2.54 % 12)}"` : '—'}</Text>
            <Text style={s.statLabel}>Height</Text>
          </Pressable>
          <View style={s.statDivider} />
          <Pressable style={s.statBlock} onPress={() => openEditField('weight')}>
            <Text style={s.statValue}>{profile.weightKg ? `${Math.round(profile.weightKg * 2.20462)}lbs` : '—'}</Text>
            <Text style={s.statLabel}>Weight</Text>
          </Pressable>
          <View style={s.statDivider} />
          <Pressable style={s.statBlock} onPress={() => openEditField('activity')}>
            <Text style={[s.statValue, { fontSize: 14 }]}>
              {profile.activity ? profile.activity.replace(/_/g, ' ').split(' ')[0]!.charAt(0).toUpperCase() + profile.activity.replace(/_/g, ' ').split(' ')[0]!.slice(1) : '—'}
            </Text>
            <Text style={s.statLabel}>Activity</Text>
          </Pressable>
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

        {/* Logout */}
        <Pressable style={s.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={16} color="#B85450" />
          <Text style={s.logoutText}>Log out</Text>
        </Pressable>

        {/* Delete account — subtle, destructive */}
        <Pressable style={s.deleteBtn} onPress={confirmDelete}>
          <Text style={s.deleteText}>Delete account</Text>
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
        trackMacroTargetsEdited({
          entry_point: 'profile',
          has_protein: updated.protein !== '',
          has_carbs: updated.carbs !== '',
          has_fat: updated.fat !== '',
          has_calories: updated.calories !== '',
        });
      }}
      onClose={() => setFilterVisible(false)}
    />

    {sheetProps && <ProfileEditSheet {...sheetProps} />}
    </>
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
    fontFamily: FONTS.frauncesBold,
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
    fontSize: 18,
    fontWeight: '700',
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
    fontSize: 18,
    fontWeight: '700',
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
  // Delete account — subtle text-only, no background
  deleteBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 8,
  },
  deleteText: { fontSize: 13, fontWeight: '500', color: '#B85450' },
});
