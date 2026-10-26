import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { sampleKeys } from './sample';
import { sha256, type Discovery, type Download, type Review } from './types';

const directory = join(__dirname, 'demo');
interface Checks {
  chains: { directory: string; seed: string; sourceSha256: string; textSha256: string; matches: number;
    rows: { canonicalKey: string; observed: Record<'calories' | 'proteinG' | 'carbsG' | 'fatG', number>; matches: boolean }[] }[];
}
const checks = JSON.parse(readFileSync(join(directory, 'spot-checks.json'), 'utf8')) as Checks;

test.each([['wahoos', 1523], ['claim-jumper', 1244], ['old-spaghetti-factory', 175]] as const)(
  'saved %s demo binds every unverified row and 10 independent transcriptions to hashed source evidence', (name, count) => {
    const root = join(directory, name);
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
      source: Download; extraction: { sha256: string; itemCount: number };
    };
    const review = JSON.parse(gunzipSync(readFileSync(join(root, 'review.json.gz'))).toString('utf8')) as Review;
    const text = gunzipSync(readFileSync(join(root, 'source.txt.gz'))).toString('utf8');
    // Source binaries are not committed (size); verify when a local download is present.
    const sourceFile = join(root, manifest.source.file);
    if (existsSync(sourceFile)) expect(sha256(readFileSync(sourceFile))).toBe(manifest.source.sha256);
    expect(sha256(text)).toBe(manifest.extraction.sha256);
    expect(manifest.extraction.itemCount).toBe(count);
    expect(review.changes).toHaveLength(count);
    expect(new Set(review.changes.map(row => row.canonicalKey)).size).toBe(count);
    const pages = text.split('\f').map(page => page.split('\n'));
    for (const row of review.changes) {
      expect(row.status).toBe('unverified');
      expect(row.aliases).toEqual([]);
      expect(row.source.sha256).toBe(manifest.source.sha256);
      const { page, lineStart, lineEnd, rawText } = row.provenance;
      expect((page === null ? text.split('\n') : pages[page - 1]!).slice(lineStart - 1, lineEnd).join('\n')).toBe(rawText);
    }
    const discovery = JSON.parse(readFileSync(join(root, 'discovery.json'), 'utf8')) as Discovery;
    for (const search of discovery.searches) {
      if (search.file) expect(sha256(readFileSync(join(root, search.file)))).toBe(search.sha256);
    }
    expect(discovery.candidates.some(row => row.outcome.startsWith('Chosen:'))).toBe(true);
    const checked = checks.chains.find(row => row.directory === name)!;
    expect(checked.sourceSha256).toBe(manifest.source.sha256);
    expect(checked.textSha256).toBe(manifest.extraction.sha256);
    expect(sampleKeys(review.changes.map(row => row.canonicalKey), checked.seed)).toEqual(checked.rows.map(row => row.canonicalKey));
    expect(checked.rows).toHaveLength(10);
    expect(checked.matches).toBe(10);
    for (const row of checked.rows) {
      const actual = review.changes.find(item => item.canonicalKey === row.canonicalKey)!;
      expect(actual.facts).toMatchObject(row.observed);
      expect(row.matches).toBe(true);
    }
  },
);

test('demo selection is absent from the pinned local chain and reviewed source inventories', () => {
  const receipt = JSON.parse(readFileSync(join(directory, 'eligibility.json'), 'utf8')) as {
    sources: { file: string; sha256: string }[]; chains: { matches: string[] }[];
  };
  for (const source of receipt.sources) expect(sha256(readFileSync(resolve(__dirname, '../../..', source.file)))).toBe(source.sha256);
  expect(receipt.chains).toHaveLength(3);
  for (const chain of receipt.chains) expect(chain.matches).toEqual([]);
});
