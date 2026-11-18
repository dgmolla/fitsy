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

// ─── "Enjoying Fitsy?" ask (#960): a native alert, and the feedback route ────
jest.mock('react-native', () => ({ __esModule: true, Alert: { alert: jest.fn() } }));
jest.mock('expo-router', () => ({ __esModule: true, router: { push: jest.fn() } }));

// ─── analytics mock ──────────────────────────────────────────────────────────
jest.mock('./analytics', () => ({
  __esModule: true,
  trackRatingPromptRequested: jest.fn(),
  trackRatingPromptAnswered: jest.fn(),
}));

const StoreReview = jest.requireMock('expo-store-review') as {
  hasAction: jest.Mock;
  requestReview: jest.Mock;
};
const { trackRatingPromptRequested, trackRatingPromptAnswered } = jest.requireMock('./analytics') as {
  trackRatingPromptRequested: jest.Mock;
  trackRatingPromptAnswered: jest.Mock;
};
const { Alert } = jest.requireMock('react-native') as { Alert: { alert: jest.Mock } };
const { router } = jest.requireMock('expo-router') as { router: { push: jest.Mock } };

/** Press one of the ask's buttons by its label, like the user would. */
function answer(label: 'Yes' | 'Not really') {
  const buttons = Alert.alert.mock.calls.at(-1)?.[2] as { text: string; onPress: () => void }[];
  buttons.find(button => button.text === label)?.onPress();
}

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
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('prompts after MIN_SEARCHES on a return session, then never again', async () => {
    await reachReturnSession();
    for (let i = 0; i < MIN_SEARCHES - 1; i++) await recordSearchAndMaybePrompt();
    expect(StoreReview.requestReview).not.toHaveBeenCalled();

    await recordSearchAndMaybePrompt(); // hits MIN_SEARCHES → asks "Enjoying Fitsy?"
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(Alert.alert.mock.calls[0][0]).toBe('Enjoying Fitsy?');
    expect(StoreReview.requestReview).not.toHaveBeenCalled(); // not until the user says yes
    expect(trackRatingPromptRequested).toHaveBeenCalledTimes(1);

    await recordSearchAndMaybePrompt(); // already prompted → no repeat
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it('yes calls Apple\'s native review prompt and is tracked', async () => {
    await reachReturnSession();
    for (let i = 0; i < MIN_SEARCHES; i++) await recordSearchAndMaybePrompt();
    answer('Yes');
    expect(StoreReview.requestReview).toHaveBeenCalledTimes(1);
    expect(trackRatingPromptAnswered).toHaveBeenCalledWith({ answer: 'yes' });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('no opens the in-app feedback board and never calls the review prompt', async () => {
    await reachReturnSession();
    for (let i = 0; i < MIN_SEARCHES; i++) await recordSearchAndMaybePrompt();
    answer('Not really');
    expect(router.push).toHaveBeenCalledWith('/feedback-board');
    expect(trackRatingPromptAnswered).toHaveBeenCalledWith({ answer: 'no' });
    expect(StoreReview.requestReview).not.toHaveBeenCalled();
  });
});

describe('recordSaveAndMaybePrompt', () => {
  it('prompts after MIN_SAVES on a return session, before any search threshold', async () => {
    await reachReturnSession();
    for (let i = 0; i < MIN_SAVES; i++) await recordSaveAndMaybePrompt();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it('records the action but does not prompt when the store is unavailable', async () => {
    StoreReview.hasAction.mockResolvedValue(false);
    await reachReturnSession();
    for (let i = 0; i < MIN_SAVES; i++) await recordSaveAndMaybePrompt();
    expect(Alert.alert).not.toHaveBeenCalled();
    // saveCount advanced, but NOT marked prompted — a later session on a real
    // device can still surface the prompt.
    const s = await getRatingPromptState();
    expect(s.saveCount).toBe(MIN_SAVES);
    expect(s.promptedAt).toBeUndefined();
  });

  it('never throws when requestReview rejects after a yes', async () => {
    StoreReview.requestReview.mockRejectedValue(new Error('boom'));
    await reachReturnSession();
    await recordSaveAndMaybePrompt();
    await expect(recordSaveAndMaybePrompt()).resolves.toBeUndefined();
    expect(() => answer('Yes')).not.toThrow();
  });

  it('persists state under the namespaced key', async () => {
    await recordSession();
    expect(store[RATING_PROMPT_KEY]).toBeDefined();
  });
});
