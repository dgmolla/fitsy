import { Prisma, type ChainItem, type Restaurant } from "@prisma/client";
import { chainSnapshotInput, restaurantSnapshotInput } from "./snapshot-row";
const row: Omit<ChainItem, "review"> = { id: "catalog-row", brandId: "waba", canonicalKey: "chicken-plate", aliases: [], servingSize: "1 plate", calories: 820,
  proteinG: 54, carbsG: 110, fatG: 15, source: "official", confidence: "HIGH", officialUrl: "https://example.com/nutrition.pdf", retrievedAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
test("pre-review snapshots remain unchanged", () => { expect(chainSnapshotInput(row)).toStrictEqual(row);
  expect("review" in chainSnapshotInput(row)).toBe(false); });
test("database null becomes Prisma DbNull rather than JSON null", () => {
  expect(chainSnapshotInput({ ...row, review: null })).toEqual({ ...row, review: Prisma.DbNull });
});
test("review objects survive snapshot copying", () => {
  const review = { version: 1, aliases: [{ name: "Chicken Plate" }] };
  expect(chainSnapshotInput({ ...row, review })).toEqual({ ...row, review });
});

const restaurant: Omit<Restaurant, 'openingHours'> = {
  id: 'hours-restaurant', storeUuid: 'hours-store', name: 'Hours fixture', address: 'Fixture', lat: 34, lng: -118,
  homeHex: null, brand: null, brandId: null, cuisineTags: [], chainFlag: false, source: 'test', menuSourceId: null,
  photoUrl: null, photoSource: null, rating: null, userRatingCount: null, priceLevel: null, dietaryOptions: [],
  lastScrapedAt: null, menuHash: null, menuKind: 'restaurant', createdAt: new Date(), updatedAt: new Date(),
};
test('pre-hours snapshots remain unchanged', () => {
  expect(restaurantSnapshotInput(restaurant)).toEqual(restaurant);
  expect('openingHours' in restaurantSnapshotInput(restaurant)).toBe(false);
});
test('unknown restaurant hours stay database null instead of JSON null', () => {
  expect(restaurantSnapshotInput({ ...restaurant, openingHours: null })).toEqual({ ...restaurant, openingHours: Prisma.DbNull });
});
test('verified restaurant hours survive the actual snapshot input adapter', () => {
  const openingHours = { timeZone: 'America/Los_Angeles', periods: [{ day: 1, opens: 600, closes: 1200 }] };
  expect(restaurantSnapshotInput({ ...restaurant, openingHours })).toEqual({ ...restaurant, openingHours });
});
