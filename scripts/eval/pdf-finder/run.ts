import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { discover, domainOf, onDomain } from './discover';
import { extract } from './extract';
import { publicUrl } from './fetch';
import { buildReview, sha256, type Discovery, type Download, type Extraction } from './types';

const help = `Offline chain nutrition PDF finder (research drafts only)
  npm run eval:pdf-finder -- --chain "Chain Name" [--domain chain.com] --out NEW_DIR
  npm run eval:pdf-finder -- --chain "Chain Name" --input LOCAL.pdf --source-url https://chain.com/nutrition.pdf --out NEW_DIR
  npm run eval:pdf-finder -- --replay SAVED_DIR --out NEW_DIR
Discovery makes bounded public GET requests. Input/replay modes make zero network requests.
All rows remain unverified; no approval, database writes, or model calls exist.`;

const downloadSchema = z.object({ requestedUrl: z.url(), url: z.url(), file: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(), contentType: z.string() });
const manifestSchema = z.object({ version: z.literal(1), chain: z.string().min(1), source: downloadSchema });

function inside(root: string, file: string) {
  const path = resolve(root, file), rel = relative(resolve(root), path);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw new Error('Saved source path escapes replay directory.');
  return path;
}

async function json(file: string, value: unknown) { await writeFile(file, JSON.stringify(value, null, 2) + '\n'); }

export async function run(argv: string[]) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    chain: { type: 'string' }, domain: { type: 'string' }, out: { type: 'string' }, input: { type: 'string' },
    'source-url': { type: 'string' }, replay: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) return { help };
  if (!values.out) throw new Error(help);
  let chain = values.chain ?? positionals.join(' ');
  if (values.replay && (chain || values.input || values['source-url'] || values.domain)) throw new Error('--replay cannot be combined with chain, input, source-url, or domain.');
  if (!values.replay && !chain.trim()) throw new Error('A nonempty chain name is required.');
  if (Boolean(values.input) !== Boolean(values['source-url'])) throw new Error('--input and --source-url must be supplied together.');
  if (values.input && values.domain) throw new Error('--domain is for discovery; --input uses only its explicit source-url.');
  const domain = values.domain ? domainOf(values.domain) : null;
  if (values['source-url']) publicUrl(values['source-url']);
  const out = resolve(values.out);
  await mkdir(out); // Exclusive creation prevents replacing source evidence or prior reviews.
  await mkdir(join(out, 'search'));
  await mkdir(join(out, 'downloads'));
  let source: Download, extraction: Extraction;
  let discovery: Discovery = { chain, domainHint: domain, searches: [], candidates: [], selected: null, selectionReason: null };
  try {
    if (values.replay) {
      const previous = manifestSchema.parse(JSON.parse(await readFile(join(values.replay, 'manifest.json'), 'utf8')));
      chain = previous.chain;
      const bytes = await readFile(inside(values.replay, previous.source.file));
      if (sha256(bytes) !== previous.source.sha256 || bytes.length !== previous.source.bytes) throw new Error('Saved source SHA-256/byte length mismatch.');
      publicUrl(previous.source.url);
      const filename = `downloads/source.${bytes.subarray(0, 5).toString() === '%PDF-' ? 'pdf' : 'html'}`;
      await writeFile(join(out, filename), bytes);
      source = { ...previous.source, file: filename };
      discovery = JSON.parse(await readFile(join(values.replay, 'discovery.json'), 'utf8')) as Discovery;
      extraction = await extract(join(out, source.file));
    } else if (values.input) {
      const bytes = await readFile(resolve(values.input));
      const filename = `downloads/source.${bytes.subarray(0, 5).toString() === '%PDF-' ? 'pdf' : 'html'}`;
      await writeFile(join(out, filename), bytes);
      source = { requestedUrl: values['source-url']!, url: values['source-url']!, file: filename,
        sha256: sha256(bytes), bytes: bytes.length, contentType: 'local-snapshot' };
      discovery.selectionReason = 'Explicit local snapshot and source URL supplied by operator; official ownership remains unverified.';
      extraction = await extract(join(out, source.file));
    } else {
      const session = await discover(chain, domain, out);
      discovery = session.discovery;
      await json(join(out, 'discovery.json'), discovery);
      let selected: { source: Download; extraction: Extraction } | undefined;
      for (const candidate of discovery.candidates.filter(row => row.official && row.score >= 120).slice(0, 12)) {
        try {
          const saved = await session.download(candidate.url);
          const redirectedOffDomain = !onDomain(saved.url, new URL(candidate.url).hostname.replace(/^www\./, ''));
          if (redirectedOffDomain) throw new Error('Redirect changed domain; use an explicit reviewed source URL instead.');
          const parsed = await extract(join(out, saved.file));
          if (!parsed.items.length) throw new Error(`No supported complete nutrition rows (${parsed.diagnostics.length} diagnostics).`);
          selected = { source: saved, extraction: parsed };
          candidate.outcome = `Chosen: ${parsed.items.length} complete unverified rows; ${parsed.method}.`;
          discovery.selectionReason = `Highest-ranked successfully parsed official candidate (score ${candidate.score}). ${candidate.reasons.join(' ')} Selection does not verify facts or freshness.`;
          break;
        } catch (error) { candidate.outcome = error instanceof Error ? error.message : String(error); }
      }
      await json(join(out, 'discovery.json'), discovery);
      if (!selected) throw new Error('No supported official nutrition source found. Inspect discovery.json; supply a saved official PDF/HTML via --input and --source-url.');
      ({ source, extraction } = selected);
    }
    if (!extraction.items.length) throw new Error('No complete nutrition rows under supported headers.');
    discovery.selected = source;
    await json(join(out, 'discovery.json'), discovery);
    await writeFile(join(out, 'source.txt'), extraction.text);
    const review = buildReview(chain, source, extraction);
    await json(join(out, 'review.json'), review);
    // Same base row shape as the hand-checked chain-batch-source-extraction snapshot.
    await json(join(out, 'extraction.json'), review.changes.map(row => ({
      brand: row.slug, page: row.provenance.page, section: row.provenance.section, name: row.provenance.name,
      serving: row.facts.servingSize && /^\d+(?:\.\d+)?\s*g$/i.test(row.facts.servingSize)
        ? Number(row.facts.servingSize.replace(/g/i, '').trim()) : null,
      calories: row.facts.calories, proteinG: row.facts.proteinG, carbsG: row.facts.carbsG, fatG: row.facts.fatG,
      canonicalKey: row.canonicalKey, factStatus: 'unverified', reason: row.provenance.notes.join(' '),
      status: 'unverified', servingSize: row.facts.servingSize, source: row.source, locator: row.locator,
    })));
    await json(join(out, 'manifest.json'), { version: 1, status: 'unverified', chain,
      mode: values.replay ? 'replay' : values.input ? 'local-input' : 'web-discovery', source,
      extraction: { method: extraction.method, textFile: 'source.txt', sha256: sha256(extraction.text),
        itemCount: extraction.items.length, diagnosticCount: extraction.diagnostics.length },
      reviewFile: 'review.json', selectionReason: discovery.selectionReason });
    return { chain, url: source.url, sha256: source.sha256, items: review.changes.length,
      diagnostics: extraction.diagnostics.length, status: 'unverified', out };
  } catch (error) {
    await json(join(out, 'failure.json'), { status: 'failed', error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then(result => process.stdout.write('help' in result ? result.help + '\n' : JSON.stringify(result, null, 2) + '\n'))
    .catch(error => { process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n'); process.exitCode = 1; });
}
