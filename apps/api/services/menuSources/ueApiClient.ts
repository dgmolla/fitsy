/**
 * Uber Eats internal API client.
 *
 * Two endpoints:
 *   - getStoreV1: full menu for a known storeUuid. Works unauth with CSRF header only.
 *   - getFeedV1:  delivery feed (list of stores) for a given lat/lng. Works unauth
 *                 but requires a `uev2.loc` cookie captured from a browser session.
 *                 The cookie's lat/lng fields are authoritative per-call; other
 *                 fields (HERE reference, address) are cosmetic and reused across
 *                 probes. See docs/engineering/plans/ue-feed-spike-findings.md.
 *
 * Cookie rotation: if `getFeedV1` starts returning empty-state at scale, the
 * cookie has expired. Capture a fresh one from ubereats.com → DevTools →
 * Application → Cookies → `uev2.loc` and update the `UE_LOC_COOKIE` secret.
 */

import type { StructuredMenuItem } from "./types";

const UE_BASE = "https://www.ubereats.com";
const UE_STORE_ENDPOINT = `${UE_BASE}/_p/api/getStoreV1`;
const UE_FEED_ENDPOINT = `${UE_BASE}/_p/api/getFeedV1`;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_BACKOFF_MS = 1000;
const ERROR_BODY_PREVIEW = 200;
/** Statuses UE uses for soft-block / rate-limit — worth retrying. */
const RETRY_STATUSES = new Set([403, 429, 502, 503]);

// ─── Soft-block circuit breaker ──────────────────────────────────────────────
//
// If UE starts returning 403 to us at volume, continuing to hammer risks
// escalating a soft-block into a hard IP ban. Count 403s in a sliding window;
// once the threshold trips, every further postUe call throws UeSoftBlockError
// which propagates up through the source -> resolver -> processRestaurant,
// where Guard 2 (strict hex atomicity in preload-ue-first.ts) catches it,
// skips the hex checkpoint, and exits so the operator can rotate the cookie.
//
// 403 is the only signal tracked — see discussion in docs for rationale. 429
// is throttle (retry-after handles it); 502/503/504 are infra noise; network
// errors are local-side. All other responses are silent from the breaker's
// perspective.

const CB_WINDOW_MS = 60_000;
const CB_TRIP_THRESHOLD = 10;
const recentBlockTimestamps: number[] = [];
let breakerTripped = false;

export class UeSoftBlockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UeSoftBlockError";
  }
}

function recordBlockSignal(): void {
  const now = Date.now();
  while (
    recentBlockTimestamps.length > 0 &&
    recentBlockTimestamps[0]! < now - CB_WINDOW_MS
  ) {
    recentBlockTimestamps.shift();
  }
  recentBlockTimestamps.push(now);
  if (!breakerTripped && recentBlockTimestamps.length >= CB_TRIP_THRESHOLD) {
    breakerTripped = true;
    console.error(
      `[ue-api] circuit breaker tripped — ${recentBlockTimestamps.length} UE 403s in last ${CB_WINDOW_MS / 1000}s. ` +
        `Rotate UE_LOC_COOKIE and/or wait for the block to clear before resuming.`,
    );
  }
}

function checkBreaker(): void {
  if (breakerTripped) {
    throw new UeSoftBlockError(
      `UE soft-block circuit breaker tripped (>=${CB_TRIP_THRESHOLD} 403s in ${CB_WINDOW_MS / 1000}s). ` +
        `Hex aborted — pending for resume after cookie rotation.`,
    );
  }
}

/** Test-only: reset circuit breaker state. Do not call from production code. */
export function __resetUeCircuitBreakerForTest(): void {
  recentBlockTimestamps.length = 0;
  breakerTripped = false;
}

/**
 * Rotating pool of recent Chrome UAs (desktop) paired with matching
 * `sec-ch-ua` / `sec-ch-ua-platform` client hints so the User-Agent + hints
 * agree. UE's bot-defense can flag UA/hint mismatches.
 */
interface ChromeProfile {
  ua: string;
  secChUa: string;
  platform: '"macOS"' | '"Windows"';
}
const CHROME_PROFILES: ChromeProfile[] = [
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    platform: '"macOS"',
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    platform: '"Windows"',
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
    platform: '"macOS"',
  },
];

function pickChromeProfile(): ChromeProfile {
  return CHROME_PROFILES[Math.floor(Math.random() * CHROME_PROFILES.length)]!;
}

/** UE requires `x-csrf-token` but doesn't validate it for unauth reads. A
 *  random-looking token avoids being a static fingerprint across requests. */
