import type { PrismaClient } from '@prisma/client';
import { getResolution, isValidCell, cellToLatLng } from 'h3-js';
import { approvedChainRow, buildChainMatcher } from '../../apps/api/services/chainCatalog';
import { buildBrandIdentityMatcher, officialMacro } from '../../apps/api/services/chainServing';
import { UeApiDirectSource } from '../../apps/api/services/menuSources/ueApiDirectSource';
import { computeMenuHash, menuItemIdentity } from '../../apps/api/services/menuSources/menuItemIdentity';
import type { MacroData, MenuSourceResult } from '../../apps/api/services/menuSources/types';
import { databaseTarget } from '../lib/db-target-guard';
import { persistHex, isHexComplete, type HexRestaurantData, type PersistHexOpts } from '../hex-persist';
import { DEV_POC_RUN_PREFIX } from '../hex-resume';
import { validateHexInTx } from '../preload-invariants';
import { validateItems } from '../pipeline-utils';
import { JEV_LIMITS } from '../eval/lib/jev-experiment';
import { digest, protocolHash, type V2Ledger } from './journal';
import { SharedUeRateLimiter } from './ue-rate-limiter';
import { v2Telemetry } from './telemetry';
import { PdfJobQueue } from './pdf-queue';

export interface V2Options { hexId: string; runId: string; out: string; capUsd: number }
export function validateV2Hex(hexId: string): void {
  if (!isValidCell(hexId) || getResolution(hexId) !== 7) throw new Error('An explicit resolution-7 LA hex is required');
  const [lat, lng] = cellToLatLng(hexId);
  if (lat < 33.95 || lat > 34.15 || lng < -118.50 || lng > -118.15) throw new Error('POC hex must be inside the LA discovery boundary');
}
export function validateV2RunId(runId: string): void {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(runId)) throw new Error('An explicit run-id is required');
}
export function validateV2Cap(capUsd: number): void {
  if (!Number.isFinite(capUsd) || capUsd < 0 || capUsd > 5) throw new Error('DEV POC cap must be between $0 and $5');
}
export function parseOptions(args: string[]): V2Options {
  const values = new Map<string, string>();
  for (const arg of args) {
    const match = /^--(hex-id|run-id|out|cost-cap-usd)=(.+)$/.exec(arg);
    if (!match || values.has(match[1]!)) throw new Error('Use unique --hex-id=HEX --run-id=ID --out=DIR [--cost-cap-usd=5]');
    values.set(match[1]!, match[2]!);
  }
  const hexId = values.get('hex-id') ?? '', runId = values.get('run-id') ?? '', out = values.get('out') ?? '';
  validateV2Hex(hexId); validateV2RunId(runId);
  if (!out) throw new Error('An explicit run-id and private output directory are required');
  const capUsd = Number(values.get('cost-cap-usd') ?? '5');
  validateV2Cap(capUsd);
  return { hexId, runId: `${DEV_POC_RUN_PREFIX}${runId}`, out, capUsd };
}

export function targetIdentity(url: string): string {
  const target = databaseTarget(url), parsed = new URL(url);
  return digest([target.ref ?? 'loopback', parsed.host, parsed.pathname, parsed.username]);
}

export async function loadV2Catalog(prisma: Pick<PrismaClient, 'brand' | 'chainItem'>) {
  const brands = await prisma.brand.findMany({ where: { detectionConf: { in: ['high', 'llm-confirmed'] }, menuKind: 'restaurant' } });
  const rows = await prisma.chainItem.findMany({ where: { brandId: { in: brands.map(b => b.id) }, source: 'official' } });
  // Published facts and eligible reviewed aliases are different coverage measures.
  const published = new Set(rows.filter(row => row.officialUrl?.startsWith('https://') && row.servingSize?.trim()
    && [row.calories, row.proteinG, row.carbsG, row.fatG].every(n => n !== null && Number.isFinite(n) && n >= 0)).map(row => row.brandId));
  return { brands, published, identity: buildBrandIdentityMatcher(brands), match: buildChainMatcher(rows),
    reviewedBrands: new Set(rows.filter(row => (approvedChainRow(row)?.review.aliases.length ?? 0) > 0).map(row => row.brandId)).size };
}

