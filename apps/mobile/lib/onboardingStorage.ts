import AsyncStorage from '@react-native-async-storage/async-storage';
import { calculateAge } from '../../../packages/shared/src/utils/dateUtils';
import { calculateRecommendedCalories } from '../../../packages/shared/src/utils/macroTargets';
import type { TriedApproach } from './onboardingPersonalization';
import { supabase } from './supabase';
import { validateProfileFact } from './profileFactValidation';

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
  if (record && record._owner === undefined && !await AsyncStorage.getItem(LEGACY_KEY)) {
    await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(record));
  }
}

/** Old records have ambiguous ownership and require an explicit account restore. */
export async function getLegacyOnboardingData(): Promise<OnboardingData | null> {
  const active = await readRecord();
  const raw = active?._owner === undefined && active ? active : null;
  let record = raw;
  if (!record) {
    try { record = JSON.parse(await AsyncStorage.getItem(LEGACY_KEY) ?? 'null'); } catch { return null; }
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const { birthday, heightCm, weightKg, sex, activity, goal } = record;
  const facts = Object.fromEntries(Object.entries({ birthday, heightCm, weightKg, sex, activity, goal })
    .filter(([, value]) => value !== undefined)) as OnboardingData;
  return Object.keys(facts).length ? facts : null;
}

export async function restoreLegacyOnboardingData(): Promise<{ owner: string; profile: OnboardingData }> {
  const owner = await currentOwner();
  if (!owner) throw new Error('Sign in before restoring profile facts');
  return serialize(async () => {
    const legacy = await getLegacyOnboardingData();
    if (!legacy || await currentOwner() !== owner) throw new Error('Older profile is unavailable');
    const record = await readRecord();
    await retainLegacy(record);
    const existing = ownedData(record, owner);
    const facts = Object.fromEntries(Object.entries(legacy).filter(([, value]) => value !== undefined));
    for (const [field, value] of Object.entries(facts)) validateProfileFact(field as keyof OnboardingData, value);
    const restored = { ...existing, ...facts };
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...restored, _owner: owner }));
    if (await currentOwner() !== owner) throw new Error('Account changed while restoring profile');
    return { owner, profile: restored };
  });
}

export async function retireLegacyOnboardingData(owner: string): Promise<void> {
  await serialize(async () => {
    if (await currentOwner() !== owner) throw new Error('Account changed while restoring profile');
    await AsyncStorage.removeItem(LEGACY_KEY);
  });
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
export async function clearAccountOnboardingData(userId: string | null): Promise<void> {
  await serialize(async () => {
    const record = await readRecord();
    await retainLegacy(record);
    if (record && (record._owner === userId || record._owner === undefined)) await AsyncStorage.removeItem(KEY);
  });
}

export function calculateSuggestedCalories(data: OnboardingData): number {
  return calculateRecommendedCalories({
    age: data.birthday ? calculateAge(data.birthday) : undefined,
    heightCm: data.heightCm,
    weightKg: data.weightKg,
    sex: data.sex,
    activityLevel: data.activity,
    goal: data.goal,
  });
}
