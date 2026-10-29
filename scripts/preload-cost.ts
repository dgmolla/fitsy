import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { StructuredMenuItem } from '../apps/api/services/menuSources/types';
import { menuItemIdentity } from '../apps/api/services/menuSources/menuItemIdentity';
import { HAIKU_MODEL } from '../apps/api/services/macroEstimationService';

// Standard synchronous Haiku 4.5 USD/token, including the default 5m cache TTL.
// https://platform.claude.com/docs/en/about-claude/pricing
const PRICE = { inputTokens: 1, outputTokens: 5, cacheCreationInputTokens: 1.25, cacheReadInputTokens: 0.1 };
const tokenKeys = ['inputTokens', 'outputTokens', 'cacheCreationInputTokens', 'cacheReadInputTokens'] as const;
const countKeys = [...tokenKeys, 'requests', 'itemAttempts'] as const;
type Tokens = Record<typeof tokenKeys[number], number>;
export interface AiUsageTotals extends Tokens { costUsd: number; requests: number; itemAttempts: number }
export interface ItemCost extends Tokens { itemKey: string; name: string; costUsd: number }
export interface AiUsageEvent extends AiUsageTotals {
  type: 'ai_usage'; version: 1; requestId: string; runId: string; hexId: string;
  restaurantId: string; placeId: string; model: typeof HAIKU_MODEL;
  allocation: 'equal_batch_share'; items: ItemCost[]; _time: string;
}
export type UsageContext = Pick<AiUsageEvent, 'hexId' | 'restaurantId' | 'placeId'>;

export interface ServiceUsageEvent {
  type: 'service_usage'; version: 1; requestId: string; runId: string; hexId: string; restaurantId: string; placeId: string;
  service: 'google'; costUsd: number; pricing: 'list_price_upper_bound'; _time: string;
}
type Reservation = { type: 'spend_reservation'; version: 1; requestId: string; runId: string; service: 'haiku' | 'google'; reserveUsd: number };
type Release = { type: 'spend_release'; version: 1; requestId: string; runId: string };
export class SpendCapReached extends Error {
  constructor(message: string, readonly scope: 'run' | 'daily_google' = 'run') { super(message); }
}
export class CostAccountingError extends Error {}

export function parseCostCap(raw = '15'): number {
  if (!raw.trim() || !Number.isFinite(Number(raw)) || Number(raw) < 0) {
    throw new Error('cost cap must be a finite non-negative USD amount');
  }
  return Number(raw);
}

export function emptyUsage(): AiUsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, costUsd: 0, requests: 0, itemAttempts: 0 };
}

function dollars(tokens: Tokens): number {
  return tokenKeys.reduce((sum, key) => sum + tokens[key] * PRICE[key], 0) / 1_000_000;
}

function add(total: AiUsageTotals, usage: AiUsageTotals): void {
  for (const key of tokenKeys) total[key] += usage[key];
  // Round only below the smallest supported token charge ($0.0000001).
  total.costUsd = Number((total.costUsd + usage.costUsd).toFixed(9));
  total.requests += usage.requests;
  total.itemAttempts += usage.itemAttempts;
}

