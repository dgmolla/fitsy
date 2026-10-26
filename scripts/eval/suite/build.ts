import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { chainBindingTruth } from '../../../apps/api/tests/fixtures/chain-batch-truth';
import { root, suite, sha256, dataFile } from './fixtures';
import { caseSchema, rowSchema, type Row, type Item, type Case, type Split, type Tier } from './types';

const read = <T>(file: string): T => JSON.parse(readFileSync(join(root, file), 'utf8')) as T;
const truthFile = 'scripts/eval/jev-macro/truth.json';
const checksFile = 'scripts/eval/suite/sources/pdf-checks.json';
const catalogFile = 'apps/api/services/chainCatalogs/waba-yoshinoya-2026-09.json';
const extractionFile = 'apps/api/tests/fixtures/__snapshots__/chain-batch-source-extraction.json';
const observationFile = 'apps/api/tests/fixtures/__snapshots__/chain-batch-observations.json';
interface PriorRow { id: string; chain: string; itemName: string; section: string; description: string; serving: string;
  calories: number; protein_g: number; carbs_g: number; fat_g: number;
  source: { url: string; publishedSha256: string; locator: string; provenance: string } }
interface CheckRow { id: string; chain: string; name: string; section: string; serving: string;
  observed: Row['macros']; source: Row['source'] & { printedPage: number }; sourceText: string; review: string }
