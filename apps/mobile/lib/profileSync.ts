import { api } from './api';
import { getStoredToken } from './authClient';
import { getOnboardingData, type OnboardingData } from './onboardingStorage';
import { clearArchivedMacroTarget, getAnonymousCompleteTarget, getArchivedMacroTarget, getDiscoveryMacroTargetSnapshot, getMacroTargetSnapshot, getMacroTargetSource, getQuarantinedLegacyTarget, saveMacroTargets, type StoredMacroTargets } from './macroStorage';
import { MEALS_PER_DAY } from './macroCalculator';
import { macroCalories, parseTarget } from './macroEnergy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { ProfileResponse as ProfileContract, UserGoalV2 } from '@fitsy/shared';

// This client opts into goalSchema=2; legacy clients keep the default contract.
type ProfileResponse = ProfileContract<UserGoalV2>;

const ONBOARDING_KEY = '@fitsy/onboarding';
const PENDING_PROFILE_SYNC_KEY = '@fitsy/pending_profile_sync';
const pendingKey = (userId: string) => `${PENDING_PROFILE_SYNC_KEY}:${userId}`;
let lastPush: Promise<boolean> = Promise.resolve(true);
let savedSyncQueue: Promise<void> = Promise.resolve();
let profileRevision = 0;
let retryCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Returns null on auth failure or network error. */
export async function fetchProfile(expectedUserId?: string): Promise<ProfileResponse | null> {
  try {
    return await api.get<ProfileResponse>('/api/user/profile?goalSchema=2', true, {}, expectedUserId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[profileSync] fetchProfile failed:', err);
    return null;
  }
}

/** Build daily API targets from the complete local meal allocation. */
async function buildProfileBody(): Promise<Record<string, unknown>> {
    const [onboarding, macroSnapshot, discoverySnapshot] = await Promise.all([
      getOnboardingData(),
      getMacroTargetSnapshot(),
      getDiscoveryMacroTargetSnapshot(),
    ]);
    const macros = macroSnapshot?.targets;
    const partialFilter = !macros && discoverySnapshot?.mode === 'search';
    const userId = (await supabase.auth.getSession()).data.session?.user?.id;
    const unreconciledArchive = !macros && userId && await getArchivedMacroTarget(userId);

    const body: Record<string, unknown> = {};

    if (onboarding.birthday) body.birthday = onboarding.birthday;
    if (onboarding.heightCm) body.heightCm = onboarding.heightCm;
    if (onboarding.weightKg) body.weightKg = onboarding.weightKg;
    if (onboarding.sex) body.sex = onboarding.sex;
    if (onboarding.activity) body.activityLevel = onboarding.activity;
    if (onboarding.goal) body.goal = onboarding.goal;

    // Convert per-meal → daily (×MEALS_PER_DAY)
    if (partialFilter || unreconciledArchive) body.preserveMacroTarget = true;
    if (macros && !partialFilter) {
      const p = parseTarget(macros.protein);
      const c = parseTarget(macros.carbs);
      const f = parseTarget(macros.fat);
      const cal = parseTarget(macros.calories);
      if (p !== null && c !== null && f !== null && cal !== null)
        body.macroTarget = dailyMacroTarget(macros, await getMacroTargetSource());
    }

    return body;
}

function dailyMacroTarget(macros: StoredMacroTargets, source: 'automatic' | 'manual') {
  const daily = {
    proteinG: Math.round(Number(macros.protein) * MEALS_PER_DAY),
    carbsG: Math.round(Number(macros.carbs) * MEALS_PER_DAY),
    fatG: Math.round(Number(macros.fat) * MEALS_PER_DAY),
  };
  return { ...daily, source, calories: macroCalories({ protein: daily.proteinG,
    carbs: daily.carbsG, fat: daily.fatG }) };
}

async function performProfilePush(expectedUserId: string, savedBody?: Record<string, unknown>): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user?.id !== expectedUserId) return false;
    const token = await getStoredToken();
    if (!token) return false;
    const body = savedBody ?? await buildProfileBody();
    if (Object.keys(body).length === 0) return true;
    await api.patch('/api/user/profile?goalSchema=2', body, true, expectedUserId);
    return true;
  } catch (err) {
    // Data stays local; the next pushProfileToServer call retries. Surface in
    // console so we don't silently lose the entire profile sync silently
    // during onboarding the way we did before S-221.
    // eslint-disable-next-line no-console
    console.warn('[profileSync] pushProfileToServer failed:', err);
    return false;
  }
}

/** Serialize all profile writes so a slower older request cannot overwrite a newer edit. */
export function pushProfileToServer(expectedUserId?: string, savedBody?: Record<string, unknown>): Promise<boolean> {
  const session = expectedUserId ? null : supabase.auth.getSession();
  const run = async () => {
    const userId = expectedUserId ?? (await session!)?.data.session?.user?.id ?? null;
    if (!userId) return false;
    return performProfilePush(userId, savedBody);
  };
  const attempt = lastPush.then(run, run);
  lastPush = attempt;
  return attempt;
}

