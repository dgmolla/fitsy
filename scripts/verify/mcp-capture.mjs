// Provenance for interactive walkthrough evidence (#888). The capture proxy
// (product-flow.mjs capture-walkthrough) appends every JSON-RPC line it relays
// to a hash-chained log bound to a per-session nonce recorded in the report;
// the trace is a deterministic projection of that log. Dependency-free so the
// validator and the proxy share one definition.
import { createHash } from 'node:crypto';

export const GENESIS = '0'.repeat(64);
// Real tool names exposed by `maestro mcp` (tools/list): run, inspect_screen,
// take_screenshot, ... The legacy names are no longer produced by any tool.
export const interactionTools = ['run'];
export const observationTools = ['inspect_screen'];

const digest = text => createHash('sha256').update(text).digest('hex');
export const recordHash = (prev, { seq, at, dir, raw }) => digest(`${prev}\n${seq}\n${at}\n${dir}\n${raw}`);

export function sealRecord(prev, seq, dir, raw, at = new Date().toISOString()) {
  const record = { seq, at, dir, raw, prev };
  return { ...record, hash: recordHash(prev, record) };
}

// Throws unless every record chains from GENESIS, the first is the meta record
// carrying the expected nonce, and every direction is known.
export function parseCapture(bytes, { nonce }) {
  const records = [];
  let prev = GENESIS;
  for (const [seq, line] of bytes.toString().split('\n').filter(Boolean).entries()) {
    let record;
    try { record = JSON.parse(line); } catch { throw new Error('walkthrough capture is not JSONL'); }
    if (record.seq !== seq || record.prev !== prev || !['meta', 'in', 'out'].includes(record.dir) ||
        typeof record.raw !== 'string' || typeof record.at !== 'string' || record.hash !== recordHash(prev, record))
      throw new Error(`walkthrough capture was not produced by the capture tooling (record ${seq})`);
    records.push(record);
    prev = record.hash;
  }
  let meta;
  try { meta = records[0]?.dir === 'meta' ? JSON.parse(records[0].raw) : null; } catch { meta = null; }
  if (!nonce || meta?.nonce !== nonce) throw new Error('walkthrough capture is not bound to this walkthrough session');
  return records;
}

// One event per tools/call request/response pair, keyed by the real MCP tool
// name. A JSON-RPC error becomes an isError result so validators reject it.
export function projectTrace(records) {
  const calls = new Map(), events = [];
  for (const record of records) {
    if (record.dir === 'meta') continue;
    let message;
    try { message = JSON.parse(record.raw); } catch { continue; }
    if (record.dir === 'in' && message.method === 'tools/call') calls.set(message.id, message.params || {});
    else if (record.dir === 'out' && calls.has(message.id) && (message.result || message.error)) {
      const call = calls.get(message.id);
      calls.delete(message.id);
      events.push({ at: record.at, command: { name: call.name, arguments: call.arguments ?? {} },
        result: message.error ? { isError: true, content: [{ type: 'text', text: String(message.error.message || 'error') }] } : message.result });
    }
  }
  return events.map(event => `${JSON.stringify(event)}\n`).join('');
}

export function hasInteractionAndObservation(events) {
  return events.some(event => interactionTools.includes(event.command?.name)) &&
    events.some(event => observationTools.includes(event.command?.name));
}
