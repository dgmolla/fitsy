import { StyleSheet } from 'react-native';
import type { ThemeColors } from '@/lib/theme';

export function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    inner: {
      flex: 1,
      paddingHorizontal: 20,
      paddingTop: 24,
      paddingBottom: 16,
      gap: 20,
    },
    header: {
      alignItems: 'center',
      gap: 8,
    },
    emoji: {
      fontSize: 44,
    },
    title: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
      textAlign: 'center',
    },
    suggestionsSection: {
      gap: 8,
    },
    suggestionsLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      paddingLeft: 2,
    },
    suggestionsRow: {
      flexDirection: 'row',
      gap: 8,
    },
    suggestionPill: {
      flex: 1,
      backgroundColor: colors.bgElevated,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
      gap: 3,
      minHeight: 68,
      justifyContent: 'center',
    },
    suggestionPillActive: {
      backgroundColor: colors.accentBg,
      borderColor: colors.accent,
    },
    suggestionIcon: {
      fontSize: 18,
    },
    suggestionText: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    suggestionTextActive: {
      color: colors.accent,
    },
    suggestionHint: {
      fontSize: 10,
      color: colors.textTertiary,
      textAlign: 'center',
    },
    pickerGrid: {
      flex: 1,
      gap: 10,
    },
    pickerRow: {
      flex: 1,
      flexDirection: 'row',
      gap: 10,
    },
    actions: {
      gap: 12,
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
