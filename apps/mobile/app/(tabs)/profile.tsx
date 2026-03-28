import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearToken, getStoredToken } from '@/lib/authClient';
import { decodeEmailFromToken } from '@/lib/jwtUtils';
import type { MacroValues } from '@/lib/macroPresets';
import { MacroTargetsSection } from '@/components/MacroTargetsSection';
import { useTheme } from '@/lib/theme';

const MACRO_STORAGE_KEY = 'fitsy:macroTargets';

export default function ProfileScreen() {
  const { colors } = useTheme();
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>('—');
  const [macroTargets, setMacroTargets] = useState<MacroValues | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [token, rawMacros] = await Promise.all([
          getStoredToken(),
          AsyncStorage.getItem(MACRO_STORAGE_KEY),
        ]);

        if (token) {
          setEmail(decodeEmailFromToken(token));
        }

        if (rawMacros) {
          setMacroTargets(JSON.parse(rawMacros) as MacroValues);
        }
      } catch {
        // Use defaults on storage failure
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const handleSaveMacros = useCallback(async (values: MacroValues) => {
    await AsyncStorage.setItem(MACRO_STORAGE_KEY, JSON.stringify(values));
    setMacroTargets(values);
  }, []);

  const handleSetupPress = useCallback(() => {
    router.replace('/(tabs)/search');
  }, []);

  const handleLogout = useCallback(async () => {
    await clearToken();
    router.replace('/auth/login');
  }, []);

  const initials = email !== '—' ? email.charAt(0).toUpperCase() : '?';

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
        <ActivityIndicator
          size="large"
          color={colors.spinnerColor}
          style={styles.spinner}
          accessibilityLabel="Loading profile"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.screenTitle, { color: colors.textPrimary }]}>Profile</Text>

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

        {/* Macro targets section */}
        <MacroTargetsSection
          targets={macroTargets}
          onSave={handleSaveMacros}
          onSetupPress={handleSetupPress}
        />

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
    </SafeAreaView>
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
    padding: 16,
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
