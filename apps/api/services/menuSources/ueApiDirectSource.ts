/**
 * UE Direct MenuSource — used in the UE-first pipeline.
 *
 * Unlike `UberEatsSource` (which does URL discovery via Brave/sitemap/Firecrawl
 * before hitting UE), this source takes a pre-known `storeUuid` discovered by
 * Phase 1 (`scripts/preload-ue-first.ts`) and calls `getStoreV1` directly. No
 * discovery, no external calls beyond UE.
 */

import {
  classifyStoreV1Response,
  fetchStoreV1,
  UeUnexpectedError,
  type FetchStoreV1Opts,
} from "./ueApiClient";
import type { MenuSource, MenuSourceResult } from "./types";

/**
 * Optional semaphore injected by the pipeline to cap concurrent UE calls at
 * the process level. Lives in the source (not around the whole resolver) so
 * non-UE work like FatSecret doesn't waste a UE slot.
 */
export interface UeConcurrencyGate {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export class UeApiDirectSource implements MenuSource {
  readonly id = "ue_api_direct";
  private storeUuid: string;
  private opts: FetchStoreV1Opts;
  private gate: UeConcurrencyGate | undefined;

  constructor(storeUuid: string, opts: FetchStoreV1Opts = {}, gate?: UeConcurrencyGate) {
    this.storeUuid = storeUuid;
    this.opts = opts;
    this.gate = gate;
  }

  async lookup(_name: string, _address: string): Promise<MenuSourceResult> {
    const doFetch = () => fetchStoreV1(this.storeUuid, this.opts);
    const json = this.gate ? await this.gate.run(doFetch) : await doFetch();
    if (!json) {
      throw new UeUnexpectedError(
        `UE getStoreV1 returned no body after retries (storeUuid=${this.storeUuid})`,
      );
    }

    const outcome = classifyStoreV1Response(json);
    if (outcome.ok) {
      const result: MenuSourceResult = {
        found: true,
        items: outcome.result.items,
        sourceId: this.id,
        restaurant: { name: outcome.result.restaurant.name },
      };
      if (outcome.result.restaurant.imageUrl) {
        result.restaurant!.imageUrl = outcome.result.restaurant.imageUrl;
      }
      return result;
    }

    // Genuine empty menu — ghost kitchen between refreshes, closed, delisted.
    // A single store missing its menu isn't a pipeline-level signal; soft-skip.
    if (outcome.reason === "no_sections") {
      return { found: false, items: [], sourceId: this.id };
    }

    // Schema drift or missing data block — hard fail so the operator notices
    // before the rest of the hex gets written with corrupted/empty menus.
    throw new UeUnexpectedError(
      `UE getStoreV1 response unexpected (reason=${outcome.reason}, storeUuid=${this.storeUuid})`,
    );
  }
}
