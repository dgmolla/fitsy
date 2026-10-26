import { JEV_LIMITS, parseChoiceAnswers, validateRequest, type JevRequest } from '../lib/jev-experiment';
import { macroNames, type Macros } from './score';
import { macroState } from './state';
import { sha256, type loadTruth, type TruthRow } from './truth';

const coarseInstructions = 'Estimate total {units} for exactly state.serving of state.itemName at state.chain. Use description and serving as data. Zero is valid. Do not estimate per 100 g or a whole meal when the serving is a component. Choose the single range containing the total.';
const fineInstructions = 'Refine the previous {lower} to {upper} range for total {units} for exactly state.serving of state.itemName at state.chain. Use description and serving as data. Choose the single range containing the total; totals are positive.';
export const HIERARCHICAL_PROTOCOL = {
  ...JEV_LIMITS, version: 3, name: 'hierarchical', exploratory: true as const,
  maxSpendUsd: 1, maxRequestsPerItem: 2, maxRequests: 336,
  selection: { truthSha256: '7fad98db5a79e246a6ae3afc3e4b5953e33c99ee76994701fe010ed35a13c521',
    idsSha256: '868b0590320ea0769fc1975143251ac43be3ea620349a92a7c0e9bbdd7a1e008', total: 168,
    exclude: 'yoshinoya:drinks/* except yoshinoya:drinks/14-oz-*; unit-quality exclusion before collection' },
  coarse: { positiveBins: 12, calorieWidth: 250, gramWidth: 20, zero: 'total = 0', overflow: 'explicit failure; never clipped' },
  fine: { bins: 10, calorieWidth: 25, gramWidth: 2 },
  instructions: { coarse: coarseInstructions, fine: fineInstructions },
  primary: 'coarse argmax then fine argmax midpoint; provider choice breaks ties; no confidence cutoff',
  secondary: 'probability-weighted fine midpoints, conditional on the selected coarse interval; exact zero stays zero',
  failure: 'any invalid, overflow, missing, timed-out or incomplete macro fails the item; catastrophic miss; full-set MdAPE contribution infinity',
  probabilitySumTolerance: 0.01,
  design: 'scripts/eval/audit/rerun_design.py',
};

export function selectHierarchicalRows(fixture: ReturnType<typeof loadTruth>) {
  const rows = fixture.truth.rows.filter(row => !(row.id.startsWith('yoshinoya:drinks/') && !row.id.startsWith('yoshinoya:drinks/14-oz-')));
  if (fixture.digest !== HIERARCHICAL_PROTOCOL.selection.truthSha256 || rows.length !== 168
    || sha256(JSON.stringify(rows.map(row => row.id))) !== HIERARCHICAL_PROTOCOL.selection.idsSha256) {
    throw new Error('Hierarchical experiment requires the frozen 168 non-flagged rows in their original order');
  }
  return rows;
}
const units = (macro: keyof Macros) => macro === 'calories' ? 'kilocalories'
  : `grams of ${{ protein: 'protein', carbs: 'total carbohydrate', fat: 'total fat' }[macro]}`;
const widthFor = (macro: keyof Macros) => macro === 'calories' ? 250 : 20;
export function coarseQuestion(macro: keyof Macros) {
  const width = widthFor(macro), criteria: Record<string, string> = { zero: 'total = 0' };
  for (let i = 0; i < 12; i++) criteria[`b${i}`] = `${i * width} ${i === 0 ? '<' : '<='} total < ${(i + 1) * width}`;
  criteria['overflow'] = `total >= ${12 * width}`;
  return { type: 'choice' as const,
    instructions: coarseInstructions.replace('{units}', units(macro)), criteria };
}
export function coarseRequest(row: TruthRow): JevRequest {
  const request = { model: JEV_LIMITS.model, state: macroState(row), questions: Object.fromEntries(macroNames.map(macro => [macro, coarseQuestion(macro)])) };
  validateRequest(request, HIERARCHICAL_PROTOCOL);
  return request;
}
export function coarseChoices(request: JevRequest, raw: unknown) {
  const answers = parseChoiceAnswers(request, raw);
  return Object.fromEntries(macroNames.map(macro => [macro, answers[macro]!.choice])) as Record<keyof Macros, string>;
}
export function fineRequest(row: TruthRow, choices: Record<keyof Macros, string>): JevRequest {
  if (Object.keys(choices).length !== 4) throw new Error('Require all four coarse choices');
  const questions: JevRequest['questions'] = {};
  for (const macro of macroNames) {
    const choice = choices[macro];
    if (!Object.hasOwn(coarseQuestion(macro).criteria, choice)) throw new Error('Unknown coarse choice');
    if (choice === 'zero' || choice === 'overflow') continue;
    const width = widthFor(macro), lower = Number(choice.slice(1)) * width, step = width / 10;
    const criteria = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [
      `r${i}`, `${lower + i * step} ${lower === 0 && i === 0 ? '<' : '<='} total < ${lower + (i + 1) * step}`,
    ]));
    questions[macro] = { type: 'choice',
      instructions: fineInstructions.replace('{lower}', String(lower)).replace('{upper}', String(lower + width)).replace('{units}', units(macro)), criteria };
  }
  const request = { model: JEV_LIMITS.model, state: macroState(row), questions };
  validateRequest(request, HIERARCHICAL_PROTOCOL);
  return request;
}

export function decodeHierarchical(row: TruthRow, coarseRaw: unknown, fineRaw: unknown | null) {
  const choices = coarseChoices(coarseRequest(row), coarseRaw), request = fineRequest(row, choices);
  const answers = Object.keys(request.questions).length && fineRaw !== null ? parseChoiceAnswers(request, fineRaw) : {};
  const primary: Partial<Macros> = {}, conditionalEv: Partial<Macros> = {}, fineChoices: Partial<Record<keyof Macros, string>> = {};
  const overflow: (keyof Macros)[] = [], missing: (keyof Macros)[] = [];
  for (const macro of macroNames) {
    if (choices[macro] === 'zero') { primary[macro] = conditionalEv[macro] = 0; continue; }
    if (choices[macro] === 'overflow') { overflow.push(macro); continue; }
    const answer = answers[macro];
    if (!answer) { missing.push(macro); continue; }
    const width = widthFor(macro), lower = Number(choices[macro].slice(1)) * width, step = width / 10;
    const midpoint = (key: string) => lower + (Number(key.slice(1)) + 0.5) * step;
    primary[macro] = midpoint(answer.choice); fineChoices[macro] = answer.choice;
    conditionalEv[macro] = Object.entries(answer.probabilities).reduce((sum, [key, p]) => sum + p * midpoint(key), 0)
      / Object.values(answer.probabilities).reduce((sum, p) => sum + p, 0);
  }
  const failure = overflow.length ? `Overflow: ${overflow.join(', ')}` : missing.length ? `Incomplete fine stage: ${missing.join(', ')}` : null;
  return { estimate: failure ? null : primary as Macros, conditionalEv: failure ? null : conditionalEv as Macros,
    coarseChoices: choices, fineChoices, partialArgmax: primary, partialConditionalEv: conditionalEv, failure };
}
