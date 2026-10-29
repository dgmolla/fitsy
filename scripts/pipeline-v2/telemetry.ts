import { Axiom } from '@axiomhq/js';
import type { BudgetState } from './budget-types';

const dataset = 'fitsy-pipeline';
/** Stable snapshot keys allow replay and recovery without double-counting costs or items. */
export class V2Telemetry {
  private client: Axiom | undefined;
  private emit(event: Record<string, unknown>): void {
    const token = process.env['AXIOM_TOKEN'];
    if (!token) return;
    this.client ??= new Axiom({ token });
    this.client.ingest(dataset, [{ pipelineVersion: 2, environment: 'dev', ...event }]);
  }
  budgets(states: BudgetState[]): void {
    for (const state of states) this.emit({ type: 'v2_service_budget', ...state, _time: new Date(state.observedAt).toISOString() });
  }
  hex(report: Record<string, unknown>): void {
    const coverage = report.coverage as Record<string, number> | undefined;
    if (!coverage) return;
    this.emit({ type: 'v2_hex', runId: report.runId, hexId: report.hexId, status: report.status,
      restaurants: coverage.restaurants, menus: coverage.menus, uniqueItems: coverage.uniqueItems,
      persistedItems: coverage.persistedItems, officialCoverage: report.officialCoverage, persistedCoverage: report.persistedCoverage,
      sourceMix: report.status === 'completed' ? report.sourceMix : {}, _time: new Date().toISOString() });
  }
  throttle(service: string, event: { status?: number; runId?: string; hexId?: string; reason?: 'daily_cap' }): void {
    this.emit({ type: 'v2_throttle', service, ...event, reason: event.reason ?? 'provider', _time: new Date().toISOString() });
  }
  async flush(): Promise<void> { await this.client?.flush(); }
}
export const v2Telemetry = new V2Telemetry();
