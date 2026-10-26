import { attribute, children, clean, contents, descendants, documentOf, tag, type HtmlNode } from './html';
import type { Diagnostic, Extraction, ParsedItem } from './types';

type Macro = 'calories' | 'proteinG' | 'carbsG' | 'fatG';
const required: Macro[] = ['calories', 'proteinG', 'carbsG', 'fatG'];
const exact = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:g|kcal)?$/i;
export const numberOf = (value: string): number | null => exact.test(value.trim())
  ? Number(value.replace(/,/g, '').replace(/(?:g|kcal)$/i, '').trim()) : null;

function field(label: string): Macro | 'servingSize' | null {
  const name = clean(label).toLowerCase().replace(/\([^)]*\)/g, '').trim();
  if (/^(?:total )?calories$/.test(name)) return 'calories';
  if (/^protein$/.test(name)) return 'proteinG';
  if (/^(?:total )?(?:carbs?|carbohydrates?|carbohydra\s*te)$/.test(name)) return 'carbsG';
  if (/^(?:fat|total ?fat|total fat \/ saturated fat)$/.test(name)) return 'fatG';
  if (/^serving(?: size)?$/.test(name)) return 'servingSize';
  return null;
}

function nutrition(values: Record<string, string>) {
  const numbers = Object.fromEntries(required.map(key => [key, numberOf(values[key] ?? '')]));
  if (required.some(key => numbers[key] === null)) return null;
  return numbers as Record<Macro, number>;
}

function energyNotes(item: Record<Macro, number>): string[] {
  const energy = item.proteinG * 4 + item.carbsG * 4 + item.fatG * 9;
  return Math.abs(energy - item.calories) > Math.max(60, item.calories * 0.2)
    ? ['Published energy/macros disagree beyond max(60 kcal, 20%); requires source review.'] : [];
}

interface Layout { name: string; columns: number; indices: Record<Macro, number>; serving?: number; servingUnit?: string }
const servingInName = (name: string) => /\b\d+(?:[./]\d+)?\s*(?:fl\s*oz|oz|g|lbs?|servings?|pieces?|pcs?|slices?|tablespoons?|teaspoons?|pancakes?|cups?)\b/i.exec(name)?.[0]
  ?? /\b(?:Share|Snack) Size\b/i.exec(name)?.[0] ?? null;

function headerFragment(value: string) {
  const rest = value.replace(/\b(?:total|fat|calories|protein|carbohydra|te|carbs|carbohydrates?|saturated|saturat|ed|cholesterol|choleste|rol|trans|sodium|dietary|fiber|sugars?|from|vit|a|c|calcium|iron|g|mg|kcal|iu)\b/gi, '')
    .replace(/[\s()/,-]/g, '');
  return !rest;
}

/** Profiles identify column order from source headers, never from the chain name. */
function pdfLayout(header: string): Layout | null {
  const normalized = clean(header);
  if (/Calories\s+Protein\s+Carbohydra\s+Total Fat/i.test(normalized)
    && /from fat/i.test(normalized)) {
    return { name: 'protein-before-carbs', columns: 11, indices: { calories: 0, proteinG: 2, carbsG: 3, fatG: 4 } };
  }
  if (/Total Calories\s+Fat Calories.*Total Fat.*Saturated Fat.*Trans Fat.*Cholesterol.*Sodium.*Total Carbs.*Fiber.*Sugars.*Protein/i.test(normalized)) {
    return { name: 'calories-fat-carbs-protein', columns: /Vit A/i.test(normalized) ? 15 : 11,
      indices: { calories: 0, fatG: 2, carbsG: 7, proteinG: 10 } };
  }
  // Simple, fully labelled, space-aligned tables, including a published serving column.
  for (const line of header.split('\n')) {
    const cells = line.trim().split(/\s{2,}|\t+/);
    const mapped = cells.map(field);
    if (!required.every(key => mapped.includes(key))) continue;
    const first = mapped.findIndex(value => value !== null);
    if (first !== 1 || new Set(mapped.filter(Boolean)).size !== mapped.filter(Boolean).length) continue;
    const serving = mapped.indexOf('servingSize');
    return { name: 'labelled-columns', columns: cells.length - 1,
      indices: Object.fromEntries(required.map(key => [key, mapped.indexOf(key) - 1])) as Record<Macro, number>,
      ...(serving === -1 ? {} : { serving: serving - 1, ...(/\(g\)/i.test(cells[serving]!) ? { servingUnit: 'g' } : {}) }) };
  }
  return null;
}

