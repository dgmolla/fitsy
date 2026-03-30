import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { clearToken, getStoredToken } from '@/lib/authClient';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScreenBackground } from '@/components/ScreenBackground';
import { decodeEmailFromToken } from '@/lib/jwtUtils';
import type { MacroValues } from '@/lib/macroPresets';
import { getMacroTargets } from '@/lib/macroStorage';
import { getOnboardingData, type OnboardingData } from '@/lib/onboardingStorage';
import { calculateAge } from '@fitsy/shared';
import { pushProfileToServer } from '@/lib/profileSync';
import { useTheme } from '@/lib/theme';

function formatBirthday(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ProfileRow({ label, value, onPress, colors }: {
  label: string;
  value?: string;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <Pressable style={styles.profileRow} onPress={onPress} accessibilityRole="button">
      <Text style={[styles.profileLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.profileValue, { color: value ? colors.textPrimary : colors.textTertiary }]}>
        {value ?? 'Not set'}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>('—');
  const [macroTargets, setMacroTargets] = useState<MacroValues | null>(null);
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

          if (token) {
            setEmail(decodeEmailFromToken(token));
          }

          if (stored) {
            setMacroTargets(stored as unknown as MacroValues);
          }

          setProfile(onboarding);

          // Push to server if profile data changed since last focus
          const snapshot = JSON.stringify(onboarding);
          if (prevProfile.current && prevProfile.current !== snapshot) {
            pushProfileToServer();
          }
          prevProfile.current = snapshot;
        } catch {
          // Use defaults on storage failure
        } finally {
          setLoading(false);
        }
      }
      void load();
    }, []),
  );

  const handleLogout = useCallback(async () => {
    await clearToken();
    router.replace('/welcome');
  }, []);

  const initials = email !== '—' ? email.charAt(0).toUpperCase() : '?';

  if (loading) {
    return (
      <ScreenBackground>
        <ActivityIndicator
          size="large"
          color={colors.spinnerColor}
          style={styles.spinner}
          accessibilityLabel="Loading profile"
        />
      </ScreenBackground>
    );
  }

  return (
    <ScreenBackground>
      <ScreenHeader />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >

        {/* Avatar + account section */}
        <View style={[styles.section, {
          backgroundColor: colors.bgCard,
          borderColor: colors.border,
          shadowColor: colors.glassShadowColor,
          shadowOpacity: colors.glassShadowOpacity,
          shadowRadius: colors.glassShadowRadius,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
        }]}>
          <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Account</Text>
          <View style={styles.accountRow}>
            <View style={[styles.avatar, { backgroundColor: colors.accentBg, borderColor: colors.accentBorder }]}>
              <Text style={[styles.avatarText, { color: colors.accent }]}>{initials}</Text>
            </View>
            <Text
              style={[styles.emailValue, { color: colors.textSecondary }]}
              numberOfLines={1}
              accessibilityLabel={`Email: ${email}`}
            >
              {email}
            </Text>
          </View>
        </View>

        {/* Body stats */}
        <View style={[styles.section, {
          backgroundColor: colors.bgCard,
          borderColor: colors.border,
          shadowColor: colors.glassShadowColor,
          shadowOpacity: colors.glassShadowOpacity,
          shadowRadius: colors.glassShadowRadius,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
        }]}>
          <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Body Stats</Text>
          <ProfileRow
            label="Birthday"
            value={profile.birthday ? `${formatBirthday(profile.birthday)} (${calculateAge(profile.birthday)} yrs)` : undefined}
            onPress={() => router.push('/welcome/age')}
            colors={colors}
          />
          <ProfileRow
            label="Height"
            value={profile.heightCm ? `${profile.heightCm} cm` : undefined}
            onPress={() => router.push('/welcome/height')}
            colors={colors}
          />
          <ProfileRow
            label="Weight"
            value={profile.weightKg ? `${profile.weightKg} kg` : undefined}
            onPress={() => router.push('/welcome/weight')}
            colors={colors}
          />
          <ProfileRow
            label="Activity"
            value={profile.activity?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            onPress={() => router.push('/welcome/activity')}
            colors={colors}
          />
          <ProfileRow
            label="Goal"
            value={profile.goal?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
            onPress={() => router.push('/welcome/goal')}
            colors={colors}
          />
        </View>

        {/* Per-meal macros (read-only, derived from body stats) */}
        {macroTargets && (
          <View style={[styles.section, {
            backgroundColor: colors.bgCard,
            borderColor: colors.border,
            shadowColor: colors.glassShadowColor,
            shadowOpacity: colors.glassShadowOpacity,
            shadowRadius: colors.glassShadowRadius,
            shadowOffset: { width: 0, height: 4 },
            elevation: 8,
          }]}>
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Per-Meal Targets</Text>
            <View style={styles.macroGrid}>
              {[
                { label: 'Protein', value: macroTargets.protein, unit: 'g' },
                { label: 'Carbs', value: macroTargets.carbs, unit: 'g' },
                { label: 'Fat', value: macroTargets.fat, unit: 'g' },
              ].map(({ label, value, unit }) => (
                <View key={label} style={styles.macroChip}>
                  <Text style={[styles.macroChipValue, { color: colors.accent }]}>{value || '--'}{unit}</Text>
                  <Text style={[styles.macroChipLabel, { color: colors.textTertiary }]}>{label}</Text>
                </View>
              ))}
            </View>
            <Text style={[styles.macroHint, { color: colors.textTertiary }]}>
              Calculated from your body stats. Adjust targets in the search tab.
            </Text>
          </View>
        )}

        {/* Logout */}
        <Pressable
          style={[styles.logoutButton, { backgroundColor: colors.errorBg, borderColor: colors.errorBorder }]}
          onPress={handleLogout}
          accessibilityRole="button"
          accessibilityLabel="Log out"
        >
          <Text style={[styles.logoutButtonText, { color: colors.error }]}>Log out</Text>
        </Pressable>
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  spinner: {
    flex: 1,
    alignSelf: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  section: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 12,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  emailValue: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  profileLabel: {
    fontSize: 14,
    fontWeight: '500',
    width: 70,
  },
  profileValue: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  macroGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  macroChip: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  macroChipValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  macroChipLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  macroHint: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
  logoutButton: {
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    borderWidth: 1,
  },
  logoutButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
