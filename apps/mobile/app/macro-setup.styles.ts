import { StyleSheet } from 'react-native';
import type { ThemeColors } from '@/lib/theme';

export function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    flex: {
      flex: 1,
    },
    scroll: {
      paddingHorizontal: 24,
      paddingTop: 40,
      paddingBottom: 40,
      gap: 32,
    },
    header: {
      alignItems: 'center',
      gap: 12,
    },
    emoji: {
      fontSize: 52,
    },
    title: {
      fontSize: 26,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 15,
      color: colors.textSecondary,
      lineHeight: 22,
      textAlign: 'center',
    },
    presetRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      justifyContent: 'center',
    },
    presetPill: {
      backgroundColor: colors.bgElevated,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    presetText: {
      fontSize: 13,
      color: colors.textPrimary,
      fontWeight: '500',
    },
    form: {
      gap: 20,
    },
    actions: {
      gap: 16,
      alignItems: 'center',
    },
    saveButton: {
      width: '100%',
      height: 52,
      backgroundColor: colors.accent,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    saveButtonDisabled: {
      opacity: 0.5,
    },
    saveText: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.accentOnAccent,
    },
    skipButton: {
      paddingVertical: 8,
    },
    skipText: {
      fontSize: 15,
      color: colors.textTertiary,
    },
  });
}
