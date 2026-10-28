/** Exact identities from chainPilot.db.test.ts, chainCatalogExpansion.db.test.ts and chainDefaults.db.test.ts.
 * No environment files are loaded, and connection strings never enter the report.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { realpathSync } from 'node:fs';
import { chainPilot } from '../../apps/api/services/chainPilotData';
import { compileChainProductBatch } from '../../apps/api/services/chainProductBatch';
import { assertDatabaseWriteAllowed, databaseTarget, DEV_PROJECT_REF, PROD_PROJECT_REF } from '../lib/db-target-guard';

const batch: typeof import('../../apps/api/services/chainCatalogs/waba-yoshinoya-2026-09.json') = require('../../apps/api/services/chainCatalogs/waba-yoshinoya-2026-09.json');
const april: typeof import('../../apps/api/tests/fixtures/__snapshots__/chain-pilot-april.json') = require('../../apps/api/tests/fixtures/__snapshots__/chain-pilot-april.json');
const qualityInput: typeof import('../../apps/api/services/chainCatalogs/chain-quality-2026-09-input.json') = require('../../apps/api/services/chainCatalogs/chain-quality-2026-09-input.json');
// chainDefaults uses the expansion brand identity and the same compiler, preserving each binding's chain.
const expansionCatalog = [...batch.changes, ...compileChainProductBatch(qualityInput).changes];

export const tables = ['SavedItem', 'MacroEstimate', 'MenuItem', 'Restaurant', 'ChainItem', 'Brand', 'PipelineCompletedHex'] as const;
type Table = typeof tables[number];
export type Counts = Record<Table, number>;
type Row = { id: string } & Record<string, unknown>;
type Ambiguous = { table: Table; row: Row; reason: string };
export type Options = { apply: boolean; expect?: Counts; urlEnv: string; prod: boolean };
class CleanupError extends Error {}
const refuse = (message: string): never => { throw new CleanupError(message); };
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const uuidPattern = new RegExp(`^${uuid}$`);
const brandPattern = `^(${uuid})(waba-grill|yoshinoya)$`;
const addresses = ['Captured fixture', 'Captured variant', 'Rollback fixture', 'New hex fixture'];
const slugs = ['waba-grill', 'yoshinoya'];

export function parseOptions(args: string[]): Options {
  const seen = new Set<string>();
  const options: Options = { apply: false, urlEnv: 'POSTGRES_PRISMA_URL', prod: false };
  for (const arg of args) {
    const key = arg.split('=')[0]!;
    if (seen.has(key)) refuse('Duplicate option');
    seen.add(key);
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') { /* The default. */ }
    else if (arg === '--prod') options.prod = true;
    else if (arg.startsWith('--url-env=')) {
      const name = arg.slice('--url-env='.length);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) refuse('Invalid environment variable name');
      options.urlEnv = name;
    } else if (arg.startsWith('--expect=')) {
      let value: unknown;
      try { value = JSON.parse(arg.slice('--expect='.length)); } catch { refuse('--expect must be a JSON object of counts for all seven tables'); }
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).length !== tables.length || tables.some(table =>
            !Object.hasOwn(value, table) || !Number.isSafeInteger((value as Counts)[table]) || (value as Counts)[table] < 0)) {
        refuse('--expect must contain exactly all seven table names with nonnegative integer counts');
      }
      options.expect = value as Counts;
    } else refuse('Unknown option; use --dry-run, --apply, --expect=<JSON>, --url-env=<NAME>, or --prod');
  }
  if (options.apply && seen.has('--dry-run')) refuse('--apply and --dry-run conflict');
  if (options.apply && !options.expect) refuse('--apply requires --expect=<JSON> from a reviewed dry run');
  return options;
}

/** Read-only discovery validates the route without authorizing mutations. */
export function cleanupReadTarget(value: string | undefined): string {
  const target = databaseTarget(value);
  if (![DEV_PROJECT_REF, PROD_PROJECT_REF].includes(target.ref ?? '') && !(target.local && !target.ref)) {
    refuse('Read target is outside the DEV/PROD/loopback allowlist');
  }
  return target.url;
}

type FixtureBrand = { id: string; slug: string; displayName: string; scope: string; chain: string; suite: 'pilot' | 'expansion' };
type RestaurantRow = { id: string; name: string; storeUuid: string; address: string; brandId: string | null; source: string; lat: number; lng: number };
export function checkpointMatches(row: { runId: string; hexId: string; count: number }, brands: FixtureBrand[]): boolean {
  return uuidPattern.test(row.runId) && row.count === 1 && brands.some(brand =>
    row.runId === brand.scope && row.hexId === (brand.suite === 'pilot' ? brand.scope + brand.chain : brand.chain));
}

