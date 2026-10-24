import { reconcileMenuItemIds, type ExistingMenuItem, type IncomingMenuItem } from './menu-item-identity';
import { dedupByIdentity, type ValidatedPair } from './pipeline-utils';

const item = { name: 'Alfredo', description: 'Pasta', price: 18, section: 'Entrees' };
const old: ExistingMenuItem = { ...item, id: 'logged-dish', restaurantId: 'la', sourceItemId: null, retiredAt: null, category: null };
const incoming = (sourceItemId?: string, patch = {}): IncomingMenuItem => ({ restaurantId: 'la', item: { ...item, sourceItemId, ...patch } });

test('unique legacy context adopts its logged dish ID, while a same-name family order gets its own ID', () => {
  const input = [incoming('ubereats:individual'), incoming('ubereats:family', { price: 63, section: 'Family' })];
  const ids = reconcileMenuItemIds(input, [old]);
  expect(ids[0]).toBe(old.id);
  expect(ids[1]).not.toBe(old.id);
  const bound = input.map((row, i) => ({ ...old, ...row.item, id: ids[i]!, sourceItemId: row.item.sourceItemId! }));
  expect(reconcileMenuItemIds([...input].reverse(), bound)).toEqual([...ids].reverse());
  expect(reconcileMenuItemIds([incoming('ubereats:individual', { name: 'Renamed', price: 20 })], bound)).toEqual([old.id]);
});

test('ambiguous legacy context is never arbitrarily assigned to a source product', () => {
  const ids = reconcileMenuItemIds([incoming('ubereats:a'), incoming('ubereats:b')], [old]);
  expect(new Set(ids).size).toBe(2);
  expect(ids).not.toContain(old.id);
  expect(reconcileMenuItemIds([incoming('ubereats:a')], [old, { ...old, id: 'other-legacy' }])).not.toContain(old.id);
});

test('fallback rows are reserved before source reconciliation and provider/store scopes stay separate', () => {
  const ids = reconcileMenuItemIds([incoming('ubereats:a'), incoming()], [old]);
  expect(ids[0]).not.toBe(old.id);
  expect(ids[1]).toBe(old.id);
  const bound = { ...old, sourceItemId: 'ubereats:a' };
  expect(reconcileMenuItemIds([{ ...incoming('ubereats:a'), restaurantId: 'sf' }, incoming('other:a')], [bound])).not.toContain(old.id);
});

test('retired source products revive by ID, but retired ambiguous legacy rows cannot claim new products', () => {
  const retired = { ...old, retiredAt: new Date() };
  expect(reconcileMenuItemIds([incoming('ubereats:a')], [{ ...retired, sourceItemId: 'ubereats:a' }])).toEqual([old.id]);
  expect(reconcileMenuItemIds([incoming('ubereats:a')], [retired])).not.toContain(old.id);
  expect(() => reconcileMenuItemIds([incoming('ubereats:a'), incoming('ubereats:a')], [])).toThrow('Duplicate incoming');
});

test('old case-sensitive fallback duplicates retain the unique exact display-name ID', () => {
  const upper = { ...old, name: 'ALFREDO', id: 'upper' };
  expect(reconcileMenuItemIds([incoming()], [old, upper])).toEqual([old.id]);
  expect(reconcileMenuItemIds([incoming(undefined, { name: 'ALFREDO' })], [old, upper])).toEqual([upper.id]);
  expect(reconcileMenuItemIds([incoming(undefined, { name: 'alfredo' })], [old, upper])).not.toContain(old.id);
});

test('deduplication keeps same-name source variants and their corresponding macros', () => {
  const pair = (id: string | undefined, calories: number): ValidatedPair => ({ item: { name: 'Alfredo', sourceItemId: id },
    macro: { calories, proteinG: 20, carbsG: 50, fatG: 10, source: 'haiku', confidence: 'LOW', dietaryTags: [] } });
  const pairs = [pair('ubereats:a', 400), pair('ubereats:b', 1500), pair('ubereats:a', 900), pair(undefined, 500), pair(undefined, 600)];
  expect(dedupByIdentity(pairs).map(p => p.macro.calories)).toEqual([400, 1500, 500]);
});
