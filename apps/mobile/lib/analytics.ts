/**
 * Fitsy analytics — thin wrapper around PostHog React Native.
 *
 * All public functions are fire-and-forget: errors are swallowed so analytics
 * failures never affect the user-facing experience.
 *
 * Import typed helpers from here rather than calling posthog directly from screens.
 */

import PostHog from 'posthog-react-native';
import type { JsonType } from '@posthog/core';

const API_KEY =
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? 'phc_placeholder_replace_via_vercel_cli';

const HOST =
  process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

if (API_KEY.startsWith('phc_placeholder')) {
  // Loud warning rather than silent fallback — the previous silent fallback
  // shipped to production and PostHog appeared "not working" until we noticed.
  // eslint-disable-next-line no-console
  console.warn('[analytics] EXPO_PUBLIC_POSTHOG_API_KEY missing; using placeholder. Events will not reach PostHog.');
}

let _client: PostHog | null = null;

export function getPostHogClient(): PostHog {
  if (!_client) {
    _client = new PostHog(API_KEY, {
      host: HOST,
      // Aggressive flush during pre-launch testing so events land in PostHog
      // within seconds, not 30s. Revert to defaults (flushAt: 20, flushInterval:
      // 30000) before public launch — frequent flushes increase battery use.
      flushAt: 1,
      flushInterval: 5000,
    });
  }
  return _client;
}

function logCaptureError(eventName: string, err: unknown): void {
  // Replaces the silent `catch {}` pattern from before — surface analytics
  // failures so we don't ship another "PostHog isn't tracking anything" mystery.
  // eslint-disable-next-line no-console
  console.warn(`[analytics] capture(${eventName}) failed:`, err);
}

export interface UserProperties {
  email?: string;
  goal?: string;
  activity_level?: string;
  macro_protein?: number;
  macro_carbs?: number;
  macro_fat?: number;
  macro_calories?: number;
  [key: string]: JsonType | undefined;
}

export function identifyUser(userId: string, props: UserProperties): void {
  try {
    const cleanProps: Record<string, JsonType> = {};
    for (const [k, v] of Object.entries(props)) {
      if (v !== undefined) cleanProps[k] = v;
    }
    getPostHogClient().identify(userId, cleanProps);
  } catch (err) {
    logCaptureError('identify', err);
  }
}

export function resetAnalyticsSession(): void {
  try {
    getPostHogClient().reset();
  } catch (err) {
    logCaptureError('reset', err);
  }
}

// ─── Onboarding screen views ─────────────────────────────────────────────────
// Add `useTrackOnboardingScreenView('screen_name')` to each welcome/* screen
// to measure per-step drop-off. Without this we only see onboarding_completed
// and can't tell where users quit during the 15-screen flow.

export function trackOnboardingScreenView(screenName: string): void {
  try {
    getPostHogClient().capture('onboarding_screen_view', { screen_name: screenName });
  } catch (err) {
    logCaptureError('onboarding_screen_view', err);
  }
}

export type LocationSourceTag =
  | 'gps'
  | 'manual'
  | 'fallback-denied'
  | 'fallback-timeout'
  | 'fallback-error';

export interface SearchPerformedProps {
  has_protein_target: boolean;
  has_carbs_target: boolean;
  has_fat_target: boolean;
  has_calories_target: boolean;
  cuisine_filter: string;
  result_count: number;
  location_source: LocationSourceTag;
  success: boolean;
}

export function trackSearchPerformed(props: SearchPerformedProps): void {
  try {
    getPostHogClient().capture('search_performed', props as unknown as Record<string, JsonType>);
  } catch (err) {
    logCaptureError('search_performed', err);
  }
}

// ─── Location resolution outcomes ────────────────────────────────────────────
// Fired from `useLocation` whenever GPS resolution falls back. Splitting by
// reason lets us tell "denied permission" from "timed out" from "errored" in
// PostHog without inferring it from screen-level `search_performed` events.

export function trackLocationPermissionDenied(props: { had_last_known: boolean }): void {
  try {
    getPostHogClient().capture('location_permission_denied', props as unknown as Record<string, JsonType>);
  } catch (err) {
    logCaptureError('location_permission_denied', err);
  }
}

