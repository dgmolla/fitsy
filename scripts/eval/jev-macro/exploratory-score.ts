import { macroNames, score, type ItemResult, type Macros } from './score';
import type { TruthRow } from './truth';

export const truthMacros = (row: TruthRow): Macros => ({ calories: row.calories, protein: row.protein_g, carbs: row.carbs_g, fat: row.fat_g });
const finite = (value: number) => Number.isFinite(value) ? value : null;
export function exploratoryScore(rows: TruthRow[], results: (ItemResult & { knownCostUsd?: number })[]) {
  const base = score(rows, results), byId = new Map(results.map(result => [result.id, result]));
  const meanAbsoluteError = Object.fromEntries(macroNames.map(macro => [macro, rows.length ? finite(rows.reduce((sum, row) => {
    const estimate = byId.get(row.id)?.estimate;
    return sum + (estimate ? Math.abs(estimate[macro] - truthMacros(row)[macro]) : Infinity);
  }, 0) / rows.length) : null]));
  const zeroTruth = Object.fromEntries(macroNames.map(macro => {
    const subset = rows.filter(row => truthMacros(row)[macro] === 0);
    return [macro, { total: subset.length,
      exactZero: subset.filter(row => byId.get(row.id)?.estimate?.[macro] === 0).length,
      positive: subset.filter(row => (byId.get(row.id)?.estimate?.[macro] ?? 0) > 0).length,
      failed: subset.filter(row => !byId.get(row.id)?.estimate).length }];
  }));
  return { ...base, knownCostUsd: results.reduce((sum, result) => sum + (result.knownCostUsd ?? result.costUsd ?? 0), 0),
    meanAbsoluteError, zeroTruth };
}
export function category(row: TruthRow) {
  const key = row.id.split(':')[1]!.split('/')[0]!;
  if (['drinks', 'packaged'].includes(key)) return 'drinks';
  if (['sauce-dressing', 'side-sauces', 'packets'].includes(key)) return 'sauces';
  if (key === 'family-a-la-carte' || key === 'desserts') return key;
  if (key.includes('select-') || ['sides', 'appetizers', 'miso-soup', 'blount-clam-chowder', 'gyudon-beef-side', 'habanero-chicken-side'].includes(key)) return 'sides/components';
  return 'entrees';
}
export function scoreSlices(rows: TruthRow[], results: (ItemResult & { knownCostUsd?: number })[]) {
  const subset = (selected: TruthRow[]) => {
    const ids = new Set(selected.map(row => row.id));
    return exploratoryScore(selected, results.filter(result => ids.has(result.id)));
  };
  return { all: subset(rows), fatAtLeast2g: subset(rows.filter(row => row.fat_g >= 2)),
    categories: Object.fromEntries(['desserts', 'drinks', 'entrees', 'family-a-la-carte', 'sauces', 'sides/components']
      .map(name => [name, subset(rows.filter(row => category(row) === name))])),
    byChain: Object.fromEntries([...new Set(rows.map(row => row.chain))].map(chain => [chain, subset(rows.filter(row => row.chain === chain))])) };
}

export function formatComparison(comparisons: Record<string, ReturnType<typeof scoreSlices>>) {
  const number = (n: number | null | undefined, digits = 2) => n === null || n === undefined ? 'unavailable' : n.toFixed(digits);
  const table = (slice: (data: ReturnType<typeof scoreSlices>) => ReturnType<typeof exploratoryScore>) => [
    '| Run | N | Cal MdAPE % | Protein MdAPE % | Carb MdAPE % | Fat MdAPE % | Catastrophic | $ / 1k attempted | Median ms | p95 ms |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...Object.entries(comparisons).map(([name, data]) => {
      const m = slice(data);
      return `| ${name} | ${m.total} | ${macroNames.map(macro => number(m.medianAbsolutePctError[macro])).join(' | ')} | ${m.catastrophicMisses}/${m.total} (${number(m.catastrophicMissRate * 100)}%) | ${number(m.costUsdPer1000Items, 6)} | ${number(m.latency.medianMs)} | ${number(m.latency.p95Ms)} |`;
    }), '',
  ];
  return [
    '## Same 168 rows', '', ...table(data => data.all),
    '## Truth fat >=2 g subset', '', ...table(data => data.fatAtLeast2g),
    ...Object.keys(Object.values(comparisons)[0]!.categories).flatMap(name => [
      `## Category: ${name}`, '', ...table(data => data.categories[name]!),
    ]),
    '## Absolute errors and zero-truth behavior', '',
    '| Run | Cal MAE kcal | Protein MAE g | Carb MAE g | Fat MAE g |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...Object.entries(comparisons).map(([name, data]) => `| ${name} | ${macroNames.map(macro => number(data.all.meanAbsoluteError[macro])).join(' | ')} |`), '',
    '| Run | Macro | Zero-truth rows | Exact zero | Positive prediction | Failed item |',
    '| --- | --- | ---: | ---: | ---: | ---: |',
    ...Object.entries(comparisons).flatMap(([name, data]) => macroNames.map(macro => {
      const z = data.all.zeroTruth[macro]!;
      return `| ${name} | ${macro} | ${z.total} | ${z.exactZero} | ${z.positive} | ${z.failed} |`;
    })), '',
  ].join('\n');
}
