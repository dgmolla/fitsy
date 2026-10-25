import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Anthropic from '@anthropic-ai/sdk';
import { PreloadCostTracker, CostAccountingError, SpendCapReached, costFromUsage, parseCostCap } from './preload-cost';

const context = { hexId: 'hex-a', restaurantId: 'restaurant-a', placeId: 'store-a' };
const usage: Anthropic.Usage = { input_tokens: 1000, output_tokens: 2000, cache_creation_input_tokens: null, cache_read_input_tokens: null };
let dir: string;
let path: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'preload-cost-')); path = join(dir, 'usage.jsonl'); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('prices measured input/output and cache tokens at Haiku 4.5 rates', () => {
  expect(costFromUsage(usage).costUsd).toBe(0.011);
  expect(costFromUsage({ ...usage, input_tokens: 0, output_tokens: 0 }).costUsd).toBe(0);
  expect(costFromUsage({ ...usage, output_tokens: 200, cache_creation_input_tokens: 800, cache_read_input_tokens: 2000 }).costUsd).toBe(0.0032);
});

it('attributes each batch across distinct product identities without losing tokens or cost', () => {
  const events: unknown[] = [];
  const costs = new PreloadCostTracker('run', 15, path, event => events.push(event));
  costs.record(context, [
    { name: 'Bowl', sourceItemId: 'ue:small' }, { name: 'Bowl', sourceItemId: 'ue:large' }, { name: 'Soup' },
  ], usage);
  const event = JSON.parse(readFileSync(path, 'utf8'));
  expect(events).toEqual([event]);
  expect(event.allocation).toBe('equal_batch_share');
  expect(event.items.map((item: { itemKey: string }) => item.itemKey)).toEqual(['source:ue:small', 'source:ue:large', 'name:soup']);
  for (const key of ['inputTokens', 'outputTokens', 'cacheCreationInputTokens', 'cacheReadInputTokens', 'costUsd']) {
    expect(event.items.reduce((sum: number, item: Record<string, number>) => sum + item[key]!, 0)).toBeCloseTo(event[key], 10);
  }
  expect(costs.total).toMatchObject({ inputTokens: 1000, outputTokens: 2000, costUsd: 0.011, itemAttempts: 3, requests: 1 });
  expect(costs.forRestaurant(context)).toEqual(costs.total);
  expect(costs.forHex(context.hexId)).toEqual(costs.total);
});

it('restores failed/retried attempts and aggregates run, hex and restaurant totals separately', () => {
  const tracker = new PreloadCostTracker('run', 15, path);
  tracker.record(context, [{ name: 'Bowl' }], usage);
  tracker.record(context, [{ name: 'Bowl' }], usage);
  tracker.record({ ...context, hexId: 'hex-b', restaurantId: 'restaurant-b' }, [{ name: 'Soup' }], usage);
  new PreloadCostTracker('other-run', 15, path).record(context, [{ name: 'Other' }], usage);
  const resumed = new PreloadCostTracker('run', 15, path);
  expect(resumed.total).toMatchObject({ costUsd: 0.033, requests: 3, itemAttempts: 3, inputTokens: 3000, outputTokens: 6000 });
  expect(resumed.forHex('hex-a').costUsd).toBe(0.022);
  expect(resumed.forRestaurant(context).costUsd).toBe(0.022);
  expect(resumed.costPer1kItems).toBe(11);
});

it('blocks at the exact cap across restarts until the cumulative cap is raised', () => {
  const tracker = new PreloadCostTracker('run', 0.011, path);
  tracker.assertCanSpend();
  tracker.record(context, [{ name: 'Bowl' }], usage);
  expect(() => tracker.assertCanSpend()).toThrow(SpendCapReached);
  expect(() => new PreloadCostTracker('run', 0.011, path).assertCanSpend()).toThrow(SpendCapReached);
  expect(() => new PreloadCostTracker('run', 0.022, path).assertCanSpend()).not.toThrow();
});

it('permits a zero-dollar cap and produces a finite empty summary', () => {
  const tracker = new PreloadCostTracker('run', 0, path);
  expect(() => tracker.assertCanSpend()).toThrow(SpendCapReached);
  expect(tracker.costPer1kItems).toBe(0);
});

it.each(['', ' ', '-1', 'NaN', 'Infinity', 'abc'])('rejects invalid spend caps: %s', raw => {
  expect(() => parseCostCap(raw)).toThrow('finite non-negative');
});

it('accepts decimal caps and defaults to $15', () => {
  expect(parseCostCap()).toBe(15);
  expect(parseCostCap('0.025')).toBe(0.025);
});

it.each([undefined, { ...usage, input_tokens: NaN }, { ...usage, output_tokens: -1 }])('fails closed on unavailable or invalid usage', value => {
  expect(() => costFromUsage(value as Anthropic.Usage)).toThrow(CostAccountingError);
});

it.each(['{"partial":', '{"bad":true}\n', '{bad json}\n'])('preserves corrupt ledgers instead of resetting spend', contents => {
  writeFileSync(path, contents);
  expect(() => new PreloadCostTracker('run', 15, path)).toThrow(CostAccountingError);
  expect(readFileSync(path, 'utf8')).toBe(contents);
});

it('stops on ledger write failures while retaining observed usage in memory', () => {
  const emit = jest.fn();
  const tracker = new PreloadCostTracker('run', 15, path, emit);
  rmSync(path); mkdirSync(path);
  expect(() => tracker.record(context, [{ name: 'Bowl' }], usage)).toThrow(CostAccountingError);
  expect(tracker.total.costUsd).toBe(0.011);
  expect(emit).toHaveBeenCalledTimes(1);
});

it('makes telemetry failures non-retryable after saving the paid response', () => {
  const tracker = new PreloadCostTracker('run', 15, path, () => { throw new Error('telemetry unavailable'); });
  expect(() => tracker.record(context, [{ name: 'Bowl' }], usage)).toThrow(CostAccountingError);
  expect(new PreloadCostTracker('run', 15, path).total.costUsd).toBe(0.011);
});

it.each(['runId', 'costUsd'])('rejects a ledger with missing or inconsistent billing identity: %s', key => {
  const tracker = new PreloadCostTracker('run', 15, path);
  tracker.record(context, [{ name: 'Bowl' }], usage);
  const event = JSON.parse(readFileSync(path, 'utf8'));
  if (key === 'runId') delete event.runId;
  else event.costUsd = 0;
  writeFileSync(path, JSON.stringify(event) + '\n');
  expect(() => new PreloadCostTracker('run', 15, path)).toThrow(CostAccountingError);
});
