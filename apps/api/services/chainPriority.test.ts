import { macroSourceRank, macroWinnerSqlOrder, pickWinningEstimate } from "@fitsy/shared";
test("reviewed official outranks estimates while preserving merchant corrections", () => {
  const sources = ["merchant", "official", "fatsecret", "ffn", "haiku", "unknown"];
  expect(sources.map(macroSourceRank)).toEqual([0, 1, 2, 3, 4, 99]);
  const rows = sources.map((source, i) => ({ source, estimatedAt: new Date(2026, 0, i + 1) }));
  expect(pickWinningEstimate(rows)?.source).toBe("merchant");
  expect(pickWinningEstimate(rows.slice(1))?.source).toBe("official");
  expect(pickWinningEstimate([...rows].reverse())?.source).toBe("merchant");
  expect(pickWinningEstimate(rows.slice(1).reverse())?.source).toBe("official");
  expect(macroWinnerSqlOrder("x")).toBe("CASE x.source WHEN 'merchant' THEN 0 WHEN 'official' THEN 1 WHEN 'fatsecret' THEN 2 WHEN 'ffn' THEN 3 WHEN 'haiku' THEN 4 ELSE 99 END ASC, x.\"estimatedAt\" DESC");
});
test("same-source updates choose newest while an empty list has no winner", () => {
  const old = { source: "official", estimatedAt: new Date("2026-01-01") };
  const recent = { source: "official", estimatedAt: new Date("2026-02-01") };
  expect(pickWinningEstimate([old, recent])).toBe(recent);
  expect(pickWinningEstimate([recent, old])).toBe(recent);
  expect(pickWinningEstimate([])).toBeNull();
  expect(macroWinnerSqlOrder()).toContain('CASE e.source');
});