const numericToken = /(?:[<>≤≥]\s*)?-?\d[\d,]*(?:\.\d+)?(?:\s?(?:mg|g|kcal))?|n\/a|[\u2013\u2014-]/gi;
function numericTail(line: string) {
  const starts = line.matchAll(/(?:^|\s{2,})(?=(?:[<>≤≥]\s*)?-?\d|n\/a\b)/gi);
  for (const match of starts) {
    const start = match.index;
    const suffix = line.slice(start).trim();
    const tokens = [...suffix.matchAll(numericToken)].map(token => token[0]);
    if (!suffix.replace(numericToken, '').trim()) return { name: line.slice(0, start).trim(), tokens };
  }
  return null;
}

export function parsePdfText(text: string): Extraction {
  const items: ParsedItem[] = [], diagnostics: Diagnostic[] = [];
  let layout: Layout | null = null, section = '';
  const sectionKey = (label: string) => label.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]/g, '');
  const sections = new Set<string>();
  const pages = text.replace(/\r/g, '').split('\f');
  // Some guides have a contents page. It provides section labels, never facts.
  for (const line of (pages[0] ?? '').split('\n')) {
    const match = /^(.*?)\s{2,}\d+\s*(?:-\s*\d+)?\s*$/.exec(line.trim());
    if (match?.[1]) sections.add(sectionKey(match[1]));
  }
  pages.forEach((pageText, pageIndex) => {
    const lines = pageText.split('\n');
    let pending: { text: string; line: number }[] = [];
    for (let index = 0; index < lines.length; index++) {
      const raw = lines[index]!, value = clean(raw);
      const header = lines.slice(index, index + 27).join('\n');
      // A profile starts only at a header, never by looking ahead from an item.
      const nutrientHeaders = raw.match(/\b(?:Calories|Protein|Carbohydra(?:te)?|Carbohydrates?|Carbs?|Total\s*Fat)\b/gi) ?? [];
      if ((nutrientHeaders.length >= 3 || /Total Calories\s+Fat Calories/i.test(raw)) && !numericTail(raw)) {
        const found = pdfLayout(header);
        if (found) {
          layout = found;
          const heading = raw.split(/Total Calories|Calories|\s{2,}(?=Serving)/i)[0]?.trim();
          if (heading && !/^(?:Item|Food|Menu)/i.test(heading)) section = heading;
          pending = [];
          continue;
        }
        layout = null;
        pending = [];
        diagnostics.push({ page: pageIndex + 1, line: index + 1, rawText: raw, reason: 'Unsupported nutrient header; previous table layout cleared.' });
        continue;
      }
      if (!value) { pending = []; continue; }
      if (/^(?:Page\s+\d+|\d+|v\.\d+-\d+|NUTRITION GUIDE|CLAIM JUMPER NUTRITION GUIDE)$/i.test(value)) { pending = []; continue; }
      const sectionLabel = value.replace(/\s*\([^)]*\)\s*$/, '');
      if (sections.has(sectionKey(sectionLabel))) { section = value; pending = []; continue; }
      const row = numericTail(raw);
      if (!row) {
        if (headerFragment(value)) continue;
        if (/^[A-Z][A-Z\s&',/-]{3,}$/.test(value)) { section = value; pending = []; continue; }
        pending.push({ text: value, line: index + 1 });
        continue;
      }
      if (!layout) {
        if (row.tokens.length >= 4) diagnostics.push({ page: pageIndex + 1, line: index + 1, rawText: raw, reason: 'Unrecognized header; no column order inferred.' });
        pending = [];
        continue;
      }
      const name = clean([...pending.map(part => part.text), row.name].join(' '));
      const lineStart = pending[0]?.line ?? index + 1;
      pending = [];
      if (row.tokens.length !== layout.columns || !name) {
        diagnostics.push({ page: pageIndex + 1, line: index + 1, rawText: raw,
          reason: `Expected ${layout.columns} columns and an item name under ${layout.name}; got ${row.tokens.length}.` });
        continue;
      }
      const macros = nutrition(Object.fromEntries(required.map(key => [key, row.tokens[layout!.indices[key]]!])));
      if (!macros) {
        diagnostics.push({ page: pageIndex + 1, line: index + 1, rawText: raw, reason: 'Missing, negative, ranged, or less-than macro; no exact value inferred.' });
        continue;
      }
      items.push({ name, section, servingSize: layout.serving === undefined ? servingInName(name)
        : `${row.tokens[layout.serving]!}${layout.servingUnit && !/[a-z]$/i.test(row.tokens[layout.serving]!) ? ` ${layout.servingUnit}` : ''}`,
        ...macros, page: pageIndex + 1, lineStart, lineEnd: index + 1,
        rawText: lines.slice(lineStart - 1, index + 1).join('\n'), notes: energyNotes(macros) });
    }
  });
  return { method: 'pdftotext -layout; header-identified columns', text, items, diagnostics };
}