async function retryPendingProfileSync(scheduleRetry = true): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return true;
  const key = pendingKey(userId);
  let sentRaw: string | null = null;
  // Read inside delivery serialization: an earlier delayed read must never
  // enqueue a stale body after a later revision has already reached the API.
  const deliver = async () => {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return true;
    const pending = JSON.parse(raw) as { revision: number; body: Record<string, unknown> };
    if (!await performProfilePush(userId, pending.body)) return false;
    sentRaw = raw;
    return true;
  };
  const delivery = lastPush.then(deliver, deliver);
  lastPush = delivery;
  if (await delivery) {
    if (sentRaw === null) return true;
    // Acknowledgement and durable writes share the same storage queue.
    // Network delivery stays outside it so an offline request cannot block edits.
    const cleanup = async () => {
      if (await AsyncStorage.getItem(key) === sentRaw) {
        await AsyncStorage.removeItem(key);
        retryCount = 0;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
      }
    };
    const acknowledged = savedSyncQueue.then(cleanup, cleanup);
    savedSyncQueue = acknowledged.catch(() => {});
    await acknowledged;
    return true;
  }
  if (scheduleRetry && !retryTimer) {
    const delay = [1000, 5000, 15000][retryCount++] ?? 60000;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void retryPendingProfileSync().catch(err => {
        // eslint-disable-next-line no-console
        console.warn('[profileSync] pending profile retry failed:', err);
      });
    }, delay);
  }
  return false;
}

/** Keep a failed local edit pending and retry before a later profile pull. */
async function performSavedProfileSync(revision: number,
  session: ReturnType<typeof supabase.auth.getSession>, bodyOverride?: Record<string, unknown>): Promise<void> {
  const { data } = await session;
  const userId = data.session?.user?.id;
  if (!userId) {
    await pushProfileToServer();
    return;
  }
  if ((await supabase.auth.getSession()).data.session?.user?.id !== userId) return;
  retryCount = 0;
  const nextBody = bodyOverride ?? await buildProfileBody();
  if ((await supabase.auth.getSession()).data.session?.user?.id !== userId) return;
  if (Object.keys(nextBody).length === 0) return;
  // A later target-only edit must retain offline body facts in the same
  // account's durable request. The serialized queue owns this merge.
  const raw = await AsyncStorage.getItem(pendingKey(userId));
  const previous = raw ? JSON.parse(raw) as { body: Record<string, unknown> } : null;
  const body = { ...previous?.body, ...nextBody };
  if (body.macroTarget) delete body.preserveMacroTarget;
  if ((await supabase.auth.getSession()).data.session?.user?.id !== userId) return;
  await AsyncStorage.setItem(pendingKey(userId),
    JSON.stringify({ revision, body }));
}

export function queueSavedProfileToServer(bodyOverride?: Record<string, unknown>): Promise<void> {
  const revision = ++profileRevision;
  const session = supabase.auth.getSession();
  const attempt = savedSyncQueue.then(() => performSavedProfileSync(revision, session, bodyOverride),
    () => performSavedProfileSync(revision, session, bodyOverride));
  savedSyncQueue = attempt.catch(() => {});
  return attempt;
}

/** Persist before acknowledging an edit; network delivery never owns the storage queue. */
export async function syncSavedProfileToServer(bodyOverride?: Record<string, unknown>): Promise<void> {
  await queueSavedProfileToServer(bodyOverride);
  await retryPendingProfileSync();
}

export function deliverQueuedProfile(): void {
  void retryPendingProfileSync().catch(err => {
    // eslint-disable-next-line no-console
    console.warn('[profileSync] pending profile delivery failed:', err);
  });
}

/** Resume a durable edit on ordinary authenticated app startup. */
export async function replayPendingProfileSync(): Promise<void> {
  try {
    await retryPendingProfileSync();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[profileSync] pending profile replay failed:', err);
  }
}

/**
 * Pull the user's profile from the server and populate AsyncStorage.
 * Call after login to restore data on a new device.
 */
export type ProfileReconciliation = 'restored' | 'absent' | 'unavailable' | 'account-changed';

