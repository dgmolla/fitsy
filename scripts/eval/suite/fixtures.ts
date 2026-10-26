import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { caseSchema, rowSchema, type Case, type Split, type Tier } from './types';

export const root = resolve(__dirname, '../../..');
export const suite = join(root, 'scripts/eval/suite');
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function durableAppend(file: string, value: unknown) {
  const fd = openSync(file, 'a', 0o600);
  try { appendFileSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
}
export const dataFile = (tier: Tier, split: Split) => `data/${tier}.${split}.jsonl`;
export function verifyChecksums(directory = suite) {
  const lines = readFileSync(join(directory, 'holdout.sha256'), 'utf8').trim().split('\n');
  const expected = ['data/curated.holdout.jsonl', 'data/bulk.holdout.jsonl', 'data/rows.json'];
  if (lines.length !== expected.length) throw new Error('Invalid holdout checksum manifest');
  for (const [index, line] of lines.entries()) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match || match[2] !== expected[index] || sha256(readFileSync(join(directory, match[2]!))) !== match[1]) {
      throw new Error('Holdout checksum mismatch; expected-output changes require human review');
    }
  }
  return sha256(readFileSync(join(directory, 'holdout.sha256')));
}
export function loadCases(split: Split, tier: Tier | 'both', directory = suite) {
  const checksum = verifyChecksums(directory);
  const tiers: Tier[] = tier === 'both' ? ['curated', 'bulk'] : [tier];
  const files = tiers.map(t => dataFile(t, split));
  const bytes = files.map(file => readFileSync(join(directory, file), 'utf8'));
  const cases = bytes.flatMap((contents, index) => contents.trim().split('\n').map(line => {
    const c = caseSchema.parse(JSON.parse(line));
    if (c.split !== split || c.tier !== tiers[index]) throw new Error('Case in wrong partition');
    return c;
  }));
  if (new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('Duplicate case ID');
  const rows = rowSchema.array().parse(JSON.parse(readFileSync(join(directory, 'data/rows.json'), 'utf8')));
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate reference ID');
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const c of cases) {
    if (!byId.has(c.group)) throw new Error('Missing serving group');
    if (c.task === 'matching' && (new Set(c.candidates).size !== c.candidates.length
      || c.candidates.some(id => !byId.has(id)) || (c.expected.kind === 'match'
        ? !c.expected.matchId || !c.candidates.includes(c.expected.matchId) : c.expected.matchId !== null))) {
      throw new Error('Invalid matching expectation or candidate references');
    }
  }
  return { cases, rows, checksum, fixtureSha256: sha256(bytes.join('\n')) };
}
export function stratifiedSample(cases: Case[], count: number): Case[] {
  if (count >= cases.length) return cases;
  if (count <= 0) return [];
  const buckets = new Map<string, Case[]>();
  for (const c of cases) {
    const key = `${c.tier}/${c.task}/${c.chain}/${c.category}`;
    buckets.set(key, [...(buckets.get(key) ?? []), c]);
  }
  const queues = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, values]) =>
    values.sort((a, b) => sha256(a.id).localeCompare(sha256(b.id))));
  const result: Case[] = [];
  while (result.length < count) {
    for (const queue of queues) {
      const c = queue.shift();
      if (c) result.push(c);
      if (result.length === count) break;
    }
  }
  return result;
}
