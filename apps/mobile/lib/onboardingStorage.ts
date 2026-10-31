import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TriedApproach } from './onboardingPersonalization';
import { supabase } from './supabase';

const KEY = '@fitsy/onboarding';
const LEGACY_KEY = '@fitsy/onboarding_unowned';

export type ActivityLevel = 'sedentary' | 'lightly_active' | 'active' | 'very_active';
export type Goal = 'lose_fat' | 'maintain' | 'build_muscle' | 'performance';
export type Sex = 'female' | 'male';

export interface OnboardingArea { lat: number; lng: number; name: string; source: 'gps' | 'manual' | 'saved' }

export interface OnboardingData {
  tried?: TriedApproach;
  area?: OnboardingArea;
  targetMode?: 'known' | 'estimate';
  targetChoiceInProgress?: boolean;
  targetBasis?: string;
  previewCraving?: string;
  previewArea?: string;
  birthday?: string;
  heightCm?: number;
  weightKg?: number;
  sex?: Sex;
  activity?: ActivityLevel;
  goal?: Goal;
  dietary?: string[];
}

let pendingWrite: Promise<void> = Promise.resolve();

async function currentOwner(): Promise<string | null> {
  return (await supabase.auth.getSession()).data.session?.user?.id ?? null;
}

type OwnedOnboarding = OnboardingData & { _owner?: string | null };

async function readRecord(): Promise<OwnedOnboarding | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as OwnedOnboarding;
    return record && typeof record === 'object' && !Array.isArray(record) ? record : null;
  } catch { return null; }
}

function ownedData(record: OwnedOnboarding | null, owner: string | null): OnboardingData {
  if (!record) return {};
  if (owner === null && record._owner === undefined) {
    const { birthday: _birthday, heightCm: _height, weightKg: _weight,
      sex: _sex, activity: _activity, goal: _goal, ...setup } = record;
    return setup;
  }
  if (record._owner !== owner) return {};
  const { _owner, ...data } = record;
  return data;
}

async function retainLegacy(record: OwnedOnboarding | null): Promise<void> {
  // Preserve unowned facts when newer account data replaces the active record.
  if (record && record._owner === undefined && !await AsyncStorage.getItem(LEGACY_KEY)) {
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(record));
  }
}

function serialize<T>(write: () => Promise<T>): Promise<T> {
  const attempt = pendingWrite.then(write, write);
  pendingWrite = attempt.then(() => {}, () => {});
  return attempt;
}

export async function saveOnboardingField<K extends keyof OnboardingData>(
  field: K,
  value: OnboardingData[K],
  expectedOwner?: string | null,
): Promise<void> {
  // Capture the initiating account before waiting behind another storage write.
  const startingOwner = currentOwner();
  return serialize(async () => {
    const owner = await startingOwner;
    if (expectedOwner !== undefined && owner !== expectedOwner) throw new Error('Account changed while saving profile');
    const record = await readRecord();
    await retainLegacy(record);
    const existing = ownedData(record, owner);
    if (await currentOwner() !== owner) throw new Error('Account changed while saving profile');
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...existing, [field]: value, _owner: owner }));
    if (await currentOwner() !== owner) throw new Error('Account changed while saving profile');
  });
}

export async function getOnboardingData(): Promise<OnboardingData> {
  const owner = await currentOwner();
  const data = ownedData(await readRecord(), owner);
  return await currentOwner() === owner ? data : {};
}

/** Only explicitly saved anonymous edits may follow the user through sign-in. */
export async function claimAnonymousOnboardingData(userId: string): Promise<boolean> {
  let claimed = false;
  await serialize(async () => {
    const record = await readRecord();
    if (record?._owner !== null || await currentOwner() !== userId) return;
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...record, _owner: userId }));
    claimed = await currentOwner() === userId;
  });
  return claimed;
}

/** Replace even an empty server profile, retaining only this account's local setup metadata. */
export async function replaceAccountOnboardingData(userId: string, profile: OnboardingData): Promise<boolean> {
  let replaced = false;
  await serialize(async () => {
    const record = await readRecord();
    await retainLegacy(record);
    const existing = ownedData(record, userId);
    const { birthday: _birthday, heightCm: _height, weightKg: _weight,
      sex: _sex, activity: _activity, goal: _goal, ...setup } = existing;
    if (await currentOwner() !== userId) return;
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...setup, ...profile, _owner: userId }));
    replaced = await currentOwner() === userId;
  });
  return replaced;
}

/** Logout also retires legacy unowned measurements; another account cannot claim them. */
export async function clearAccountOnboardingData(userId: string | null, forgetLegacy = false): Promise<void> {
  await serialize(async () => {
    const record = await readRecord();
    if (forgetLegacy) await AsyncStorage.removeItem(LEGACY_KEY);
    else await retainLegacy(record);
    if (record && (record._owner === userId || record._owner === undefined || record._owner === null))
      await AsyncStorage.removeItem(KEY);
  });
}
