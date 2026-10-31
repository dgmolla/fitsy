import type { CaptureEvent, JsonType } from '@posthog/core';

// Operational events deny unknown fields, nested objects, error strings,
// location and nutrition values. Account identification permits only email.
const allowed = new Set([
  'screen_name', 'screen', 'cuisine_filter', 'location_source', 'restaurant_id', 'menu_item_id', 'feedback_id',
  'action', 'entry_point', 'provider', 'tab', 'field', 'link', 'source', 'outcome', 'reason', 'kind',
  'offering_id', 'access_variant', 'image_variant', 'layout_variant', 'paywall_variant', 'paywall_config_version',
  'product_id', 'actual_period', 'query_length', 'result_count', 'page_index', 'total_results', 'pages_loaded',
  'position', 'message_length', 'session_count', 'save_count', 'search_count', 'actual_days', 'desired_days',
  'success', 'had_last_known', 'is_new_user', 'is_pro', 'device_pro', 'server_active', 'is_fatal',
  'paywall_tester_override', 'meals', 'trial', 'has_protein_target', 'has_carbs_target', 'has_fat_target',
  'has_calories_target', 'has_protein', 'has_carbs', 'has_fat', 'has_calories', 'has_weight', 'has_height',
  '$lib', '$lib_version', '$os', '$os_version', '$app_version', '$app_build', '$session_id',
  '$feature_flag', '$feature_flag_response', '$geoip_disable', '$process_person_profile',
]);

export function sanitizeAnalyticsEvent(event: CaptureEvent | null): CaptureEvent | null {
  if (!event) return null;
  const identityEvent = event.event === '$identify' || event.event === '$set';
  if (event.event.startsWith('$') && !identityEvent && event.event !== '$feature_flag_called') return null;
  const properties: Record<string, JsonType> = {};
  for (const [key, value] of Object.entries(event.properties ?? {})) {
    if (!allowed.has(key) && !(identityEvent && key === '$anon_distinct_id')) continue;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.length <= 128 && !/[@\s]|Bearer|eyJ/i.test(value))) {
      properties[key] = value;
    }
  }
  // The SDK exposes person properties at the top level of before_send events.
  const email = identityEvent ? event.$set?.['email'] : undefined;
  return {
    event: event.event, uuid: event.uuid, timestamp: event.timestamp, properties,
    ...(typeof email === 'string' && email.length <= 320 && /^[^\s@]+@[^\s@]+$/.test(email)
      ? { $set: { email } } : {}),
  };
}
