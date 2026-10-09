import { Stack } from 'expo-router';

export default function WelcomeLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        gestureEnabled: true,
      }}
    >
      <Stack.Screen name="preview" options={{ gestureEnabled: false }} />
      {/* Sign-in Back clears a pending checkout; the swipe gesture cannot. */}
      <Stack.Screen name="signin" options={{ gestureEnabled: false }} />
      {/* Checkout Back owns the exit dialog; native pop bypasses that recovery. */}
      <Stack.Screen name="payment" options={{ gestureEnabled: false }} />
      <Stack.Screen name="resubscribe" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