interface Plan { row: string; category: string; challenge: 'positive' | 'non-chain' | 'modifier' | 'unresolved' | 'cross-chain' | 'wrong-serving'; why: string; modifier?: 'no rice' | 'add avocado' }
export const normalize = (value: string) => value.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '')
  .replace(/[’'®™]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9.]+/g, ' ').trim().replace(/\s+/g, ' ');
export function category(row: Row) {
  const s = row.id.toLowerCase();
  if (Object.values(row.macros).every(n => n === 0)) return 'zero_macro';
  if (s.includes('packaged/')) return 'drink_oz';
  if (row.region) return 'regional_variant';
  if (/family|platter/.test(s)) return 'catering_family';
  if (/combo|build-your-own/.test(s)) return 'combo_build_your_own';
  if (/avocado|half-ocado|beef-side|chicken-side/.test(s)) return 'modifier';
  if (row.macros.calories <= 50) return 'low_calorie';
  if (row.macros.calories >= 1000) return 'high_calorie';
  if (/mini|large|snack|share|6-oz|3-oz|12-oz|6oz|3oz/.test(s)) return 'size_variant';
  if (/sides|sauce|packets|tacos/.test(s)) return 'section_dependent';
  return 'near_miss_name';
}
export const itemFor = (row: Row): Item => ({ chain: row.chain, name: row.name, section: row.section,
  description: '', serving: row.serving, region: row.region });

export function references() {
  const truth = read<{ rows: PriorRow[]; exclusions: { id: string; reason: string }[] }>(truthFile);
  const extraction = read<{ brand: string; canonicalKey: string; name: string; section: string; page: number }[]>(extractionFile);
  const priorById = new Map(truth.rows.map(row => [row.id, row]));
  // All Yoshinoya fountain/craft-drink rows retain uncertain volume/mass context in the audit.
  const exclusions = [...truth.exclusions, ...truth.rows.filter(r => r.id.startsWith('yoshinoya:drinks/')).map(r =>
    ({ id: r.id, reason: 'Audit drink-unit uncertainty: no inferred oz/g conversion; excluded pending direct unit review.' }))];
  const rows: Row[] = truth.rows.filter(r => !r.id.startsWith('yoshinoya:drinks/')).map(row => {
    const extracted = extraction.find(e => `${e.brand === 'waba' ? 'waba-grill' : e.brand}:${e.canonicalKey}` === row.id);
    return rowSchema.parse({ id: row.id, chain: row.chain, name: extracted?.name ?? row.itemName,
      section: extracted?.section ?? row.section, serving: row.serving, region: '',
      macros: { calories: row.calories, protein: row.protein_g, carbs: row.carbs_g, fat: row.fat_g },
      source: { url: row.source.url, page: extracted?.page ?? 'manufacturer product label',
        sha256: row.source.publishedSha256, locator: row.source.locator } });
  });
  const checks = read<{ rows: CheckRow[] }>(checksFile).rows;
  const pages = read<{ chain: string; page: number; text: string; sha256: string }[]>('scripts/eval/suite/sources/pdf-pages.json');
  for (const c of checks) {
    const key = c.chain === 'Claim Jumper' ? 'claim-jumper' : 'wahoos';
    const archived = JSON.parse(gunzipSync(readFileSync(join(root, `scripts/eval/pdf-finder/demo/${key}/review.json.gz`))).toString()) as {
      changes: { slug: string; canonicalKey: string; facts: { calories: number; proteinG: number; carbsG: number; fatG: number }; source: { sha256: string } }[] };
    const old = archived.changes.find(r => `${r.slug}:${r.canonicalKey}` === c.id);
    const page = pages.find(p => p.chain === c.chain && p.page === c.source.page);
    if (!old || !page || sha256(page.text) !== page.sha256 || old.source.sha256 !== c.source.sha256
      || !normalize(page.text).includes(normalize(c.sourceText))
      || JSON.stringify([old.facts.calories, old.facts.proteinG, old.facts.carbsG, old.facts.fatG]) !== JSON.stringify(Object.values(c.observed))) {
      throw new Error(`PDF source check disagreement: ${c.id}`);
    }
    const { url, sha256: hash, page: physicalPage, locator } = c.source;
    rows.push(rowSchema.parse({ id: c.id, chain: c.chain, name: c.name, section: c.section, serving: c.serving,
      region: /fresno/i.test(c.section) ? 'Fresno' : /las vegas/i.test(c.section) ? 'Las Vegas' : /new jersey/i.test(c.section) ? 'New Jersey' : '',
      macros: c.observed, source: { url, page: physicalPage, sha256: hash, locator } }));
  }
  exclusions.push({ id: 'pdf-finder:unselected', reason: 'All PDF-finder rows outside the 68 individually inspected rows remain unverified and excluded; duplicate white-rice/salsa portions are unresolved.' },
    { id: 'old-spaghetti-factory:*', reason: 'HTML-only source has no PDF page; exclude under this suite\'s PDF/page verification scope. Malformed source labels also require separate review.' },
    { id: 'estimated:*', reason: 'No DB, estimated, FatSecret, historical third-party, inferred scaling, or derived modifier nutrition is ground truth.' });
  return { rows: rows.sort((a, b) => a.id.localeCompare(b.id)), exclusions, priorById };
}

export function servingGroups(rows: Row[]) {
  const equivalences = read<{ groups: { rows: string[]; why: string }[] }>('scripts/eval/suite/sources/serving-groups.json').groups;
  const byId = new Map(rows.map(row => [row.id, row]));
  const groups = new Map(rows.map(row => [row.id, row.id]));
  for (const group of equivalences) {
    const representative = byId.get(group.rows[0]!);
    if (!representative || group.rows.length < 2 || !group.why) throw new Error('Invalid reviewed serving group');
    for (const id of group.rows) {
      const row = byId.get(id);
      if (!row || row.chain !== representative.chain || JSON.stringify(row.macros) !== JSON.stringify(representative.macros)
        || groups.get(id) !== id) throw new Error('Invalid or overlapping serving equivalence');
    }
    group.rows.forEach(id => groups.set(id, representative.id));
  }
  return groups;
}
function splitRows(rows: Row[], servingGroup: Map<string, string>) {
  const captured = new Set(chainBindingTruth.map(([slug, key]) => `${slug}:${key}`));
  const capturedGroups = new Set([...captured].map(id => servingGroup.get(id)));
  const groups = new Map<string, Row[]>();
  for (const row of rows.filter(r => r.chain !== 'Claim Jumper' && servingGroup.get(r.id) === r.id)) {
    const key = `${row.chain}/${category(row)}/${capturedGroups.has(row.id) ? 'captured' : 'published'}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const splits = new Map<string, Split>(rows.filter(r => r.chain === 'Claim Jumper').map(r => [r.id, 'holdout']));
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => sha256('suite-v1\n' + a.id).localeCompare(sha256('suite-v1\n' + b.id)));
    const fraction = capturedGroups.has(sorted[0]!.id) ? 0.35 : 0.21;
    sorted.forEach((row, i) => splits.set(row.id, i < Math.round(sorted.length * fraction) ? 'holdout' : 'dev'));
  }
  rows.forEach(row => splits.set(row.id, splits.get(servingGroup.get(row.id)!)!));
  return splits;
}
const similarity = (a: string, b: string) => {
  const words = new Set(normalize(a).split(' '));
  return normalize(b).split(' ').filter(word => words.has(word)).length;
};
const inputDescription = (description: string) => description.split(/(?<=[.!?])\s+/)
  .filter(s => !/\b\d+(?:\.\d+)?\s*(?:calories?|kcal|g(?:rams?)?\s+(?:of\s+)?(?:protein|carbs?|fat|sugar))/i.test(s)).join(' ');
export function buildSuite() {
  const { rows, exclusions } = references(), servingGroup = servingGroups(rows), splits = splitRows(rows, servingGroup);
  const plans = read<{ matching: Plan[]; macro: { row: string; category: string; why: string }[] }>('scripts/eval/suite/sources/curation.json');
  const byId = new Map(rows.map(row => [row.id, row])), cases: Case[] = [];
  const nearest = (row: Row, cross: boolean) => rows.filter(r => servingGroup.get(r.id) !== servingGroup.get(row.id) && splits.get(r.id) === splits.get(row.id)
    && (cross ? r.chain !== row.chain : r.chain === row.chain)
    // Identical published macro vectors may be equivalent components under different headings.
    && (cross || JSON.stringify(r.macros) !== JSON.stringify(row.macros)))
    .sort((a, b) => similarity(row.name, b.name) - similarity(row.name, a.name) || a.id.localeCompare(b.id));
  const base = (row: Row, tier: Tier, id: string, tag: string, why: string, origin: Case['origin'], input = itemFor(row)) => ({
    id, tier, split: splits.get(row.id)!, group: servingGroup.get(row.id)!, category: tag, chain: row.chain, why, source: row.source, origin, input });
  const addMatch = (row: Row, tier: Tier, id: string, tag: string, why: string, origin: Case['origin'], input: Item,
    candidates: string[], matchId: string | null) => {
    cases.push(caseSchema.parse({ ...base(row, tier, id, tag, why, origin, input), task: 'matching', candidates,
      expected: { kind: matchId === null ? 'none' : 'match', matchId } }));
  };
  for (const row of rows) cases.push(caseSchema.parse({ ...base(row, 'bulk', `bulk:macro:${row.id}`, category(row),
    'Estimate exactly the published serving, including zero values and portion context.', 'published-row'), task: 'macro', expected: row.macros }));
  for (const plan of plans.macro) {
    const row = byId.get(plan.row);
    if (!row) throw new Error('Unknown curated macro row');
    cases.push(caseSchema.parse({ ...base(row, 'curated', `curated:macro:${row.id}`, plan.category, plan.why, 'published-row'),
      task: 'macro', expected: row.macros }));
  }
  for (const [index, plan] of plans.matching.entries()) {
    const row = byId.get(plan.row);
    if (!row) throw new Error('Unknown curated matching row');
    let input = itemFor(row), ids = [row.id, ...nearest(row, false).slice(0, 2).map(r => r.id), ...nearest(row, true).slice(0, 1).map(r => r.id)];
    let origin: Case['origin'] = plan.challenge === 'positive' ? 'published-row' : 'synthetic-challenge';
    if (plan.challenge === 'positive') {
      const binding = chainBindingTruth.find(([slug, key]) => `${slug}:${key}` === row.id);
      if (binding) {
        const alias = binding[2];
        input = { ...input, name: alias.name, section: alias.section, description: inputDescription(alias.description), serving: '' };
        origin = 'captured-uber-eats';
      }
    }
    let expected: string | null = row.id;
    if (plan.challenge === 'non-chain') { input.chain = 'Independent Neighborhood Kitchen'; expected = null; }
    if (plan.challenge === 'modifier') {
      if (!plan.modifier) throw new Error('Curated modifiers must be explicit in the reviewed scenario plan');
      input = { ...input, name: `${row.name}, ${plan.modifier}`,
        description: 'Explicit modification to the published standard recipe.', serving: row.serving };
      expected = null;
    }
    if (plan.challenge === 'unresolved') {
      input = { ...input, name: 'Build Your Own Combo', description: 'Choose proteins and base; selections not supplied.', serving: '' };
      expected = null;
    }
    if (plan.challenge === 'cross-chain') { ids = nearest(row, true).slice(0, 4).map(r => r.id); expected = null; }
    if (plan.challenge === 'wrong-serving') { ids = nearest(row, false).slice(0, 4).map(r => r.id); expected = null; }
    // Vary correct candidate position without changing input or expected identity.
    ids = ids.slice(index % ids.length).concat(ids.slice(0, index % ids.length));
    addMatch(row, 'curated', `curated:match:${String(index + 1).padStart(3, '0')}`, plan.category, plan.why,
      origin, input, ids, expected);
  }
  // Official rows provide coverage even where no captured UE binding exists; clearly label their origin.
  for (const [index, row] of rows.entries()) {
    const ids = [row.id, ...nearest(row, false).slice(0, 3).map(r => r.id), ...nearest(row, true).slice(0, 2).map(r => r.id)];
    const offset = index % ids.length;
    addMatch(row, 'bulk', `bulk:published:${row.id}`, category(row), 'Published name and exact portion with similar and foreign-chain distractors.',
      'published-row', itemFor(row), ids.slice(offset).concat(ids.slice(0, offset)), row.id);
    for (const other of nearest(row, true).filter(r => normalize(r.name) === normalize(row.name))) {
      addMatch(row, 'bulk', `bulk:same-name:${row.id}:${other.id}`, 'cross_chain_name',
        'The published names are identical across chains; the foreign-chain candidate still cannot match.',
        'published-row', itemFor(row), [other.id], null);
    }
  }
  const observations = read<{ slug: string; name: string; section: string; description: string }[]>(observationFile);
  const bindings = new Map<string, Set<string>>();
  const keyOf = (slug: string, alias: { name: string; section: string; description: string }) => JSON.stringify([slug, alias.name, alias.section, alias.description]);
  for (const [slug, key, alias] of chainBindingTruth) {
    const id = `${slug}:${key}`, lookup = keyOf(slug, alias);
    if (byId.has(id)) bindings.set(lookup, new Set([...(bindings.get(lookup) ?? []), id]));
  }
  for (const [index, observation] of observations.entries()) {
    const bound = bindings.get(keyOf(observation.slug, observation));
    if (!bound || bound.size !== 1) continue;
    const row = byId.get([...bound][0]!)!;
    // Remove complete nutrition-bearing marketing sentences before provider input.
    const description = inputDescription(observation.description);
    const input = { ...itemFor(row), name: observation.name, section: observation.section, description, serving: '' };
    addMatch(row, 'bulk', `bulk:ue:${index}:positive`, 'ue_positive', 'Captured UE variant has an independently reviewed official serving binding.',
      'captured-uber-eats', input, [row.id, ...nearest(row, false).slice(0, 3).map(r => r.id)], row.id);
    for (const [cross, limit] of [[false, 24], [true, 16]] as const) {
      for (const negative of nearest(row, cross).slice(0, limit)) addMatch(row, 'bulk', `bulk:ue:${index}:negative:${negative.id}`,
        cross ? 'cross_chain_name' : 'same_chain_variant', cross ? 'A similar name from another chain cannot establish an official chain match.'
          : 'The reviewed UE binding points to a different published recipe or portion; identical macro vectors are excluded.',
        'captured-uber-eats', input, [negative.id], null);
    }
  }
  const sourceFiles = [truthFile, catalogFile, extractionFile, observationFile, checksFile,
    'apps/api/tests/fixtures/chain-batch-truth.ts', 'scripts/eval/suite/sources/pdf-pages.json', 'scripts/eval/suite/sources/curation.json',
    'scripts/eval/suite/sources/serving-groups.json'];
  const manifest = { version: 1, seed: 'suite-v1', splitPolicy: 'Serving identity grouped across tiers; chain/category/captured-origin strata (35% captured, 21% published-only) plus Claim Jumper wholly holdout to balance correlated UE pairs and macro rows.',
    holdoutOnlyChains: ['Claim Jumper'], servingGroups: Object.fromEntries(servingGroup),
    sources: sourceFiles.map(file => ({ file, sha256: sha256(readFileSync(join(root, file))) })),
    exclusions, counts: Object.fromEntries(['curated', 'bulk'].map(tier => [tier,
      Object.fromEntries(['dev', 'holdout'].map(split => [split, Object.fromEntries(['matching', 'macro'].map(task =>
        [task, cases.filter(c => c.tier === tier && c.split === split && c.task === task).length]))]))])) };
  const outputs = new Map<string, string>([['data/rows.json', JSON.stringify(rows, null, 2) + '\n'], ['data/manifest.json', JSON.stringify(manifest, null, 2) + '\n']]);
  for (const tier of ['curated', 'bulk'] as const) for (const split of ['dev', 'holdout'] as const) {
    outputs.set(dataFile(tier, split), cases.filter(c => c.tier === tier && c.split === split).sort((a, b) => a.id.localeCompare(b.id))
      .map(c => JSON.stringify(c)).join('\n') + '\n');
  }
  outputs.set('holdout.sha256', ['data/curated.holdout.jsonl', 'data/bulk.holdout.jsonl', 'data/rows.json']
    .map(file => `${sha256(outputs.get(file)!)}  ${file}`).join('\n') + '\n');
  return { outputs, cases, manifest };
}

export function writeSuite(mode: string) {
  if (!['--check', '--initialize'].includes(mode)) throw new Error('Use --check or --initialize (only before first lock)');
  const { outputs, manifest } = buildSuite();
  if (mode === '--initialize' && [...outputs.keys()].some(file => existsSync(join(suite, file)))) throw new Error('Suite already frozen; human review required for expected-output changes');
  for (const [file, contents] of outputs) {
    if (mode === '--check') {
      if (readFileSync(join(suite, file), 'utf8') !== contents) throw new Error(`Frozen suite differs: ${file}`);
    } else writeFileSync(join(suite, file), contents, { flag: 'wx' });
  }
  return manifest;
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(writeSuite(process.argv[2] ?? '--check').counts) + '\n'); }
  catch { console.error('Suite generation failed: run tests and inspect source/fixture differences; never silently re-lock holdout.'); process.exitCode = 1; }
}