function randomCsrfToken(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function readBodyPreview(response: Response): Promise<string> {
  try {
    const body = await response.text();
    return body.slice(0, ERROR_BODY_PREVIEW);
  } catch {
    return "<unreadable>";
  }
}

/** Exponential backoff with ±25% jitter. baseMs=0 disables (for tests). */
function jitteredBackoffMs(attempt: number, baseMs: number): number {
  if (baseMs <= 0) return 0;
  const base = baseMs * 2 ** attempt;
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(1, Math.round(base + jitter));
}

// ─── Shared POST helper ──────────────────────────────────────────────────────

interface PostUeOpts {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxRetries?: number;
  baseBackoffMs?: number;
  /** Extra Cookie header value (e.g. for getFeedV1's uev2.loc). */
  cookieHeader?: string;
  /** Label for log lines (e.g. storeUuid or "feed:34.05,-118.24"). */
  logLabel: string;
}

async function postUe<T>(endpoint: string, body: unknown, opts: PostUeOpts): Promise<T | null> {
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseBackoffMs = opts.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Short-circuit once the breaker is tripped — propagates up through the
    // resolver so Guard 2 catches it and skips the hex checkpoint.
    checkBreaker();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    const tag = `attempt ${attempt + 1}/${maxRetries + 1}`;
    const profile = pickChromeProfile();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": profile.ua,
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "x-csrf-token": randomCsrfToken(),
      Referer: `${UE_BASE}/`,
      Origin: UE_BASE,
      "sec-ch-ua": profile.secChUa,
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": profile.platform,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    };
    if (opts.cookieHeader) headers["Cookie"] = opts.cookieHeader;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.ok) return (await response.json()) as T;

      // 403 is UE's soft-block signal — count it whether we retry or give up.
      // Threshold + window are tuned conservatively; see CB constants above.
      if (response.status === 403) recordBlockSignal();

      const preview = await readBodyPreview(response);
      const retriable = RETRY_STATUSES.has(response.status) && attempt < maxRetries;
      if (retriable) {
        console.warn(`[ue-api] HTTP ${response.status} for ${opts.logLabel} (${tag}, retrying): ${preview}`);
      } else {
        console.warn(`[ue-api] HTTP ${response.status} for ${opts.logLabel} (${tag}, giving up): ${preview}`);
        return null;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= maxRetries) {
        console.warn(`[ue-api] network error for ${opts.logLabel} (${tag}, giving up): ${msg}`);
        return null;
      }
      console.warn(`[ue-api] network error for ${opts.logLabel} (${tag}, retrying): ${msg}`);
    } finally {
      clearTimeout(timeout);
    }

    const delay = jitteredBackoffMs(attempt, baseBackoffMs);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }
  return null;
}

// ─── Store UUID decoding ─────────────────────────────────────────────────────

/**
 * Decode the store UUID from a UberEats store URL.
 *
 * UE URLs have the form `/store/{slug}/{b64url}[?query]` where `{b64url}` is
 * 22 characters of base64url (no padding) representing a 16-byte UUID.
 *
 * Returns a canonical lowercase UUID string (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
 * or `null` if the URL doesn't contain a decodable UUID segment.
 */
