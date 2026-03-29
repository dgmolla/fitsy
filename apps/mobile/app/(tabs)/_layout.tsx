import { useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';

const NAV_BAR_HEIGHT = 48;
const NAV_BAR_BOTTOM_MARGIN = 12;

export default function TabLayout() {
  const { colors, mode } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isDark = mode === 'dark';
  const navBg = isDark ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)';
  const navMargin = Math.round(width * 0.30);
  const bottomPosition = insets.bottom > 0 ? insets.bottom : NAV_BAR_BOTTOM_MARGIN;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: bottomPosition,
          left: navMargin,
          right: navMargin,
          height: NAV_BAR_HEIGHT,
          borderRadius: 24,
          borderTopWidth: 0,
          backgroundColor: navBg,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
          shadowColor: colors.glassShadowColor,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: isDark ? 0.3 : 0.12,
          shadowRadius: 12,
          elevation: 8,
          paddingBottom: 0,
          paddingTop: 0,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
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
