import { Axiom } from "@axiomhq/js";

const DATASET = "fitsy-pipeline";

export interface SearchRouteEvent {
  type: "search_route";
  route: string;
  authMs: number;
  queryMs: number;
  durationMs: number;
  resultCount: number;
  hasTargets: boolean;
  cuisineFilter?: string;
  /** Whether a free-text query was present. Raw text is omitted to avoid PII. */
  hasQuery?: boolean;
  /** Length of the free-text query (PII-safe signal for tuning relevance). */
  queryLength?: number;
  status: number;
  _time: string;
}

export type ApiEvent = SearchRouteEvent;

class ApiEmitter {
  private axiom: Axiom | null;

  constructor() {
    const token = process.env["AXIOM_TOKEN"];
    this.axiom = token ? new Axiom({ token }) : null;
    if (!this.axiom) {
      console.warn("[api-emitter] AXIOM_TOKEN not set — events will not be sent");
    }
  }

  emitSearchRoute(event: Omit<SearchRouteEvent, "type" | "_time">): void {
    if (!this.axiom) return;
    this.axiom.ingest(DATASET, [
      { ...event, type: "search_route", _time: new Date().toISOString() },
    ]);
  }

  async flush(): Promise<void> {
    if (this.axiom) await this.axiom.flush();
  }
}

let _emitter: ApiEmitter | null = null;
export function getApiEmitter(): ApiEmitter {
  if (!_emitter) _emitter = new ApiEmitter();
  return _emitter;
}
