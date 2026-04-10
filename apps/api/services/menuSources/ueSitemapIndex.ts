/**
 * UE Sitemap Index — downloads and indexes Uber Eats sitemap shards for URL discovery.
 *
 * Downloads all 26 gzipped sitemaps from ubereats.com, extracts /store/ URLs,
 * and builds a slug → full URL index. Caches locally for 7 days.
 *
 * Usage:
 *   const index = new UESitemapIndex();
 *   await index.load();
 *   const url = index.findUrl("Thai Orchid");  // → "https://www.ubereats.com/store/thai-orchid/AbCd..."
 */

import * as fs from "fs";
import * as path from "path";
import { gunzipSync } from "zlib";

const SITEMAP_BASE = "https://www.ubereats.com/sitemap-store-771af823-";
const SHARD_COUNT = 26; // 000..025
const CACHE_DIR = path.join(process.cwd(), "scripts", "cache");
const CACHE_FILE = path.join(CACHE_DIR, "ue-sitemap-index.json");
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheData {
  timestamp: number;
  entries: Record<string, string>; // slug → url
}

export class UESitemapIndex {
  private index: Map<string, string> = new Map();
  private loaded = false;

  /** Download all sitemap shards and build the index. Uses local cache if fresh. */
  async load(): Promise<void> {
    if (this.loaded) return;

    // Try cache first
    if (this.loadFromCache()) {
      this.loaded = true;
      return;
    }

    // Download all shards
    console.log("[UESitemapIndex] Downloading sitemap shards...");
    let totalUrls = 0;

    for (let i = 0; i < SHARD_COUNT; i++) {
      const shard = String(i).padStart(3, "0");
      const url = `${SITEMAP_BASE}${shard}.xml.gz`;

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.log(`[UESitemapIndex] Shard ${shard}: HTTP ${response.status}`);
          continue;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        let xml: string;
        try {
          xml = gunzipSync(buffer).toString("utf-8");
        } catch {
          // Not gzipped — try as plain XML
          xml = buffer.toString("utf-8");
        }

        const urls = this.extractStoreUrls(xml);
        for (const storeUrl of urls) {
          const slug = this.extractSlug(storeUrl);
          if (slug) {
            this.index.set(slug, storeUrl);
          }
        }
        totalUrls += urls.length;
        console.log(`[UESitemapIndex] Shard ${shard}: ${urls.length} store URLs`);
      } catch (err) {
        console.log(`[UESitemapIndex] Shard ${shard}: ${String(err)}`);
      }
    }

    console.log(`[UESitemapIndex] Indexed ${this.index.size} unique slugs from ${totalUrls} URLs`);

    this.saveToCache();
    this.loaded = true;
  }

  /** Find a UE store URL by restaurant name. Exact slug match only — no fuzzy/substring. */
  findUrl(restaurantName: string): string | null {
    const slug = this.nameToSlug(restaurantName);
    return this.index.get(slug) ?? null;
  }

  /** Number of indexed URLs (for stats/testing). */
  get size(): number {
    return this.index.size;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private extractStoreUrls(xml: string): string[] {
    const urls: string[] = [];
    const pattern = /<loc>(https?:\/\/www\.ubereats\.com\/store\/[^<]+)<\/loc>/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(xml)) !== null) {
      if (match[1]) urls.push(match[1]);
    }
    return urls;
  }

  private extractSlug(url: string): string | null {
    // URL format: https://www.ubereats.com/store/{slug}/{uuid}
    const match = url.match(/\/store\/([^/]+)\//);
    return match?.[1] ?? null;
  }

  private nameToSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/'/g, "")
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private loadFromCache(): boolean {
    try {
      if (!fs.existsSync(CACHE_FILE)) return false;

      const stat = fs.statSync(CACHE_FILE);
      const age = Date.now() - stat.mtimeMs;
      if (age > CACHE_MAX_AGE_MS) {
        console.log("[UESitemapIndex] Cache expired, will re-download");
        return false;
      }

      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const data = JSON.parse(raw) as CacheData;

      for (const [slug, url] of Object.entries(data.entries)) {
        this.index.set(slug, url);
      }

      console.log(`[UESitemapIndex] Loaded ${this.index.size} slugs from cache`);
      return true;
    } catch {
      return false;
    }
  }

  private saveToCache(): void {
    try {
      if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
      }

      const data: CacheData = {
        timestamp: Date.now(),
        entries: Object.fromEntries(this.index),
      };

      fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
      console.log(`[UESitemapIndex] Saved cache (${this.index.size} slugs)`);
    } catch (err) {
      console.log(`[UESitemapIndex] Failed to save cache: ${String(err)}`);
    }
  }
}
