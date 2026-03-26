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
import { clearToken, getStoredToken } from '@/lib/authClient';
import { decodeEmailFromToken } from '@/lib/jwtUtils';
import type { MacroValues } from '@/lib/macroPresets';
import { getMacroTargets, saveMacroTargets } from '@/lib/macroStorage';
import { MacroTargetsSection } from '@/components/MacroTargetsSection';

export default function ProfileScreen() {
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string>('—');
  const [macroTargets, setMacroTargets] = useState<MacroValues | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [token, macros] = await Promise.all([
          getStoredToken(),
          getMacroTargets(),
        ]);

        if (token) {
          setEmail(decodeEmailFromToken(token));
        }

        if (macros) {
          setMacroTargets(macros);
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
    await saveMacroTargets(values);
    setMacroTargets(values);
  }, []);

  const handleSetupPress = useCallback(() => {
    router.replace('/(tabs)/search');
  }, []);

  const handleLogout = useCallback(async () => {
    await clearToken();
    router.replace('/auth/login');
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator
          size="large"
          color="#2D7D46"
          style={styles.spinner}
          accessibilityLabel="Loading profile"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.screenTitle}>Profile</Text>

        {/* Account section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.emailRow}>
            <Text style={styles.emailLabel}>Email</Text>
            <Text style={styles.emailValue} accessibilityLabel={`Email: ${email}`}>
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
          style={styles.logoutButton}
          onPress={handleLogout}
          accessibilityRole="button"
          accessibilityLabel="Log out"
        >
          <Text style={styles.logoutButtonText}>Log out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  spinner: {
    flex: 1,
    alignSelf: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 20,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  emailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  emailLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  emailValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '500',
    flexShrink: 1,
    textAlign: 'right',
  },
  logoutButton: {
    height: 50,
    backgroundColor: '#FEE2E2',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  logoutButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#DC2626',
  },
});
