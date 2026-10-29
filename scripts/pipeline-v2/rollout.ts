import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { cellArea, cellToLatLng, cellToParent, gridDisk, gridDistance, latLngToCell, polygonToCells, UNITS } from 'h3-js';
import { z } from 'zod';
import { chainUsState } from '../../apps/api/services/chainGeography';
import * as input from './rollout-input.json';
import { baselineFromPoc, baselineSchema, estimatePhase } from './rollout-estimate';
import { priorityJobSchema, rolloutPhases, type PriorityJob, type RolloutPhase } from './rollout-priority';

type StateMask = { states: { code: string; polygons: { rings: number[][][] }[] }[] };
export interface Demand { hexId: string; restaurants: number; population: number }
const inventorySchema = z.object({
  source: z.string().min(1), capturedAt: z.string().datetime(),
  hexes: z.array(priorityJobSchema.pick({ hexId: true }).extend({
    restaurants: z.number().int().nonnegative(), population: z.number().int().nonnegative(),
  }).strict()).min(1).refine(rows => new Set(rows.map(row => row.hexId)).size === rows.length, 'Duplicate inventory hex'),
}).strict();
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const maskPath = resolve(__dirname, '../../apps/api/services/chainUsStates.generated.json.gz');

/** Reuse the maintained Census mask, including Alaska across the antimeridian and Hawaii. */
export function usHexes(mask: StateMask, resolution = 7): string[] {
  const cells = new Set<string>();
  for (const state of mask.states) {
    if (['AS', 'GU', 'MP', 'PR', 'VI'].includes(state.code)) continue;
    for (const polygon of state.polygons) {
      const rings = polygon.rings.map(ring => ring.map(([lng, lat]) => [((lng! + 180) % 360 + 360) % 360 - 180, lat!]));
      for (const cell of polygonToCells(rings, resolution, true)) cells.add(cell);
    }
  }
  return [...cells].sort();
}

export interface RankedHex extends PriorityJob { phase: RolloutPhase; metro: string | null }
/** LA first, then metro population; measured restaurant density refines each metro and the remainder. */
export function rankHexes(cells: string[], demand: Demand[] = []): RankedHex[] {
  const remaining = new Set(cells), byHex = new Map(demand.map(row => [row.hexId, row]));
  const ranked: Omit<RankedHex, 'priority'>[] = [];
  const density = (id: string) => (byHex.get(id)?.restaurants ?? 0) / cellArea(id, UNITS.km2);
  const compare = (a: string, b: string) => density(b) - density(a)
    || (byHex.get(b)?.population ?? 0) - (byHex.get(a)?.population ?? 0) || a.localeCompare(b);
  const append = (ids: string[], phase: RolloutPhase, metro: string | null, center?: string) => {
    ids.filter(id => remaining.has(id)).sort((a, b) => density(b) - density(a)
      || (byHex.get(b)?.population ?? 0) - (byHex.get(a)?.population ?? 0)
      || (center ? gridDistance(center, a) - gridDistance(center, b) : 0) || a.localeCompare(b))
      .forEach(hexId => { remaining.delete(hexId); ranked.push({ hexId, phase, metro }); });
  };
  const la = input.metros.find(metro => metro.id === 'los-angeles')!;
  const laCenter = latLngToCell(la.lat, la.lng, 7);
  append(gridDisk(laCenter, 1), 'la-pilot', la.id, laCenter);
  append(gridDisk(laCenter, la.rings), 'la-metro', la.id, laCenter);
  for (const metro of input.metros.filter(m => m.id !== la.id).sort((a, b) => b.population - a.population || a.id.localeCompare(b.id))) {
    const center = latLngToCell(metro.lat, metro.lng, 7);
    append(gridDisk(center, metro.rings), 'top-metros', metro.id, center);
  }
  // Avoid recomputing density/area in O(n log n) comparisons when no inventory exists.
  const rest = [...remaining];
  if (demand.length) rest.sort(compare); else rest.sort();
  for (const hexId of rest) ranked.push({ hexId, phase: 'rest-us', metro: null });
  if (ranked.length > 2147483647) throw new Error('Priority inventory exceeds queue integer range');
  return ranked.map((row, i) => ({ ...row, priority: ranked.length - i }));
}

