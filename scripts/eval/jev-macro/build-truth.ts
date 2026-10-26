import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTruth, repository, truthPath } from './truth';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) throw new Error('Usage: eval:jev-macro:truth [--check]');
const truth = buildTruth();
const contents = JSON.stringify(truth, null, 2) + '\n';
if (args[0] === '--check') {
  if (readFileSync(resolve(repository, truthPath), 'utf8') !== contents) throw new Error('truth.json differs from deterministic local sources');
} else writeFileSync(resolve(repository, truthPath), contents);
process.stdout.write(JSON.stringify({ total: truth.rows.length,
  byChain: Object.fromEntries([...new Set(truth.rows.map(row => row.chain))].map(chain =>
    [chain, truth.rows.filter(row => row.chain === chain).length])), exclusions: truth.exclusions.length }) + '\n');
