import AsyncStorage from '@react-native-async-storage/async-storage';

export const PENDING_PROFILE_SYNC_KEY = '@fitsy/pending_profile_sync';
export const PROFILE_SYNC_ACK_KEY = '@fitsy/profile_sync_ack';
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
    await AsyncStorage.removeItem(`${PROFILE_SYNC_ACK_KEY}:${userId}`);
  });
}


/** A durable receipt precedes target acknowledgement and pending-body cleanup. */
export function recordProfileAcknowledgement(userId: string, pendingRaw: string | null,
  targetRaw: string | null): Promise<void> {
  return queueProfileStorage(async () => {
    if (isProfileSyncForgotten(userId)) return;
    await AsyncStorage.setItem(`${PROFILE_SYNC_ACK_KEY}:${userId}`, JSON.stringify({ pendingRaw, targetRaw }));
  });
}

/** Recover interrupted cleanup without resending an already acknowledged edit. */
export async function profileWriteWasAcknowledged(userId: string, pendingRaw: string | null,
  targetRaw: string | null): Promise<boolean> {
  const raw = await AsyncStorage.getItem(`${PROFILE_SYNC_ACK_KEY}:${userId}`);
  if (!raw) return false;
  const ack = JSON.parse(raw) as { pendingRaw: string | null; targetRaw: string | null };
  return ack.pendingRaw === pendingRaw && (targetRaw === null || ack.targetRaw === targetRaw);
}
