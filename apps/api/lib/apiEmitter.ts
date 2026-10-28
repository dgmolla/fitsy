/* eslint-disable no-console -- Safe structured telemetry and sanitized transport diagnostics. */
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
  hasCuisineFilter?: boolean;
  /** Whether a free-text query was present. Raw text is omitted to avoid PII. */
  hasQuery?: boolean;
  /** Length of the free-text query (PII-safe signal for tuning relevance). */
  queryLength?: number;
  status: number;
  _time: string;
}

/** Only static route templates and operational metadata, never request data. */
export interface ApiRequestEvent {
  type: 'api_request';
  route: string;
  method: string;
  status: number;
  durationMs: number;
  environment: string;
  deploymentSha: string | null;
  alert: boolean;
  _time: string;
}

export type ApiEvent = SearchRouteEvent | ApiRequestEvent;

class ApiEmitter {
  private axiom: Axiom | null;

  constructor() {
    const token = process.env["AXIOM_TOKEN"];
    this.axiom = token ? new Axiom({ token, onError: () => {
      console.error('[api-emitter] telemetry delivery failed');
    } }) : null;
    if (!this.axiom) {
      console.warn("[api-emitter] AXIOM_TOKEN not set — events will not be sent");
    }
  }

  get enabled(): boolean { return this.axiom !== null; }

  emitRequest(event: Omit<ApiRequestEvent, 'type' | '_time'>): void {
    // Stdout is a bounded, safe diagnostic even when Axiom itself is unavailable.
    const record = { ...event, type: 'api_request', _time: new Date().toISOString() };
    console.info(JSON.stringify(record));
    this.axiom?.ingest(DATASET, [record]);
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
let _token: string | undefined;
export function getApiEmitter(): ApiEmitter {
  const token = process.env['AXIOM_TOKEN'];
  if (!_emitter || _token !== token) { _emitter = new ApiEmitter(); _token = token; }
  return _emitter;
}
