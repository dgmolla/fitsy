> **🗄️ ARCHIVED 2026-06-12** — Superseded by `docs/engineering/pipeline/ue-first-pipeline.md`. Historical record; do not update.

# UE `getFeedV1` Spike — Findings (2026-04-19)

## Verdict: GREEN LIGHT

All kill-criteria from `ue-first-pipeline.md` are cleared. The unauth-feed probe
strategy is viable. Proceed to Stage 2 (migration + source module).

## Method

Script: `scripts/ue-feed-spike.ts`. Five probe points spanning CA → NY, hitting
`POST https://www.ubereats.com/_p/api/getFeedV1` with:
- Baseline cookies from `GET /` (session_v2, dId, _ua, jwt-session, __cf_bm)
- `uev2.loc` cookie injected from a real browser session, with `latitude`/`longitude`
  fields overwritten per probe (other fields kept fixed, including the HERE reference)
- Body: standard feed request with `pageInfo: { offset: 0, pageSize: 80 }`, `vertical: "ALL"`

## Results

| Probe | Status | Stores | First-store geo | `data.cityName` |
|---|---|---|---|---|
| Los Feliz (cookie-original) | 200 | 57 | (34.1023, -118.3083) | los_angeles |
| Downtown LA | 200 | 100 | (34.0488, -118.2608) | los_angeles |
| Santa Monica | 200 | 99 | (34.0327, -118.4941) | los_angeles |
| San Francisco | 200 | 69 | (37.769, -122.4284) | san_francisco |
| NYC Times Square | 200 | 52 | (40.7548, -73.9797) | new_york |

No 403/429/captcha. Response sizes 1.5–2.5 MB. Latency ~1–2 s per probe.

## Key facts

1. **Cookie lat/lng is authoritative.** The HERE `reference` token in the cookie is
   cosmetic — server recomputes the feed center from `latitude`/`longitude` in the
   cookie JSON. One captured cookie string works for the entire US.
2. **Per-store geo is in the feed response.** Each `feedItems[]` entry of
   `type: "REGULAR_STORE"` has `store.mapMarker.latitude` and
   `store.mapMarker.longitude`. No `getStoreV1` needed for hex assignment.
3. **Feed carries enough to create a Restaurant row** except for full street address:
   - `store.storeUuid` — stable identity
   - `store.title.text` — name
   - `store.rating.text` — rating string (parse as float)
   - `store.rating.accessibilityText` — embeds review count ("…based on more than 230 reviews")
   - `store.actionUrl` — `/store/<slug>/<shortUuid>?diningMode=DELIVERY`
   - `store.image.items[]` — 6 resolutions of the hero photo (2880w → 240w)
   - `store.mapMarker.latitude/longitude`
4. **`getStoreV1` still required** per restaurant for: menu items, full street
   address, hours, cuisine tags. But this is a known-working call.
5. **`storesMap` is empty / deprecated** in the current response. Stores are
   inline in `feedItems[]`. The plan's extractor must read from `feedItems`.

## Cookie mechanics

- UE's web client sets `uev2.loc` client-side in JS after address pick. There is
  no RPC to set it (tried `setTargetLocationV1` → returns 400 "Delivery location
  cookie is not set"; `getLocationDetailsV1` → 404 `ERR_MISSING_HANDLER`).
- The captured cookie will be stored as a config secret. If it expires, rotate
  by capturing from any logged-out session at ubereats.com → DevTools →
  Application → Cookies → `uev2.loc`.

## Gaps still unvalidated (non-blocking)

- Pagination: `pageSize: 80` returned 100 on some probes (hard cap?). Need to
  test `offset > 0` to see if additional pages exist or if one call is terminal.
- Rate-limit ceiling: 5 rapid probes had no rejections; need a burst test (50+)
  to find the semaphore ceiling empirically. Plan assumes 5 concurrent.
- Cookie lifetime: unknown. Assume weeks based on typical UE session cookie
  patterns; revisit if first pipeline run fails.

## Next steps

1. Update `ue-first-pipeline.md` to note spike cleared; link to this doc.
2. Stage 2: destructive migration (`20260419_ue_first_rebuild`) + `UeFeedSource`
   module extending `apps/api/services/menuSources/ueApiClient.ts`.
