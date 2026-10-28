import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Brand, Prisma, PrismaClient } from '@prisma/client';
import { applyCatalogPlan, planChainPilot, stateHash } from '../../apps/api/services/chainPilotPlan';
import { applyAprilChainBatch, MAX_APRIL_CHUNK, type AprilBatchEntry } from '../../apps/api/services/chainAprilBatch';
import { aprilMenuIdentity, buildBrandIdentityMatcher } from '../../apps/api/services/chainServing';
import { buildChainMatcher } from '../../apps/api/services/chainCatalog';
import { fetchPipelinePdfSource, researchUrl } from '../../apps/api/services/pipelinePdfSource';
import { discover, onDomain } from '../eval/pdf-finder/discover';
import { extract } from '../eval/pdf-finder/extract';
import { digest, type JournalEvent } from './journal';
import { LeaseLostError } from './queue';
import { PdfJobQueue, PDF_LEASE_MS, type PdfJob } from './pdf-queue';
import { pdfBrandHash, readVerifiedPdf, sealPdf, verifyPdf, PdfVerificationError, type PdfEvidence, type VerifiedPdf } from './pdf-verify';

export interface PdfOptions { mode: 'pdf-enqueue' | 'pdf-worker'; brandIds: string[]; workerId: string; maxJobs: number; out: string }
export function parsePdfOptions(args: string[]): PdfOptions {
  const mode = args[0];
  if (mode !== 'pdf-enqueue' && mode !== 'pdf-worker') throw new Error('Use pdf-enqueue or pdf-worker');
  const values = new Map<string, string>(), brandIds: string[] = [];
  for (const arg of args.slice(1)) {
    const match = /^--(brand-id|worker-id|max-jobs|out)=(.+)$/.exec(arg);
    if (!match || (match[1] !== 'brand-id' && values.has(match[1]!))) throw new Error('Invalid or repeated PDF option');
    if (match[1] === 'brand-id') {
      if (mode !== 'pdf-enqueue' || !/^[\w-]{1,128}$/.test(match[2]!)) throw new Error('Invalid PDF brand ID');
      brandIds.push(match[2]!);
    } else {
      if (mode === 'pdf-enqueue') throw new Error('PDF enqueue accepts only explicit brand IDs');
      values.set(match[1]!, match[2]!);
    }
  }
  const maxJobs = Number(values.get('max-jobs') ?? 1), workerId = values.get('worker-id') ?? '', out = values.get('out') ?? '';
  if (mode === 'pdf-enqueue' && !brandIds.length) throw new Error('PDF enqueue requires --brand-id=ID');
  if (mode === 'pdf-worker' && (!workerId.trim() || workerId.length > 128 || !out
    || !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 1000)) throw new Error('PDF worker requires --worker-id=ID --out=PRIVATE_DIR [--max-jobs=1..1000]');
  return { mode, brandIds: [...new Set(brandIds)], maxJobs, workerId, out };
}

/** Uses the existing bounded finder/parser; its inferred domains never grant landing authority. */
async function researchPdf(brand: Brand, out: string, signal: AbortSignal): Promise<{ evidence: PdfEvidence; extraction: Awaited<ReturnType<typeof extract>> }> {
  const domain = brand.officialUrl ? researchUrl(brand.officialUrl).hostname.replace(/^www\./, '') : null;
  mkdirSync(join(out, 'search'), { recursive: true, mode: 0o700 });
  mkdirSync(join(out, 'downloads'), { recursive: true, mode: 0o700 });
  const session = await discover(brand.displayName, domain, out, url => fetchPipelinePdfSource(url, signal));
  writeFileSync(join(out, 'discovery.json'), JSON.stringify(session.discovery, null, 2) + '\n', { mode: 0o600 });
  for (const candidate of session.discovery.candidates.slice(0, 12)) {
    signal.throwIfAborted();
    const origin = candidate.discoveredFrom.find(from => from.kind === 'official-link' && domain && onDomain(from.url, domain));
    if (!origin || !domain || !onDomain(candidate.url, domain)) continue;
    try {
      const source = await session.download(candidate.url), page = session.cache.get(origin.url);
      if (!page || !onDomain(source.url, domain) || !onDomain(page.url, domain)) continue;
      const extraction = await extract(join(out, source.file));
      if (!extraction.items.length) continue;
      return { extraction, evidence: { sourceUrl: source.url, pageUrl: page.url, fetchedAt: new Date().toISOString(),
        sourceBase64: readFileSync(join(out, source.file)).toString('base64'), pageBase64: readFileSync(join(out, page.file)).toString('base64') } };
    } catch { signal.throwIfAborted(); }
  }
  throw new PdfVerificationError('No current official nutrition document with an established brand domain');
}

