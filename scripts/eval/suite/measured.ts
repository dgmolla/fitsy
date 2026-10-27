import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { root, sha256, suite } from './fixtures';
import { caseSchema, rowSchema, type Case, type Item, type Row, type Split } from './types';

const directory = join(suite, 'sources/measured');
const read = <T>(file: string): T => {
  const bytes = readFileSync(join(directory, file));
  return JSON.parse(file.endsWith('.gz') ? gunzipSync(bytes).toString() : bytes.toString()) as T;
};
interface Observation { id: string; name: string; section: string; sourceLine: number; rawPdfKeys: string[];
  lowerTrimPdfKeys: string[]; relatedPdfKeys?: string[]; missCategory?: string; reason?: string }
interface Tagged { key: string; name: string; section: string; page: number | null; lineStart: number;
  lineEnd: number; rawText: string; tag: NonNullable<Row['tags']>[number] }
interface ChainPlan { name: string; slug: string; positive: number[]; negative: number[]; negativeCategories: string[];
  excluded: number[]; overrides: Record<string, { expectedKey?: string; category?: string; why?: string }>;
  fallbackKeys: string[]; exclusionReason: string }
interface Check { chain: string; key: string; serving: string; observed: Row['macros']; sourceSha256: string;
  evidence: { page?: number; sourceText?: string; section?: string; name?: string; labels?: Record<string, string> } }
interface Decision { chain: string; index: number; item: Observation; keys: string[]; expected: string | null;
  category: string; why: string; hard: boolean; family?: string }
const normalize = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const categoryOf = (item: Observation) => item.section.toLowerCase().includes('catering') ? 'catering_family'
  : /gluten/i.test(item.section) ? 'gluten_sensitive' : item.rawPdfKeys.length > 1 ? 'multiple_pdf_rows'
    : ({ 'combo/build-your-own': 'combo_build_your_own', 'missing from PDF': 'snapshot_missing',
      'UE-only': 'snapshot_ue_only', 'naming/punctuation': 'naming_punctuation',
      'size/variant wording': 'size_variant' } as Record<string, string>)[item.missCategory ?? ''] ?? 'ue_positive';

