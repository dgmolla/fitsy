import { Dimensions, View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const NAV_WIDTH = SCREEN_WIDTH * 0.78;
const NAV_MARGIN = (SCREEN_WIDTH - NAV_WIDTH) / 2;

export default function TabLayout() {
  const { colors, mode } = useTheme();

  const navBg = mode === 'dark' ? '#1E242E' : '#FFFFFF';
  const inactiveColor = mode === 'dark' ? 'rgba(255,255,255,0.4)' : '#94A3B8';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: 32,
          marginHorizontal: NAV_MARGIN,
          height: 58,
          backgroundColor: navBg,
          borderRadius: 29,
          borderWidth: 1.5,
          borderColor: mode === 'dark' ? 'rgba(68,72,79,0.5)' : 'rgba(0,0,0,0.1)',
          elevation: 12,
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          paddingBottom: 0,
          paddingTop: 0,
        },
        tabBarActiveTintColor: '#22C55E',
        tabBarInactiveTintColor: inactiveColor,
        tabBarLabelStyle: {
          fontSize: 9,
          fontWeight: '700',
          letterSpacing: 0.8,
        },
        tabBarItemStyle: {
          justifyContent: 'center',
          alignItems: 'center',
          height: 58,
        },
      }}
    >
      <Tabs.Screen
        name="search"
        options={{
          title: 'DISCOVER',
          tabBarIcon: ({ color, focused }: { color: string; size: number; focused: boolean }) => (
            <Ionicons
              name={focused ? 'compass' : 'compass-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: 'SAVED',
          tabBarIcon: ({ color, focused }: { color: string; size: number; focused: boolean }) => (
            <Ionicons name={focused ? 'bookmark' : 'bookmark-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'PROFILE',
          tabBarIcon: ({ color, focused }: { color: string; size: number; focused: boolean }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
