/**
 * Spike: does UberEats `getFeedV1` work unauth after bootstrapping a location?
 *
 * Round 1 (scripts/cache/ue-feed-spike-sample.json from prior run) proved
 * that `getFeedV1` returns 200 but `storesMap: {}` / EMPTY_STATE regardless
 * of lat/lng in the body — it reads location from a session cookie.
 *
 * Round 2 (this script): bootstrap a location by calling internal setter
 * endpoints, capture cookies, then re-call `getFeedV1` with those cookies.
 *
 * Usage:
 *   npx tsx scripts/ue-feed-spike.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://www.ubereats.com";
const CACHE_DIR = join(process.cwd(), "scripts", "cache");

const LAT = 34.09142;
const LNG = -118.29402;

// Real uev2.loc cookie captured from a signed-out browser session (user-provided).
// URL-encoded JSON: { address, latitude, longitude, reference (here_places ref), ... }
// This is the cookie the UE web client sets after an address is picked in the UI.
const UEV2_LOC_COOKIE =
  "%7B%22address%22%3A%7B%22address1%22%3A%221119%20N%20Berendo%20St%22%2C%22address2%22%3A%22Los%20Angeles%2C%20CA%22%2C%22aptOrSuite%22%3A%22%22%2C%22eaterFormattedAddress%22%3A%221119%20N%20Berendo%20St%2C%20Los%20Angeles%2C%20CA%2090029-1705%2C%20US%22%2C%22subtitle%22%3A%22Los%20Angeles%2C%20CA%22%2C%22title%22%3A%221119%20N%20Berendo%20St%22%2C%22uuid%22%3A%22%22%7D%2C%22latitude%22%3A34.09142%2C%22longitude%22%3A-118.29402%2C%22reference%22%3A%22here%3Aaf%3Astreetsection%3AG8bANzG9fjPkATqc.SVb2D%3ACgcIBCCI-aY7EAEaBDExMTk%22%2C%22referenceType%22%3A%22here_places%22%2C%22type%22%3A%22here_places%22%2C%22addressComponents%22%3A%7B%22city%22%3A%22Los%20Angeles%22%2C%22countryCode%22%3A%22US%22%2C%22firstLevelSubdivisionCode%22%3A%22CA%22%2C%22postalCode%22%3A%2290029-1705%22%7D%2C%22categories%22%3A%5B%22address_point%22%5D%2C%22originType%22%3A%22user_autocomplete%22%2C%22source%22%3A%22manual_auto_complete%22%2C%22userState%22%3A%22Unknown%22%2C%22residenceType%22%3A%22%22%7D";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Minimal cookie jar — collects Set-Cookie from responses, sends them on next request.
class CookieJar {
  private cookies = new Map<string, string>();

  absorb(setCookieHeader: string | null): void {
    if (!setCookieHeader) return;
    // Node fetch merges multiple Set-Cookie into one string separated by ", "
    // but cookie values can contain commas too. Split on the boundary pattern
    // `,\s+<cookie-name>=` instead.
    const entries = setCookieHeader.split(/,\s*(?=[A-Za-z0-9_-]+=)/);
    for (const entry of entries) {
      const first = entry.split(";")[0]!;
      const eq = first.indexOf("=");
      if (eq < 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  header(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  size(): number {
    return this.cookies.size;
  }

  names(): string[] {
    return Array.from(this.cookies.keys());
  }
}

async function post(
  path: string,
  body: unknown,
  jar: CookieJar,
  label: string,
): Promise<{
  status: number;
  contentType: string;
  raw: string;
  json: unknown;
  ms: number;
  setCookieNames: string[];
}> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": BROWSER_UA,
    "x-csrf-token": "x",
    Referer: `${BASE}/`,
    Origin: BASE,
  };
  const cookieHeader = jar.header();
  if (cookieHeader) headers["Cookie"] = cookieHeader;

  let status = -1;
  let contentType = "";
  let raw = "";
  let setCookie = "";

  try {
    const response = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    status = response.status;
    contentType = response.headers.get("content-type") ?? "";
    setCookie = response.headers.get("set-cookie") ?? "";
    raw = await response.text();
  } catch (err) {
    raw = `<fetch error: ${err instanceof Error ? err.message : String(err)}>`;
  } finally {
    clearTimeout(timeout);
  }

  const setCookieNames: string[] = [];
  if (setCookie) {
    // For logging only — the jar extracts its own set.
    const entries = setCookie.split(/,\s*(?=[A-Za-z0-9_-]+=)/);
    for (const e of entries) {
      const name = e.split("=")[0]?.trim();
      if (name) setCookieNames.push(name);
    }
    jar.absorb(setCookie);
  }

  const ms = Date.now() - t0;
  let json: unknown = null;
  if (contentType.includes("application/json") && raw.length > 0) {
    try {
      json = JSON.parse(raw);
    } catch {
      /* ignore */
    }
  }

  const keysPreview =
    json && typeof json === "object" && !Array.isArray(json)
      ? Object.keys(json as Record<string, unknown>).slice(0, 20).join(", ")
      : "<non-object>";
  console.log(`─── ${label} (${path}) ───`);
  console.log(`  status:        ${status}`);
  console.log(`  content-type:  ${contentType}`);
  console.log(`  body length:   ${raw.length}`);
  console.log(`  top keys:      [${keysPreview}]`);
  console.log(`  set-cookie:    [${setCookieNames.join(", ") || "none"}]`);
  console.log(`  jar size:      ${jar.size()} (${jar.names().join(", ")})`);
  console.log(`  ms:            ${ms}`);
  console.log(`  preview:       ${raw.slice(0, 300).replace(/\s+/g, " ")}`);
  console.log();

  return { status, contentType, raw, json, ms, setCookieNames };
}

