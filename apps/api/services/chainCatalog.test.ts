import { approvedChainRow, buildChainMatcher, chainMenuFingerprint, chainReviewHash, type ChainCatalogRow, type ChainReview } from "./chainCatalog";
const item = { name: "Chicken Plate", section: "Plates", description: "Grilled chicken with rice." };
function fixture(overrides: Partial<ChainCatalogRow> = {}, aliases: ChainReview["aliases"] = [item]): ChainCatalogRow {
  const row: ChainCatalogRow = { id: "waba-plate", brandId: "waba", canonicalKey: "plates/chicken", servingSize: "1 plate", // gitleaks:allow — fixture dish identity, not a credential
    calories: 820, proteinG: 54, carbsG: 110, fatG: 15, source: "official", confidence: "HIGH",
    officialUrl: "https://www.wabagrill.com/nutritional-guide", review: null, ...overrides };
  const review = { version: 1 as const, sourceHash: "a".repeat(64), locator: "PDF page 1, Plates, Chicken", reviewedBy: "fixture", aliases };
  return { ...row, review: { ...review, dataHash: chainReviewHash(row, review) } };
}
test("same reviewed item at existing and new locations has the same chain identity and macros", () => {
  // Persisted version-1 review identities must survive future releases.
  expect(chainMenuFingerprint(item)).toBe("80ff24f82e8dc69eb88c5e394d780dfb5dc1f6ff574612ba7f0f3b148da9d8f2");
  expect((fixture().review as ChainReview).dataHash).toBe("82cdb7c9dd88bc10b50ea95d178f787939db4316fa39fccaf2d4be5dd7131555");
  const match = buildChainMatcher([fixture()]);
  expect(match("waba", item)).toMatchObject({ status: "matched", row: { id: "waba-plate", calories: 820, proteinG: 54, carbsG: 110, fatG: 15 } });
  expect(match("waba", { ...item, name: " CHICKEN  PLATE " })).toEqual(match("waba", item));
  expect(match("waba", { ...item, name: "ＣＨＩＣＫＥＮ ＰＬＡＴＥ" })).toEqual(match("waba", item));
  expect(match("yoshinoya", item)).toEqual({ status: "unmatched" });
  expect(match(undefined, item)).toEqual({ status: "unmatched" });
});
test.each([
  { ...item, name: "Chicken Family Meal" }, { ...item, name: "Chicken Plate (Large)" },
  { ...item, section: "Family Meals" }, { ...item, description: "Choose chicken or tofu; rice or noodles." },
  { name: item.name },
])("portion, section, description, and missing context cannot inherit an alias: %p", variant => {
  expect(buildChainMatcher([fixture()])("waba", variant)).toEqual({ status: "unmatched" });
});
test("legacy aliases and canonical name alone never authorize nutrition", () => {
  const old = { ...fixture(), review: null, aliases: ["chicken-plate"] };
  expect(buildChainMatcher([old])("waba", item)).toEqual({ status: "unmatched" });
  expect(buildChainMatcher([fixture({}, [])])("waba", item)).toEqual({ status: "unmatched" });
});
test("two approved configurations for one observation abstain, even if their macros agree", () => {
  const rows = [fixture(), fixture({ id: "waba-other", canonicalKey: "other" })];
  expect(buildChainMatcher(rows)("waba", item)).toEqual({ status: "ambiguous" });
});
test.each([
  { calories: 819 }, { proteinG: 55 }, { carbsG: 109 }, { fatG: 14 }, { brandId: "other" },
  { canonicalKey: "family/chicken" }, { servingSize: "family portion" }, { officialUrl: "https://example.com/other.pdf" }, // gitleaks:allow — fixture dish identity, not a credential
])("editing approved facts invalidates the review: %p", update => {
  expect(approvedChainRow({ ...fixture(), ...update })).toBeNull();
});
test("editing source evidence or alias wording invalidates the review", () => {
  const row = fixture(), review = row.review as ChainReview;
  for (const update of [{ sourceHash: "b".repeat(64) }, { reviewedBy: "another reviewer" }, { locator: "different row" }, { aliases: [{ name: "Chicken Family Meal" }] }, { dataHash: "0".repeat(64) }]) {
    expect(approvedChainRow({ ...row, review: { ...review, ...update } })).toBeNull();
  }
});
test.each([
  { calories: null }, { proteinG: -1 }, { carbsG: NaN }, { fatG: Infinity }, { calories: 820.5 },
  { servingSize: null }, { officialUrl: "http://example.com" }, { confidence: "LOW" }, { source: "haiku" },
  { calories: 1387, proteinG: 26, carbsG: 304, fatG: 112 },
])("invalid or inconsistent facts cannot be approved by a matching digest: %p", update => {
  expect(approvedChainRow(fixture(update))).toBeNull();
});
test("Yoshinoya regular versus side remains distinct despite identical protein wording", () => {
  const name = "Habanero Grilled Chicken";
  const rows = [fixture({ id: "yoshi-side", brandId: "yoshi", calories: 290, proteinG: 28, carbsG: 18, fatG: 11, servingSize: "166 g protein side" }, [{ name, section: "Ala Carte" }]),
    fixture({ id: "yoshi-regular", brandId: "yoshi", calories: 620, proteinG: 33, carbsG: 90, fatG: 11, servingSize: "510 g regular bowl" }, [{ name, section: "Regular Bowls" }])];
  const match = buildChainMatcher(rows);
  expect(match("yoshi", { name, section: "Ala Carte" })).toMatchObject({ row: { calories: 290 } });
  expect(match("yoshi", { name, section: "Regular Bowls" })).toMatchObject({ row: { calories: 620 } });
  expect(match("yoshi", { name })).toEqual({ status: "unmatched" });
});
test("normalization keeps parenthetical size and numeric quantities", () => {
  expect(chainMenuFingerprint({ name: "Dumplings (5 pc)" })).not.toEqual(chainMenuFingerprint({ name: "Dumplings (10 pc)" }));
  expect(chainMenuFingerprint({ name: "Chicken Plate" })).not.toEqual(chainMenuFingerprint({ name: "ChickenPlate" }));
  expect(chainMenuFingerprint({ name: "Soup", section: "", description: "" })).toEqual(chainMenuFingerprint({ name: "Soup" }));
});
test("review metadata must be complete, typed and current", () => {
  const row = fixture(), review = row.review as ChainReview;
  for (const change of [{ version: 2 }, { reviewedBy: " " }, { locator: "" }, { sourceHash: "not-a-hash" }, { aliases: [{ name: "" }] }, { extraField: true }]) {
    expect(approvedChainRow({ ...row, review: { ...review, ...change } })).toBeNull();
  }
});
test("zero macros and ordinary label rounding remain usable, but null/negative nutrients do not", () => {
  const zero = fixture({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  expect(approvedChainRow(zero)).toMatchObject({ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 });
  expect(buildChainMatcher([zero])("waba", { ...item, calories: 0 })).toMatchObject({ status: "matched", row: { calories: 0 } });
  expect(buildChainMatcher([zero])("waba", { ...item, calories: -1 })).toEqual({ status: "unmatched" });
  expect(approvedChainRow(fixture({ calories: 200, proteinG: 10, carbsG: 25, fatG: 0 }))).not.toBeNull(); // exactly 60 calories
  expect(approvedChainRow(fixture({ calories: 201, proteinG: 10, carbsG: 25, fatG: 0 }))).toBeNull();
  expect(approvedChainRow(fixture({ calories: 600, proteinG: 0, carbsG: 120, fatG: 0 }))).not.toBeNull(); // exactly 20%
  expect(approvedChainRow(fixture({ calories: 600, proteinG: 0, carbsG: 119, fatG: 0 }))).toBeNull();
  expect(approvedChainRow(fixture({ calories: 600, proteinG: 30, carbsG: 75, fatG: 10 }))).not.toBeNull(); // 90 cal, within 20% but above 60 cal
});
test.each([{ servingSize: " " }, { officialUrl: null }, { officialUrl: "https://" },
  { calories: 600, proteinG: null, carbsG: 120, fatG: 10 },
  { calories: 600, proteinG: -.1, carbsG: 120, fatG: 10 }])("malformed source or nutrient cannot pass the energy check alone: %p", update => {
  expect(approvedChainRow(fixture(update))).toBeNull();
});
test("source calorie labels corroborate a binding; ranges or conflicts cannot override", () => {
  const match = buildChainMatcher([fixture()]);
  expect(match("waba", { ...item, calories: 820 })).toMatchObject({ status: "matched" });
  expect(match("waba", { ...item, calories: 819 })).toMatchObject({ status: "matched" });
  expect(match("waba", { ...item, calories: 779 })).toMatchObject({ status: "matched" }); // exactly 5%, above the 30-calorie floor
  expect(match("waba", { ...item, calories: 778 })).toEqual({ status: "unmatched" });
  const small = buildChainMatcher([fixture({ calories: 30, proteinG: 2, carbsG: 3, fatG: 0 })]);
  expect(small("waba", { ...item, calories: 60 })).toMatchObject({ status: "matched" }); // exactly the 30-calorie floor
  expect(small("waba", { ...item, calories: 61 })).toEqual({ status: "unmatched" });
  for (const update of [{ calorieLabel: "500+ Cal." }, { calories: 640 }, { calories: NaN }, { calories: -1 }, { calorieRange: [640, 820] as [number, number] }]) {
    expect(match("waba", { ...item, ...update })).toEqual({ status: "unmatched" });
  }
});

test("reviewer and source locator whitespace survive stored JSON validation", () => {
  const row = fixture(), review = row.review as ChainReview;
  for (const change of [{ locator: ` ${review.locator} ` }, { reviewedBy: ` ${review.reviewedBy} ` }]) {
    const metadata = { ...review, ...change };
    const saved = { ...row, review: JSON.parse(JSON.stringify({ ...metadata, dataHash: chainReviewHash(row, metadata) })) };
    expect(buildChainMatcher([saved])("waba", item)).toMatchObject({ status: "matched", row: { calories: 820 } });
    expect(chainReviewHash(row, metadata)).toBe(review.dataHash);
  }
});

test("malformed review metadata stays invalid even with a freshly computed digest", () => {
  const row = fixture(), review = row.review as ChainReview;
  for (const change of [{ locator: " " }, { reviewedBy: " " }, { sourceHash: "z" + "a".repeat(64) },
    { sourceHash: "a".repeat(64) + "z" }, { aliases: [{ name: "" }] }, { aliases: [{ name: " " }] }]) {
    const malformed = { ...review, ...change };
    expect(approvedChainRow({ ...row, review: { ...malformed, dataHash: chainReviewHash(row, malformed) } })).toBeNull();
  }
});
test("all reviewed aliases match and reordering them preserves approval", () => {
  const featured = { ...item, section: "Featured items" }, row = fixture({}, [item, featured]), review = row.review as ChainReview;
  const reversed = { ...review, aliases: [featured, item] };
  expect(chainReviewHash(row, reversed)).toBe(review.dataHash);
  const match = buildChainMatcher([{ ...row, review: reversed }]);
  for (const alias of [item, featured]) expect(match("waba", alias)).toMatchObject({ status: "matched", row: { id: row.id, calories: 820 } });
});
