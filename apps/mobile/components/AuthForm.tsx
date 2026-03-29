import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '@/lib/theme';
import { BRAND } from '@/lib/brand';

export interface AuthFormProps {
  mode: 'login' | 'register';
  onSubmit: (fields: { name?: string; email: string; password: string }) => Promise<void>;
  footerText: string;
  footerLinkText: string;
  onFooterPress: () => void;
}

export function AuthForm({
  mode,
  onSubmit,
  footerText,
  footerLinkText,
  onFooterPress,
}: AuthFormProps) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRegister = mode === 'register';

  const canSubmit =
    (isRegister ? name.trim().length > 0 : true) &&
    email.trim().length > 0 &&
    password.length > 0 &&
    !loading;

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      await onSubmit({
        ...(isRegister ? { name: name.trim() } : {}),
        email: email.trim(),
        password,
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isRegister
          ? 'Registration failed. Please try again.'
          : 'Login failed. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  const title = isRegister ? 'Create account' : 'Welcome back';
  const subtitle = isRegister
    ? 'Start finding meals that match your goals'
    : 'Log in to find meals that fit your macros';
  const submitLabel = isRegister ? 'Create account' : 'Log in';
  const loadingLabel = isRegister ? 'Creating account\u2026' : 'Logging in\u2026';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
        </View>

        <View style={styles.form}>
          {isRegister && (
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>Name</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor: colors.inputBorder,
                    color: colors.inputText,
                    backgroundColor: colors.inputBg,
                  },
                ]}
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoCorrect={false}
                autoComplete="name"
                textContentType="name"
                accessibilityLabel="Full name"
                placeholder="Jane Doe"
                placeholderTextColor={colors.inputPlaceholder}
                editable={!loading}
              />
            </View>
          )}

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>Email</Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: colors.inputBorder,
                  color: colors.inputText,
                  backgroundColor: colors.inputBg,
                },
              ]}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              accessibilityLabel="Email address"
              placeholder="you@example.com"
              placeholderTextColor={colors.inputPlaceholder}
              editable={!loading}
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>Password</Text>
            <TextInput
              style={[
                styles.input,
                {
                  borderColor: colors.inputBorder,
                  color: colors.inputText,
                  backgroundColor: colors.inputBg,
                },
              ]}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={isRegister ? 'new-password' : 'password'}
              textContentType={isRegister ? 'newPassword' : 'password'}
              accessibilityLabel="Password"
              placeholder={isRegister ? 'At least 8 characters' : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
              placeholderTextColor={colors.inputPlaceholder}
              editable={!loading}
            />
          </View>

          {error !== null && (
            <View
              style={[styles.errorBanner, { backgroundColor: colors.errorBg }]}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
            >
              <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
            </View>
          )}

          <Pressable
            style={[
              styles.button,
              { backgroundColor: colors.accent },
              !canSubmit && styles.buttonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityLabel={loading ? loadingLabel : submitLabel}
            accessibilityRole="button"
          >
            {loading ? (
              <ActivityIndicator size="small" color={colors.accentOnAccent} />
            ) : (
              <Text style={[styles.buttonText, { color: colors.accentOnAccent }]}>
                {submitLabel}
              </Text>
            )}
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.textSecondary }]}>{footerText}</Text>
          <Pressable
            onPress={onFooterPress}
            accessibilityRole="button"
            accessibilityLabel={footerLinkText}
            hitSlop={8}
          >
            <Text style={[styles.footerLink, { color: BRAND.color }]}> {footerLinkText}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  form: {
    gap: 16,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  errorBanner: {
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  button: {
    height: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 32,
  },
  footerText: {
    fontSize: 14,
  },
  footerLink: {
    fontSize: 14,
    fontWeight: '600',
  },
});