export function parseHtml(html: string): Extraction {
  const document = documentOf(html), diagnostics: Diagnostic[] = [], items: ParsedItem[] = [];
  const textLines = ['Item\tSection\tServing\tCalories\tProtein (g)\tCarbs (g)\tFat (g)\tSource HTML lines\tNotes'];
  function append(node: HtmlNode, name: string, section: string, values: Record<string, string>, notes: string[] = []) {
    const location = 'sourceCodeLocation' in node ? node.sourceCodeLocation : null;
    const sourceLines = `${location?.startLine ?? 1}-${location?.endLine ?? 1}`;
    const macros = nutrition(values);
    if (!macros) {
      diagnostics.push({ page: null, line: location?.startLine ?? 1, rawText: clean(contents(node)), reason: 'HTML row/card lacks four exact nonnegative macros; no missing value inferred.' });
      return;
    }
    const servingSize = values.servingSize || null;
    textLines.push([name, section, servingSize ?? '', ...required.map(key => macros[key]), sourceLines, ...notes].join('\t'));
    items.push({ name, section, servingSize, ...macros, page: null,
      lineStart: textLines.length, lineEnd: textLines.length, rawText: textLines.at(-1)!,
      notes: [`Original HTML lines ${sourceLines}.`, ...notes, ...energyNotes(macros)] });
  }
  for (const table of descendants(document, node => tag(node) === 'table')) {
    const rows = descendants(table, node => tag(node) === 'tr');
    let headers: (ReturnType<typeof field>)[] = [], nameIndex = 0;
    const caption = descendants(table, node => tag(node) === 'caption')[0];
    const section = caption ? clean(contents(caption)) : attribute(table, 'aria-label') || 'Menu';
    for (const row of rows) {
      const cells = children(row).filter(node => ['td', 'th'].includes(tag(node)));
      const values = cells.map(node => clean(contents(node)));
      const mapped = values.map(field);
      if (required.every(key => mapped.includes(key))) {
        if (new Set(mapped.filter(Boolean)).size !== mapped.filter(Boolean).length) {
          diagnostics.push({ page: null, line: 1, rawText: values.join(' | '), reason: 'Duplicate nutrient headers are ambiguous.' });
          headers = [];
          continue;
        }
        headers = mapped;
        const explicitName = values.findIndex(value => /^(?:item(?: name)?|food(?: name)?|menu(?: item)?|name|product(?: name)?)$/i.test(value));
        nameIndex = explicitName >= 0 ? explicitName : mapped[0] === null ? 0 : -1;
        continue;
      }
      if (!headers.length) continue;
      if (cells.some(node => ['colspan', 'rowspan'].some(key => attribute(node, key) && attribute(node, key) !== '1'))
        || cells.length !== headers.length || nameIndex < 0) {
        diagnostics.push({ page: null, line: 1, rawText: values.join(' | '), reason: 'Ambiguous spanning or ragged HTML row.' });
        continue;
      }
      append(row, values[nameIndex]!, section, Object.fromEntries(headers.flatMap((key, index) => key ? [[key, values[index]!]] : [])));
    }
  }
  // Label/value cards are common on official sites, including OSF's static accordion.
  const containers = descendants(document, node => ['li', 'article'].includes(tag(node)));
  for (const container of containers) {
    if (descendants(container, node => ['li', 'article', 'table'].includes(tag(node))).length) continue;
    const values: Record<string, string> = {}, notes: string[] = [];
    for (const p of descendants(container, node => tag(node) === 'p')) {
      const parts = children(p).filter(node => tag(node) === 'span').map(node => clean(contents(node)));
      if (parts.length !== 2) continue;
      const key = field(parts[0]!);
      if (key) values[key] = key === 'fatG' && /saturated/i.test(parts[0]!) ? parts[1]!.split('/')[0]! : parts[1]!;
      else if (/notes/i.test(parts[0]!)) notes.push(parts.join(': '));
    }
    if (!('calories' in values)) continue;
    const title = descendants(container, node => /^(?:button|h[2-6])$/.test(tag(node)))[0];
    if (!title) continue;
    const parent = 'parentNode' in container ? container.parentNode : null;
    const ancestor = parent && 'parentNode' in parent ? parent.parentNode : null;
    const sectionNode = ancestor ? children(ancestor).find(node => /^(?:button|h[2-6])$/.test(tag(node))) : null;
    append(container, clean(contents(title)), sectionNode ? clean(contents(sectionNode)) : '', values, notes);
  }
  return { method: 'parse5; labelled HTML tables/cards', text: textLines.join('\n') + '\n', items, diagnostics };
}