export function restaurantMatches(row: RestaurantRow, brand: FixtureBrand): boolean {
  if (row.source !== 'ue_feed' || row.lat !== 34 || row.lng !== -118 ||
      (row.brandId !== null && row.brandId !== brand.id)) return false;
  const { scope, chain, suite, displayName } = brand;
  if (suite === 'pilot') {
    if (row.brandId === brand.id && row.address === 'Captured fixture' && april.some(f =>
      f.slug === chain && row.storeUuid === scope + f.restaurantId && row.name === scope + ' ' + f.restaurantName)) return true;
    if (chain === 'waba-grill' && row.brandId === brand.id && row.address === 'Rollback fixture' &&
        row.storeUuid === scope && row.name === displayName) return true;
  } else if (row.brandId === brand.id && row.address === 'Captured variant' && row.name === scope + chain &&
      row.storeUuid.slice(0, scope.length) === scope && uuidPattern.test(row.storeUuid.slice(scope.length)) && uuidPattern.test(row.id)) return true;
  return row.address === 'New hex fixture' && row.name === displayName + ' (New Location)' &&
    row.storeUuid === scope + (suite === 'pilot' ? brand.id : 'new-' + chain);
}

/** Only called with brands whose complete fixture identity was verified during discovery. */
export function chainItemMatches(row: { brandId: string; canonicalKey: string }, brand: FixtureBrand): boolean {
  const allowed = brand.suite === 'pilot' ? [...chainPilot.changes, ...chainPilot.quarantine] : expansionCatalog;
  return row.brandId === brand.id && allowed.some(f => f.slug === brand.chain && f.canonicalKey === row.canonicalKey);
}