export function runRolloutCommand(args: string[]): unknown {
  const values = new Map<string, string>();
  for (const arg of args.slice(1)) {
    const match = /^--(out|poc|inventory)=(.+)$/.exec(arg);
    if (!match || values.has(match[1]!)) throw new Error('Use rollout --out=NEW_DIR [--poc=REPORT] [--inventory=JSON]');
    values.set(match[1]!, match[2]!);
  }
  if (args[0] !== 'rollout' || !values.get('out')) throw new Error('Rollout requires an explicit output directory');
  const out = resolve(values.get('out')!);
  if (existsSync(out)) throw new Error('Rollout output directory already exists; retain it and select a new directory');
  const sourceFiles = ['rollout.ts', 'rollout-estimate.ts', 'rollout-priority.ts', 'rollout-input.json']
    .map(file => join(__dirname, file)).concat(resolve(__dirname, '../../package-lock.json'), maskPath);
  const sourceHashes = sourceFiles.map(file => hash(readFileSync(file)));
  const pocBytes = values.has('poc') ? readFileSync(values.get('poc')!) : undefined;
  const baseline = pocBytes ? baselineFromPoc(JSON.parse(pocBytes.toString('utf8'))) : baselineSchema.parse(input.scenario);
  const inventoryBytes = values.has('inventory') ? readFileSync(values.get('inventory')!) : undefined;
  const inventory = inventoryBytes ? inventorySchema.parse(JSON.parse(inventoryBytes.toString('utf8'))) : undefined;
  const maskBytes = readFileSync(maskPath);
  const cells = inventory ? inventory.hexes.map(row => {
    const [lat, lng] = cellToLatLng(row.hexId);
    const state = chainUsState({ lat, lng });
    if (!state || ['AS', 'GU', 'MP', 'PR', 'VI'].includes(state)) throw new Error('Inventory contains a hex outside or on an uncertain US state border');
    return row.hexId;
  }) : usHexes(JSON.parse(gunzipSync(maskBytes).toString('utf8')) as StateMask);
  const ranked = rankHexes(cells, inventory?.hexes);
  const sourceHash = hash(JSON.stringify({ input, mask: hash(maskBytes), poc: pocBytes ? hash(pocBytes) : null,
    inventory: inventoryBytes ? hash(inventoryBytes) : null, implementation: sourceHashes }));
  if (sourceFiles.some((file, i) => hash(readFileSync(file)) !== sourceHashes[i])) throw new Error('Rollout source changed during generation; freeze inputs and regenerate');
  // A fresh directory preserves prior source-bound planning evidence and batches.
  mkdirSync(dirname(out), { recursive: true, mode: 0o700 });
  mkdirSync(out, { mode: 0o700 });
  const phases = rolloutPhases.map(phase => {
    const phaseRows = ranked.filter(row => row.phase === phase);
    const probes = new Set(phaseRows.map(row => cellToParent(row.hexId, 5)));
    const eligible = inventory ? new Map(inventory.hexes.filter(row => row.restaurants > 0).map(row => [row.hexId, row.restaurants])) : undefined;
    const jobs = eligible ? phaseRows.filter(row => eligible.has(row.hexId)) : phaseRows;
    const batches: { file: string; hexes: number; sha256: string }[] = [];
    for (let offset = 0; offset < jobs.length; offset += 1000) {
      const file = `${phase}-${String(offset / 1000 + 1).padStart(4, '0')}.json`;
      const batch = JSON.stringify({ version: 1, phase, sourceHash,
        jobs: jobs.slice(offset, offset + 1000).map(({ hexId, priority }) => ({ hexId, priority })) }) + '\n';
      writeFileSync(join(out, file), batch, { mode: 0o600, flag: 'wx' });
      batches.push({ file, hexes: Math.min(1000, jobs.length - offset), sha256: hash(batch) });
    }
    return { ...estimatePhase(phase, phaseRows.length, probes.size, baseline, eligible ? {
      hexes: jobs.length, restaurants: jobs.reduce((sum, row) => sum + eligible.get(row.hexId)!, 0),
    } : undefined),
      priorityHexes: jobs.length, batches };
  });
  const summary = { version: 1, sourceHash, baselineKind: pocBytes ? 'poc-report' : 'unmeasured-scenario', baseline,
    geography: inventory ? 'supplied-inventory-only' : '50-states-and-DC-center-mask',
    inventory: inventory ? { source: inventory.source, capturedAt: inventory.capturedAt } : null,
    queueScope: 'DEV LA only; other phases require regional worker and discovery acceptance',
    populationSource: input.populationSource, capacity: input.capacity, phases };
  writeFileSync(join(out, 'plan.json'), JSON.stringify(summary, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { out, sourceHash, baselineKind: summary.baselineKind, phases: phases.map(({ batches, ...phase }) => ({ ...phase, batches: batches.length })) };
}
