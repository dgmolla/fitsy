/**
 * Uber Eats internal API client for `/_p/api/getStoreV1`.
 *
 * UE's storefront uses an internal JSON API that returns the full menu
 * without the SSR bot-defense wall that blocks the HTML/JSON-LD path.
 * The store UUID is encoded in the URL path as the 22-char base64url
 * segment after the slug: `/store/{slug}/{b64url}` → 16-byte UUID.
 *
 * This module is stateless — it does not cache URLs or manage flow
 * (that's `UberEatsSource`'s job). It exposes primitives the source
 * can call when `UE_API_MODE` is `primary` or `shadow`.
 */

import type { StructuredMenuItem } from "./types";

const UE_API_ENDPOINT = "https://www.ubereats.com/_p/api/getStoreV1";
const DEFAULT_TIMEOUT_MS = 8_000;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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

// ─── API response types ──────────────────────────────────────────────────────

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

// ─── Fetch ───────────────────────────────────────────────────────────────────

/**
 * POST to UE's internal getStoreV1 endpoint. Returns parsed JSON or `null`
 * on network error, non-2xx, or malformed response. Aborts after `timeoutMs`.
 */
export async function fetchStoreV1(
  storeUuid: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<UeStoreResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(UE_API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": BROWSER_UA,
        Accept: "application/json",
        "x-csrf-token": "x", // UE requires this header to be present (value not validated for unauth reads)
      },
      body: JSON.stringify({ storeUuid }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    return (await response.json()) as UeStoreResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Response parsing ────────────────────────────────────────────────────────

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
        // Upgrade the prior entry if we now have a section name and it didn't
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

// ─── Convenience wrapper ─────────────────────────────────────────────────────

/**
 * Full API path: decode storeUuid from URL → POST getStoreV1 → parse.
 * Returns `null` for any failure (undecodable URL, network error, empty menu).
 */
export async function extractMenuViaApi(
  storeUrl: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<UeApiResult | null> {
  const storeUuid = decodeStoreUuid(storeUrl);
  if (!storeUuid) return null;

  const json = await fetchStoreV1(storeUuid, opts);
  if (!json) return null;

  return parseStoreV1Response(json);
}
