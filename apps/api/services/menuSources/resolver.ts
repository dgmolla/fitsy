/**
 * MenuSourceResolver — phased fallback orchestrator
 *
 * Tries each MenuSource in order until one returns found: true.
 * The pipeline instantiates the resolver with sources in priority order:
 *
 *   new MenuSourceResolver([
 *     new FFNSource(),       // Phase 1: official chain macros, $0
 *     new FatSecretSource(), // Phase 1b: more chain macros, $0
 *     new UberEatsSource(),  // Phase 2: structured indie menus, $0
 *     new FirecrawlSource(), // Phase 3: fallback scraping, ~$0.006
 *   ])
 *
 * The resolver returns the first successful result. sourceId on the
 * result identifies which source was used.
 */

import type { MenuSource, MenuSourceResult } from "./types";

export class MenuSourceResolver {
  private sources: MenuSource[];

  constructor(sources: MenuSource[]) {
    this.sources = sources;
  }

  async resolve(name: string, address: string): Promise<MenuSourceResult> {
    for (const source of this.sources) {
      let result: MenuSourceResult;
      try {
        result = await source.lookup(name, address);
      } catch {
        // Individual source failure should not abort the fallback chain
        continue;
      }

      if (result.found) return result;
    }

    return { found: false, items: [], sourceId: "none" };
  }
}
