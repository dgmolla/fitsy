import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface EmptyStateProps {
  hasInputs: boolean;
}

export function EmptyState({ hasInputs }: EmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateText}>
        {hasInputs
          ? 'No restaurants match your macro targets'
          : 'Enter macro targets above to find matching restaurants'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingTop: 64,
  },
  emptyStateText: {
    fontSize: 15,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 22,
  },
});
