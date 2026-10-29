import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requestJevDecision } from '../../apps/api/services/jevDecisionService';
import { JEV_LIMITS, parseChoiceAnswers, type JevRequest } from '../eval/lib/jev-experiment';
import { adapterProtocol, choiceMethod } from '../eval/suite/adapters';
import type { ChoiceClient } from '../eval/suite/budget';
import { DailyBudgetExceeded, type PaidBudget, type PaidService } from './service-budget';
import { v2Telemetry } from './telemetry';

export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
// JSONB reorders object keys. Request identity must survive storage and another worker's parse.
export const requestKey = (request: JevRequest): string => digest(canonical(request));
export const protocolHash = digest({ limits: JEV_LIMITS, adapter: adapterProtocol });
// Convert to a number only after decimal billing arithmetic, preserving equality
// between queue admission, reservations and PostgreSQL's stored USD cap.
const jevInputUsd = (tokens: number): number => new Prisma.Decimal(tokens)
  .mul(JEV_LIMITS.pricing.inputUsdPerMillion).div(1_000_000).toNumber();
export const reservationUsd = jevInputUsd(JEV_LIMITS.reservedInputTokens);
const usageSchema = z.object({ usage: z.object({ input_tokens: z.number().int().positive().safe(), output_tokens: z.number().int().nonnegative().safe() }) });
export type JournalEvent = { event: string; at?: string; [key: string]: unknown };
export interface JournalIdentity { runId: string; hexId: string; target: string }
export const journalHeader = (identity: JournalIdentity, capUsd: number): JournalEvent =>
  ({ event: 'identity', ...identity, protocolHash, capUsd });

function usage(body: string): number | null {
  try {
    const parsed = usageSchema.safeParse(JSON.parse(body));
    return parsed.success ? jevInputUsd(parsed.data.usage.input_tokens) : null;
  } catch { return null; }
}
function validateResponse(request: JevRequest, response: { status: number; body: string }) {
  if (response.status !== 200) throw new Error(`Jev HTTP ${response.status}; no retry`);
  const raw: unknown = JSON.parse(response.body);
  if (!z.object({ model: z.literal(JEV_LIMITS.requiredModel) }).safeParse(raw).success) throw new Error('Jev model drift; no retry');
  parseChoiceAnswers(request, raw);
  return raw;
}

function claimLock(directory: string): string {
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const owners = readdirSync(directory);
    const match = owners.length === 1 ? /^(\d+)-[a-f0-9-]{36}\.owner$/.exec(owners[0]!) : null;
    if (!match) throw new Error('Uncertain POC lock owner; inspect the private journal before recovery');
    const ownerPath = join(directory, owners[0]!);
    if (readFileSync(ownerPath, 'utf8') !== hostname()) throw new Error('POC lock belongs to another host');
    let absent = false;
    try { process.kill(Number(match[1]), 0); }
    catch (error) { absent = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    if (!absent) throw new Error('POC journal already has a live or inaccessible owner');
    // The unique owner filename is a recovery claim. Only one recovering process
    // can unlink it; losers stop without touching a new owner's token/directory.
    unlinkSync(ownerPath); rmdirSync(directory); mkdirSync(directory, { mode: 0o700 });
  }
  const token = join(directory, `${process.pid}-${randomUUID()}.owner`);
  try { writeFileSync(token, hostname(), { flag: 'wx', mode: 0o600 }); }
  catch (error) { rmdirSync(directory); throw error; }
  return token;
}

/** Both local and shared storage use the same spend reservation and replay rules. */
export abstract class V2Ledger implements ChoiceClient {
  knownUsd = 0;
  stopped: string | null = null;
  requests = 0;
  reusedRequests = 0;
  unknown = false;
  dailyCap: PaidService | null = null;
  context = '';
  readonly events: JournalEvent[] = [];
  private readonly responses = new Map<string, { status: number; body: string; latencyMs: number }>();
  private readonly cap: number;
  private inFlight = false;
  readonly estimator = choiceMethod('jev-v3', this).estimator!;

  constructor(cap = 5, private readonly budget?: PaidBudget) {
    if (!Number.isFinite(cap) || cap < 0 || cap > 5) throw new Error('DEV POC cap must be between $0 and $5');
    this.cap = cap;
  }

  protected load(events: JournalEvent[], identity: JournalIdentity, cap: number): JournalEvent {
    const header = journalHeader(identity, cap);
    if (events.length && !isDeepStrictEqual(events[0], header)) throw new Error('POC journal identity, protocol or cap changed');
    this.events.push(...events);
    const pending = new Set<string>(), requests = new Map<string, JevRequest>(), canonicalKeys = new Set<string>();
    for (const event of events.slice(1)) {
      if (event.event === 'jev_request') {
        const request = event.request as JevRequest, key = String(event.key), stableKey = requestKey(request);
        // Existing local #591 ledgers used insertion-order hashes. Read them without rewriting history.
        if ((key !== stableKey && key !== digest(request)) || requests.has(key) || canonicalKeys.has(stableKey)) throw new Error('Invalid or duplicated POC request record');
        pending.add(key); requests.set(key, request); canonicalKeys.add(stableKey); this.requests++;
      } else if (event.event === 'jev_response') {
        const key = String(event.key);
        if (!pending.delete(key) || typeof event.body !== 'string' || !Number.isInteger(event.status)
          || !Number.isFinite(event.latencyMs) || Number(event.latencyMs) < 0) throw new Error('Invalid POC response record');
        const cost = usage(event.body);
        if (cost === null) this.unknown = true;
        else this.knownUsd += cost;
        this.responses.set(requestKey(requests.get(key)!), { status: Number(event.status), body: event.body, latencyMs: Number(event.latencyMs) });
        // Usage exceeding the reservation remains accounted, but never permits more paid work.
        if (cost !== null && cost > reservationUsd) this.stopped = 'Jev usage exceeded the reserved envelope';
        try { validateResponse(requests.get(key)!, { status: Number(event.status), body: event.body }); }
        catch { this.stopped ??= 'Invalid prior Jev response; inspect the retained response before resuming'; }
      }
    }
    if (pending.size) this.unknown = true;
    return header;
  }

