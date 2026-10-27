import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSuite } from './build';
import { root, suite } from './fixtures';
import type { Row } from './types';

export function caseList() {
  const { cases } = buildSuite();
  const rows = JSON.parse(readFileSync(join(suite, 'data/rows.json'), 'utf8')) as Row[];
  const clean = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const count = (task: CaseTask) => cases.filter(c => c.tier === 'curated' && c.task === task).length;
  const lines = [`**TL;DR:** These ${count('matching')} matching and ${count('macro')} macro scenarios freeze verified servings and explicit hard-case expectations.`, '',
    '# Eval suite v1 curated cases', '',
    'This is a human review list; generating it does not execute any model or score holdout.',
    'Tune with dev only; do not copy holdout cases into prompts, rules, or examples.',
    'Matching scenarios marked synthetic deliberately alter chain, modifiers, or candidate availability; their nutrition reference stays the cited published row.',
    'Physical PDF page numbers are one-based; Wahoo\'s printed page is one less.',
    'Manufacturer sources use the named product-label page.', '',
    'Measured seeds retain a second citation to the captured UE card; NO MATCH is relative to the listed candidates.',
    'Measured candidates include their section, portion and optional source tags so identical names remain distinguishable.', '',
    '```mermaid', 'flowchart LR', '  R[Official serving and source] --> C[Explicit curated scenario]',
    '  C --> D[Dev: tuning allowed]', '  C --> H[Locked holdout: rare logged runs]', '```', ''];
  for (const task of ['matching', 'macro']) {
    lines.push(`## ${task === 'matching' ? 'Matching' : 'Macro estimation'}`, '',
      '| ID / split | Chain / category | Input and serving | Expected | Why | Source |', '| --- | --- | --- | --- | --- | --- |');
    for (const c of cases.filter(c => c.tier === 'curated' && c.task === task)) {
      const label = (id: string) => {
        const row = rows.find(r => r.id === id)!;
        return c.capture ? `${row.name} [${row.section}; ${row.serving}; ${(row.tags ?? []).join(', ')}; ${row.id}]` : row.name;
      };
      const expected = c.task === 'macro' ? `Cal/P/C/F: ${c.expected.calories}/${c.expected.protein}/${c.expected.carbs}/${c.expected.fat}`
        : c.expected.kind === 'none' ? 'NO MATCH' : `MATCH: ${label(c.expected.matchId!)}`;
      const details = c.task === 'matching' ? `; ${c.origin}; candidates: ${c.candidates.map(label).join(' / ')}` : '';
      const capture = c.capture ? `; [UE card line ${c.capture.line}](${c.capture.url})` : '';
      lines.push(`| ${clean(c.id)} / ${c.split} | ${clean(c.chain)} / ${c.category} | ${clean(c.input.name)}; ${clean(c.input.section)}; ${clean(c.input.serving)}${clean(details)} | ${clean(expected)} | ${clean(c.why)} | [page ${clean(String(c.source.page))}](${c.source.url})${capture} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
type CaseTask = 'matching' | 'macro';
if (require.main === module) {
  const file = join(root, 'docs/engineering/pipeline/eval-suite-cases.md'), contents = caseList();
  if (process.argv[2] === '--check') {
    if (readFileSync(file, 'utf8') !== contents) throw new Error('Curated case list is stale');
  } else writeFileSync(file, contents);
}
