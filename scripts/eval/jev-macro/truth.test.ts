import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildMacroRequest } from './run';
import { buildTruth, loadTruth, nutritionQuantity, repository, sourcePaths, truthPath } from './truth';

test('truth is deterministic, official-only, distinct by serving, and includes the LA manufacturer labels', () => {
  const { truth } = loadTruth();
  expect(truth).toEqual(buildTruth());
  expect(truth.rows).toHaveLength(190);
  expect(truth.rows.filter(row => row.chain === 'WaBa Grill')).toHaveLength(88);
  expect(truth.rows.filter(row => row.chain === 'Yoshinoya')).toHaveLength(102);
  expect(new Set(truth.rows.map(row => row.id)).size).toBe(190);
  expect(truth.rows.filter(row => row.source.provenance === 'official-pdf')).toHaveLength(181);
  expect(truth.rows.filter(row => row.source.provenance === 'official-manufacturer-label')).toHaveLength(9);
  expect(truth.rows.every(row => row.source.publishedSha256.length === 64 && row.serving.length > 0)).toBe(true);
  expect(truth.sources.map(source => source.file)).toEqual(Object.values(sourcePaths));
  expect(JSON.stringify(truth.rows)).not.toMatch(/fatsecret/i);
  expect(truth.exclusions).toHaveLength(17);
  expect(truth.exclusions.find(row => row.id.endsWith('chocolate-chip-cookies-2'))?.reason).toContain('Derived serving');
  expect(truth.rows.find(row => row.id.endsWith('regular-bowls-on-white-rice-w-mixed-veggies/gyudon-beef-w-o-veg'))?.calories).toBe(646.4);
  expect(truth.rows.every(row => !nutritionQuantity.test([row.itemName, row.section, row.description, row.serving].join('\n')))).toBe(true);
  expect(truth.rows.find(row => row.id === 'waba-grill:packaged/poppi/raspberry-rose/12-fl-oz')!.description).not.toContain('35 calories');
  expect(truth.rows.find(row => row.id === 'yoshinoya:gyudon-beef-side')!.serving).toContain('198 g side (no rice)');
});

test('truth refuses changed nutrition and SHA-256 source changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'jev-truth-'));
  try {
    for (const file of [...Object.values(sourcePaths), truthPath]) {
      mkdirSync(dirname(resolve(root, file)), { recursive: true });
      writeFileSync(resolve(root, file), readFileSync(resolve(repository, file)));
    }
    const frozen = readFileSync(resolve(root, truthPath), 'utf8');
    const changed = JSON.parse(frozen); changed.rows[0].calories += 1;
    writeFileSync(resolve(root, truthPath), JSON.stringify(changed));
    expect(() => loadTruth(root)).toThrow('Frozen truth');
    writeFileSync(resolve(root, truthPath), frozen);
    writeFileSync(resolve(root, sourcePaths.observations), readFileSync(resolve(root, sourcePaths.observations), 'utf8') + '\n');
    expect(() => loadTruth(root)).toThrow('SHA-256');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('every request is invariant to truth, identity and provenance changes', () => {
  for (const row of loadTruth().truth.rows) {
    const request = buildMacroRequest(row);
    expect(Object.keys(request.state).sort()).toEqual(['chain', 'description', 'itemName', 'serving']);
    expect(buildMacroRequest({ ...row, id: 'DO NOT LEAK', calories: 123456, protein_g: 234567, carbs_g: 345678,
      fat_g: 456789, source: { ...row.source, locator: 'DO NOT LEAK' } })).toEqual(request);
    expect(JSON.stringify(request)).not.toContain('DO NOT LEAK');
    expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThanOrEqual(12_000);
  }
});