export interface HexCoverage {
  restaurants: number; menus: number; emptyMenus: number; rawItems: number; uniqueItems: number;
  officialItems: number; jevItems: number; rejectedItems: number; persistedItems: number;
  chainsWithPublishedData: number; chainsWithoutPublishedData: number; independentRestaurants: number;
}
export async function runV2Hex(prisma: PrismaClient, options: V2Options, journal: V2Ledger,
  persistence: PersistHexOpts & { beforePersist?: () => Promise<void> } = {}) {
  const start = performance.now();
  const rateLimiter = new SharedUeRateLimiter(prisma, async event => {
    await journal.append({ ...event });
    v2Telemetry.throttle('uber_eats', { status: event.status, runId: options.runId, hexId: options.hexId });
  });
  // Honor the explicit hex's checkpoint too. --hex-id never overrides resume.
  if (await isHexComplete(options.runId, options.hexId, prisma)) {
    const completed = [...journal.events].reverse().find(e => e.event === 'completed');
    const saved = completed ?? [...journal.events].reverse().find(e => e.event === 'prepared');
    if (!saved) throw new Error('Checkpoint has no source-bound POC report; inspect before resuming');
    return { ...saved.report as Record<string, unknown>, status: 'completed', resumedCheckpoint: true,
      wallTimeComplete: Boolean(completed) && (saved.report as Record<string, unknown>).wallTimeComplete !== false,
      recoveredFrom: completed ? 'completed-report' : 'prepared-before-commit' };
  }
  const coverage: HexCoverage = { restaurants: 0, menus: 0, emptyMenus: 0, rawItems: 0, uniqueItems: 0,
    officialItems: 0, jevItems: 0, rejectedItems: 0, persistedItems: 0, chainsWithPublishedData: 0, chainsWithoutPublishedData: 0, independentRestaurants: 0 };
  const sourceMix = { official: 0, jev: 0, other: 0 };
  const matches: Record<string, unknown>[] = [], rejections: Record<string, unknown>[] = [];
  const previousWallMs = journal.events.filter(e => e.event === 'attempt_end').reduce((sum, e) => sum + Number(e.wallMs), 0);
  const interruptedAttempts = journal.events.filter(e => e.event === 'attempt_start').length - journal.events.filter(e => e.event === 'attempt_end').length;
  await journal.append({ event: 'attempt_start', at: new Date().toISOString() });
  const report = (status: string) => ({ version: 2, environment: 'dev', runId: options.runId, hexId: options.hexId, status,
    source: [...journal.events].reverse().find(e => e.event === 'source') ?? null,
    model: JEV_LIMITS.requiredModel, protocolHash, pricing: JEV_LIMITS.pricing,
    coverage, sourceMix, officialCoverage: coverage.uniqueItems ? coverage.officialItems / coverage.uniqueItems : 0,
    persistedCoverage: coverage.uniqueItems ? coverage.persistedItems / coverage.uniqueItems : 0,
    calls: { uberEats: journal.events.filter(e => e.event === 'ue_request').length, jev: journal.requests,
      pdfSearch: 0, reusedJev: journal.reusedRequests },
    ueThrottles: journal.events.filter(e => e.event === 'ue_throttle').length,
    costUsd: journal.unknown ? null : journal.knownUsd, knownCostUsd: journal.knownUsd,
    unknownUsage: journal.unknown, capUsd: options.capUsd, wallMs: previousWallMs + performance.now() - start,
    wallTimeComplete: interruptedAttempts === 0, interruptedAttempts,
    matches, rejections, wrongMatches: null, matchAudit: 'Inspect the retained official serving evidence before claiming zero wrong matches',
    pdfJobs: journal.events.filter(e => e.event === 'pdf_search_enqueued'),
    notes: 'Verified chains without published data enter the shared async PDF queue; PDF search runs separately from the hex worker.' });
  try {
    if (journal.unknown || journal.stopped) throw new Error('Prior Jev accounting failure requires reconciliation');
    const catalog = await loadV2Catalog(prisma);
    const restaurants = await prisma.restaurant.findMany({ where: { source: 'ue_feed', homeHex: options.hexId, menuKind: 'restaurant' }, orderBy: { id: 'asc' } });
    if (!restaurants.length) throw new Error('Selected hex has no discovered UE restaurants');
    coverage.restaurants = restaurants.length;
    const results: HexRestaurantData[] = [];
    for (const restaurant of restaurants) {
      journal.signal?.throwIfAborted();
      const brandId = catalog.identity(restaurant), hasPublished = brandId !== undefined && catalog.published.has(brandId);
      if (hasPublished) coverage.chainsWithPublishedData++;
      else if (brandId) {
        coverage.chainsWithoutPublishedData++;
        await new PdfJobQueue(prisma).enqueue(brandId);
        await journal.enqueuePdf(catalog.brands.find(b => b.id === brandId)!);
      }
      else coverage.independentRestaurants++;
      const savedMenu = journal.events.find(e => e.event === 'ue_menu' && e.restaurantId === restaurant.id && e.storeUuid === restaurant.storeUuid);
      const menu = savedMenu ? savedMenu.menu as MenuSourceResult : await new UeApiDirectSource(restaurant.storeUuid!, { maxRetries: 0,
        rateLimiter,
        ...(journal.signal ? { signal: journal.signal } : {}),
        onRequest: () => journal.append({ event: 'ue_request', at: new Date().toISOString(), restaurantId: restaurant.id }) }).lookup(restaurant.name, restaurant.address);
      if (!savedMenu) await journal.append({ event: 'ue_menu', restaurantId: restaurant.id, storeUuid: restaurant.storeUuid, menu });
      if (!menu.found) { coverage.emptyMenus++; continue; }
      coverage.menus++; coverage.rawItems += menu.items.length;
      const items = [...new Map(menu.items.map(item => [menuItemIdentity(item), item])).values()];
      coverage.uniqueItems += items.length;
      const macros: MacroData[] = [];
      for (const item of items) {
        const match = catalog.match(hasPublished ? brandId : undefined, item, restaurant);
        if (match.status === 'matched') {
          macros.push(officialMacro(match.row, item)); coverage.officialItems++;
          matches.push({ restaurantId: restaurant.id, name: item.name, section: item.section ?? null, description: item.description ?? null,
            sourceItemId: item.sourceItemId ?? null, chainItemId: match.row.id, servingSize: match.row.servingSize,
            sourceUrl: match.row.officialUrl, sourceHash: match.row.review.sourceHash, reviewHash: match.row.review.dataHash, locator: match.row.review.locator });
        } else {
          journal.context = `${restaurant.id}:${menuItemIdentity(item)}`;
          const estimate = await journal.estimator.estimate({ chain: restaurant.name, name: item.name, section: item.section ?? '',
            description: item.description ?? '', region: 'Los Angeles, CA, US', serving: 'one menu item as described, including its named size and components' });
          if (!estimate) throw new Error('Jev overflow or incomplete estimate; leave the hex pending');
          macros.push({ calories: estimate.calories, proteinG: estimate.protein, carbsG: estimate.carbs, fatG: estimate.fat,
            source: 'jev', confidence: 'LOW', dietaryTags: [], reasoning: JSON.stringify({ kind: 'jev-v3-estimate', model: JEV_LIMITS.requiredModel,
              protocol: 'coarse-then-fine-argmax', quantization: { caloriesKcal: 25, macrosG: 2 }, estimated: true }) });
          coverage.jevItems++;
        }
      }
      const validated = validateItems(items, macros);
      for (const entry of validated.valid) {
        const source = entry.macro.source;
        sourceMix[source === 'official' || source === 'jev' ? source : 'other']++;
      }
      coverage.rejectedItems += validated.rejected.length;
      rejections.push(...validated.rejected.map(item => ({ restaurantId: restaurant.id, ...item })));
      if (!validated.valid.length) throw new Error('Menu has no valid sourced food; leave the hex pending');
      results.push({ restaurantId: restaurant.id, ...(brandId ? { brandId } : {}), items: validated.valid, menuHash: computeMenuHash(menu.items) });
    }
    if (!results.length) throw new Error('No sourced menus; leave the hex pending');
    coverage.persistedItems = results.reduce((sum, r) => sum + r.items.length, 0);
    // Prepare before commit: a process dying just after the atomic checkpoint can still recover its report.
    const prepared = { ...report('prepared'), catalog: { brands: catalog.brands.length, publishedBrands: catalog.published.size, reviewedBrands: catalog.reviewedBrands } };
    await journal.append({ event: 'prepared', at: new Date().toISOString(), report: prepared });
    await persistence.beforePersist?.();
    await persistHex(options.runId, options.hexId, results, prisma, { ...persistence, validateInTx: validateHexInTx });
    const complete = { ...prepared, ...report('completed') };
    await journal.append({ event: 'completed', at: new Date().toISOString(), report: complete });
    return complete;
  } catch (error) {
    coverage.persistedItems = 0;
    const safeMessages = ['TYPESAFE_API_KEY is required', 'Selected hex has no discovered UE restaurants',
      'Jev overflow or incomplete estimate; leave the hex pending', 'Menu has no valid sourced food; leave the hex pending',
      'No sourced menus; leave the hex pending', 'Nutrition target in estimator input'];
    const failureReason = journal.runCap ? 'Cumulative run budget unavailable; retain the hex for operator inspection'
      : journal.dailyCap ? `Daily ${journal.dailyCap} budget exhausted; resume next UTC day` : journal.unknown ? 'Unknown Jev spend; retain and reconcile the journal before resuming'
      : journal.stopped ?? (error instanceof Error && safeMessages.includes(error.message) ? error.message
        : error instanceof Error && error.name === 'UeUnexpectedError' ? 'UE menu fetch or parsing failed'
          : 'Execution or database failure; inspect the private command diagnostics before resuming');
    const failed = { ...report(journal.runCap ? 'run_cap' : journal.dailyCap ? 'daily_cap' : journal.stopped?.includes('spend cap') ? 'spend_cap' : 'failed'), failure: error instanceof Error ? error.name : 'UnknownError', failureReason };
    await journal.append({ event: 'failed', at: new Date().toISOString(), report: failed });
    return failed;
  } finally { await journal.append({ event: 'attempt_end', at: new Date().toISOString(), wallMs: performance.now() - start }); }
}
