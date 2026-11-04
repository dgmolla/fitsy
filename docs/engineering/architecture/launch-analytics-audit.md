**TL;DR:** Ingestion works; LA retention, test exclusion, and cross-device identity remain unproven.

# Launch analytics audit

> **Status:** living audit · **Last verified:** 2026-11-04 · **Source:** `37b73fe3bb6982c2ae52198daeed47ec6b719a48`

This is the audit-only scope [approved for #731](https://github.com/dgmolla/fitsy/issues/731#issuecomment-6638818432), following the [LA readiness assessment](../../gtm/la-readiness.md#analytics-query-and-interpretation).
Source inspection and existing-data queries are separate evidence below; neither establishes that every installed bundle matches this commit.
No events, person properties, flags, configuration, saved insights, production records, or follow-up issues were created or changed.
Gap implementation waits for Dawit's review.

## Findings

| Question | Observed result | Limit / recommended gap |
| --- | --- | --- |
| Does ingestion work? | **Yes, for this sample:** 545 events, 29 event names, 11 distinct `person_id` values; 24 of 60 custom event definitions appeared. | Eleven analytics identities are not eleven verified customers; 36 custom names were absent in this window, not necessarily broken. |
| Does identity stitch? | Six `$identify` events map to one person spanning 34 sessions and 14 LA calendar days; one person has multiple distinct IDs. | Cross-session continuity is observed for one person only; no `$device_id` property was present, so cross-device continuity is unproven. |
| Can test usage and TestFlight be separated? | Builds 5-8 sent events; build 8 sent 175, including 14 `kind=development` subscription checks from one person. | No test-run or distribution-channel marker; neither automated flows, manual testing, nor actual TestFlight installations can be attributed conclusively. |
| Can staff/test accounts be excluded? | Existing cohort `233968` matches `$internal_or_test_user=true`, but has zero members; explicit SQL exclusion leaves all 545 events / 11 people. | The app never supplies that person property, and default filtering is off; the existing rule removes no observed usage. |
| Is unlocked macro viewing measured? | `restaurant_detail_viewed`: 30; `menu_item_tapped`: 1; successful `item_saved`: 1. | Detail loads and taps include locked previews; neither records access state, while saving misses read-only meal exploration. |
| Is a consented LA cohort measured? | No neighborhood/cohort marker appeared; the preset helper's `neighborhood` field is removed by the privacy filter. | A location choice is not analytics-cohort consent; existing GeoIP must not substitute for a consented LA marker. |
| Two active days in each of two weeks? | The executed save-only proxy returned **0 people**, with **0 save events** in the two completed weeks. | This is a plausible proxy result, not the full LA launch metric; the only observed save was in the following week. |

The [detail load](../../../apps/mobile/app/restaurant/%5Bid%5D.tsx#L134) records any non-null menu, including a locked one; [item taps](../../../apps/mobile/app/restaurant/%5Bid%5D.tsx#L337) are recorded before the lock branch.
Even [successful search telemetry](../../../apps/mobile/lib/discoverySearchTelemetry.ts#L7) includes locked previews.
The [post-purchase save continuation](../../../apps/mobile/app/restaurant/%5Bid%5D.tsx#L144) calls `saveItem` without `trackItemSaved`, so the save proxy also misses that path.
These are source findings, not newly reproduced production journeys.

## Live evidence and attribution

Queries ran in the authenticated, unsaved [SQL editor](https://us.posthog.com/project/361712/sql) against project `361712`, which matched Fitsy's existing `POSTHOG_PROJECT_ID` and US host configuration.
The bounded event window **W** is `[2026-10-05 00:00:00 UTC, 2026-11-04 18:45:00 UTC)`; results are aggregates only.
All 545 rows report `posthog-react-native` `4.41.0`, app version `1.0.0`, and a session ID.

| App build | Events | Distinct people within build | Distinct sessions within build | `kind=development` |
| --- | ---: | ---: | ---: | ---: |
| 5 | 274 | 1 | 28 | 0 |
| 6 | 65 | 5 | 7 | 0 |
| 7 | 31 | 5 | 5 | 0 |
| 8 | 175 | 1 | 6 | 14 |

People and sessions can overlap rows; do not sum those columns into project totals.
The [existing release receipt](../devops/ios-ota-baseline.md#verified-testflight-build-8) establishes build 8's TestFlight availability, not the installation source of these events.
[Monitoring classification](../../../apps/mobile/lib/monitoringEnvironment.ts#L5) labels any non-`production` OTA channel, including `testflight`, as `development`; therefore excluding that value would also exclude some TestFlight usage.
The other 531 events have no `kind`, and ordinary engagement events have no common environment marker.
Read-only [project customization](https://us.posthog.com/project/361712/settings/project-customization#internal-user-filtering) showed `User not in Internal / Test users`, with filtering disabled by default for new insights and revenue analytics.
The [existing dynamic cohort `233968`](https://us.posthog.com/project/361712/cohorts/233968) uses the person property `$internal_or_test_user equals true`; its displayed membership was zero.
The property was absent from Q4's observed person keys and is not set by current app code.
Q9 confirmed zero cohort events/people and zero marked events in W; `person_id NOT IN COHORT 233968` retained all 545 events and 11 people.
This proves the exclusion expression executes, not that actual staff/test accounts are identified correctly.
PostHog's [filter documentation](https://posthog.com/tutorials/filter-internal-users) requires explicit exclusion in SQL; project defaults do not apply it to raw SQL queries.
No filter, cohort definition, membership, or default was edited, and existing saved insights' individual filter states were not audited.
The current Jest suites mock the PostHog transport; their passing results establish local contracts, not server ingestion or historical Maestro attribution.
This audit generated no new product events.

The identity aggregate found three people with multiple sessions, but only one with `$identify` in W: 449 events, six distinct anonymous IDs on identify calls, 34 sessions, and 14 distinct LA days.
No device identifiers were exported or available through the queried `$device_id` field.
The event-associated person properties contained `email` on 439 events for one person; this does not identify that person as staff, a tester, or an external customer.
No private account identities or property values are included here.

Historical privacy state differs from current source: event-property keys include GeoIP latitude/longitude, IP, and fields now filtered out; person-property keys retain `goal`, `activity_level`, and `macro_calories`, `macro_protein`, `macro_carbs`, `macro_fat`, alongside email and SDK metadata.
Current filtering does not erase previously stored properties.
Only property presence was queried, not location, nutrition, IP, or email values.
Q8 localized GeoIP coordinate properties to all 274 build-5 events; all 271 build-6/7/8 events had `$geoip_disable=true` and no GeoIP coordinate property.
An `$ip` property was present on all 545 events, without inspecting its values or whether they were masked.
Retained person nutrition was associated with 274 build-5 and 165 build-8 events; this does not establish new nutrition collection by build 8.
Both observed successful auth events were Apple sign-ins on build 8; no dev/Google auth event was observed in W.

<details>
<summary>Complete source inventory: identity, SDK behavior, 60 custom events, and backend reads</summary>

## Source inventory

[Client setup](../../../apps/mobile/lib/analytics.ts#L15) uses `EXPO_PUBLIC_POSTHOG_API_KEY`, default US ingestion host, `identified_only` person profiles, memory persistence, `flushAt: 1`, and `flushInterval: 5000`.
GeoIP, lifecycle capture, session replay, and surveys are disabled; the [provider](../../../apps/mobile/app/_layout.tsx#L84) also disables autocapture.
A missing key warns and uses a placeholder; that source branch is not evidence that an installed build has a missing key.

The [privacy filter](../../../apps/mobile/lib/analyticsPrivacy.ts#L5) retains allowlisted booleans, finite numbers, and short strings without whitespace, `@`, `Bearer`, or `eyJ`; nulls, objects, arrays, and other fields are removed.
The table lists helper-supplied properties that survive this filter, followed by explicitly dropped fields where relevant.
Optional fields remain optional and string values may still be rejected by the value filter.
Common permitted SDK keys are `$lib`, `$lib_version`, `$os`, `$os_version`, `$app_version`, `$app_build`, `$session_id`, `$feature_flag`, `$feature_flag_response`, `$geoip_disable`, and `$process_person_profile`.
Stored ingestion metadata can differ from this client allowlist, as the live property-key queries show.

### Identity and SDK events

| Call / event | Source and behavior | Properties / W count |
| --- | --- | --- |
| `identifyAnalyticsUser` / `$identify` | [Single identify call](../../../apps/mobile/lib/analytics.ts#L78), invoked by [useAuthAnalytics](../../../apps/mobile/lib/useAuthAnalytics.ts#L12) on `INITIAL_SESSION` and `SIGNED_IN` with a session; distinct ID is the Supabase user ID; then reloads flags. | Only optional `email` survives as a person property; `$anon_distinct_id` is permitted on identity events; **6 events, 1 person**. |
| `$set` | Filter permits SDK identity updates; no direct application `setPersonProperties` call. | Only valid `email` in top-level `$set`; **0 events**. |
| Alias / `$create_alias` | No app or backend alias calls; the privacy filter rejects `$create_alias`. | None. |
| `resetAnalyticsSession` | [Reset call](../../../apps/mobile/lib/analytics.ts#L58) from [SIGNED_OUT](../../../apps/mobile/lib/useAuthAnalytics.ts#L19); clears identity. | A local SDK reset, not an application `$reset` capture event. |
| `$feature_flag_called` | SDK flag reads in [floating nav](../../../apps/mobile/lib/useFloatingNavFlag.ts#L14), [shuffle](../../../apps/mobile/lib/useShuffleFlag.ts#L11), and [development iOS map](../../../apps/mobile/lib/useMapSearchFlag.ts#L14). | `$feature_flag`, `$feature_flag_response`, common SDK fields; **17 events, 10 people**. |
| Lifecycle / screen / touch / replay | Disabled in current setup; other `$` events are rejected except `$identify`, `$set`, `$feature_flag_called`. | Historical W data: `Application Backgrounded` **50**, `Application Became Active` **51**, `Application Opened` **27**, each for one person. |

There are no application person properties for staff/test status, LA cohort, signup/install source, or analytics consent.
The filter drops `$set_once` and all person fields except email, including nutrition fields still listed in the older [event taxonomy](analytics-events.md#identity).
That older taxonomy also misstates reset and some event payloads; use the source-bound inventory here for this audit.
Memory persistence limits anonymous continuity across app processes; authenticated re-identification is necessary after restart, and the audit does not prove every account/device path.
`session_refresh_failed` fires on any `SIGNED_OUT` after a known session, including deliberate logout, so it is not a clean token-expiry measure.

### Custom events

All paths in the caller column are relative to `apps/mobile/`.
Event links point to the exact helper definitions; counts are all W events, including unattributed/test usage.
`0` means not observed in W; `uncalled` means the helper has no non-test app caller at the audited source.
For compactness, `targets` means `has_protein_target`, `has_carbs_target`, `has_fat_target`, `has_calories_target`; `paywall attribution` means optional `paywall_variant`, `paywall_config_version`, `paywall_tester_override`.

| Event | Caller / trigger | Helper properties after filtering | W count |
| --- | --- | --- | ---: |
| [subscription_check](../../../apps/mobile/lib/analytics.ts#L67) | `lib/apiClient.ts:282,287`, each completed status/sync request | `source, outcome, status_code, duration_ms, kind` | 14 |
| [onboarding_screen_view](../../../apps/mobile/lib/analytics.ts#L93) | `app/welcome/` screen mounts; `lib/useDiscoveryState.ts:34` results; `components/DiscoveryScreen.tsx:228` tour steps | `screen_name` | 5 |
| [search_performed](../../../apps/mobile/lib/analytics.ts#L121) | `lib/discoverySearchTelemetry.ts:11`; `lib/useDiscoveryResults.ts:115,147`, settled first page or failure | `targets, cuisine_filter, query_length, result_count, location_source, success` | 86 |
| [location_permission_denied](../../../apps/mobile/lib/analytics.ts#L134) | `lib/useLocation.ts:149,241`; `app/welcome/location-permission.tsx:82`, permission denied | `had_last_known` | 0 |
| [location_timeout](../../../apps/mobile/lib/analytics.ts#L142) | `lib/useLocation.ts:176,260`, GPS timeout | `had_last_known` | 1 |
| [location_error](../../../apps/mobile/lib/analytics.ts#L150) | `lib/useLocation.ts:193,275`, GPS exception | none; drops `error_message` | 0 |
| [search_page_loaded](../../../apps/mobile/lib/analytics.ts#L173) | `lib/discoverySearchTelemetry.ts:9`; `lib/useDiscoveryResults.ts:243`, page received | `page_index, result_count`; drops `cursor` | 101 |
| [search_pagination_end_reached](../../../apps/mobile/lib/analytics.ts#L186) | `lib/discoverySearchTelemetry.ts:10`; `lib/useDiscoveryResults.ts:251`, no next cursor | `total_results, pages_loaded` | 3 |
| [notification_priming_shown](../../../apps/mobile/lib/analytics.ts#L204) | `app/welcome/trial-reminder.tsx:46` and `notification-permission.tsx:31`, eligible screen mount | none | 0 |
| [notification_priming_allow_tapped](../../../apps/mobile/lib/analytics.ts#L212) | Same screens `:69` / `:40`, allow tap | none | 0 |
| [notification_priming_skip_tapped](../../../apps/mobile/lib/analytics.ts#L220) | Same screens `:103` / `:58`, skip tap | none | 0 |
| [notification_permission_granted](../../../apps/mobile/lib/analytics.ts#L228) | Same screens `:81` / `:44`, OS grant | none | 0 |
| [notification_permission_denied](../../../apps/mobile/lib/analytics.ts#L236) | Same screens `:88` / `:52`, OS denial | none | 0 |
| [location_manual_override_opened](../../../apps/mobile/lib/analytics.ts#L251) | `lib/useDiscoveryState.ts:52`, open picker | none | 2 |
| [location_manual_override_picked](../../../apps/mobile/lib/analytics.ts#L259) | `lib/useDiscoveryState.ts:56`, select preset | none; drops `neighborhood` | 0 |
| [location_manual_override_cleared](../../../apps/mobile/lib/analytics.ts#L270) | `lib/useDiscoveryState.ts:60`, use current location | none | 1 |
| [location_priming_shown](../../../apps/mobile/lib/analytics.ts#L289) | `app/welcome/location-permission.tsx:30`, mount | none | 3 |
| [location_priming_allow_tapped](../../../apps/mobile/lib/analytics.ts#L297) | uncalled | none | 0 |
| [location_priming_skip_tapped](../../../apps/mobile/lib/analytics.ts#L305) | uncalled | none | 0 |
| [location_permission_granted](../../../apps/mobile/lib/analytics.ts#L313) | `app/welcome/location-permission.tsx:87`, OS grant | none | 1 |
| [restaurant_tapped](../../../apps/mobile/lib/analytics.ts#L329) | `components/DiscoveryCards.tsx:104,211,222`, `DiscoveryMap.tsx:45`, `app/(tabs)/saved.tsx:93`, open restaurant | `restaurant_id, position, entry_point`; drops `restaurant_name, best_match_calories` | 8 |
| [item_saved](../../../apps/mobile/lib/analytics.ts#L351) | `app/restaurant/[id].tsx:190,198`, `app/(tabs)/saved.tsx:73`, successful save/unsave | `menu_item_id, restaurant_id, action, entry_point` | 1 |
| [onboarding_completed](../../../apps/mobile/lib/analytics.ts#L366) | `lib/onboardingCompletion.ts:32`, first recorded completion | `has_weight, has_height`; drops `goal, activity_level` | 0 |
| [auth_success](../../../apps/mobile/lib/analytics.ts#L385) | `app/auth/login.tsx:36,56,84`, `app/welcome/signin.tsx:161`, successful provider flow | `provider, is_new_user` | 2 |
| [restaurant_detail_viewed](../../../apps/mobile/lib/analytics.ts#L398) | `app/restaurant/[id].tsx:134`, non-null menu load | `restaurant_id`; drops `item_count` | 30 |
| [menu_search_typed](../../../apps/mobile/lib/analytics.ts#L412) | Detail `:257`, first character, clear, or each fifth character | `query_length` | 0 |
| [menu_filter_chip_toggled](../../../apps/mobile/lib/analytics.ts#L423) | Detail `:250`, filter toggle | none; drops `chip, on` | 0 |
| [menu_sort_changed](../../../apps/mobile/lib/analytics.ts#L434) | Detail `:263`, sort change | none; drops `sort` | 0 |
| [menu_item_tapped](../../../apps/mobile/lib/analytics.ts#L445) | Detail `:337`, card tap before lock check | `menu_item_id, restaurant_id, position` | 1 |
| [auth_failure](../../../apps/mobile/lib/analytics.ts#L465) | `app/auth/login.tsx:42,47,62,89`, `app/welcome/signin.tsx:202,207,221,252`, provider failure | `provider`; drops `error_message` | 0 |
| [session_refreshed](../../../apps/mobile/lib/analytics.ts#L481) | `lib/useAuthAnalytics.ts:17`, `TOKEN_REFRESHED` | none | 28 |
| [session_refresh_failed](../../../apps/mobile/lib/analytics.ts#L489) | `lib/useAuthAnalytics.ts:20`, `SIGNED_OUT` after known session | none | 1 |
| [stats_fetch_failed](../../../apps/mobile/lib/analytics.ts#L508) | `lib/useStats.ts:40`, stats fetch rejection | none; drops `error_message` | 0 |
| [preview_fetch_failed](../../../apps/mobile/lib/analytics.ts#L519) | `lib/useDiscoveryResults.ts:124,159`, onboarding preview failure | none; drops `error_message` | 0 |
| [save_macro_targets_failed](../../../apps/mobile/lib/analytics.ts#L530) | uncalled | none; drops `error_message` | 0 |
| [tab_switched](../../../apps/mobile/lib/analytics.ts#L548) | `app/(tabs)/_layout.tsx:71`, destination changes | `tab`; drops `from_tab` | 73 |
| [cuisine_selected](../../../apps/mobile/lib/analytics.ts#L566) | uncalled | none; drops `cuisine` | 0 |
| [macro_targets_edited](../../../apps/mobile/lib/analytics.ts#L585) | `lib/useDiscoveryState.ts:164`, `app/(tabs)/profile.tsx:403`, apply macro edits | `entry_point, has_protein, has_carbs, has_fat, has_calories` | 0 |
| [search_empty_results](../../../apps/mobile/lib/analytics.ts#L611) | `lib/discoverySearchTelemetry.ts:13`, successful zero-result search | `cuisine_filter, targets` | 0 |
| [search_failed](../../../apps/mobile/lib/analytics.ts#L622) | `lib/useDiscoveryResults.ts:123,155`, network/exception path | `cuisine_filter`; drops `error_message` | 0 |
| [restaurant_detail_failed](../../../apps/mobile/lib/analytics.ts#L640) | Detail `:131`, null menu outcome | `restaurant_id`; drops `error_message` | 0 |
| [save_failed](../../../apps/mobile/lib/analytics.ts#L659) | Detail `:192,202`, `app/(tabs)/saved.tsx:83`, failed save/unsave | `menu_item_id, restaurant_id, action, entry_point`; drops `error_message` | 0 |
| [onboarding_choice_selected](../../../apps/mobile/lib/analytics.ts#L688) | `app/welcome/{tried:42,goal:85,target-setup:66,dietary:31,sex:54,activity:50}.tsx`, choice tap | `screen`; drops `value` | 2 |
| [profile_field_edited](../../../apps/mobile/lib/analytics.ts#L710) | `app/(tabs)/profile.tsx:191`, profile field edit | `field` | 5 |
| [profile_logout_tapped](../../../apps/mobile/lib/analytics.ts#L721) | Profile `:115`, logout tap | none | 1 |
| [profile_account_deleted](../../../apps/mobile/lib/analytics.ts#L729) | Profile `:123,127`, deletion outcome | `success` | 0 |
| [legal_link_opened](../../../apps/mobile/lib/analytics.ts#L744) | `lib/legalLinks.ts:32`, privacy/terms/support open | `link` | 0 |
| [rating_prompt_requested](../../../apps/mobile/lib/analytics.ts#L761) | `lib/ratingPrompt.ts:81`, engagement-gated native prompt request | `source, session_count, save_count, search_count`; current caller uses `source=engagement` | 0 |
| [feedback_opened](../../../apps/mobile/lib/analytics.ts#L783) | `app/feedback-board.tsx:64`, open composer | none | 0 |
| [feedback_submitted](../../../apps/mobile/lib/analytics.ts#L791) | Feedback board `:70`, submission outcome | `message_length, success` | 0 |
| [feedback_upvoted](../../../apps/mobile/lib/analytics.ts#L805) | Feedback board `:57`, vote outcome | `feedback_id, action` | 0 |
| [paywall_shown](../../../apps/mobile/lib/analytics.ts#L826) | `app/welcome/payment.tsx:150`, `lib/usePurchaseActions.ts:72`, paywall presentation | `source, paywall attribution` | 0 |
| [paywall_result](../../../apps/mobile/lib/analytics.ts#L834) | `lib/usePurchaseActions.ts:60,74`, purchase/hosted paywall outcome | `source, outcome, paywall attribution` | 7 |
| [purchases_restored](../../../apps/mobile/lib/analytics.ts#L842) | `lib/usePurchaseActions.ts:105`, restore outcome | `is_pro` | 0 |
| [entitlement_mismatch](../../../apps/mobile/lib/analytics.ts#L857) | `lib/useEntitlementVerdict.ts:119`, device/server disagreement | `reason, device_pro, server_active` | 3 |
| [entitlement_sync_failed](../../../apps/mobile/lib/analytics.ts#L869) | `lib/useEntitlementVerdict.ts:86`, sync failure | `reason` | 15 |
| [paywall_experiment_exposed](../../../apps/mobile/lib/analytics.ts#L882) | `app/welcome/payment.tsx:151`, offering UI shown | `offering_id, access_variant, image_variant, layout_variant, paywall attribution` | 0 |
| [trial_catalog_mismatch](../../../apps/mobile/lib/analytics.ts#L887) | Payment `:161`, selected trial differs from expectation | `offering_id, product_id, actual_days, actual_period, desired_days`; null `actual_days` is dropped | 0 |
| [reminder_action](../../../apps/mobile/lib/analytics.ts#L892) | `lib/useReminders.tsx:139,149`, notification open/preferences; welcome reminder screens `:86` / `:49` | `action` plus `kind`, or `meals, trial` | 0 |
| [client_error](../../../apps/mobile/lib/errorReporting.ts#L20) | Global JS handler `:70`; `components/AppErrorBoundary.tsx:28`, render error | `source, is_fatal, kind`; message/stack are not sent | 0 |

### Backend and existing insights

No PostHog capture, identify, alias, or person-property writes were found in `apps/api` or `packages/shared`.
[posthogService.ts](../../../apps/api/services/posthogService.ts#L13) only POSTs `HogQLQuery` reads with `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, optional `POSTHOG_HOST`, and a ten-second timeout.
Its scoreboard counts all-event WAU, searches, zero-result searches, and a bounded D7 proxy; it has no meaningful-use, staff/test, or LA filter and no two-days-in-each-week calculation.
The [weekly scoreboard route](../../../apps/api/app/api/internal/weekly-scoreboard/route.ts) can send Slack output, so this audit did not invoke it.
The absence of a backend capture client also means successful API writes do not independently corroborate mobile capture completeness.

</details>

## Recommended gaps, pending Dawit's review

1. Verify staff/test eligibility and the existing `$internal_or_test_user` cohort's population path, then propose any needed default-filter change for approval; add reliable distribution/test attribution and verify the same account across real sessions and devices without exporting identities.
2. Measure successful unlocked macro viewing separately from teaser taps, and reconcile the post-purchase save path before choosing the activity definition.
3. Design explicit consent for a coarse LA marker, with no precise location and with an intentional privacy-filter contract; do not merely allowlist the existing neighborhood field.
4. Reconcile historical retained GeoIP/nutrition/IP properties with the current privacy contract; any retention/config/data action needs separate authorization and is outside this audit.
5. Refresh the stale taxonomy and decide whether the four uncalled helpers and filtered-out operational fields should remain, change, or be retired.
6. After those decisions, validate a staff-excluded, consented-LA, meaningful-use active-days query; keep the manual “would miss fitsy” check-in outside build work.

<details>
<summary>Executed read-only query book and execution receipts</summary>

## Reproducible read-only queries

Use the unsaved SQL editor or the existing query service with an already-authorized query-read credential; do not use capture endpoints or save an insight.
PostHog documents [query POSTs](https://posthog.com/docs/api/queries), [event/person expressions](https://posthog.com/docs/sql/expressions), and [identity stitching](https://posthog.com/docs/data/persons).
Existing Vercel CLI access established configuration presence, but the sensitive personal API key was not retrievable; an isolated browser tab using the existing Google sign-in recovered access without creating credentials or changing permissions.
Never print configuration values or substitute the public ingestion token for a query credential.

The SQL below freezes the actual audit windows; W predicates in each query are inclusive at the start and exclusive at the end.
The two LA weeks are October 19-25 and October 26-November 1, with UTC bounds `2026-10-19 07:00:00` and `2026-11-02 08:00:00`; the DST change is handled by named timezone conversion.
Q7 includes all identities; Q10 repeats it with the existing internal/test cohort excluded, which removes nobody in W.
Reliable staff/LA eligibility remains unavailable, so neither result is the launch's qualified-user count.

```sql
-- Q1: ingestion inventory, 29 rows; 545 events in total.
SELECT event, count() AS events, uniqExact(person_id) AS people,
       min(timestamp) AS first_seen, max(timestamp) AS last_seen
FROM events
WHERE timestamp >= toDateTime('2026-10-05 00:00:00', 'UTC')
  AND timestamp < toDateTime('2026-11-04 18:45:00', 'UTC')
GROUP BY event ORDER BY event LIMIT 200
```

```sql
-- Q2: build/environment attribution, five rows; build 8 has two kind groups.
SELECT coalesce(toString(properties.$lib), '(missing)') AS sdk,
       coalesce(toString(properties.$lib_version), '(missing)') AS sdk_version,
       coalesce(toString(properties.$app_version), '(missing)') AS app_version,
       coalesce(toString(properties.$app_build), '(missing)') AS app_build,
       coalesce(toString(properties.kind), '(missing)') AS kind,
       count() AS events, uniqExact(person_id) AS people,
       uniqExactIf(toString(properties.$session_id), properties.$session_id IS NOT NULL) AS sessions
FROM events
WHERE timestamp >= toDateTime('2026-10-05 00:00:00', 'UTC')
  AND timestamp < toDateTime('2026-11-04 18:45:00', 'UTC')
GROUP BY sdk, sdk_version, app_version, app_build, kind ORDER BY events DESC LIMIT 100
```

```sql
-- Q3: 71 event-property keys; never return property values.
SELECT arrayJoin(JSONExtractKeys(properties)) AS property, count() AS events
FROM events
WHERE timestamp >= toDateTime('2026-10-05 00:00:00', 'UTC')
  AND timestamp < toDateTime('2026-11-04 18:45:00', 'UTC')
GROUP BY property ORDER BY property LIMIT 200
```

```sql
-- Q4: 52 event-associated person-property keys, each seen for one person on 439 events.
SELECT arrayJoin(JSONExtractKeys(person.properties)) AS property,
       uniqExact(person_id) AS people, count() AS events
FROM events
WHERE timestamp >= toDateTime('2026-10-05 00:00:00', 'UTC')
  AND timestamp < toDateTime('2026-11-04 18:45:00', 'UTC')
GROUP BY property ORDER BY property LIMIT 200
```

```sql
-- Q5: aggregate continuity, not a person/device export.
SELECT count() AS people, sum(n) AS events,
       countIf(identify_events > 0) AS people_with_identify,
       sumIf(n, identify_events > 0) AS events_for_people_with_identify,
       countIf(sessions > 1) AS people_multiple_sessions,
       countIf(identify_events > 0 AND sessions > 1) AS identify_people_multiple_sessions,
       maxIf(sessions, identify_events > 0) AS max_identify_person_sessions,
       maxIf(days, identify_events > 0) AS max_identify_person_days,
       countIf(ids > 1) AS people_multiple_distinct_ids,
       sum(identify_events) AS total_identify_events,
       max(anon_ids) AS max_identify_anon_ids, max(devices) AS max_device_ids
FROM (
  SELECT person_id, count() AS n, uniqExact(distinct_id) AS ids,
         uniqExactIf(toString(properties.$session_id), properties.$session_id IS NOT NULL) AS sessions,
         uniqExact(toDate(toTimeZone(timestamp, 'America/Los_Angeles'))) AS days,
         countIf(event = '$identify') AS identify_events,
         uniqExactIf(toString(properties.$anon_distinct_id), event = '$identify' AND properties.$anon_distinct_id IS NOT NULL) AS anon_ids,
         uniqExactIf(toString(properties.$device_id), properties.$device_id IS NOT NULL) AS devices
  FROM events
  WHERE timestamp >= toDateTime('2026-10-05 00:00:00', 'UTC')
    AND timestamp < toDateTime('2026-11-04 18:45:00', 'UTC')
  GROUP BY person_id
)
```

```sql
-- Q6: marker coverage; only development_events=14 and development_people=1 are nonzero.
SELECT countIf(event = 'auth_success' AND properties.provider = 'dev') AS dev_auth_events,
       countIf(properties.kind = 'development') AS development_events,
       uniqExactIf(person_id, properties.kind = 'development') AS development_people,
       countIf(properties.paywall_tester_override = true) AS tester_override_events,
       countIf(properties.neighborhood IS NOT NULL) AS neighborhood_events,
       countIf(properties.is_staff IS NOT NULL OR properties.is_test IS NOT NULL OR person.properties.is_staff IS NOT NULL OR person.properties.is_test IS NOT NULL) AS staff_test_marker_events,
       countIf(properties.la_cohort IS NOT NULL OR person.properties.la_cohort IS NOT NULL) AS la_cohort_events,
       countIf(properties.locked IS NOT NULL OR properties.unlocked IS NOT NULL OR properties.entitled IS NOT NULL) AS access_marker_events
FROM events
WHERE timestamp >= toDateTime('2026-10-05 00:00:00', 'UTC')
  AND timestamp < toDateTime('2026-11-04 18:45:00', 'UTC')
```

```sql
-- Q7: save-only proxy, output saving_people=0, save_events=0, two_days_each_week=0.
WITH toDateTime('2026-10-19 00:00:00', 'America/Los_Angeles') AS week_one,
     toDateTime('2026-10-26 00:00:00', 'America/Los_Angeles') AS week_two,
     toDateTime('2026-11-02 00:00:00', 'America/Los_Angeles') AS window_end
SELECT count() AS saving_people, sum(saves) AS save_events,
       countIf(days_one >= 2 AND days_two >= 2) AS two_days_each_week
FROM (
  SELECT person_id, count() AS saves,
         uniqExactIf(toDate(toTimeZone(timestamp, 'America/Los_Angeles')), timestamp < week_two) AS days_one,
         uniqExactIf(toDate(toTimeZone(timestamp, 'America/Los_Angeles')), timestamp >= week_two) AS days_two
  FROM events
  WHERE timestamp >= week_one AND timestamp < window_end
    AND event = 'item_saved' AND properties.action = 'save'
  GROUP BY person_id
)
```

The only save in W occurred at `2026-11-03 19:51:28.949 UTC`, outside Q7's completed weeks.
The existing all-event WAU/D7 scoreboard cannot stand in for this calculation.

```sql
-- Q8: build-specific property presence and attribution; no sensitive values.
SELECT toString(properties.$app_build) AS app_build, count() AS events,
       countIf(properties.$geoip_latitude IS NOT NULL OR properties.$geoip_longitude IS NOT NULL) AS geoip_coordinate_events,
       countIf(properties.$geoip_disable = true) AS geoip_disabled_events,
       countIf(properties.$ip IS NOT NULL) AS ip_property_events,
       countIf(person.properties.macro_calories IS NOT NULL) AS events_with_retained_person_nutrition,
       countIf(event = 'auth_success' AND properties.provider = 'apple') AS apple_auth,
       countIf(event = 'auth_success' AND properties.provider = 'google') AS google_auth,
       countIf(event = 'item_saved' AND properties.action = 'save') AS saves,
       min(timestamp) AS first_seen, max(timestamp) AS last_seen
FROM events
WHERE timestamp >= toDateTime('2026-10-05 00:00:00', 'UTC')
  AND timestamp < toDateTime('2026-11-04 18:45:00', 'UTC')
GROUP BY app_build ORDER BY app_build
```

```sql
-- Q9: the existing internal/test cohort excludes no observed events or people.
SELECT 'all_events' AS population, count() AS events, uniqExact(person_id) AS people,
       countIf(person.properties.$internal_or_test_user = true) AS flagged_events
FROM events
WHERE timestamp >= toDateTime('2026-10-05 00:00:00', 'UTC')
  AND timestamp < toDateTime('2026-11-04 18:45:00', 'UTC')
UNION ALL
SELECT 'internal_cohort' AS population, count() AS events, uniqExact(person_id) AS people,
       countIf(person.properties.$internal_or_test_user = true) AS flagged_events
FROM events
WHERE timestamp >= toDateTime('2026-10-05 00:00:00', 'UTC')
  AND timestamp < toDateTime('2026-11-04 18:45:00', 'UTC')
  AND person_id IN COHORT 233968
UNION ALL
SELECT 'after_exclusion' AS population, count() AS events, uniqExact(person_id) AS people,
       countIf(person.properties.$internal_or_test_user = true) AS flagged_events
FROM events
WHERE timestamp >= toDateTime('2026-10-05 00:00:00', 'UTC')
  AND timestamp < toDateTime('2026-11-04 18:45:00', 'UTC')
  AND person_id NOT IN COHORT 233968
```

Q9 returned `(events, people, flagged_events)` of `(545, 11, 0)` for all events, `(0, 0, 0)` for cohort members, and `(545, 11, 0)` after exclusion.
Q10 is Q7 with `AND person_id NOT IN COHORT 233968` added to its inner `WHERE` clause after `properties.action = 'save'`.
It also returned `saving_people=0, save_events=0, two_days_each_week=0`.

| Query | Successful execution ID | Reported duration |
| --- | --- | ---: |
| Q1 | `74392f1c-ca65-4fc5-9d6e-9debd41707d3` | 0.48s |
| Q2 | `d511242d-b742-451b-a0b4-cf4addd41b8f` | 0.57s |
| Q3 | `67ab4c7b-ce6b-40c2-ac90-1dbe1b959af0` | 4.1s |
| Q4 | `e7a0a285-1c41-40f4-ba6a-e017210ac8be` | 4.3s |
| Q5 | `f75de59d-d535-41e7-864a-596a23222886` | 0.66s |
| Q6 | `a1345377-ac07-4086-ae24-9c88bd1f218c` | 3.5s |
| Q7 | `d8728abf-09e1-4798-94c1-b5f26547d0bc` | 0.47s |
| Q8 | `2e5fce32-9df8-41a6-b829-d4ead4c37eb1` | 0.58s |
| Q9 | `6cb24900-4577-402f-a3cb-93e5a40e9431` | 3.2s |
| Q10 | `1f884d5d-eba6-4683-a672-72a934369dda` | 4.4s |

Q5 preparation rejected an unavailable `person.is_identified` field, then a ClickHouse aggregate-alias collision; the recorded successful query instead uses observed `$identify` events and a distinct output alias.
Those errors are not ingestion failures or passing results.
Query windows, IDs, and counts above are the audit evidence; no ongoing monitoring or saved insight was installed.

</details>
