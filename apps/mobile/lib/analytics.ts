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

export interface RestaurantTappedProps {
  restaurant_id: string;
  restaurant_name: string;
  position: number;
  entry_point: 'hero' | 'dish_card' | 'section';
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

export function __resetForTesting(): void {
  _client = null;
}