export function costFromUsage(usage: Anthropic.Usage): Tokens & { costUsd: number } {
  if (!usage) throw new CostAccountingError('Anthropic response is missing token usage; stopping cost accounting');
  const tokens = {
    inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
  if (tokenKeys.some(key => !Number.isSafeInteger(tokens[key]) || tokens[key] < 0)) {
    throw new CostAccountingError('Anthropic response has invalid token usage; stopping cost accounting');
  }
  return { ...tokens, costUsd: dollars(tokens) };
}

/** Append-only local billing ledger, independent of atomic menu/checkpoint writes. */
export class PreloadCostTracker {
  readonly total = emptyUsage();
  private readonly hexes = new Map<string, AiUsageTotals>();
  private readonly restaurants = new Map<string, AiUsageTotals>();
  private readonly reservations = new Map<string, Reservation>();
  private googleUsd = 0;
  private readonly googleHexes = new Map<string, number>();
  private accountingStopped = false;
  private restoredPending = false;

  constructor(readonly runId: string, readonly capUsd: number, readonly path: string,
    private readonly emit: (event: AiUsageEvent | ServiceUsageEvent) => void = () => {}) {
    parseCostCap(String(capUsd));
    if (existsSync(path)) {
      const contents = readFileSync(path, 'utf8');
      // Never silently drop a partial record and reset the spend guard on resume.
      if (contents && !contents.endsWith('\n')) throw new CostAccountingError('Incomplete cost ledger; preserve and reconcile it before resuming');
      for (const line of contents.split('\n').filter(Boolean)) {
        let event: AiUsageEvent | ServiceUsageEvent | Reservation | Release;
        try { event = JSON.parse(line); }
        catch { throw new CostAccountingError('Invalid cost ledger JSON; preserve and reconcile it before resuming'); }
        if (!event || event.version !== 1 || typeof event.requestId !== 'string' || !event.requestId || typeof event.runId !== 'string' || !event.runId) {
          throw new CostAccountingError('Invalid cost ledger identity; preserve and reconcile it before resuming');
        }
        if (event.type === 'spend_reservation') {
          if (!['haiku', 'google'].includes(event.service) || !Number.isFinite(event.reserveUsd) || event.reserveUsd < 0) throw new CostAccountingError('Invalid spend reservation');
          if (event.runId === runId) {
            if (this.reservations.has(event.requestId)) throw new CostAccountingError('Duplicated spend reservation');
            this.reservations.set(event.requestId, event);
          }
          continue;
        }
        if (event.type === 'spend_release') {
          if (event.runId === runId && !this.reservations.delete(event.requestId)) throw new CostAccountingError('Missing spend reservation');
          continue;
        }
        if (event.type === 'service_usage') {
          if (event.service !== 'google' || event.pricing !== 'list_price_upper_bound' || !Number.isFinite(event.costUsd) || event.costUsd < 0
            || !event.hexId || !event.restaurantId || !event.placeId) throw new CostAccountingError('Invalid Google usage');
          if (event.runId === runId) { this.consume(event.requestId, event.costUsd); this.googleUsd += event.costUsd; this.googleHexes.set(event.hexId, (this.googleHexes.get(event.hexId) ?? 0) + event.costUsd); }
          continue;
        }
        if (event.type !== 'ai_usage' || event.version !== 1 ||
          !['runId', 'hexId', 'restaurantId', 'placeId', 'requestId'].every(key => typeof event[key as keyof AiUsageEvent] === 'string' && event[key as keyof AiUsageEvent] !== '') ||
          event.model !== HAIKU_MODEL || event.requests !== 1 || !Array.isArray(event.items) || event.itemAttempts !== event.items.length ||
          countKeys.some(key => !Number.isSafeInteger(event[key]) || event[key] < 0) ||
          !Number.isFinite(event.costUsd) || event.costUsd < 0 || Math.abs(event.costUsd - dollars(event)) > 1e-12) {
          throw new CostAccountingError('Invalid cost ledger usage; preserve and reconcile it before resuming');
        }
        if (event.runId === runId) { this.consume(event.requestId, event.costUsd); this.accumulate(event); }
      }
    }
    this.restoredPending = this.reservations.size > 0;
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, '', { flush: true });
  }

  get spentUsd(): number { return Number((this.total.costUsd + this.googleUsd).toFixed(9)); }
  get reservedUsd(): number { return [...this.reservations.values()].reduce((sum, event) => sum + event.reserveUsd, 0); }
  get capReached(): boolean { return this.spentUsd + this.reservedUsd >= this.capUsd; }
  googleForHex(hexId: string): number { return this.googleHexes.get(hexId) ?? 0; }
  get googleCostUsd(): number { return this.googleUsd; }
  get costPer1kItems(): number { return this.total.itemAttempts ? this.total.costUsd * 1000 / this.total.itemAttempts : 0; }
  assertCanSpend(): void {
    if (this.accountingStopped || this.restoredPending) throw new CostAccountingError('Unsettled or invalid spend reservation; reconcile before resuming');
    if (this.capReached) throw new SpendCapReached(`Spend cap $${this.capUsd} reached (spent $${this.spentUsd.toFixed(6)}, reserved $${this.reservedUsd.toFixed(6)}); resume run ${this.runId} with a higher cap`);
  }
  reserve(service: 'haiku' | 'google', usd: number): string {
    this.assertCanSpend();
    if (!Number.isFinite(usd) || usd < 0) throw new CostAccountingError('Invalid spend envelope');
    if (this.spentUsd + this.reservedUsd + usd > this.capUsd) throw new SpendCapReached('Spend cap cannot cover the next in-flight request');
    const event: Reservation = { type: 'spend_reservation', version: 1, requestId: randomUUID(), runId: this.runId, service, reserveUsd: usd };
    this.reservations.set(event.requestId, event);
    this.persist(event);
    return event.requestId;
  }
  release(requestId: string): void {
    if (!this.reservations.has(requestId)) throw new CostAccountingError('Missing spend reservation');
    this.persist({ type: 'spend_release', version: 1, requestId, runId: this.runId });
    this.reservations.delete(requestId);
  }
  requestFailed(requestId: string, error: unknown): void {
    // These explicit pre-inference rejections incur no token charge. Transport/5xx
    // failures keep the full envelope and stop retries until billing is reconciled.
    const status = (error as { status?: number } | null)?.status;
    if (status !== undefined && [400, 401, 403, 404, 413, 429].includes(status)) { this.release(requestId); return; }
    this.accountingStopped = true;
    throw new CostAccountingError('Request failed with unknown billing; reserved spend retained');
  }
  recordGoogle(context: UsageContext, requestId: string): void {
    const reservation = this.reservations.get(requestId);
    if (!reservation || reservation.service !== 'google') throw new CostAccountingError('Missing Google reservation');
    const event: ServiceUsageEvent = { type: 'service_usage', version: 1, requestId, runId: this.runId, ...context,
      service: 'google', costUsd: reservation.reserveUsd, pricing: 'list_price_upper_bound', _time: new Date().toISOString() };
    this.persist(event);
    this.consume(requestId,event.costUsd);
    this.googleUsd += event.costUsd;
    this.googleHexes.set(context.hexId, this.googleForHex(context.hexId) + event.costUsd);
    try { this.emit(event); } catch { this.accountingStopped = true; throw new CostAccountingError('Could not emit Google usage; ledger saved'); }
  }
  private persist(event: Reservation | Release | ServiceUsageEvent): void {
    try { appendFileSync(this.path, JSON.stringify(event) + '\n', { flush: true }); }
    catch { this.accountingStopped = true; throw new CostAccountingError('Could not persist spend reservation; paid work stopped'); }
  }
  private consume(requestId: string, usd: number): void {
    const reservation = this.reservations.get(requestId);
    if (reservation && usd > reservation.reserveUsd) this.accountingStopped = true;
    this.reservations.delete(requestId);
  }
  forHex(hexId: string): AiUsageTotals { return { ...(this.hexes.get(hexId) ?? emptyUsage()) }; }
  forRestaurant(context: UsageContext): AiUsageTotals {
    return { ...(this.restaurants.get(JSON.stringify([context.hexId, context.restaurantId])) ?? emptyUsage()) };
  }

  record(context: UsageContext, items: StructuredMenuItem[], usage: Anthropic.Usage, requestId: string = randomUUID()): void {
    const tokens = costFromUsage(usage);
    const allocations = items.map((item, i) => {
      const share = Object.fromEntries(tokenKeys.map(key => [key,
        Math.floor(tokens[key] / items.length) + (i < tokens[key] % items.length ? 1 : 0),
      ])) as Tokens;
      return { itemKey: menuItemIdentity(item), name: item.name, ...share, costUsd: dollars(share) };
    });
    const event: AiUsageEvent = {
      type: 'ai_usage', version: 1, requestId, runId: this.runId, ...context,
      model: HAIKU_MODEL, allocation: 'equal_batch_share', ...tokens,
      requests: 1, itemAttempts: items.length, items: allocations, _time: new Date().toISOString(),
    };
    this.consume(requestId, event.costUsd);
    this.accumulate(event);
    let writeFailed = false;
    try { appendFileSync(this.path, JSON.stringify(event) + '\n', { flush: true }); }
    catch { writeFailed = true; }
    try { this.emit(event); }
    catch {
      if (!writeFailed) throw new CostAccountingError('Could not emit AI usage; ledger saved, stopping before another paid request');
    }
    if (this.accountingStopped) throw new CostAccountingError('Usage exceeded its spend reservation; paid work stopped');
    if (writeFailed) { this.accountingStopped = true; throw new CostAccountingError('Could not persist AI usage; stopping before another paid request'); }
  }

  private accumulate(event: AiUsageEvent): void {
    add(this.total, event);
    const hex = this.hexes.get(event.hexId) ?? emptyUsage();
    add(hex, event); this.hexes.set(event.hexId, hex);
    const key = JSON.stringify([event.hexId, event.restaurantId]);
    const restaurant = this.restaurants.get(key) ?? emptyUsage();
    add(restaurant, event); this.restaurants.set(key, restaurant);
  }
}