export async function cleanupFixtures(p: PrismaClient, options: Options) {
  if (options.apply && !options.expect) refuse('--apply requires expected counts');
  return p.$transaction(async tx => {
    // Must precede every discovery query, even when the supplied role is already read-only.
    if (!options.apply) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [transaction] = await tx.$queryRaw<{ readOnly: string }[]>`SELECT current_setting('transaction_read_only') AS "readOnly"`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`;
    await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
    if (options.apply) {
      // Freeze the whole dependency closure so FK cascades/SET NULL cannot affect uncounted concurrent rows.
      await tx.$executeRaw`LOCK TABLE "Brand", "ChainItem", "Restaurant", "MenuItem", "MacroEstimate", "SavedItem", "PipelineCompletedHex" IN SHARE ROW EXCLUSIVE MODE`;
    }
    const rows: Record<Table, Row[]> = { Brand: [], ChainItem: [], Restaurant: [], MenuItem: [], MacroEstimate: [], SavedItem: [], PipelineCompletedHex: [] };
    const ambiguous: Ambiguous[] = [];
    const candidates = await tx.$queryRaw<{ id: string; slug: string; displayName: string; detectionConf: string | null }[]>`
      SELECT "id", "slug", "displayName", "detectionConf" FROM "Brand" WHERE "slug" ~ ${brandPattern} ORDER BY "id"`;
    const brands: FixtureBrand[] = [];
    for (const row of candidates) {
      const [, scope, chain] = new RegExp(brandPattern).exec(row.slug)!;
      const pilotName = scope + (chain === 'waba-grill' ? ' WaBa Grill' : ' Yoshinoya');
      if (row.detectionConf !== 'high' || ![pilotName, row.slug].includes(row.displayName)) {
        ambiguous.push({ table: 'Brand', row, reason: 'UUID-scoped slug has an unexpected display name or detection confidence' });
        continue;
      }
      brands.push({ ...row, scope: scope!, chain: chain!, suite: row.displayName === pilotName ? 'pilot' : 'expansion' });
      rows.Brand.push(row);
    }
    const restaurants = await tx.restaurant.findMany({ where: { OR: [
      { address: { in: addresses } }, { brandId: { in: candidates.map(b => b.id) } },
    ] }, select: { id: true, name: true, storeUuid: true, address: true, brandId: true, source: true, lat: true, lng: true }, orderBy: { id: 'asc' } });
    for (const row of restaurants) {
      if (brands.some(brand => restaurantMatches(row, brand))) rows.Restaurant.push(row);
      else ambiguous.push({ table: 'Restaurant', row, reason: 'Fixture address or brand link without the complete exact suite identity' });
    }
    const brandIds = brands.map(b => b.id), restaurantIds = rows.Restaurant.map(r => r.id);
    const chainItems = await tx.chainItem.findMany({ where: { brandId: { in: brandIds } },
      select: { id: true, brandId: true, canonicalKey: true }, orderBy: { id: 'asc' } });
    rows.ChainItem = chainItems;
    for (const row of chainItems) {
      const brand = brands.find(b => b.id === row.brandId)!;
      if (!chainItemMatches(row, brand)) {
        ambiguous.push({ table: 'ChainItem', row, reason: 'Catalog key is absent from this suite\'s exact manifest' });
      }
    }
    rows.MenuItem = await tx.menuItem.findMany({ where: { restaurantId: { in: restaurantIds } },
      select: { id: true, name: true, restaurantId: true, sourceItemId: true }, orderBy: { id: 'asc' } });
    // Expansion variant storeUuid includes the one random menu ID created for that location.
    for (const row of rows.Restaurant.filter(r => r['address'] === 'Captured variant')) {
      const items = rows.MenuItem.filter(item => item['restaurantId'] === row.id);
      if (items.length !== 1 || items[0]!.id !== (row['storeUuid'] as string).slice(36)) {
        ambiguous.push({ table: 'Restaurant', row, reason: 'Captured variant does not have its single storeUuid-bound menu item' });
      }
    }
    const menuIds = rows.MenuItem.map(r => r.id);
    rows.MacroEstimate = await tx.macroEstimate.findMany({ where: { menuItemId: { in: menuIds } },
      select: { id: true, menuItemId: true, source: true }, orderBy: { id: 'asc' } });
    rows.SavedItem = await tx.savedItem.findMany({ where: { OR: [
      { restaurantId: { in: restaurantIds } }, { menuItemId: { in: menuIds } },
    ] }, select: { id: true, restaurantId: true, menuItemId: true, itemType: true }, orderBy: { id: 'asc' } });
    for (const row of rows.SavedItem) ambiguous.push({ table: 'SavedItem', row, reason: 'These suites do not create bookmarks; preserve user-owned references and refuse apply' });
    const checkpoints = await tx.$queryRaw<{ id: string; runId: string; hexId: string; count: number }[]>`
      SELECT "id", "runId", "hexId", "count" FROM "PipelineCompletedHex"
      WHERE "hexId" IN (${Prisma.join(slugs)}) OR "hexId" ~ ${brandPattern} ORDER BY "id"`;
    for (const row of checkpoints) {
      if (checkpointMatches(row, brands)) {
        rows.PipelineCompletedHex.push(row);
      } else ambiguous.push({ table: 'PipelineCompletedHex', row, reason: 'Checkpoint lacks a verified fixture brand scope, suite-specific hex identity or count; preserve it' });
    }
    const counts = Object.fromEntries(tables.map(table => [table, rows[table].length])) as Counts;
    if (options.expect && tables.some(table => options.expect![table] !== counts[table])) refuse('Counts differ from --expect; no changes committed');
    if (options.apply) {
      if (ambiguous.length) refuse('Ambiguous rows found; inspect a fresh dry run before applying');
      // Explicit child-first deletes, each checked. SavedItem is always empty on an eligible apply.
      const deleteCounts: Counts = {
        SavedItem: 0,
        MacroEstimate: (await tx.macroEstimate.deleteMany({ where: { id: { in: rows.MacroEstimate.map(r => r.id) } } })).count,
        MenuItem: (await tx.menuItem.deleteMany({ where: { id: { in: menuIds } } })).count,
        Restaurant: (await tx.restaurant.deleteMany({ where: { id: { in: restaurantIds } } })).count,
        ChainItem: (await tx.chainItem.deleteMany({ where: { id: { in: rows.ChainItem.map(r => r.id) } } })).count,
        Brand: (await tx.brand.deleteMany({ where: { id: { in: brandIds } } })).count,
        PipelineCompletedHex: (await tx.pipelineCompletedHex.deleteMany({ where: { id: { in: rows.PipelineCompletedHex.map(r => r.id) } } })).count,
      };
      if (tables.some(table => deleteCounts[table] !== counts[table])) refuse('Delete counts changed; transaction rolled back');
    }
    return { mode: options.apply ? 'apply' : 'dry-run', transactionReadOnly: transaction!.readOnly === 'on', counts, rows, ambiguous };
  }, { isolationLevel: options.apply ? Prisma.TransactionIsolationLevel.Serializable : Prisma.TransactionIsolationLevel.RepeatableRead,
    timeout: 60_000, maxWait: 10_000 });
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  // Bind the actual datasource directly to the shared guard so the writer inventory can verify it.
  const url = options.apply
    ? assertDatabaseWriteAllowed(process.env[options.urlEnv], { args: options.prod ? ['--prod'] : [] })
    : cleanupReadTarget(process.env[options.urlEnv]);
  const p = new PrismaClient({ datasources: { db: { url } }, log: [], errorFormat: 'minimal' });
  try { process.stdout.write(JSON.stringify(await cleanupFixtures(p, options), null, 2) + '\n'); }
  finally { await p.$disconnect(); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename)) {
  void main().catch(error => {
    // Prisma/provider exceptions can include credentials or SQL. Only our bounded errors may be displayed.
    process.stderr.write((error instanceof CleanupError || (error instanceof Error && error.message.startsWith('DB_WRITE_REFUSED:'))
      ? error.message : 'Fixture cleanup failed; no success confirmed. Inspect connectivity/schema privately and rerun dry-run.') + '\n');
    process.exitCode = 1;
  });
}
