import type { CaptureEvent, JsonType } from '@posthog/core';

// Only operational metadata may leave the device. Unknown fields, nested
// objects, error strings, identity, location and nutrition values are denied.
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
  if (!event || (event.event.startsWith('$') && event.event !== '$feature_flag_called')) return null;
  const properties: Record<string, JsonType> = {};
  for (const [key, value] of Object.entries(event.properties ?? {})) {
    if (!allowed.has(key)) continue;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.length <= 128 && !/[@\s]|Bearer|eyJ/i.test(value))) {
      properties[key] = value;
    }
  }
  return { event: event.event, uuid: event.uuid, timestamp: event.timestamp, properties };
}
