/** Read-only audit of retained getStoreV1 captures, before any title-based parsing or persistence. */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Capture {
  capturedAt: string;
  restaurant: { storeUuid: string; name: string };
  captured: { data: {
    location?: { latitude?: number; longitude?: number };
    catalogSectionsMap?: Record<string, { payload?: { standardItemsPayload?: {
      title?: { text?: string };
      catalogItems?: { uuid?: string; title?: string; price?: number }[];
    } } }[]>;
  } };
}
export interface CaptureInput { file: string; sha256: string; capture: Capture }

/** LA rollout bounding box, stated explicitly rather than inferring a city from a restaurant title. */
export const LA_AUDIT_BOUNDS = { minLat: 33.7, maxLat: 34.35, minLng: -118.75, maxLng: -117.65 };

export function auditMenuSourceCollisions(inputs: CaptureInput[]) {
  const latest = new Map<string, CaptureInput>();
  let outsideLa = 0, missingGeo = 0;
  for (const input of inputs) {
    const { latitude: lat, longitude: lng } = input.capture.captured.data.location ?? {};
    if (typeof lat !== 'number' || typeof lng !== 'number') { missingGeo++; continue; }
    if (lat < LA_AUDIT_BOUNDS.minLat || lat > LA_AUDIT_BOUNDS.maxLat || lng < LA_AUDIT_BOUNDS.minLng || lng > LA_AUDIT_BOUNDS.maxLng) {
      outsideLa++; continue;
    }
    const key = input.capture.restaurant.storeUuid;
    const previous = latest.get(key);
    if (!previous || input.capture.capturedAt > previous.capture.capturedAt) latest.set(key, input);
  }
  const menus = [...latest.values()].sort((a, b) => a.file.localeCompare(b.file)).map(({ file, sha256, capture }) => {
    const byName = new Map<string, Map<string, { id: string; price: number | null; sections: string[] }>>();
    const ids = new Set<string>(), retainedIds = new Set<string>(), oldNames = new Set<string>();
    let placements = 0, missingSourceIds = 0;
    for (const section of Object.values(capture.captured.data.catalogSectionsMap ?? {}).flat()) {
      const payload = section.payload?.standardItemsPayload;
      for (const raw of payload?.catalogItems ?? []) {
        const name = raw.title?.trim();
        if (!name) continue;
        placements++;
        const key = name.toLowerCase(), id = raw.uuid?.trim();
        // This models the old parser's first-title-wins rule, including ID-less first placements.
        if (!oldNames.has(key)) { if (id) retainedIds.add(id); oldNames.add(key); }
        if (!id) { missingSourceIds++; continue; }
        ids.add(id);
        const products = byName.get(key) ?? new Map();
        const product = products.get(id) ?? { id, price: typeof raw.price === 'number' ? raw.price / 100 : null, sections: [] };
        const sectionName = payload?.title?.text;
        if (sectionName && !product.sections.includes(sectionName)) product.sections.push(sectionName);
        products.set(id, product);
        byName.set(key, products);
      }
    }
    const collisions = [...byName].filter(([, products]) => products.size > 1)
      .map(([name, products]) => ({ name, products: [...products.values()] }));
    return { file, sha256, capturedAt: capture.capturedAt, storeUuid: capture.restaurant.storeUuid,
      restaurant: capture.restaurant.name, placements, uniqueSourceProducts: ids.size, oldNameCount: oldNames.size,
      missingSourceIds, collisionGroups: collisions.length,
      priceDistinctGroups: collisions.filter(group => new Set(group.products.map(p => p.price)).size > 1).length,
      lostSourceProducts: [...ids].filter(id => !retainedIds.has(id)).length, collisions };
  });
  return {
    scope: 'Retained LA source captures only; not a live production census or proof of distinct servings for every UUID.',
    bounds: LA_AUDIT_BOUNDS, inputFiles: inputs.length, outsideLa, missingGeo,
    supersededCaptures: inputs.length - outsideLa - missingGeo - menus.length,
    menusAudited: menus.length, affectedMenus: menus.filter(m => m.collisionGroups > 0).length,
    placements: menus.reduce((n, m) => n + m.placements, 0),
    uniqueSourceProducts: menus.reduce((n, m) => n + m.uniqueSourceProducts, 0),
    collisionGroups: menus.reduce((n, m) => n + m.collisionGroups, 0),
    priceDistinctGroups: menus.reduce((n, m) => n + m.priceDistinctGroups, 0),
    lostSourceProducts: menus.reduce((n, m) => n + m.lostSourceProducts, 0),
    menus,
  };
}

if (require.main === module) {
  const [directory, output, ...extra] = process.argv.slice(2);
  if (!directory || !output || extra.length) throw new Error('Usage: npm run audit:menu-identity -- <capture-directory> <report.json>');
  const inputs: CaptureInput[] = readdirSync(directory).filter(file => file.endsWith('.json')).sort().map(file => {
    const bytes = readFileSync(join(directory, file));
    const capture: Capture = JSON.parse(bytes.toString());
    if (!capture.restaurant?.storeUuid || !capture.restaurant.name || !Number.isFinite(Date.parse(capture.capturedAt)) || !capture.captured?.data?.catalogSectionsMap) {
      throw new Error(`Not a timestamped raw UE menu capture: ${file}`);
    }
    return { file, sha256: createHash('sha256').update(bytes).digest('hex'), capture };
  });
  const report = auditMenuSourceCollisions(inputs);
  if (!report.menusAudited) throw new Error('No retained LA menus with coordinates; refusing an empty collision report');
  const { menus, ...summary } = report;
  // One line per menu keeps the source-bound machine report reviewable without a huge pretty-print diff.
  const header = JSON.stringify({ generatedBy: 'scripts/menu-source-collisions.ts', measuredAt: new Date().toISOString(), ...summary }, null, 2);
  writeFileSync(output, header.slice(0, -1).trimEnd() + ',\n  "menus": [\n' +
    menus.map(menu => '    ' + JSON.stringify(menu)).join(',\n') + '\n  ]\n}\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
}