async function get(
  path: string,
  jar: CookieJar,
  label: string,
): Promise<{ status: number; raw: string; setCookieNames: string[] }> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  const headers: Record<string, string> = {
    Accept: "text/html,application/json",
    "User-Agent": BROWSER_UA,
  };
  const cookieHeader = jar.header();
  if (cookieHeader) headers["Cookie"] = cookieHeader;

  let status = -1;
  let raw = "";
  let setCookie = "";

  try {
    const response = await fetch(`${BASE}${path}`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    status = response.status;
    setCookie = response.headers.get("set-cookie") ?? "";
    raw = await response.text();
  } catch (err) {
    raw = `<fetch error: ${err instanceof Error ? err.message : String(err)}>`;
  } finally {
    clearTimeout(timeout);
  }

  const setCookieNames: string[] = [];
  if (setCookie) {
    const entries = setCookie.split(/,\s*(?=[A-Za-z0-9_-]+=)/);
    for (const e of entries) {
      const name = e.split("=")[0]?.trim();
      if (name) setCookieNames.push(name);
    }
    jar.absorb(setCookie);
  }

  const ms = Date.now() - t0;
  console.log(`─── ${label} (GET ${path}) ───`);
  console.log(`  status:     ${status}`);
  console.log(`  body length:${raw.length}`);
  console.log(`  set-cookie: [${setCookieNames.join(", ") || "none"}]`);
  console.log(`  jar size:   ${jar.size()} (${jar.names().join(", ")})`);
  console.log(`  ms:         ${ms}`);
  console.log();
  return { status, raw, setCookieNames };
}

async function main() {
  const jar = new CookieJar();

  console.log(`Testing injected uev2.loc cookie for ${LAT}, ${LNG} (Los Feliz / E Hollywood)\n`);

  // Step 0: GET homepage to collect baseline cookies (csrf, session id, cf_bm, etc.)
  await get("/", jar, "Step 0: homepage");

  // Step 1: inject the uev2.loc cookie (user-provided from a real browser session).
  // The UE web client sets this client-side after address pick — no RPC exists to set it.
  jar.set("uev2.loc", UEV2_LOC_COOKIE);
  console.log(`─── Step 1: injected uev2.loc ───`);
  console.log(`  jar size: ${jar.size()} (${jar.names().join(", ")})\n`);

  // Step 2: call getFeedV1 with full cookie jar.
  const feed = await post(
    "/_p/api/getFeedV1",
    {
      userQuery: "",
      date: "",
      startTime: 0,
      endTime: 0,
      cacheKey: "",
      pageInfo: { offset: 0, pageSize: 80 },
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
    },
    jar,
    "Step 2: getFeedV1 (with injected uev2.loc)",
  );

  // Save feed response (whatever we got).
  mkdirSync(CACHE_DIR, { recursive: true });
  const outPath = join(CACHE_DIR, "ue-feed-spike-sample.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        lat: LAT,
        lng: LNG,
        feedStatus: feed.status,
        feedContentType: feed.contentType,
        feedTopKeys:
          feed.json && typeof feed.json === "object"
            ? Object.keys(feed.json as Record<string, unknown>)
            : [],
        feedRaw: feed.json ?? feed.raw.slice(0, 2000),
        cookieNamesAfterFeed: jar.names(),
      },
      null,
      2,
    ),
  );
  console.log(`Saved feed sample → ${outPath}`);

  // Verdict
  let storeCount = 0;
  let hasStoresMap = false;
  if (feed.json && typeof feed.json === "object") {
    const data = (feed.json as { data?: { storesMap?: Record<string, unknown> } }).data;
    if (data?.storesMap && typeof data.storesMap === "object") {
      hasStoresMap = true;
      storeCount = Object.keys(data.storesMap).length;
    }
  }
  console.log(`───────────────────────────────────────`);
  console.log(`Feed status:       ${feed.status}`);
  console.log(`Has storesMap:     ${hasStoresMap}`);
  console.log(`Store count:       ${storeCount}`);
  console.log(`Cookies in jar:    [${jar.names().join(", ")}]`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
