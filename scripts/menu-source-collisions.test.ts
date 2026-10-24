import { auditMenuSourceCollisions, type CaptureInput } from './menu-source-collisions';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function capture(file: string, storeUuid: string, capturedAt: string, lat = 34): CaptureInput {
  return { file, sha256: 'a'.repeat(64), capture: { capturedAt, restaurant: { storeUuid, name: 'LA menu' }, captured: { data: {
    location: { latitude: lat, longitude: -118.3 }, catalogSectionsMap: { menu: [{ payload: { standardItemsPayload: {
      title: { text: 'Menu' }, catalogItems: [
        { title: 'Pasta', uuid: 'small', price: 1800 }, { title: 'Pasta', uuid: 'small', price: 1800 },
        { title: 'PASTA', uuid: 'family', price: 6300 }, { title: 'Soup' },
      ],
    } } }] },
  } } } };
}
test('raw source collisions distinguish repeated placements, source products and price variants', () => {
  const result = auditMenuSourceCollisions([capture('la.json', 'la', '2026-10-24')]);
  expect(result).toMatchObject({ menusAudited: 1, affectedMenus: 1, placements: 4, uniqueSourceProducts: 2,
    collisionGroups: 1, priceDistinctGroups: 1, lostSourceProducts: 1 });
  expect(result.menus[0]).toMatchObject({ missingSourceIds: 1, oldNameCount: 2 });
  expect(result.menus[0]!.collisions[0]!.products).toHaveLength(2);
});
test('store-scoped newest captures are audited once and non-LA menus are excluded', () => {
  const result = auditMenuSourceCollisions([capture('old', 'la', '2026-09-01'), capture('new', 'la', '2026-10-24'),
    capture('sf', 'sf', '2026-10-24', 37.7), capture('other-la', 'other-la', '2026-10-24')]);
  expect(result).toMatchObject({ menusAudited: 2, supersededCaptures: 1, outsideLa: 1, lostSourceProducts: 2 });
  expect(result.menus.map(m => m.file)).toEqual(['new', 'other-la']);
});

test('the root audit command writes a source-bound report and refuses to overwrite evidence or report empty LA coverage', () => {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-menu-audit-'));
  try {
    const captures = join(root, 'captures'), output = join(root, 'report.json');
    mkdirSync(captures);
    writeFileSync(join(captures, 'la.json'), JSON.stringify(capture('la', 'la', '2026-10-24').capture));
    const run = () => spawnSync('npm', ['run', 'audit:menu-identity', '--', captures, output], {
      cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 15_000,
    });
    const first = run();
    expect(first.status).toBe(0);
    const bytes = readFileSync(output, 'utf8'), report = JSON.parse(bytes);
    expect(report).toMatchObject({ menusAudited: 1, lostSourceProducts: 1, generatedBy: 'scripts/menu-source-collisions.ts' });
    expect(report.menus[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(run().status).not.toBe(0);
    expect(readFileSync(output, 'utf8')).toBe(bytes);
    rmSync(output);
    writeFileSync(join(captures, 'la.json'), JSON.stringify(capture('sf', 'sf', '2026-10-24', 37.7).capture));
    expect(run().status).not.toBe(0);
    expect(existsSync(output)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
