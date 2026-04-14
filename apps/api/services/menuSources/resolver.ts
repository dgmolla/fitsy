/**
 * MenuSourceResolver — phased fallback orchestrator
 *
 * Tries each MenuSource in order until one returns found: true.
 * The pipeline instantiates the resolver with sources in priority order.
 *
 * S-133: Logs per-source outcome, duration, and error details for
 * diagnosing source reliability issues.
 */

import type { MenuSource, MenuSourceResult } from "./types";

export interface SourceAttempt {
  sourceId: string;
  status: "ok" | "not_found" | "error";
  reason?: string;
  durationMs: number;
}

export class MenuSourceResolver {
  private sources: MenuSource[];

  constructor(sources: MenuSource[]) {
    this.sources = sources;
  }

  /**
   * Resolve menu data by trying sources in order.
   * Returns the first successful result plus a log of all attempts.
   */
  async resolve(name: string, address: string): Promise<MenuSourceResult & { attempts: SourceAttempt[] }> {
    const attempts: SourceAttempt[] = [];

    for (const source of this.sources) {
      const start = Date.now();
      let result: MenuSourceResult;
      try {
        result = await source.lookup(name, address);
      } catch (err) {
        const durationMs = Date.now() - start;
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[resolver] ${source.id} threw for "${name}": ${reason} (${durationMs}ms)`);
        attempts.push({ sourceId: source.id, status: "error", reason, durationMs });
        continue;
      }

      const durationMs = Date.now() - start;
      if (result.found) {
        attempts.push({ sourceId: source.id, status: "ok", durationMs });
        return { ...result, attempts };
      }

      attempts.push({ sourceId: source.id, status: "not_found", durationMs });
    }

    return { found: false, items: [], sourceId: "none", attempts };
  }
}
