/**
 * App Store rating prompt — anchored to engagement + proven retention.
 *
 * We deliberately do NOT prompt during onboarding: the user hasn't experienced
 * any value yet, so the rating would be reflexive noise (and Apple weights recent
 * ratings from engaged users). Apple also hard-throttles `requestReview` to ~3
 * prompts per 365 days, so each request is precious — we spend ours only after
 * the user has shown both engagement and stickiness (a return session).
 *
 * Trigger (on the user's 2nd+ session, asked at most once ever):
 *   - 5 successful searches  — the core loop; covers users who never save, OR
 *   - 2 saved meals          — a stronger, higher-intent signal of delight.
 * Whichever comes first wins.
 *
 * Decision logic is split into a pure `shouldRequestReview` so it's testable
 * without touching AsyncStorage or StoreReview.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import { trackRatingPromptRequested } from './analytics';

export const RATING_PROMPT_KEY = '@fitsy/rating_prompt';

export interface RatingPromptState {
  /** ISO timestamp of when we requested the native prompt; undefined = never asked. */
  promptedAt?: string;
  /** Distinct app sessions (cold starts) recorded so far. */
  sessionCount: number;
  /** Successful saves recorded so far. */
  saveCount: number;
  /** Successful, non-empty searches recorded so far. */
  searchCount: number;
}

const DEFAULT_STATE: RatingPromptState = { sessionCount: 0, saveCount: 0, searchCount: 0 };

/** Not the user's first session — proves they came back. */
export const MIN_SESSIONS = 2;
/** Enough searches to show the core loop delivered — covers non-savers. */
export const MIN_SEARCHES = 5;
/** A save is higher-intent, so a lower bar surfaces the prompt sooner. */
export const MIN_SAVES = 2;

/**
 * Pure predicate: given the recorded state, should we ask for a review now?
 * No side effects — safe to unit-test against fabricated state.
 */
export function shouldRequestReview(state: RatingPromptState): boolean {
  if (state.promptedAt) return false; // ask once, ever
  if (state.sessionCount < MIN_SESSIONS) return false; // return-session users only
  return state.searchCount >= MIN_SEARCHES || state.saveCount >= MIN_SAVES;
}

export async function getRatingPromptState(): Promise<RatingPromptState> {
  const raw = await AsyncStorage.getItem(RATING_PROMPT_KEY);
  if (!raw) return { ...DEFAULT_STATE };
  try {
    return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<RatingPromptState>) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function patchState(patch: Partial<RatingPromptState>): Promise<RatingPromptState> {
  const next = { ...(await getRatingPromptState()), ...patch };
  await AsyncStorage.setItem(RATING_PROMPT_KEY, JSON.stringify(next));
  return next;
}

/**
 * If the engagement+retention threshold is met, ask the OS to show the native
 * rating prompt — at most once, ever. Reads the latest persisted state itself.
 */
async function maybePrompt(): Promise<void> {
  const state = await getRatingPromptState();
  if (!shouldRequestReview(state)) return;
  // hasAction() is false on web, in the simulator without a store, etc.
  if (!(await StoreReview.hasAction())) return;
  // Mark prompted BEFORE requesting so a thrown requestReview() can't loop us.
  await patchState({ promptedAt: new Date().toISOString() });
  trackRatingPromptRequested({
    source: 'engagement',
    session_count: state.sessionCount,
    save_count: state.saveCount,
    search_count: state.searchCount,
  });
  await StoreReview.requestReview();
}

/**
 * Record one app cold-start. Call once from the root layout on mount.
 * Fire-and-forget: swallows errors so a storage hiccup never blocks render.
 */
export async function recordSession(): Promise<void> {
  try {
    const state = await getRatingPromptState();
    await patchState({ sessionCount: state.sessionCount + 1 });
  } catch {
    /* analytics-adjacent; never surface to the user */
  }
}

/**
 * Record a successful save and maybe ask for a rating.
 * Fire-and-forget: never throws, so it can't affect the save UX.
 */
export async function recordSaveAndMaybePrompt(): Promise<void> {
  try {
    const current = await getRatingPromptState();
    await patchState({ saveCount: current.saveCount + 1 });
    await maybePrompt();
  } catch {
    /* never let a rating-prompt failure affect saving */
  }
}

/**
 * Record a successful, non-empty search and maybe ask for a rating.
 * Fire-and-forget: never throws, so it can't affect the search UX.
 */
export async function recordSearchAndMaybePrompt(): Promise<void> {
  try {
    const current = await getRatingPromptState();
    await patchState({ searchCount: current.searchCount + 1 });
    await maybePrompt();
  } catch {
    /* never let a rating-prompt failure affect search */
  }
}
