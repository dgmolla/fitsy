import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSuite } from './build';
import { root, suite } from './fixtures';
import type { Row } from './types';

export function caseList() {
  const { cases } = buildSuite();
  const rows = JSON.parse(readFileSync(join(suite, 'data/rows.json'), 'utf8')) as Row[];
  const clean = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = ['**TL;DR:** These 160 matching and 160 macro scenarios freeze official servings and explicit hard-case expectations.', '',
    '# Eval suite v1 curated cases', '',
    'This is a human review list; generating it does not execute any model or score holdout.',
    'Tune with dev only; do not copy holdout cases into prompts, rules, or examples.',
    'Matching scenarios marked synthetic deliberately alter chain, modifiers, or candidate availability; their nutrition reference stays the cited published row.',
    'Physical PDF page numbers are one-based; Wahoo\'s printed page is one less.',
    'Manufacturer sources use the named product-label page.', '',
    '```mermaid', 'flowchart LR', '  R[Official serving and source] --> C[Explicit curated scenario]',
    '  C --> D[Dev: tuning allowed]', '  C --> H[Locked holdout: rare logged runs]', '```', ''];
  for (const task of ['matching', 'macro']) {
    lines.push(`## ${task === 'matching' ? 'Matching' : 'Macro estimation'}`, '',
      '| ID / split | Chain / category | Input and serving | Expected | Why | Source |', '| --- | --- | --- | --- | --- | --- |');
    for (const c of cases.filter(c => c.tier === 'curated' && c.task === task)) {
      const expected = c.task === 'macro' ? `Cal/P/C/F: ${c.expected.calories}/${c.expected.protein}/${c.expected.carbs}/${c.expected.fat}`
        : c.expected.kind === 'none' ? 'NO MATCH' : `MATCH: ${rows.find(r => r.id === c.expected.matchId)!.name}`;
      const details = c.task === 'matching' ? `; ${c.origin}; candidates: ${c.candidates.map(id => rows.find(r => r.id === id)!.name).join(' / ')}` : '';
      lines.push(`| ${clean(c.id)} / ${c.split} | ${clean(c.chain)} / ${c.category} | ${clean(c.input.name)}; ${clean(c.input.section)}; ${clean(c.input.serving)}${clean(details)} | ${clean(expected)} | ${clean(c.why)} | [page ${c.source.page}](${c.source.url}) |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
if (require.main === module) {
  const file = join(root, 'docs/engineering/pipeline/eval-suite-cases.md'), contents = caseList();
  if (process.argv[2] === '--check') {
    if (readFileSync(file, 'utf8') !== contents) throw new Error('Curated case list is stale');
  } else writeFileSync(file, contents);
}
