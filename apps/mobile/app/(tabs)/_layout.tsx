import { Dimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const NAV_MARGIN = Math.round(SCREEN_WIDTH * 0.30);

export default function TabLayout() {
  const { colors, mode } = useTheme();

  const isDark = mode === 'dark';
  const navBg = isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: 32,
          left: NAV_MARGIN,
          right: NAV_MARGIN,
          height: 48,
          borderRadius: 24,
          borderTopWidth: 0,
          backgroundColor: navBg,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: isDark ? 0.3 : 0.12,
          shadowRadius: 12,
          elevation: 8,
          paddingBottom: 0,
          paddingTop: 0,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: isDark ? '#666' : '#9CA3AF',
        tabBarItemStyle: {
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingTop: 0,
          paddingBottom: 0,
          marginTop: 0,
          marginBottom: 0,
        },
        tabBarIconStyle: {
          marginTop: 0,
          marginBottom: 0,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="search"
        options={{
          title: 'Search',
          tabBarIcon: ({ color }: { color: string; size: number }) => (
            <Ionicons name="search" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'Saved',
          tabBarIcon: ({ color }: { color: string; size: number }) => (
            <Ionicons name="bookmark" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }: { color: string; size: number }) => (
            <Ionicons name="person" size={20} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
