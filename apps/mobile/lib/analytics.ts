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

let _client: PostHog | null = null;

export function getPostHogClient(): PostHog {
  if (!_client) {
    _client = new PostHog(API_KEY, { host: HOST });
  }
  return _client;
}

export interface UserProperties {
  email?: string;
  goal?: string;
  activity_level?: string;
  macro_protein?: string;
  macro_carbs?: string;
  macro_fat?: string;
  macro_calories?: string;
  [key: string]: JsonType | undefined;
}

export function identifyUser(userId: string, props: UserProperties): void {
  try {
    const cleanProps: Record<string, JsonType> = {};
    for (const [k, v] of Object.entries(props)) {
      if (v !== undefined) cleanProps[k] = v;
    }
    getPostHogClient().identify(userId, cleanProps);
  } catch {
    // swallow
  }
}

export function resetAnalyticsSession(): void {
  try {
    getPostHogClient().reset();
  } catch {
    // swallow
  }
}

export interface SearchPerformedProps {
  has_protein_target: boolean;
  has_carbs_target: boolean;
  has_fat_target: boolean;
  has_calories_target: boolean;
  cuisine_filter: string;
  result_count: number;
  location_source: 'gps' | 'fallback';
  success: boolean;
}

export function trackSearchPerformed(props: SearchPerformedProps): void {
  try {
    getPostHogClient().capture('search_performed', props as unknown as Record<string, JsonType>);
  } catch {
    // swallow
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
  } catch {
    // swallow
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
  } catch {
    // swallow
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
  } catch {
    // swallow
  }
}

export interface AuthSuccessProps {
  provider: 'apple' | 'google' | 'dev';
  is_new_user: boolean;
}

export function trackAuthSuccess(props: AuthSuccessProps): void {
  try {
    getPostHogClient().capture('auth_success', props as unknown as Record<string, JsonType>);
  } catch {
    // swallow
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
  } catch {
    // swallow
  }
}

export function __resetForTesting(): void {
  _client = null;
}