export async function pullProfileFromServer(): Promise<ProfileReconciliation> {
  try {
    const { data: startingAuth } = await supabase.auth.getSession();
    const expectedUserId = startingAuth.session?.user?.id;
    if (!expectedUserId) return 'account-changed';
    const stillCurrent = async () =>
      (await supabase.auth.getSession()).data.session?.user?.id === expectedUserId;
    await savedSyncQueue;
    await getQuarantinedLegacyTarget();
    const anonymousTarget = await getAnonymousCompleteTarget();
    const archivedTarget = anonymousTarget ? null : await getArchivedMacroTarget(expectedUserId);
    if (!(await stillCurrent())) return 'account-changed';
    // An archive is a local cache, not evidence of an unsynced write.
    // Replay the account's durable pending request before reading the server.
    const claimedTarget = anonymousTarget?.targets;
    if (claimedTarget) {
      await saveMacroTargets(claimedTarget, 'complete', anonymousTarget!.source, expectedUserId);
      if (!(await stillCurrent())) return 'account-changed';
      await syncSavedProfileToServer({ macroTarget: dailyMacroTarget(claimedTarget, anonymousTarget!.source) });
    }
    if (!(await retryPendingProfileSync())) return 'unavailable';
    if (!(await stillCurrent())) return 'account-changed';
    const revision = profileRevision;
    const profile = await fetchProfile(expectedUserId);
    if (!(await stillCurrent())) return 'account-changed';
    if (!profile || profileRevision !== revision) return 'unavailable';

    // Write body stats to onboarding storage
    const onboarding: OnboardingData = {};
    if (profile.user.birthday !== null) onboarding.birthday = profile.user.birthday;
    if (profile.user.heightCm !== null) onboarding.heightCm = profile.user.heightCm;
    if (profile.user.weightKg !== null) onboarding.weightKg = profile.user.weightKg;
    if (profile.user.sex !== null) onboarding.sex = profile.user.sex;
    if (profile.user.activityLevel !== null) onboarding.activity = profile.user.activityLevel;
    if (profile.user.goal !== null) onboarding.goal = profile.user.goal;

    if (Object.keys(onboarding).length > 0) {
      if (!(await stillCurrent())) return 'account-changed';
      await AsyncStorage.setItem(ONBOARDING_KEY, JSON.stringify(onboarding));
    }

    // Convert daily → per-meal (÷MEALS_PER_DAY) and write to macro storage
    const localSnapshot = await getMacroTargetSnapshot();
    const discoverySnapshot = await getDiscoveryMacroTargetSnapshot();
    if (!(await stillCurrent())) return 'account-changed';
    if (!localSnapshot && discoverySnapshot?.mode === 'search')
      await saveMacroTargets(discoverySnapshot.targets, 'search', 'manual', expectedUserId);
    if (profile.macroTarget) {
      const grams = {
        protein: Math.round(profile.macroTarget.proteinG / MEALS_PER_DAY),
        carbs: Math.round(profile.macroTarget.carbsG / MEALS_PER_DAY),
        fat: Math.round(profile.macroTarget.fatG / MEALS_PER_DAY),
      };
      const perMeal: StoredMacroTargets = { protein: String(grams.protein), carbs: String(grams.carbs),
        fat: String(grams.fat), calories: String(macroCalories(grams)) };
      const source = archivedTarget?.source ?? await getMacroTargetSource();
      // Older APIs lack provenance. Retain only an explicitly tagged local
      // automatic target that matches; never infer origin from remote numbers.
      const keepAutomatic = profile.macroTarget.source === 'automatic' ||
        (profile.macroTarget.source === undefined && source === 'automatic' && localSnapshot
        && (['protein', 'carbs', 'fat', 'calories'] as const)
          .every(field => localSnapshot.targets[field] === perMeal[field]));
      await saveMacroTargets(perMeal, 'complete', keepAutomatic ? 'automatic' : 'manual', expectedUserId);
      if (archivedTarget && await stillCurrent()) await clearArchivedMacroTarget(expectedUserId);
    } else if (archivedTarget && await stillCurrent()) {
      // No server target exists. Recover the same account's local target
      // without replacing a newer remote allocation.
      await saveMacroTargets(archivedTarget.targets, 'complete', archivedTarget.source, expectedUserId);
      if (!(await stillCurrent())) return 'account-changed';
      await syncSavedProfileToServer({ macroTarget: dailyMacroTarget(archivedTarget.targets, archivedTarget.source) });
      if (await stillCurrent() && !(await AsyncStorage.getItem(pendingKey(expectedUserId))))
        await clearArchivedMacroTarget(expectedUserId);
    }
    if (!(await stillCurrent())) return 'account-changed';
    return profile.macroTarget || archivedTarget ? 'restored' : 'absent';
  } catch (err) {
    // Use whatever is in local storage; surface in dev console so we can spot
    // post-login profile-pull regressions instead of silently falling back.
    // eslint-disable-next-line no-console
    console.warn('[profileSync] pullProfileFromServer failed:', err);
    return 'unavailable';
  }
}

/** Authentication must not continue to completion on an unknown account profile. */
export async function requireProfileFromServer(): Promise<void> {
  const result = await pullProfileFromServer();
  if (result === 'unavailable') throw new Error('Could not load your account targets. Try again when you are connected.');
  if (result === 'account-changed') throw new Error('Account changed while loading targets.');
}
