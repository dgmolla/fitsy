/**
 * Pipeline event types and Axiom emitter (S-120).
 *
 * Emits 4 event types to the `fitsy-pipeline` Axiom dataset:
 *   - restaurant: per restaurant, batched per hex
 *   - error:      real-time on failure
 *   - cost_checkpoint: per hex
 *   - run:        end of pipeline
 */

import { Axiom } from "@axiomhq/js";

const DATASET = "fitsy-pipeline";

// ─── Event schemas ──────────────────────────────────────────────────────────

export interface SourceAttemptEvent {
  sourceId: string;
  status: "ok" | "not_found" | "error";
  reason?: string;
  durationMs: number;
}

export interface RestaurantEvent {
  type: "restaurant";
  runId: string;
  hexId: string;
  name: string;
  placeId: string;
  source: string;
  status: string;
  itemCount: number;
  rejectedCount: number;
  macroMismatchCount: number;
  sourcesAttempted: string[];
  sourcesFailed: string[];
  sourceAttempts: SourceAttemptEvent[];
  nameMismatch: boolean;
  durationMs: number;
  _time: string;
}

export interface PipelineError {
  type: "error";
  runId: string;
  hexId: string;
  restaurant: string;
  placeId: string;
  stage: string;
  source: string;
  error: string;
  retryable: boolean;
  retriesAttempted: number;
  _time: string;
}

export interface CostCheckpoint {
  type: "cost_checkpoint";
  runId: string;
  hexId: string;
  hexesCompleted: number;
  hexesTotal: number;
  cumulativeCost: number;
  cumulativeCostBreakdown: {
    googlePlaces: number;
    braveSearch: number;
    firecrawl: number;
    haiku: number;
  };
  _time: string;
}

export interface RunEvent {
  type: "run";
  runId: string;
  durationTotal: string;
  hexesTotal: number;
  hexesCompleted: number;
  restaurantsDiscovered: number;
  restaurantsPersisted: number;
  restaurantsFailed: number;
  itemsTotal: number;
  costTotal: number;
  _time: string;
}

export type PipelineEvent = RestaurantEvent | PipelineError | CostCheckpoint | RunEvent;

// ─── Emitter ────────────────────────────────────────────────────────────────

export class PipelineEmitter {
  private axiom: Axiom | null;
  private buffer: PipelineEvent[] = [];

  constructor() {
    const token = process.env["AXIOM_TOKEN"];
    this.axiom = token ? new Axiom({ token }) : null;
    if (!this.axiom) {
      console.warn("[pipeline-events] AXIOM_TOKEN not set — events will be logged but not sent");
    }
  }

  /** Emit an error event immediately (real-time alerting). */
  emitError(event: PipelineError): void {
    if (this.axiom) {
      this.axiom.ingest(DATASET, [event]);
    }
  }

  /** Buffer a restaurant event for batch emission. */
  bufferRestaurant(event: RestaurantEvent): void {
    this.buffer.push(event);
  }

  /** Flush buffered restaurant events + emit a cost checkpoint (per hex). */
  async flushHex(costCheckpoint: CostCheckpoint): Promise<void> {
    if (this.axiom) {
      const events = [...this.buffer, costCheckpoint];
      this.axiom.ingest(DATASET, events);
    }
    this.buffer = [];
  }

  /** Emit the final run event and flush all remaining data to Axiom. */
  async emitRun(event: RunEvent): Promise<void> {
    if (this.axiom) {
      this.axiom.ingest(DATASET, [event]);
      await this.axiom.flush();
    }
  }

  /** Flush any remaining buffered events (e.g. on exit). */
  async flush(): Promise<void> {
    if (this.axiom && this.buffer.length > 0) {
      this.axiom.ingest(DATASET, this.buffer);
      this.buffer = [];
    }
    if (this.axiom) {
      await this.axiom.flush();
    }
  }
}