  abstract append(event: JournalEvent): void | Promise<void>;
  abstract close(): void;
  get signal(): AbortSignal | undefined { return undefined; }

  async enqueuePdf(brand: { id: string; displayName: string }): Promise<void> {
    if (this.events.some(event => event.event === 'pdf_search_enqueued' && event.brandId === brand.id)) return;
    await this.append({ event: 'pdf_search_enqueued', at: new Date().toISOString(), jobId: digest(['pdf-search', brand.id]),
      brandId: brand.id, name: brand.displayName, status: 'pending', reason: 'no-published-nutrition' });
  }

  async send(request: JevRequest): Promise<{ raw: unknown; costUsd: number; latencyMs: number }> {
    if (this.inFlight) throw new Error('POC requests must be serialized to preserve the spend reservation');
    this.inFlight = true;
    try { return await this.sendOne(request); }
    finally { this.inFlight = false; }
  }

  private async sendOne(request: JevRequest): Promise<{ raw: unknown; costUsd: number; latencyMs: number }> {
    if (Buffer.byteLength(JSON.stringify(request)) > JEV_LIMITS.maxRequestBytes) throw new Error('Jev request exceeds 12KB');
    const key = requestKey(request);
    let response = this.responses.get(key);
    if (this.unknown || this.stopped) throw new Error(this.stopped ?? 'Unknown Jev usage; reconcile before resuming');
    if (response) this.reusedRequests++;
    else {
      if (this.knownUsd + reservationUsd > this.cap) { this.stopped = 'DEV POC spend cap reached'; throw new Error(this.stopped); }
      const apiKey = process.env['TYPESAFE_API_KEY'] ?? '';
      if (!apiKey.trim()) throw new Error('TYPESAFE_API_KEY is required');
      let permit: string | undefined;
      try { permit = await this.budget?.reserve('jev', reservationUsd, this.context || key); }
      catch (error) { if (error instanceof DailyBudgetExceeded) this.dailyCap = error.service; throw error; }
      await this.append({ event: 'jev_request', at: new Date().toISOString(), requestId: randomUUID(), ...(permit ? { budgetId: permit } : {}), key, request, context: this.context });
      this.requests++;
      const start = performance.now();
      try {
        const result = await requestJevDecision(request, apiKey, this.signal);
        response = { ...result, latencyMs: performance.now() - start };
        if (response.status === 429) v2Telemetry.throttle('jev', { status: 429 });
        // Never retain a provider echo of the credential.
        if (response.body.includes(apiKey)) response.body = '[credential echo redacted; usage unknown]';
        if (permit) await this.budget!.settle(permit, usage(response.body), response.status === 429);
        await this.append({ event: 'jev_response', at: new Date().toISOString(), key, ...response });
        this.responses.set(key, response);
      } catch {
        this.unknown = true;
        await this.append({ event: 'transport_error', at: new Date().toISOString(), key, reason: 'Jev request failed; usage unknown' });
        throw new Error('Jev transport failed; usage unknown');
      }
      const cost = usage(response.body);
      if (cost === null) this.unknown = true;
      else this.knownUsd += cost;
      if (cost !== null && cost > reservationUsd) this.stopped = 'Jev usage exceeded the reserved envelope';
    }
    const cost = usage(response.body);
    if (cost === null || this.unknown || this.stopped) throw new Error(this.stopped ?? 'Unknown Jev usage; reconcile before resuming');
    try { return { raw: validateResponse(request, response), costUsd: cost, latencyMs: response.latencyMs }; }
    catch (error) {
      this.stopped = 'Invalid Jev response; inspect the retained response before resuming';
      throw error;
    }
  }

}

/** Private single-host POC storage. Shared workers use the database-backed ledger. */
export class V2Journal extends V2Ledger {
  private fd: number | undefined;
  private lockToken: string | undefined;

  constructor(readonly path: string, identity: JournalIdentity, cap = 5, budget?: PaidBudget) {
    super(cap, budget);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.lockToken = claimLock(path + '.lock');
    try {
      this.fd = openSync(path, 'a+', 0o600);
      const bytes = readFileSync(path, 'utf8');
      if (bytes && !bytes.endsWith('\n')) throw new Error('Incomplete POC journal; spend requires reconciliation');
      const events: JournalEvent[] = bytes.trim() ? bytes.trim().split('\n').map(line => JSON.parse(line)) : [];
      const header = this.load(events, identity, cap);
      if (!events.length) this.append(header);
    } catch (error) { this.close(); throw error; }
  }

  append(event: JournalEvent): void {
    if (this.fd === undefined) throw new Error('POC journal is closed');
    appendFileSync(this.fd, JSON.stringify(event) + '\n'); fsyncSync(this.fd);
    this.events.push(event);
  }

  close(): void {
    if (this.fd !== undefined) { closeSync(this.fd); this.fd = undefined; }
    if (this.lockToken !== undefined) { unlinkSync(this.lockToken); rmdirSync(dirname(this.lockToken)); this.lockToken = undefined; }
  }
}
