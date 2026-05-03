/**
 * @jest-environment node
 *
 * Tests for the S-221 reliability events. Each previously-silent
 * `catch(() => {})` swallowing an onboarding API failure now routes through a
 * named PostHog event — these tests pin the event names, prop shapes, and the
 * "logging never throws even if PostHog itself errors" contract that other
 * call sites depend on.
 */

const captureMock = jest.fn();

jest.mock('posthog-react-native', () => {
  return jest.fn().mockImplementation(() => ({
    capture: captureMock,
    identify: jest.fn(),
    reset: jest.fn(),
  }));
});

import {
  __resetForTesting,
  trackCuisineSelected,
  trackMacroTargetsEdited,
  trackOnboardingChoiceSelected,
  trackPreviewFetchFailed,
  trackProfileAccountDeleted,
  trackProfileFieldEdited,
  trackProfileLogoutTapped,
  trackRestaurantDetailFailed,
  trackSaveFailed,
  trackSaveMacroTargetsFailed,
  trackSearchEmptyResults,
  trackSearchFailed,
  trackStatsFetchFailed,
  trackTabSwitched,
} from './analytics';

beforeEach(() => {
  captureMock.mockReset();
  __resetForTesting();
});

describe('trackStatsFetchFailed', () => {
  it('captures stats_fetch_failed with the error message', () => {
    trackStatsFetchFailed(new Error('boom'));
    expect(captureMock).toHaveBeenCalledWith('stats_fetch_failed', {
      error_message: 'boom',
    });
  });

  it('captures stats_fetch_failed without error_message when err is unknown shape', () => {
    trackStatsFetchFailed({ weird: true });
    expect(captureMock).toHaveBeenCalledWith('stats_fetch_failed', {});
  });

  it('does not throw when PostHog capture itself throws', () => {
    captureMock.mockImplementationOnce(() => {
      throw new Error('posthog dead');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => trackStatsFetchFailed(new Error('upstream'))).not.toThrow();
    warn.mockRestore();
  });
});

describe('trackPreviewFetchFailed', () => {
  it('captures preview_fetch_failed with the error message', () => {
    trackPreviewFetchFailed(new Error('network'));
    expect(captureMock).toHaveBeenCalledWith('preview_fetch_failed', {
      error_message: 'network',
    });
  });

  it('accepts a string error', () => {
    trackPreviewFetchFailed('timeout');
    expect(captureMock).toHaveBeenCalledWith('preview_fetch_failed', {
      error_message: 'timeout',
    });
  });
});

describe('trackSaveMacroTargetsFailed', () => {
  it('captures save_macro_targets_failed with the error message', () => {
    trackSaveMacroTargetsFailed(new Error('quota'));
    expect(captureMock).toHaveBeenCalledWith('save_macro_targets_failed', {
      error_message: 'quota',
    });
  });

  it('does not throw when PostHog capture itself throws', () => {
    captureMock.mockImplementationOnce(() => {
      throw new Error('posthog dead');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => trackSaveMacroTargetsFailed(new Error('upstream'))).not.toThrow();
    warn.mockRestore();
  });
});

// ─── S-222 events ──────────────────────────────────────────────────────────
// The S-222 pass added per-screen, per-failure-mode events. We pin the names
// and prop shapes here so renaming an event later requires touching this
// test — same contract as the S-221 events above.

describe('trackTabSwitched', () => {
  it('captures tab_switched with destination + previous tab', () => {
    trackTabSwitched({ tab: 'profile', from_tab: 'search' });
    expect(captureMock).toHaveBeenCalledWith('tab_switched', {
      tab: 'profile',
      from_tab: 'search',
    });
  });

  it('handles cold-start (from_tab null)', () => {
    trackTabSwitched({ tab: 'search', from_tab: null });
    expect(captureMock).toHaveBeenCalledWith('tab_switched', {
      tab: 'search',
      from_tab: null,
    });
  });
});

describe('trackCuisineSelected', () => {
  it('captures cuisine_selected with the chosen cuisine', () => {
    trackCuisineSelected({ cuisine: 'asian' });
    expect(captureMock).toHaveBeenCalledWith('cuisine_selected', { cuisine: 'asian' });
  });
});

describe('trackMacroTargetsEdited', () => {
  it('captures macro_targets_edited with entry_point + has_* flags', () => {
    trackMacroTargetsEdited({
      entry_point: 'search',
      has_protein: true,
      has_carbs: false,
      has_fat: true,
      has_calories: true,
    });
    expect(captureMock).toHaveBeenCalledWith('macro_targets_edited', {
      entry_point: 'search',
      has_protein: true,
      has_carbs: false,
      has_fat: true,
      has_calories: true,
    });
  });
});

describe('trackSearchEmptyResults', () => {
  it('captures search_empty_results with filter context', () => {
    trackSearchEmptyResults({
      cuisine_filter: 'mexican',
      has_protein_target: true,
      has_carbs_target: false,
      has_fat_target: false,
      has_calories_target: true,
    });
    expect(captureMock).toHaveBeenCalledWith('search_empty_results', {
      cuisine_filter: 'mexican',
      has_protein_target: true,
      has_carbs_target: false,
      has_fat_target: false,
      has_calories_target: true,
    });
  });
});

describe('trackSearchFailed', () => {
  it('captures search_failed with error_message', () => {
    trackSearchFailed({ cuisine_filter: 'all', error_message: 'timeout' });
    expect(captureMock).toHaveBeenCalledWith('search_failed', {
      cuisine_filter: 'all',
      error_message: 'timeout',
    });
  });

  it('omits error_message when not provided', () => {
    trackSearchFailed({ cuisine_filter: 'asian' });
    expect(captureMock).toHaveBeenCalledWith('search_failed', { cuisine_filter: 'asian' });
  });
});

describe('trackRestaurantDetailFailed', () => {
  it('captures restaurant_detail_failed with the restaurant id', () => {
    trackRestaurantDetailFailed({ restaurant_id: 'rest-123' });
    expect(captureMock).toHaveBeenCalledWith('restaurant_detail_failed', {
      restaurant_id: 'rest-123',
    });
  });
});

describe('trackSaveFailed', () => {
  it('captures save_failed with action + entry_point', () => {
    trackSaveFailed({
      menu_item_id: 'mi-1',
      restaurant_id: 'rest-1',
      action: 'save',
      entry_point: 'restaurant_detail',
    });
    expect(captureMock).toHaveBeenCalledWith('save_failed', {
      menu_item_id: 'mi-1',
      restaurant_id: 'rest-1',
      action: 'save',
      entry_point: 'restaurant_detail',
    });
  });
});

describe('trackOnboardingChoiceSelected', () => {
  it('captures onboarding_choice_selected with screen + value', () => {
    trackOnboardingChoiceSelected({ screen: 'goal', value: 'lose_fat' });
    expect(captureMock).toHaveBeenCalledWith('onboarding_choice_selected', {
      screen: 'goal',
      value: 'lose_fat',
    });
  });
});

describe('trackProfileFieldEdited', () => {
  it('captures profile_field_edited with the field name', () => {
    trackProfileFieldEdited({ field: 'goal' });
    expect(captureMock).toHaveBeenCalledWith('profile_field_edited', { field: 'goal' });
  });
});

describe('trackProfileLogoutTapped', () => {
  it('captures profile_logout_tapped with no props', () => {
    trackProfileLogoutTapped();
    expect(captureMock).toHaveBeenCalledWith('profile_logout_tapped', {});
  });
});

describe('trackProfileAccountDeleted', () => {
  it('captures profile_account_deleted with success flag', () => {
    trackProfileAccountDeleted({ success: true });
    expect(captureMock).toHaveBeenCalledWith('profile_account_deleted', { success: true });
  });

  it('captures the failure case', () => {
    trackProfileAccountDeleted({ success: false });
    expect(captureMock).toHaveBeenCalledWith('profile_account_deleted', { success: false });
  });
});

// "Never throws" contract — extends the S-221 invariant to every S-222 event.
// If PostHog itself blows up, none of these helpers may surface the error to
// the call site. A regression here would crash the app from a logging path.
describe('S-222 events: never-throws contract', () => {
  it.each([
    ['trackTabSwitched', () => trackTabSwitched({ tab: 'search', from_tab: null })],
    ['trackCuisineSelected', () => trackCuisineSelected({ cuisine: 'all' })],
    ['trackMacroTargetsEdited', () => trackMacroTargetsEdited({ entry_point: 'search', has_protein: false, has_carbs: false, has_fat: false, has_calories: false })],
    ['trackSearchEmptyResults', () => trackSearchEmptyResults({ cuisine_filter: 'all', has_protein_target: false, has_carbs_target: false, has_fat_target: false, has_calories_target: false })],
    ['trackSearchFailed', () => trackSearchFailed({ cuisine_filter: 'all' })],
    ['trackRestaurantDetailFailed', () => trackRestaurantDetailFailed({ restaurant_id: 'r' })],
    ['trackSaveFailed', () => trackSaveFailed({ menu_item_id: 'm', restaurant_id: 'r', action: 'save', entry_point: 'restaurant_detail' })],
    ['trackOnboardingChoiceSelected', () => trackOnboardingChoiceSelected({ screen: 'goal', value: 'maintain' })],
    ['trackProfileFieldEdited', () => trackProfileFieldEdited({ field: 'goal' })],
    ['trackProfileLogoutTapped', () => trackProfileLogoutTapped()],
    ['trackProfileAccountDeleted', () => trackProfileAccountDeleted({ success: true })],
  ])('%s does not throw when capture throws', (_name, call) => {
    captureMock.mockImplementationOnce(() => {
      throw new Error('posthog dead');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(call).not.toThrow();
    warn.mockRestore();
  });
});
