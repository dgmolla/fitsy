import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

interface Props {
  label?: string;
  onPress: () => void;
  disabled?: boolean;
}

export function ContinueButton({ label = 'Continue', onPress, disabled = false }: Props) {
  return (
    <TouchableOpacity
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
    >
      <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#2D7D46',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  buttonDisabled: {
    backgroundColor: '#D1D5DB',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  labelDisabled: {
    color: '#9CA3AF',
  },
});
