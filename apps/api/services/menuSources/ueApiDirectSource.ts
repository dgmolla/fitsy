/**
 * UE Direct MenuSource — used in the UE-first pipeline.
 *
 * Unlike `UberEatsSource` (which does URL discovery via Brave/sitemap/Firecrawl
 * before hitting UE), this source takes a pre-known `storeUuid` discovered by
 * Phase 1 (`scripts/preload-ue-first.ts`) and calls `getStoreV1` directly. No
 * discovery, no external calls beyond UE.
 */

import {
  fetchStoreV1,
  parseStoreV1Response,
  type FetchStoreV1Opts,
} from "./ueApiClient";
import type { MenuSource, MenuSourceResult } from "./types";

export class UeApiDirectSource implements MenuSource {
  readonly id = "ue_api_direct";
  private storeUuid: string;
  private opts: FetchStoreV1Opts;

  constructor(storeUuid: string, opts: FetchStoreV1Opts = {}) {
    this.storeUuid = storeUuid;
    this.opts = opts;
  }

  async lookup(_name: string, _address: string): Promise<MenuSourceResult> {
    const json = await fetchStoreV1(this.storeUuid, this.opts);
    if (!json) return { found: false, items: [], sourceId: this.id };

    const parsed = parseStoreV1Response(json);
    if (!parsed) return { found: false, items: [], sourceId: this.id };

    const result: MenuSourceResult = {
      found: true,
      items: parsed.items,
      sourceId: this.id,
      restaurant: { name: parsed.restaurant.name },
    };
    if (parsed.restaurant.imageUrl) result.restaurant!.imageUrl = parsed.restaurant.imageUrl;
    return result;
  }
}
