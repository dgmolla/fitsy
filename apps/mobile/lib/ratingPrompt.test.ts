/**
 * @jest-environment node
 */
import {
  shouldRequestReview,
  recordSession,
  recordSaveAndMaybePrompt,
  recordSearchAndMaybePrompt,
  getRatingPromptState,
  RATING_PROMPT_KEY,
  MIN_SESSIONS,
  MIN_SAVES,
  MIN_SEARCHES,
  type RatingPromptState,
} from './ratingPrompt';

// ─── AsyncStorage in-memory mock (mirrors macroStorage.test.ts) ──────────────
const store: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
      return Promise.resolve();
    }),
  },
}));

// ─── expo-store-review mock ──────────────────────────────────────────────────
jest.mock('expo-store-review', () => ({
  __esModule: true,
  hasAction: jest.fn(() => Promise.resolve(true)),
  requestReview: jest.fn(() => Promise.resolve()),
}));

// ─── analytics mock ──────────────────────────────────────────────────────────
jest.mock('./analytics', () => ({
  __esModule: true,
  trackRatingPromptRequested: jest.fn(),
}));

const StoreReview = jest.requireMock('expo-store-review') as {
  hasAction: jest.Mock;
  requestReview: jest.Mock;
};
const { trackRatingPromptRequested } = jest.requireMock('./analytics') as {
  trackRatingPromptRequested: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(store).forEach((k) => delete store[k]);
  StoreReview.hasAction.mockResolvedValue(true);
  StoreReview.requestReview.mockResolvedValue(undefined);
});

const state = (over: Partial<RatingPromptState> = {}): RatingPromptState => ({
  sessionCount: 0,
  saveCount: 0,
  searchCount: 0,
  ...over,
});

// Drive recordSession N times to reach a return session.
const reachReturnSession = async () => {
  for (let i = 0; i < MIN_SESSIONS; i++) await recordSession();
};

describe('shouldRequestReview', () => {
  it('is false on the first session even past the action thresholds', () => {
    expect(
      shouldRequestReview(state({ sessionCount: MIN_SESSIONS - 1, searchCount: 99, saveCount: 99 })),
    ).toBe(false);
  });

  it('is true on a return session once the search threshold is met', () => {
    expect(shouldRequestReview(state({ sessionCount: MIN_SESSIONS, searchCount: MIN_SEARCHES }))).toBe(true);
  });

  it('is true on a return session once the save threshold is met', () => {
    expect(shouldRequestReview(state({ sessionCount: MIN_SESSIONS, saveCount: MIN_SAVES }))).toBe(true);
  });

  it('is false below both action thresholds', () => {
    expect(
      shouldRequestReview(state({ sessionCount: MIN_SESSIONS, searchCount: MIN_SEARCHES - 1, saveCount: MIN_SAVES - 1 })),
    ).toBe(false);
  });

  it('is false once already prompted, even if thresholds are met', () => {
    expect(
      shouldRequestReview(
        state({ sessionCount: 99, searchCount: 99, saveCount: 99, promptedAt: '2026-06-06T00:00:00.000Z' }),
      ),
    ).toBe(false);
  });
});

describe('recordSession', () => {
  it('increments the session count', async () => {
    await recordSession();
    await recordSession();
    expect((await getRatingPromptState()).sessionCount).toBe(2);
  });
});

describe('recordSearchAndMaybePrompt', () => {
  it('does not prompt on the first session', async () => {
    await recordSession(); // 1 session
    for (let i = 0; i < MIN_SEARCHES; i++) await recordSearchAndMaybePrompt();
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
  });

  it('prompts after MIN_SEARCHES on a return session, then never again', async () => {
    await reachReturnSession();
    for (let i = 0; i < MIN_SEARCHES - 1; i++) await recordSearchAndMaybePrompt();
    expect(StoreReview.requestReview).not.toHaveBeenCalled();

    await recordSearchAndMaybePrompt(); // hits MIN_SEARCHES → fires
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
    expect(trackRatingPromptRequested).toHaveBeenCalledTimes(1);

    await recordSearchAndMaybePrompt(); // already prompted → no repeat
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
  });
});

describe('recordSaveAndMaybePrompt', () => {
  it('prompts after MIN_SAVES on a return session, before any search threshold', async () => {
    await reachReturnSession();
    for (let i = 0; i < MIN_SAVES; i++) await recordSaveAndMaybePrompt();
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
  });

  it('records the action but does not prompt when the store is unavailable', async () => {
    StoreReview.hasAction.mockResolvedValue(false);
    await reachReturnSession();
    for (let i = 0; i < MIN_SAVES; i++) await recordSaveAndMaybePrompt();
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
    // saveCount advanced, but NOT marked prompted — a later session on a real
    // device can still surface the prompt.
    const s = await getRatingPromptState();
    expect(s.saveCount).toBe(MIN_SAVES);
    expect(s.promptedAt).toBeUndefined();
  });

  it('never throws when requestReview rejects', async () => {
    StoreReview.requestReview.mockRejectedValue(new Error('boom'));
    await reachReturnSession();
    await recordSaveAndMaybePrompt();
    await expect(recordSaveAndMaybePrompt()).resolves.toBeUndefined();
  });

  it('persists state under the namespaced key', async () => {
    await recordSession();
    expect(store[RATING_PROMPT_KEY]).toBeDefined();
  });
});
