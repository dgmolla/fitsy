import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@fitsy/onboardingPreviewEntry';
const listeners = new Set<() => void>();

export function subscribeOnboardingPreviewEntry(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Only the nutrition-source Continue action opens another bounded preview pass. */
export async function rememberOnboardingPreviewEntry(): Promise<void> {
  await AsyncStorage.setItem(KEY, '1');
  notify();
}

export async function readOnboardingPreviewEntry(): Promise<boolean> {
  try {
    return await AsyncStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export async function clearOnboardingPreviewEntry(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
  notify();
}

const WIDGET_TIP_KEY = '@fitsy/onboardingWidgetTip';

/**
 * Set only when preview hands off to the paywall during a real onboarding
 * pass (welcome/preview); a returning sign-in that reaches payment directly
 * (e.g. a never-subscribed account signing back in) never sets this, so it
 * never sees the widget tip a second time.
 */
export async function rememberShowWidgetTip(): Promise<void> {
  await AsyncStorage.setItem(WIDGET_TIP_KEY, '1');
}

/** Read-and-clear: the tip is shown at most once per onboarding pass. */
export async function consumeShowWidgetTip(): Promise<boolean> {
  let value: string | null;
  try {
    value = await AsyncStorage.getItem(WIDGET_TIP_KEY);
  } catch {
    return false;
  }
  await AsyncStorage.removeItem(WIDGET_TIP_KEY);
  return value === '1';
}