export function decodeStoreUuid(storeUrl: string): string | null {
  const match = storeUrl.match(/\/store\/[^/]+\/([A-Za-z0-9_-]{22})(?:[/?#]|$)/);
  if (!match) return null;
  const segment = match[1]!;

  // base64url → base64 → bytes
  const b64 = segment.replace(/-/g, "+").replace(/_/g, "/") + "==";
  let bytes: Buffer;
  try {
    bytes = Buffer.from(b64, "base64");
  } catch {
    return null;
  }
  if (bytes.length !== 16) return null;

  const hex = bytes.toString("hex");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20, 32)}`
  );
}

// ─── getStoreV1 types ────────────────────────────────────────────────────────

interface UeCatalogItem {
  uuid?: string;
  title?: string;
  itemDescription?: string;
  price?: number; // cents
  imageUrl?: string;
  isAvailable?: boolean;
}

interface UeCatalogSectionPayload {
  standardItemsPayload?: {
    title?: { text?: string };
    catalogItems?: UeCatalogItem[];
  };
}

interface UeCatalogSection {
  payload?: UeCatalogSectionPayload;
}

interface UeStoreData {
  title?: string;
  location?: { latitude?: number; longitude?: number };
  heroImageUrls?: Array<{ url?: string }>;
  catalogSectionsMap?: Record<string, UeCatalogSection[]>;
}

interface UeStoreResponse {
  status?: string;
  data?: UeStoreData;
}

export interface UeApiResult {
  items: StructuredMenuItem[];
  restaurant: {
    name: string;
    imageUrl?: string;
  };
  geo?: { lat: number; lng: number };
}

// ─── fetchStoreV1 ────────────────────────────────────────────────────────────

export interface FetchStoreV1Opts {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Max retries on retriable statuses / network errors. Default 2. */
  maxRetries?: number;
  /** Base ms for exp backoff (1s → 2s → 4s). 0 disables delay (tests). Default 1000. */
  baseBackoffMs?: number;
}

/**
 * POST to UE's internal getStoreV1 endpoint. Returns parsed JSON or `null`.
 *
 * Retries with exp backoff + jitter on 403/429/502/503 and network errors
 * (UE sometimes soft-blocks rapid unauth POSTs). Logs HTTP status + body
 * preview on every non-ok response so rate-limit vs. block vs. empty-response
 * failure modes are visible in pipeline logs.
 */
export async function fetchStoreV1(
  storeUuid: string,
  opts: FetchStoreV1Opts = {},
): Promise<UeStoreResponse | null> {
  return postUe<UeStoreResponse>(UE_STORE_ENDPOINT, { storeUuid }, {
    ...opts,
    logLabel: storeUuid,
  });
}

// ─── Response parsing (getStoreV1) ───────────────────────────────────────────

/**
 * Extract structured menu items + restaurant metadata from a getStoreV1
 * response. Returns `null` if no items can be extracted.
 *
 * UE duplicates items across sections (e.g. "Most Popular" repeats items
 * from the main sections), so we dedupe by lowercased title, preferring
 * the first occurrence with a non-empty section.
 */
export function parseStoreV1Response(json: UeStoreResponse): UeApiResult | null {
  const data = json.data;
  if (!data) return null;

  const sectionsMap = data.catalogSectionsMap ?? {};
  const allSections: UeCatalogSection[] = Object.values(sectionsMap).flat();
  if (allSections.length === 0) return null;

  const items: StructuredMenuItem[] = [];
  const seen = new Map<string, number>(); // lowered title → items[] index

  for (const section of allSections) {
    const payload = section.payload?.standardItemsPayload;
    if (!payload) continue;
    const sectionName = payload.title?.text;

    for (const raw of payload.catalogItems ?? []) {
      const title = raw.title?.trim();
      if (!title) continue;

      const key = title.toLowerCase();
      const existingIdx = seen.get(key);
      if (existingIdx !== undefined) {
        if (sectionName && !items[existingIdx]!.section) {
          items[existingIdx]!.section = sectionName;
        }
        continue;
      }

      const item: StructuredMenuItem = { name: title };
      if (raw.itemDescription) item.description = raw.itemDescription;
      if (typeof raw.price === "number" && raw.price > 0) item.price = raw.price / 100;
      if (sectionName) item.section = sectionName;

      seen.set(key, items.length);
      items.push(item);
    }
  }

  if (items.length === 0) return null;

  const restaurant: UeApiResult["restaurant"] = { name: data.title ?? "" };
  const heroUrl = data.heroImageUrls?.[0]?.url;
  if (heroUrl) restaurant.imageUrl = heroUrl;

  const result: UeApiResult = { items, restaurant };
  if (
    typeof data.location?.latitude === "number" &&
    typeof data.location?.longitude === "number"
  ) {
    result.geo = { lat: data.location.latitude, lng: data.location.longitude };
  }

  return result;
}

// ─── Convenience wrapper (getStoreV1) ────────────────────────────────────────

/**
 * Full API path: decode storeUuid from URL → POST getStoreV1 → parse.
 * Returns `null` for any failure (undecodable URL, network error, empty menu).
 */
export async function extractMenuViaApi(
  storeUrl: string,
  opts: FetchStoreV1Opts = {},
): Promise<UeApiResult | null> {
  const storeUuid = decodeStoreUuid(storeUrl);
  if (!storeUuid) return null;

  const json = await fetchStoreV1(storeUuid, opts);
  if (!json) return null;

  return parseStoreV1Response(json);
}

// ─── getFeedV1 types ─────────────────────────────────────────────────────────

interface UeFeedImage {
  url?: string;
  width?: number;
  height?: number;
}

interface UeFeedMapMarker {
  latitude?: number;
  longitude?: number;
}

interface UeFeedStore {
  storeUuid?: string;
  title?: { text?: string };
  rating?: { text?: string; accessibilityText?: string };
  actionUrl?: string;
  image?: { items?: UeFeedImage[] };
  mapMarker?: UeFeedMapMarker;
  signposts?: Array<{ text?: string }>;
  meta?: Array<{ text?: string; badgeType?: string }>;
}

interface UeFeedItem {
  uuid?: string;
  type?: string;
  store?: UeFeedStore;
}

interface UeFeedData {
  feedItems?: UeFeedItem[];
  cityName?: string;
  isInServiceArea?: boolean;
  cacheKey?: string;
}

interface UeFeedResponse {
  status?: string;
  data?: UeFeedData;
}

/** Normalized store card yielded by paginateFeedV1. */
export interface UeFeedStoreCard {
  storeUuid: string;
  name: string;
  lat: number;
  lng: number;
  /** Highest-resolution image URL from `image.items[]`, if present. */
  photoUrl?: string;
  /** Numeric rating parsed from `rating.text`, if present. */
  rating?: number;
  /** Review count parsed from `rating.accessibilityText` ("…based on more than 230 reviews"). */
  userRatingCount?: number;
  /** Store slug extracted from `actionUrl` (`/store/<slug>/...`). */
  slug?: string;
  /** Short base64url ID from `actionUrl` (second path segment after slug). */
  actionUrlId?: string;
}

// ─── getFeedV1 cookie handling ───────────────────────────────────────────────

interface UeLocCookieAddress {
  address1?: string;
  address2?: string;
  aptOrSuite?: string;
  eaterFormattedAddress?: string;
  subtitle?: string;
  title?: string;
  uuid?: string;
  [key: string]: unknown;
}
interface UeLocCookieJson {
  latitude?: number;
  longitude?: number;
  address?: UeLocCookieAddress;
  reference?: string;
  [key: string]: unknown;
}

/**
 * Build the `Cookie: uev2.loc=...` header value for a given lat/lng.
 *
 * Reads `UE_LOC_COOKIE` (URL-encoded JSON captured from a browser session),
 * overrides `latitude`/`longitude`, and scrubs cosmetic personal data that
 * would otherwise leak the captured user's street address in every request
 * (`address.address1`, `eaterFormattedAddress`, etc.) and tie every probe
 * back to a single HERE `reference` token. Geo-relevant components
 * (city/state/postal) are preserved — UE infers those from lat/lng anyway.
 *
 * Throws if `UE_LOC_COOKIE` is not set or cannot be decoded.
 */
export function buildFeedCookieHeader(lat: number, lng: number): string {
  const raw = process.env.UE_LOC_COOKIE;
  if (!raw) {
    throw new Error(
      "UE_LOC_COOKIE env var not set. Capture uev2.loc from ubereats.com DevTools → Application → Cookies.",
    );
  }
  let parsed: UeLocCookieJson;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch (err) {
    throw new Error(
      `UE_LOC_COOKIE could not be parsed as URL-encoded JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  parsed.latitude = lat;
  parsed.longitude = lng;
  if (parsed.address && typeof parsed.address === "object") {
    parsed.address.address1 = "";
    parsed.address.address2 = "";
    parsed.address.aptOrSuite = "";
    parsed.address.eaterFormattedAddress = "";
    parsed.address.subtitle = "";
    parsed.address.title = "";
    parsed.address.uuid = "";
  }
  parsed.reference = "";
  const reEncoded = encodeURIComponent(JSON.stringify(parsed));
  return `uev2.loc=${reEncoded}`;
}

// ─── fetchFeedV1 ─────────────────────────────────────────────────────────────

export interface FetchFeedV1Opts extends FetchStoreV1Opts {
  /** Pagination offset into feedItems. Default 0. */
  offset?: number;
  /** Page size. UE caps this server-side; plan assumes 80. */
  pageSize?: number;
}

/**
 * POST to UE's internal getFeedV1 endpoint for a given lat/lng.
 *
 * Reads `UE_LOC_COOKIE` to build the session cookie. Returns raw JSON or null.
 */
export async function fetchFeedV1(
  lat: number,
  lng: number,
  opts: FetchFeedV1Opts = {},
): Promise<UeFeedResponse | null> {
  const offset = opts.offset ?? 0;
  const pageSize = opts.pageSize ?? 80;
  const cookieHeader = buildFeedCookieHeader(lat, lng);
  const body = {
    userQuery: "",
    date: "",
    startTime: 0,
    endTime: 0,
    cacheKey: "",
    pageInfo: { offset, pageSize },
    sortAndFilters: [],
    marketingFeedType: "",
    billboardUuid: "",
    feedProvider: "",
    promotionUuid: "",
    targetingStoreTag: "",
    venueUUID: "",
    selectedSectionUUID: "",
    favorites: "",
    vertical: "ALL",
  };
  return postUe<UeFeedResponse>(UE_FEED_ENDPOINT, body, {
    ...opts,
    cookieHeader,
    logLabel: `feed:${lat.toFixed(4)},${lng.toFixed(4)},off=${offset}`,
  });
}

// ─── Response parsing (getFeedV1) ────────────────────────────────────────────

const REVIEW_COUNT_RE = /([\d,]+)\s+reviews?/i;

function extractReviewCount(accessibilityText: string | undefined): number | undefined {
  if (!accessibilityText) return undefined;
  const m = accessibilityText.match(REVIEW_COUNT_RE);
  if (!m) return undefined;
  const n = parseInt(m[1]!.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : undefined;
}

function extractSlugAndId(actionUrl: string | undefined): { slug?: string; actionUrlId?: string } {
  if (!actionUrl) return {};
  const m = actionUrl.match(/\/store\/([^/]+)\/([A-Za-z0-9_-]+)/);
  if (!m) return {};
  const result: { slug?: string; actionUrlId?: string } = {};
  if (m[1]) result.slug = m[1];
  if (m[2]) result.actionUrlId = m[2];
  return result;
}

function pickLargestImage(items: UeFeedImage[] | undefined): string | undefined {
  if (!items || items.length === 0) return undefined;
  let best: UeFeedImage | undefined;
  let bestArea = 0;
  for (const it of items) {
    if (!it.url) continue;
    const area = (it.width ?? 0) * (it.height ?? 0);
    if (area > bestArea) {
      best = it;
      bestArea = area;
    }
  }
  return best?.url ?? items.find((i) => i.url)?.url;
}

/**
 * Extract normalized store cards from a getFeedV1 response.
 *
 * Reads `data.feedItems[]` filtered by `type === "REGULAR_STORE"` — NOT the
 * deprecated `storesMap`. Skips items without a storeUuid or valid
 * mapMarker lat/lng (both required for Phase 1 upsert + hex assignment).
 */
export function parseFeedV1Response(json: UeFeedResponse): UeFeedStoreCard[] {
  const items = json.data?.feedItems;
  if (!items) return [];

  const cards: UeFeedStoreCard[] = [];
  for (const item of items) {
    if (item.type !== "REGULAR_STORE") continue;
    const s = item.store;
    if (!s) continue;
    const storeUuid = s.storeUuid;
    const name = s.title?.text;
    const lat = s.mapMarker?.latitude;
    const lng = s.mapMarker?.longitude;
    if (!storeUuid || !name || typeof lat !== "number" || typeof lng !== "number") continue;

    const card: UeFeedStoreCard = { storeUuid, name, lat, lng };
    const photoUrl = pickLargestImage(s.image?.items);
    if (photoUrl) card.photoUrl = photoUrl;
    const ratingNum = s.rating?.text ? parseFloat(s.rating.text) : NaN;
    if (Number.isFinite(ratingNum)) card.rating = ratingNum;
    const reviewCount = extractReviewCount(s.rating?.accessibilityText);
    if (reviewCount !== undefined) card.userRatingCount = reviewCount;
    const { slug, actionUrlId } = extractSlugAndId(s.actionUrl);
    if (slug) card.slug = slug;
    if (actionUrlId) card.actionUrlId = actionUrlId;
    cards.push(card);
  }
  return cards;
}

// ─── paginateFeedV1 ──────────────────────────────────────────────────────────

export interface PaginateFeedV1Opts extends FetchStoreV1Opts {
  /** Page size per request. Default 80. */
  pageSize?: number;
  /** Hard cap on pages fetched (safety). Default 10. */
  maxPages?: number;
}

/**
 * Paginate getFeedV1 for a single probe location.
 *
 * Yields normalized store cards. Stops when a page returns zero new cards
 * (terminal) or maxPages is reached. First-page-only is the common case —
 * plan assumes most probes terminate after one page (50–100 stores).
 */
export async function* paginateFeedV1(
  lat: number,
  lng: number,
  opts: PaginateFeedV1Opts = {},
): AsyncIterable<UeFeedStoreCard> {
  const pageSize = opts.pageSize ?? 80;
  const maxPages = opts.maxPages ?? 10;
  const seen = new Set<string>();

  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const json = await fetchFeedV1(lat, lng, { ...opts, offset, pageSize });
    if (!json) return;

    const cards = parseFeedV1Response(json);
    let newCount = 0;
    for (const card of cards) {
      if (seen.has(card.storeUuid)) continue;
      seen.add(card.storeUuid);
      newCount++;
      yield card;
    }
    // Terminate when the page adds no new stores. UE's pagination isn't
    // strictly cursor-based for unauth feed — relying on "no new stores"
    // is more robust than trusting cacheKey/hasMore.
    if (newCount === 0) return;
  }
}