export function trackLocationTimeout(props: { had_last_known: boolean }): void {
  try {
    getPostHogClient().capture('location_timeout', props as unknown as Record<string, JsonType>);
  } catch (err) {
    logCaptureError('location_timeout', err);
  }
}

export function trackLocationError(props: { error_message?: string }): void {
  try {
    const p: Record<string, JsonType> = {};
    if (props.error_message !== undefined) p['error_message'] = props.error_message;
    getPostHogClient().capture('location_error', p);
  } catch (err) {
    logCaptureError('location_error', err);
  }
}

// ─── Search pagination ───────────────────────────────────────────────────────
// Per-page telemetry for the FlatList infinite scroll. `pageIndex` is 0 for
// the initial load. `cursor` is the cursor used to *fetch* this page (null on
// the first page). `result_count` is the count appended on this page (not the
// running total) so PostHog funnels can spot pages that came back smaller than
// expected without re-deriving from totals.

export interface SearchPageLoadedProps {
  page_index: number;
  result_count: number;
  cursor: string | null;
}

export function trackSearchPageLoaded(props: SearchPageLoadedProps): void {
  try {
    getPostHogClient().capture('search_page_loaded', props as unknown as Record<string, JsonType>);
  } catch (err) {
    logCaptureError('search_page_loaded', err);
  }
}

export interface SearchPaginationEndReachedProps {
  total_results: number;
  pages_loaded: number;
}

