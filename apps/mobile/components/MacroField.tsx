import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

export interface MacroFieldProps {
  label: string;
  accessibilityLabel: string;
  value: string;
  error?: string;
  onChangeText: (text: string) => void;
  onBlur: () => void;
}

export function MacroField({
  label,
  accessibilityLabel,
  value,
  error,
  onChangeText,
  onBlur,
}: MacroFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, error ? styles.inputError : null]}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        keyboardType="numeric"
        returnKeyType="done"
        maxLength={5}
        placeholder="0"
        placeholderTextColor="#9CA3AF"
        accessibilityLabel={accessibilityLabel}
      />
      {error ? (
        <Text
          style={styles.errorText}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#111827',
    backgroundColor: '#FFFFFF',
  },
  inputError: {
    borderColor: '#DC2626',
  },
  errorText: {
    fontSize: 13,
    color: '#DC2626',
  },
});