class PdfLease {
  readonly controller = new AbortController();
  private readonly stopped = new AbortController();
  private readonly heartbeat: Promise<void>;
  constructor(queue: PdfJobQueue, job: PdfJob) {
    this.heartbeat = (async () => {
      while (!this.stopped.signal.aborted) {
        try { await delay(PDF_LEASE_MS / 4, undefined, { signal: this.stopped.signal, ref: false }); }
        catch { return; }
        if (this.stopped.signal.aborted) return;
        try { await queue.renew(job); }
        catch { this.controller.abort(new LeaseLostError()); return; }
      }
    })();
  }
  async stop() { this.stopped.abort(); await this.heartbeat; }
}

async function snapshot(prisma: PrismaClient) {
  const brands = await prisma.brand.findMany({ where: { detectionConf: { in: ['high', 'llm-confirmed'] }, menuKind: 'restaurant' } });
  return { brands, identity: buildBrandIdentityMatcher(brands) };
}

/** Only new official estimates are added. Reviewed/hand-corrected estimates and unmatched dishes are untouched. */
async function rematch(prisma: PrismaClient, brand: Brand, guardInTx: (tx: Prisma.TransactionClient) => Promise<void>) {
  const { identity } = await snapshot(prisma);
  const catalog = await prisma.chainItem.findMany({ where: { brandId: brand.id } }), match = buildChainMatcher(catalog);
  const restaurants = await prisma.restaurant.findMany({ where: { menuKind: 'restaurant' } });
  let matched = 0;
  for (const restaurant of restaurants.filter(row => identity(row) === brand.id)) {
    // Cursor pagination bounds memory even for large chain menus; each chunk uses the reviewed writer.
    let cursor: string | undefined;
    while (true) {
      const items = await prisma.menuItem.findMany({ where: { restaurantId: restaurant.id, retiredAt: null },
        include: { macroEstimates: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' }, take: MAX_APRIL_CHUNK,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!items.length) break;
      const entries: AprilBatchEntry[] = [];
      for (const before of items) {
        if (before.macroEstimates.some(e => e.source === 'official')) continue;
        const result = match(brand.id, aprilMenuIdentity(before), restaurant);
        if (result.status === 'matched') entries.push({ before, approved: result.row });
      }
      if (entries.length) { await applyAprilChainBatch(prisma, entries, { guardInTx, preserveExistingOfficial: true }); matched += entries.length; }
      cursor = items.at(-1)!.id;
    }
  }
  return matched;
}

export async function workPdfJob(prisma: PrismaClient, queue: PdfJobQueue, options: PdfOptions, source: JournalEvent) {
  const job = await queue.claim(options.workerId);
  if (!job) return null;
  const lease = new PdfLease(queue, job), signal = lease.controller.signal;
  const out = join(options.out, digest([job.brandId, job.attempts, job.leaseToken]));
  mkdirSync(out, { recursive: true, mode: 0o700 });
  try {
    await queue.append(job, 'source', source);
    const { brands, identity } = await snapshot(prisma), brand = brands.find(row => row.id === job.brandId);
    if (!brand) throw new PdfVerificationError('Chain identity is no longer verified');
    let packet: VerifiedPdf;
    const saved = await queue.latest(job, 'verified');
    if (saved) packet = readVerifiedPdf(saved, brand);
    else {
      const { evidence, extraction } = await researchPdf(brand, out, signal);
      await queue.append(job, 'document', { evidence, extraction });
      const catalog = await prisma.chainItem.findMany({ where: { brandId: brand.id } });
      const restaurants = (await prisma.restaurant.findMany({ where: { menuKind: 'restaurant' } })).filter(row => identity(row) === brand.id);
      const menus = [];
      for (const restaurant of restaurants) menus.push({ restaurant, items: await prisma.menuItem.findMany({ where: { restaurantId: restaurant.id, retiredAt: null } }) });
      packet = sealPdf(brand, evidence, verifyPdf(brand, brands, catalog, menus, evidence, extraction));
      await queue.append(job, 'verified', packet);
    }
    const guardInTx = async (tx: Prisma.TransactionClient) => {
      signal.throwIfAborted();
      await queue.lockInTx(job, tx);
      await tx.$queryRaw`SELECT id FROM "Brand" WHERE id = ${brand.id} FOR SHARE`;
      const current = await tx.brand.findUnique({ where: { id: brand.id } });
      if (!current || pdfBrandHash(current) !== packet.brandHash) throw new PdfVerificationError('Brand changed before landing');
      const age = Date.now() - Date.parse(packet.evidence.fetchedAt);
      if (!Number.isFinite(age) || age < 0 || age >= 86_400_000) throw new PdfVerificationError('Verified PDF snapshot expired');
    };
    const catalog = await prisma.chainItem.findMany({ where: { brandId: brand.id } });
    const plan = planChainPilot(brands, catalog, packet.batch);
    await queue.append(job, 'catalog_plan', { plan, verificationHash: packet.hash });
    // Same audited, digest-bound catalog path as maintained chain onboarding. No retired landing script.
    await applyCatalogPlan(prisma, plan, packet.batch, guardInTx);
    const matched = await rematch(prisma, brand, guardInTx);
    await queue.append(job, 'completed', { matched, catalogAdded: plan.changes.length, verificationHash: packet.hash });
    await lease.stop(); signal.throwIfAborted();
    await queue.finish(job, true);
    return { brandId: job.brandId, attempt: job.attempts, status: 'completed', matched, catalogAdded: plan.changes.length };
  } catch (error) {
    await lease.stop();
    if (signal.aborted || error instanceof LeaseLostError) return { brandId: job.brandId, attempt: job.attempts, status: 'lease_lost' };
    // Provider exceptions can include private data; retained payloads contain only bounded safe diagnostics.
    const reason = error instanceof PdfVerificationError ? error.message : 'PDF execution failed; inspect source evidence and retry window';
    await queue.append(job, 'failure', { reason });
    await queue.finish(job, false);
    return { brandId: job.brandId, attempt: job.attempts, status: job.attempts >= job.maxAttempts ? 'failed' : 'retry', reason };
  } finally { await lease.stop(); }
}

export async function runPdfCommand(prisma: PrismaClient, options: PdfOptions, source: JournalEvent) {
  const queue = new PdfJobQueue(prisma);
  if (options.mode === 'pdf-enqueue') {
    let enqueued = 0;
    for (const brandId of options.brandIds) if (await queue.enqueue(brandId)) enqueued++;
    return { enqueued };
  }
  const outcomes = [];
  for (let index = 0; index < options.maxJobs; index++) {
    const outcome = await workPdfJob(prisma, queue, options, source);
    if (!outcome) break;
    outcomes.push(outcome);
    if (outcome.status === 'lease_lost') break;
  }
  const status = outcomes.length ? outcomes.some(outcome => outcome.status !== 'completed') ? 'incomplete' : 'completed' : 'idle';
  return { status, outcomes, sourceHash: stateHash(source) };
}
