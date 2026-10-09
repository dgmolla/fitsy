import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@fitsy/paymentSignInContinuation';
let pendingWrite: Promise<void> = Promise.resolve();
function write(work: () => Promise<void>): Promise<void> {
  const next = pendingWrite.then(work, work);
  pendingWrite = next.catch(() => undefined);
  return next;
}

/** Keep an interrupted anonymous checkout tied to sign-in, not a paywall. */
export async function rememberPaymentSignInContinuation(): Promise<void> {
  await write(() => AsyncStorage.setItem(KEY, '1'));
}

/** A resumed sign-in must never convert another account's checkout to anonymous. */
export async function preparePaymentSignInContinuation(): Promise<void> {
  await write(async () => {
    if (!(await AsyncStorage.getItem(KEY))) await AsyncStorage.setItem(KEY, '1');
  });
}

export async function hasPaymentSignInContinuation(userId?: string): Promise<boolean> {
  await pendingWrite;
  const value = await AsyncStorage.getItem(KEY);
  return value === '1' || !!value && (userId === undefined ? value.startsWith('user:') : value === `user:${userId}`);
}

/** Attach a pre-auth checkout to the account that just signed in. */
export async function bindPaymentSignInContinuation(userId: string): Promise<boolean> {
  let bound = false;
  await write(async () => {
    const value = await AsyncStorage.getItem(KEY);
    if (value === '1' || value === `user:${userId}`) {
      await AsyncStorage.setItem(KEY, `user:${userId}`);
      bound = true;
    } else if (value) await AsyncStorage.removeItem(KEY);
  });
  return bound;
}

export async function clearPaymentSignInContinuation(): Promise<void> {
  await write(() => AsyncStorage.removeItem(KEY));
}

/** A spent checkout preview must exit through the paywall instead of looping. */
export async function navigateBackFromPayment(
  canGoBack: boolean, userId: string | undefined, back: () => void, exit: () => void,
): Promise<void> {
  if (!canGoBack) { exit(); return; }
  try {
    if (await hasPaymentSignInContinuation(userId)) exit();
    else back();
  } catch { exit(); }
}