export function trackSearchPaginationEndReached(props: SearchPaginationEndReachedProps): void {
  try {
    getPostHogClient().capture(
      'search_pagination_end_reached',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('search_pagination_end_reached', err);
  }
}

// ─── Notification priming screen (S-226b) ───────────────────────────────────
// Mirrors the location-priming events: a single shot at framing *why* push
// notifications matter before the OS dialog appears. The granted/denied pair
// is emitted from the priming screen since that's where the OS prompt fires;
// downstream surfaces (e.g. a re-prompt deep-link in Profile) can re-use the
// same events when wired up.

export function trackNotificationPrimingShown(): void {
  try {
    getPostHogClient().capture('notification_priming_shown');
  } catch (err) {
    logCaptureError('notification_priming_shown', err);
  }
}

export function trackNotificationPrimingAllowTapped(): void {
  try {
    getPostHogClient().capture('notification_priming_allow_tapped');
  } catch (err) {
    logCaptureError('notification_priming_allow_tapped', err);
  }
}

export function trackNotificationPrimingSkipTapped(): void {
  try {
    getPostHogClient().capture('notification_priming_skip_tapped');
  } catch (err) {
    logCaptureError('notification_priming_skip_tapped', err);
  }
}

export function trackNotificationPermissionGranted(): void {
  try {
    getPostHogClient().capture('notification_permission_granted');
  } catch (err) {
    logCaptureError('notification_permission_granted', err);
  }
}

export function trackNotificationPermissionDenied(): void {
  try {
    getPostHogClient().capture('notification_permission_denied');
  } catch (err) {
    logCaptureError('notification_permission_denied', err);
  }
}

// ─── Manual location override (S-227) ────────────────────────────────────────
// Pairs with the truthful fallback labels (S-224) — together they form the
// deny-path escape hatch. We track three discrete moments so the funnel is
// readable in PostHog: (a) sheet opened → discoverability of the feature,
// (b) neighborhood picked → which presets actually get used, (c) cleared →
// how often users return to GPS once they've overridden.

export function trackLocationManualOverrideOpened(): void {
  try {
    getPostHogClient().capture('location_manual_override_opened', {});
  } catch (err) {
    logCaptureError('location_manual_override_opened', err);
  }
}

export function trackLocationManualOverridePicked(props: { neighborhood: string }): void {
  try {
    getPostHogClient().capture(
      'location_manual_override_picked',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('location_manual_override_picked', err);
  }
}

export function trackLocationManualOverrideCleared(): void {
  try {
    getPostHogClient().capture('location_manual_override_cleared', {});
  } catch (err) {
    logCaptureError('location_manual_override_cleared', err);
  }
}

export interface RestaurantTappedProps {
  restaurant_id: string;
  restaurant_name: string;
  position: number;
  entry_point: 'hero' | 'dish_card' | 'section' | 'saved_screen';
  best_match_calories?: number;
}

export function trackRestaurantTapped(props: RestaurantTappedProps): void {
  try {
    const p: Record<string, JsonType> = {
      restaurant_id: props.restaurant_id,
      restaurant_name: props.restaurant_name,
      position: props.position,
      entry_point: props.entry_point,
    };
    if (props.best_match_calories !== undefined) p['best_match_calories'] = props.best_match_calories;
    getPostHogClient().capture('restaurant_tapped', p);
  } catch (err) {
    logCaptureError('restaurant_tapped', err);
  }
}

export interface ItemSavedProps {
  menu_item_id: string;
  restaurant_id: string;
  action: 'save' | 'unsave';
  entry_point: 'restaurant_detail' | 'saved_screen';
}

export function trackItemSaved(props: ItemSavedProps): void {
  try {
    getPostHogClient().capture('item_saved', props as unknown as Record<string, JsonType>);
  } catch (err) {
    logCaptureError('item_saved', err);
  }
}

export interface OnboardingCompletedProps {
  goal?: string;
  activity_level?: string;
  has_weight: boolean;
  has_height: boolean;
}

export function trackOnboardingCompleted(props: OnboardingCompletedProps): void {
  try {
    const p: Record<string, JsonType> = {
      has_weight: props.has_weight,
      has_height: props.has_height,
    };
    if (props.goal !== undefined) p['goal'] = props.goal;
    if (props.activity_level !== undefined) p['activity_level'] = props.activity_level;
    getPostHogClient().capture('onboarding_completed', p);
  } catch (err) {
    logCaptureError('onboarding_completed', err);
  }
}

export interface AuthSuccessProps {
  provider: 'apple' | 'google' | 'dev';
  is_new_user: boolean;
}

export function trackAuthSuccess(props: AuthSuccessProps): void {
  try {
    getPostHogClient().capture('auth_success', props as unknown as Record<string, JsonType>);
  } catch (err) {
    logCaptureError('auth_success', err);
  }
}

// ─── Restaurant detail (S-229 Filter First) ──────────────────────────────────
// Five events scoped to the redesigned detail screen. We keep them granular so
// we can tell whether testers hit the filter chips, search the menu, or just
// scroll the list — each behaviour informs a different polish pass.

export function trackRestaurantDetailViewed(props: {
  restaurant_id: string;
  item_count: number;
}): void {
  try {
    getPostHogClient().capture(
      'restaurant_detail_viewed',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('restaurant_detail_viewed', err);
  }
}

export function trackMenuSearchTyped(props: { query_length: number }): void {
  try {
    getPostHogClient().capture(
      'menu_search_typed',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('menu_search_typed', err);
  }
}

export function trackMenuFilterChipToggled(props: { chip: string; on: boolean }): void {
  try {
    getPostHogClient().capture(
      'menu_filter_chip_toggled',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('menu_filter_chip_toggled', err);
  }
}

export function trackMenuSortChanged(props: { sort: string }): void {
  try {
    getPostHogClient().capture(
      'menu_sort_changed',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('menu_sort_changed', err);
  }
}

export function trackMenuItemTapped(props: {
  menu_item_id: string;
  restaurant_id: string;
  position: number;
}): void {
  try {
    getPostHogClient().capture(
      'menu_item_tapped',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('menu_item_tapped', err);
  }
}

export interface AuthFailureProps {
  provider: 'apple' | 'google' | 'dev';
  error_message?: string;
}

export function trackAuthFailure(props: AuthFailureProps): void {
  try {
    const p: Record<string, JsonType> = { provider: props.provider };
    if (props.error_message !== undefined) p['error_message'] = props.error_message;
    getPostHogClient().capture('auth_failure', p);
  } catch (err) {
    logCaptureError('auth_failure', err);
  }
}

// ─── Session lifecycle (S-228) ────────────────────────────────────────────────
// Emitted from the supabase.auth.onAuthStateChange subscription wired in
// app/_layout.tsx. `session_refreshed` fires every time the SDK rotates the
// access token in the background; `session_refresh_failed` fires when the
// refresh token has expired or was reused, forcing a SIGNED_OUT.

export function trackSessionRefreshed(props: { user_id: string }): void {
  try {
    getPostHogClient().capture('session_refreshed', props as unknown as Record<string, JsonType>);
  } catch (err) {
    logCaptureError('session_refreshed', err);
  }
}

export function trackSessionRefreshFailed(props: { user_id: string }): void {
  try {
    getPostHogClient().capture('session_refresh_failed', props as unknown as Record<string, JsonType>);
  } catch (err) {
    logCaptureError('session_refresh_failed', err);
  }
}

// ─── Onboarding API failure events (S-221) ──────────────────────────────────
// Each event corresponds to a previously-silent `catch(() => {})` that masked a
// real onboarding API failure. Capture lets us see the failure in PostHog and
// quantify conversion impact instead of guessing from drop-off curves.

function extractMessage(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return undefined;
}

export function trackStatsFetchFailed(err: unknown): void {
  try {
    const p: Record<string, JsonType> = {};
    const msg = extractMessage(err);
    if (msg !== undefined) p['error_message'] = msg;
    getPostHogClient().capture('stats_fetch_failed', p);
  } catch (capErr) {
    logCaptureError('stats_fetch_failed', capErr);
  }
}

export function trackPreviewFetchFailed(err: unknown): void {
  try {
    const p: Record<string, JsonType> = {};
    const msg = extractMessage(err);
    if (msg !== undefined) p['error_message'] = msg;
    getPostHogClient().capture('preview_fetch_failed', p);
  } catch (capErr) {
    logCaptureError('preview_fetch_failed', capErr);
  }
}

export function trackSaveMacroTargetsFailed(err: unknown): void {
  try {
    const p: Record<string, JsonType> = {};
    const msg = extractMessage(err);
    if (msg !== undefined) p['error_message'] = msg;
    getPostHogClient().capture('save_macro_targets_failed', p);
  } catch (capErr) {
    logCaptureError('save_macro_targets_failed', capErr);
  }
}

// ─── Tab navigation (S-222) ─────────────────────────────────────────────────
// Captures every tab switch in the bottom bar so we can read top-level
// engagement (saved vs search vs profile) without inferring from screen views.
// `tab` is the destination tab id. `from_tab` is null on cold start.

export type TabId = 'saved' | 'search' | 'profile';

export function trackTabSwitched(props: { tab: TabId; from_tab: TabId | null }): void {
  try {
    getPostHogClient().capture(
      'tab_switched',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('tab_switched', err);
  }
}

// ─── Search filters (S-222) ─────────────────────────────────────────────────
// `cuisine_selected` fires every time the user picks a cuisine chip on the
// search masthead — separated from `search_performed` so we can see chip
// usage independently of the debounced fetch that follows. `macro_targets_edited`
// fires when the FilterPopup is applied; this is the canonical "user touched
// macros" event regardless of whether it's reached from search or profile.

export function trackCuisineSelected(props: { cuisine: string }): void {
  try {
    getPostHogClient().capture(
      'cuisine_selected',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('cuisine_selected', err);
  }
}

export interface MacroTargetsEditedProps {
  entry_point: 'search' | 'profile';
  has_protein: boolean;
  has_carbs: boolean;
  has_fat: boolean;
  has_calories: boolean;
}

export function trackMacroTargetsEdited(props: MacroTargetsEditedProps): void {
  try {
    getPostHogClient().capture(
      'macro_targets_edited',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('macro_targets_edited', err);
  }
}

// ─── Search outcome events (S-222) ──────────────────────────────────────────
// `search_empty_results` is the distinct "filters returned zero matches" state
// — separate from "we're still adding restaurants" (no GPS yet) and from
// `search_failed` (network/API error). The three states answer different
// product questions: empty = filter is too aggressive, failed = backend
// reliability, no-results = catalog coverage.

export interface SearchEmptyResultsProps {
  cuisine_filter: string;
  has_protein_target: boolean;
  has_carbs_target: boolean;
  has_fat_target: boolean;
  has_calories_target: boolean;
}

export function trackSearchEmptyResults(props: SearchEmptyResultsProps): void {
  try {
    getPostHogClient().capture(
      'search_empty_results',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('search_empty_results', err);
  }
}

export function trackSearchFailed(props: {
  cuisine_filter: string;
  error_message?: string;
}): void {
  try {
    const p: Record<string, JsonType> = { cuisine_filter: props.cuisine_filter };
    if (props.error_message !== undefined) p['error_message'] = props.error_message;
    getPostHogClient().capture('search_failed', p);
  } catch (err) {
    logCaptureError('search_failed', err);
  }
}

// ─── Restaurant detail failure (S-222) ──────────────────────────────────────
// Fires when /api/menu/[id] returns null/throws on the detail screen. Pairs
// with `restaurant_detail_viewed` (success) — together they let us read a
// detail-screen reliability ratio.

export function trackRestaurantDetailFailed(props: {
  restaurant_id: string;
  error_message?: string;
}): void {
  try {
    const p: Record<string, JsonType> = { restaurant_id: props.restaurant_id };
    if (props.error_message !== undefined) p['error_message'] = props.error_message;
    getPostHogClient().capture('restaurant_detail_failed', p);
  } catch (err) {
    logCaptureError('restaurant_detail_failed', err);
  }
}

// ─── Save failure (S-222) ──────────────────────────────────────────────────
// Pairs with `item_saved` — when the create/delete request fails the success
// event never fires, so we'd previously have no signal at all. `action`
// matches `item_saved.action` so PostHog can compute a per-action failure
// rate.

export function trackSaveFailed(props: {
  menu_item_id: string;
  restaurant_id: string;
  action: 'save' | 'unsave';
  entry_point: 'restaurant_detail' | 'saved_screen';
  error_message?: string;
}): void {
  try {
    const p: Record<string, JsonType> = {
      menu_item_id: props.menu_item_id,
      restaurant_id: props.restaurant_id,
      action: props.action,
      entry_point: props.entry_point,
    };
    if (props.error_message !== undefined) p['error_message'] = props.error_message;
    getPostHogClient().capture('save_failed', p);
  } catch (err) {
    logCaptureError('save_failed', err);
  }
}

// ─── Onboarding choice selection (S-222) ────────────────────────────────────
// Generic event for the "user picked an option" moment on choice-style
// onboarding screens (goal, activity, dietary, tried, response). `screen` is
// the same snake_case key as `trackOnboardingScreenView`; `value` is the
// chosen option id. We fold these into one event rather than `goal_selected`
// + `activity_selected` + … so PostHog dashboards can group by `screen`
// instead of unioning N events.

export function trackOnboardingChoiceSelected(props: {
  screen: string;
  value: string;
}): void {
  try {
    getPostHogClient().capture(
      'onboarding_choice_selected',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('onboarding_choice_selected', err);
  }
}

// ─── Profile screen actions (S-222) ─────────────────────────────────────────
// Profile is a high-intent surface — every interaction signals an active user.
// We track field edits separately from log out / delete because the cohorts
// answer different questions: field edits = "do users tune their inputs after
// onboarding?", log out / delete = churn signals.

export type ProfileField = 'goal' | 'activity' | 'height' | 'weight' | 'age';

export function trackProfileFieldEdited(props: { field: ProfileField }): void {
  try {
    getPostHogClient().capture(
      'profile_field_edited',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('profile_field_edited', err);
  }
}

export function trackProfileLogoutTapped(): void {
  try {
    getPostHogClient().capture('profile_logout_tapped', {});
  } catch (err) {
    logCaptureError('profile_logout_tapped', err);
  }
}

export function trackProfileAccountDeleted(props: { success: boolean }): void {
  try {
    getPostHogClient().capture(
      'profile_account_deleted',
      props as unknown as Record<string, JsonType>,
    );
  } catch (err) {
    logCaptureError('profile_account_deleted', err);
  }
}

export function __resetForTesting(): void {
  _client = null;
}
