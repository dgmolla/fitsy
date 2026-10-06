import AsyncStorage from '@react-native-async-storage/async-storage';

export const PENDING_PROFILE_SYNC_KEY = '@fitsy/pending_profile_sync';
let storageQueue: Promise<void> = Promise.resolve();
const forgottenOwners = new Set<string>();

/** Durable writes, acknowledgements and deletion share one storage ordering. */
export function queueProfileStorage(write: () => Promise<void>): Promise<void> {
  const attempt = storageQueue.then(write, write);
  storageQueue = attempt.catch(() => {});
  return attempt;
}

export const waitForProfileStorage = () => storageQueue;
export const isProfileSyncForgotten = (userId: string) => forgottenOwners.has(userId);

/** Prevent already queued work from recreating a deleted account's local data. */
export function forgetPendingProfileSync(userId: string): Promise<void> {
  forgottenOwners.add(userId);
  return queueProfileStorage(async () => {
    await AsyncStorage.removeItem(`${PENDING_PROFILE_SYNC_KEY}:${userId}`);
  });
}
