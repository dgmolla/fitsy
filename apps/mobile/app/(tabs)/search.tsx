import { FlatList, SafeAreaView, StyleSheet, Text, View } from 'react-native';

function TargetBarPlaceholder() {
  return (
    <View style={styles.targetBar}>
      <Text style={styles.targetBarText}>
        Set macro targets to get personalized results
      </Text>
    </View>
  );
}

function EmptyState() {
  return (
    <View style={styles.emptyState}>
      <Text
        style={styles.emptyStateText}
        accessibilityLabel="No restaurants found. Enter location to search."
      >
        Enter your location to find nearby restaurants
      </Text>
    </View>
  );
}

export default function SearchScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <TargetBarPlaceholder />
      <FlatList
        data={[]}
        renderItem={null}
        ListEmptyComponent={<EmptyState />}
        contentContainerStyle={styles.listContent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  targetBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#D1D5DB',
  },
  targetBarText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  listContent: {
    flexGrow: 1,
  },
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
