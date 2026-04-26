import { Axiom } from "@axiomhq/js";

const DATASET = "fitsy-api";

export interface SearchRouteEvent {
  type: "search_route";
  route: string;
  auth_ms: number;
  query_ms: number;
  duration_ms: number;
  result_count: number;
  has_targets: boolean;
  cuisine_filter?: string;
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
