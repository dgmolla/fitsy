import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { numberOf, parseHtml, parsePdfText } from './parse';
import { buildReview, type Download } from './types';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const source: Download = { requestedUrl: 'https://chain.example.org/nutrition.pdf', url: 'https://chain.example.org/nutrition.pdf',
  sha256: 'a'.repeat(64), file: 'source.pdf', bytes: 100, contentType: 'application/pdf' };

describe('deterministic source extraction', () => {
  test('reads the real wrapped Wahoo header and names, retaining decimals and physical pages', () => {
    const result = parsePdfText(fixture('wahoos.txt'));
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({ name: 'Loaded Nachos Blackened Chicken Black Beans', section: 'Shared Plates',
      calories: 1303.75, proteinG: 66.54, carbsG: 98.78, fatG: 69.09, servingSize: null, page: 2 });
    expect(result.items[2]).toMatchObject({ name: 'Loaded Quesadilla Vegetarian Brown Rice and Black Beans',
      calories: 800.54, proteinG: 32.64, carbsG: 77.4, fatG: 38.95 });
    const item = result.items[2]!;
    expect(fixture('wahoos.txt').split('\f')[item.page! - 1]!.split('\n').slice(item.lineStart - 1, item.lineEnd).join('\n')).toBe(item.rawText);
  });

  test('Claim Jumper columns do not confuse calories-from-fat with protein', () => {
    const result = parsePdfText(fixture('claim-jumper.txt'));
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({ name: 'BBQ Chicken Sliders', section: 'APPETIZERS',
      calories: 663, proteinG: 37, carbsG: 95, fatG: 14 });
  });

  test('parses labelled serving columns and rejects incomplete or ambiguous values', () => {
    const header = 'Item  Serving Size (g)  Calories  Protein (g)  Carbs (g)  Total Fat (g)\n';
    const result = parsePdfText(header + 'Plate  200  450  30  60  10\nLess than  200  450  <1  60  10\nRagged  200  450  30  60\n');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'Plate', servingSize: '200 g', proteinG: 30 });
    expect(result.diagnostics).toHaveLength(2);
    expect(parsePdfText('Item  Calories  Sodium  Sugar  Fiber\nPlate  100  200  3  4\n').items).toEqual([]);
  });

  test('preserves item names beginning with digits and containing Protein', () => {
    const result = parsePdfText('Item  Calories  Protein (g)  Carbs (g)  Total Fat (g)\n'
      + '3 Egg Omelette  450  30  60  10\nProtein Bowl\n  450  30  60  10\n');
    expect(result.items.map(row => row.name)).toEqual(['3 Egg Omelette', 'Protein Bowl']);
  });

  test('retains explicit portions without rescaling published macros', () => {
    const result = parsePdfText('Item  Calories  Protein (g)  Carbs (g)  Total Fat (g)\n'
      + 'Bacon (2 tablespoons)  70  0  0  10\nCake (10 slices)  1000  20  150  30\n');
    expect(result.items.map(row => row.servingSize)).toEqual(['2 tablespoons', '10 slices']);
    expect(result.items[1]!.calories).toBe(1000);
  });

  test('an unsupported later table cannot inherit the preceding column order', () => {
    const result = parsePdfText('Item  Calories  Protein (g)  Carbs (g)  Fat (g)\n'
      + 'Known  450  30  60  10\n\fCalories Carbs Protein Fat\nUnlabelled  450  60  30  10\n');
    expect(result.items.map(row => row.name)).toEqual(['Known']);
    expect(result.diagnostics.some(row => row.reason.includes('layout cleared'))).toBe(true);
  });

  test('HTML tables map full headers and distinguish saturated from total fat', () => {
    const result = parseHtml(fixture('table.html'));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'Rice & Chicken', calories: 410, proteinG: 35, carbsG: 45, fatG: 10, servingSize: '250 g', section: 'Lunch', page: null });
    expect(result.diagnostics).toHaveLength(3);
    const item = result.items[0]!;
    expect(result.text.split('\n')[item.lineStart - 1]).toBe(item.rawText);
  });

  test('HTML label/value cards retain portion and regional notes without inventing missing protein', () => {
    const result = parseHtml(fixture('cards.html'));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ name: 'Mini Pasta', section: 'Kids', servingSize: '227g',
      calories: 310, proteinG: 10, carbsG: 59, fatG: 2.5 });
    expect(result.items[0]!.notes).toContain('Special Notes: California only');
    expect(result.diagnostics).toHaveLength(1);
  });

  test.each(['<1g', '1-2g', '-1', 'NaN', '', 'N/A', '10mg', '1,23'])('does not turn %p into a precise macro', value => {
    expect(numberOf(value)).toBeNull();
  });

  test('review drafts preserve catalog fields and source identity without any approval or aliases', () => {
    const extraction = parseHtml(fixture('cards.html'));
    extraction.items.push({ ...extraction.items[0]!, lineStart: 3, lineEnd: 3 });
    const review = buildReview('Test Chain', source, extraction);
    expect(review.reviewedBy).toBeNull();
    expect(new Set(review.changes.map(row => row.canonicalKey)).size).toBe(2);
    for (const row of review.changes) {
      expect(row).toMatchObject({ status: 'unverified', slug: 'test-chain', expected: null, aliases: [], source: { url: source.url, sha256: source.sha256 } });
      expect(row).not.toHaveProperty('review');
      expect(row).not.toHaveProperty('dataHash');
      expect(row.locator).toContain('source.txt lines');
      expect(Object.keys(row.facts)).toEqual(['calories', 'proteinG', 'carbsG', 'fatG', 'servingSize']);
    }
  });
});
