import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256, type Review } from './types';

/** Seeded random ordering; independent of row nutrition values. */
export function sampleKeys(keys: string[], seed: string, count = 10) {
  return [...keys].sort((a, b) => sha256(`${seed}\n${a}`).localeCompare(sha256(`${seed}\n${b}`))).slice(0, count);
}

export async function sample(directory: string, seed: string) {
  const review = JSON.parse(await readFile(join(directory, 'review.json'), 'utf8')) as Review;
  const sourceText = await readFile(join(directory, 'source.txt'), 'utf8');
  const keys = sampleKeys(review.changes.map(row => row.canonicalKey), seed);
  return { seed, chain: review.chain, sample: keys.map(key => {
    const row = review.changes.find(item => item.canonicalKey === key)!;
    const page = row.provenance.page === null ? sourceText : sourceText.split('\f')[row.provenance.page - 1]!;
    return { canonicalKey: key, name: row.provenance.name, locator: row.locator,
      sourceText: page.split('\n').slice(row.provenance.lineStart - 1, row.provenance.lineEnd).join('\n') };
  }) };
}

if (require.main === module) {
  const directory = process.argv[2], seed = process.argv[3] ?? randomBytes(16).toString('hex');
  if (!directory || process.argv.length > 4) {
    process.stderr.write('Usage: node --import tsx scripts/eval/pdf-finder/sample.ts SAVED_DIR [SEED]\n');
    process.exitCode = 1;
  } else sample(directory, seed).then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n'))
    .catch(error => { process.stderr.write(String(error) + '\n'); process.exitCode = 1; });
}
