import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { BlurFallback } from '@/lib/BlurFallback';

export default function TabLayout() {
  const { colors, mode } = useTheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: 28,
          left: 32,
          right: 32,
          height: 60,
          borderRadius: 30,
          borderTopWidth: 0,
          backgroundColor: 'transparent',
          elevation: 0,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.10,
          shadowRadius: 28,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
        },
        tabBarBackground: () => (
          <BlurFallback
            tint={mode === 'dark' ? 'dark' : 'light'}
            intensity={92}
            fallbackColor={colors.tabBarBg}
            style={{ borderRadius: 30 }}
          />
        ),
        tabBarItemStyle: {
          paddingVertical: 6,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Ionicons name="search" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Ionicons name="bookmark" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Ionicons name="person" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