/** Append a versioned population only after proving the original fixture bytes are unchanged. */
export function extendMeasured(rows: Row[], cases: Case[], originalGroups: Map<string, string>, rowCategory: (row: Row) => string) {
  const captureManifest = read<{ files: Record<string, string>; sourceHead: string }>('capture-manifest.json');
  for (const [file, hash] of Object.entries(captureManifest.files)) {
    if (sha256(readFileSync(join(directory, file))) !== hash) throw new Error('Measured capture hash differs');
  }
  const plan = read<{ version: string; curatedPerStratum: number; curatedMacroPerChain: number; chains: Record<string, ChainPlan> }>('plan.json');
  const measurement = read<Record<string, { pdfRowsTagged: Tagged[]; ueInventory: Observation[] }>>('measurement.json.gz');
  const checks = readFileSync(join(directory, 'row-checks.jsonl'), 'utf8').trim().split('\n').map(s => JSON.parse(s) as Check);
  const pages = read<{ chain: string; page: number; text: string; sha256: string }[]>('pdf-pages.json.gz');
  const byId = new Map(rows.map(r => [r.id, r])), originalIds = new Set(byId.keys());
  const splits = new Map<string, Split>(cases.filter(c => c.task === 'macro' && c.tier === 'bulk')
    .map(c => [c.id.slice('bulk:macro:'.length), c.split]));
  const exclusions: { id: string; reason: string }[] = [], decisions: Decision[] = [];
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id);
    if (!p) { parent.set(id, id); return id; }
    if (p === id) return id;
    const representative = find(p); parent.set(id, representative); return representative;
  };
  const union = (a: string, b: string) => parent.set(find(b), find(a));
  for (const check of checks) {
    const config = plan.chains[check.chain]!;
    const tagged = measurement[check.chain]!.pdfRowsTagged.find(r => r.key === check.key);
    const archived = JSON.parse(gunzipSync(readFileSync(join(root, `scripts/eval/pdf-finder/demo/${check.chain}/review.json.gz`))).toString()) as {
      changes: { canonicalKey: string; facts: { calories: number; proteinG: number; carbsG: number; fatG: number };
        source: { url: string; sha256: string }; locator: string }[] };
    const source = archived.changes.find(r => r.canonicalKey === check.key);
    if (!source || !tagged || source.source.sha256 !== check.sourceSha256
      || JSON.stringify(Object.values(check.observed)) !== JSON.stringify([source.facts.calories, source.facts.proteinG, source.facts.carbsG, source.facts.fatG])) {
      throw new Error('Measured source check disagrees with frozen extraction');
    }
    if (tagged.page) {
      const page = pages.find(p => p.chain === config.name && p.page === tagged.page);
      if (!page || sha256(page.text) !== page.sha256 || !check.evidence.sourceText
        || !page.text.replace(/\s+/g, ' ').includes(check.evidence.sourceText.replace(/\s+/g, ' '))) throw new Error('Missing inspected PDF row');
    } else if (sha256(gunzipSync(readFileSync(join(directory, 'official-osf.html.gz')))) !== check.sourceSha256
      || check.evidence.name !== tagged.name || check.evidence.section !== tagged.section) throw new Error('Missing labelled HTML source');
    const id = `${config.slug}:${check.key}`;
    const tags = [tagged.tag, ...(/gluten sensitive/i.test(tagged.section) ? ['gluten-sensitive' as const] : [])];
    if (byId.has(id)) {
      const existing = byId.get(id)!;
      if (JSON.stringify(existing.macros) !== JSON.stringify(check.observed)) throw new Error('Original reference macros differ');
      existing.tags = tags;
    } else {
      const row = rowSchema.parse({ id, chain: config.name, name: tagged.name, section: tagged.section,
        serving: check.serving, region: '', tags, macros: check.observed,
        source: { ...source.source, page: tagged.page ?? `HTML card: ${tagged.section} / ${tagged.name}`, locator: source.locator } });
      rows.push(row); byId.set(id, row);
    }
    find(id);
  }
  for (const [chain, config] of Object.entries(plan.chains)) {
    const observed = measurement[chain]!.ueInventory;
    for (const [index, item] of observed.entries()) {
      const override = config.overrides[String(index)];
      const positive = config.positive.includes(index);
      const admitted = !config.excluded.includes(index) && (positive || config.negative.includes(index)
        || config.negativeCategories.includes(item.missCategory ?? ''));
      if (!admitted) {
        exclusions.push({ id: `measured:${chain}:${item.id}`, reason: override?.why ?? config.exclusionReason }); continue;
      }
      const keys = [...new Set([...(item.relatedPdfKeys ?? item.lowerTrimPdfKeys), ...(override?.expectedKey ? [override.expectedKey] : [])])]
        .map(key => `${config.slug}:${key}`);
      if (keys.some(id => !byId.has(id))) throw new Error('Unverified measured candidate');
      const expected = positive ? `${config.slug}:${override?.expectedKey ?? (item.relatedPdfKeys ?? item.lowerTrimPdfKeys)[0]}` : null;
      const category = override?.category ?? categoryOf(item);
      const why = override?.why ?? (positive
        ? 'Reviewed captured recipe and menu context identify the standard published serving; preserve all explicit portion and dietary distinctions.'
        : category === 'catering_family' ? 'The captured catering order does not identify any supplied single-meal or child serving; identical titles do not establish portion compatibility.'
          : category === 'gluten_sensitive' ? 'The captured recipe explicitly uses gluten-sensitive fusilli; supplied regular-pasta or child rows cannot substitute.'
            : category === 'combo_build_your_own' ? 'Unselected configuration or a complete bundle cannot identify any supplied fixed configuration or individual component.'
              : category === 'size_variant' ? 'The captured count, adult serving or catering configuration explicitly differs from the supplied published portion.'
                : 'No supplied verified candidate identifies this captured item. This is a candidate-relative negative, not a claim of absence from the complete source.');
      for (const id of keys.slice(1)) union(keys[0]!, id);
      decisions.push({ chain, index, item, keys, expected, category, why,
        hard: item.rawPdfKeys.length > 1 || !!item.lowerTrimPdfKeys.length && /catering|gluten/i.test(item.section) });
    }
  }
  // Existing equivalences retain their split, and new collision families never straddle it.
  for (const id of parent.keys()) {
    const original = originalGroups.get(id);
    if (original && parent.has(original)) union(id, original);
  }
  const families = new Map<string, string[]>();
  for (const id of parent.keys()) families.set(find(id), [...(families.get(find(id)) ?? []), id]);
  const familyGroups = new Map<string, string>(), strata = new Map<string, string[]>();
  for (const [family, ids] of families) {
    const prior = ids.filter(id => splits.has(id));
    const fixed = new Set(prior.map(id => splits.get(id)!));
    if (fixed.size > 1) throw new Error('New collision family conflicts with frozen splits; exclude or review it explicitly');
    const representative = [...(prior.length ? prior : ids)].sort()[0]!;
    familyGroups.set(family, originalGroups.get(representative) ?? representative);
    if (fixed.size) ids.forEach(id => splits.set(id, [...fixed][0]!));
    else if (byId.get(representative)!.chain === 'Claim Jumper') ids.forEach(id => splits.set(id, 'holdout'));
    else {
      const row = byId.get(representative)!;
      const key = `${row.chain}/${rowCategory(row)}/captured`;
      strata.set(key, [...(strata.get(key) ?? []), family]);
    }
  }
  for (const values of strata.values()) {
    values.sort((a, b) => sha256(`suite-v1\n${a}`).localeCompare(sha256(`suite-v1\n${b}`)));
    values.forEach((family, i) => families.get(family)!.forEach(id => splits.set(id, i < Math.round(values.length * .35) ? 'holdout' : 'dev')));
  }
  const captureSplits = new Map<string, Split>();
  const captureStrata = new Map<string, string[]>();
  for (const decision of decisions.filter(d => !d.keys.length)) {
    const key = `${decision.chain}/${normalize(decision.item.name)}`;
    decision.family = key;
    const stratum = `${decision.chain}/${decision.category}`;
    captureStrata.set(stratum, [...new Set([...(captureStrata.get(stratum) ?? []), key])]);
  }
  for (const [stratum, values] of captureStrata) {
    values.sort((a, b) => sha256(`suite-v1\n${a}`).localeCompare(sha256(`suite-v1\n${b}`)));
    values.forEach((key, i) => captureSplits.set(key, stratum.startsWith('claim-jumper/')
      || i < Math.round(values.length * .35) ? 'holdout' : 'dev'));
  }
  const curated = new Set(decisions.filter(d => d.hard).map(d => `${d.chain}/${d.index}`));
  const buckets = new Map<string, Decision[]>();
  for (const d of decisions) {
    const key = `${d.chain}/${d.category}`;
    buckets.set(key, [...(buckets.get(key) ?? []), d]);
  }
  for (const values of buckets.values()) values.sort((a, b) => sha256(a.item.id).localeCompare(sha256(b.item.id)))
    .slice(0, plan.curatedPerStratum).forEach(d => curated.add(`${d.chain}/${d.index}`));
  for (const d of decisions) {
    const config = plan.chains[d.chain]!;
    const split = d.keys.length ? splits.get(d.keys[0]!)! : captureSplits.get(d.family!)!;
    const pool = rows.filter(r => r.chain === config.name && splits.get(r.id) === split);
    if (!pool.length) throw new Error('No same-split verified candidates');
    const ids = d.keys.length ? d.keys : pool.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 3).map(r => r.id);
    if (ids.some(id => splits.get(id) !== split)) throw new Error('Measured candidate crosses split');
    const capture = read<{ url: string; body: string }>(`${d.chain}.retry.json.gz`);
    const lines = (JSON.parse(capture.body) as { data: { markdown: string } }).data.markdown.split('\n');
    const description: string[] = [];
    for (const line of lines.slice(d.item.sourceLine + 1)) {
      if (line.includes('](https://www.ubereats.com')) break;
      const text = line.replace(/\\/g, '').trim();
      if (!text || /^(?:\$|Priced by add-ons|Popular|Plus small|!\[|#\d)/.test(text)) continue;
      // Remove complete nutrition-bearing marketing sentences, including calorie ranges.
      if (/\b\d+(?:\.\d+)?\s*(?:-|to)?\s*\d*\s*(?:cal\.?|calories?|kcal|g\s+(?:protein|carbs?|fat))\b/i.test(text)) continue;
      description.push(text);
    }
    const input: Item = { chain: config.name, name: d.item.name, section: d.item.section,
      description: description.join(' '), serving: '', region: '' };
    const group = d.keys.length ? familyGroups.get(find(d.keys[0]!))! : `capture:${sha256(d.family!).slice(0, 24)}`;
    const anchor = byId.get(d.expected ?? ids[0]!)!;
    for (const tier of (curated.has(`${d.chain}/${d.index}`) ? ['curated', 'bulk'] : ['bulk']) as Case['tier'][]) {
      const offset = d.index % ids.length;
      cases.push(caseSchema.parse({ id: `${tier}:measured:ue:${d.chain}:${d.item.id}`, tier, split, group,
        category: d.category, chain: config.name, why: d.why, source: anchor.source, origin: 'captured-uber-eats', input,
        capture: { itemId: d.item.id, url: capture.url, sha256: captureManifest.files[`${d.chain}.retry.json.gz`],
          line: d.item.sourceLine, missCategory: d.item.missCategory ?? 'exact-title-hit' }, task: 'matching',
        candidates: ids.slice(offset).concat(ids.slice(0, offset)), expected: { kind: d.expected ? 'match' : 'none', matchId: d.expected } }));
    }
  }
  const addedRows = rows.filter(r => !originalIds.has(r.id));
  const macroCurated = new Set<string>();
  for (const config of Object.values(plan.chains)) {
    const candidates = addedRows.filter(r => r.chain === config.name).sort((a, b) => sha256(a.id).localeCompare(sha256(b.id)));
    const selected: Row[] = [], buckets = new Map<string, Row[]>();
    for (const row of candidates) buckets.set(rowCategory(row), [...(buckets.get(rowCategory(row)) ?? []), row]);
    while (selected.length < Math.min(plan.curatedMacroPerChain, candidates.length)) {
      for (const values of buckets.values()) {
        const row = values.shift(); if (row) selected.push(row);
        if (selected.length === Math.min(plan.curatedMacroPerChain, candidates.length)) break;
      }
    }
    selected.forEach(r => macroCurated.add(r.id));
  }
  for (const row of addedRows) {
    const group = familyGroups.get(find(row.id))!, split = splits.get(row.id)!;
    const input = { chain: row.chain, name: row.name, section: row.section, description: '', serving: row.serving, region: row.region };
    for (const tier of (macroCurated.has(row.id) ? ['curated', 'bulk'] : ['bulk']) as Case['tier'][]) {
      cases.push(caseSchema.parse({ id: `${tier}:measured:macro:${row.id}`, tier, split, group, category: rowCategory(row),
        chain: row.chain, why: 'Estimate only the independently source-checked published serving; no captured or inferred macro labels.',
        source: row.source, origin: 'published-row', input, task: 'macro', expected: row.macros }));
    }
    const candidates = rows.filter(r => splits.get(r.id) === split && r.chain === row.chain && r.id !== row.id)
      .sort((a, b) => (b.name === row.name ? 1 : 0) - (a.name === row.name ? 1 : 0) || a.id.localeCompare(b.id)).slice(0, 3);
    cases.push(caseSchema.parse({ id: `bulk:measured:published:${row.id}`, tier: 'bulk', split, group, category: rowCategory(row),
      chain: row.chain, why: 'Published name, section and exact portion distinguish verified rows; optional tags are source metadata.',
      source: row.source, origin: 'published-row', input, task: 'matching', candidates: [row.id, ...candidates.map(r => r.id)],
      expected: { kind: 'match', matchId: row.id } }));
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return { exclusions, addedRows: addedRows.length, admitted: decisions.length, excluded: exclusions.length,
    version: plan.version, sourceHead: captureManifest.sourceHead,
    splitFamilies: Object.fromEntries([...parent.keys()].map(id => [id, familyGroups.get(find(id))])),
    sources: ['capture-manifest.json', 'plan.json', 'v1-lock.json', 'row-checks.jsonl', 'pdf-pages.json.gz', 'official-osf.html.gz',
      ...Object.keys(captureManifest.files)].map(file => ({ file: `scripts/eval/suite/sources/measured/${file}`,
      sha256: sha256(readFileSync(join(directory, file))) })) };
}
