import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENESIS, hasInteractionAndObservation, parseCapture, projectTrace, sealRecord } from '../verify/mcp-capture.mjs';

const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('the capture proxy relays a stand-in MCP server byte for byte and records a verifiable, projectable capture', t => {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-mcp-capture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const flowDir = join(root, '.evidence/product-flow');
  mkdirSync(join(flowDir, 'walkthrough/auth'), { recursive: true });
  writeFileSync(join(flowDir, 'report.json'), JSON.stringify({ walkthroughProtocol: 2, simulator: 'sim-udid',
    walkthroughPending: { state: 'ready', captureNonce: 'session-nonce', mcpCapture: 'walkthrough/auth/mcp-capture.jsonl',
      captureReceipt: 'walkthrough/auth/xctest-capture.jsonl' } }));
  const server = join(root, 'fake-maestro');
  writeFileSync(server, `#!${process.execPath}
const lines = require('node:readline').createInterface({ input: process.stdin });
lines.on('line', line => {
  const request = JSON.parse(line);
  if (request.method !== 'tools/call') return;
  const text = request.params.name === 'inspect_screen' ? 'Screen: Welcome' : 'Tapped';
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text }] } }) + '\\n');
});
`);
  chmodSync(server, 0o755);
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run', arguments: { yaml: '- tapOn: Start' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'inspect_screen', arguments: {} } },
  ].map(request => `${JSON.stringify(request)}\n`).join('');
  const result = spawnSync(process.execPath, ['scripts/sim/product-flow.mjs', 'capture-walkthrough'],
    { cwd: repository, input: requests, encoding: 'utf8', env: { ...process.env, FITSY_PRODUCT_ROOT: root, MAESTRO_BIN: server } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.split('\n').filter(Boolean).length, 2, 'every server line reaches the client unchanged');
  assert.deepEqual(JSON.parse(result.stdout.split('\n')[1]).result.content, [{ type: 'text', text: 'Screen: Welcome' }]);

  const captureBytes = readFileSync(join(flowDir, 'walkthrough/auth/mcp-capture.jsonl'));
  const records = parseCapture(captureBytes, { nonce: 'session-nonce' });
  assert.equal(records[0].dir, 'meta');
  assert.equal(records.filter(record => record.dir === 'in').length, 2);
  assert.equal(records.filter(record => record.dir === 'out').length, 2);
  const events = projectTrace(records).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(events.map(event => event.command.name), ['run', 'inspect_screen']);
  assert.deepEqual(events[0].command.arguments, { yaml: '- tapOn: Start' });
  assert.equal(hasInteractionAndObservation(events), true);
  assert.throws(() => parseCapture(captureBytes, { nonce: 'another-session' }), /not bound to this walkthrough session/);
  assert.throws(() => parseCapture(Buffer.from(captureBytes.toString().replace('Tapped', 'Invented')), { nonce: 'session-nonce' }),
    /not produced by the capture tooling/);

  const again = spawnSync(process.execPath, ['scripts/sim/product-flow.mjs', 'capture-walkthrough'],
    { cwd: repository, input: '', encoding: 'utf8', env: { ...process.env, FITSY_PRODUCT_ROOT: root, MAESTRO_BIN: server } });
  assert.notEqual(again.status, 0, 'an existing capture is never appended to or overwritten');
});

test('capture parsing rejects reordered, truncated-chain and missing-meta logs; error responses never project as passing events', () => {
  const meta = sealRecord(GENESIS, 0, 'meta', JSON.stringify({ nonce: 'n' }), '2026-01-01T00:00:00.000Z');
  const call = sealRecord(meta.hash, 1, 'in', JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'run' } }), '2026-01-01T00:00:01.000Z');
  const failure = sealRecord(call.hash, 2, 'out', JSON.stringify({ jsonrpc: '2.0', id: 7, error: { message: 'device offline' } }), '2026-01-01T00:00:02.000Z');
  const log = records => Buffer.from(`${records.map(record => JSON.stringify(record)).join('\n')}\n`);
  const events = projectTrace(parseCapture(log([meta, call, failure]), { nonce: 'n' })).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events[0].result.isError, true);
  assert.throws(() => parseCapture(log([meta, failure, call]), { nonce: 'n' }), /not produced by the capture tooling/);
  assert.throws(() => parseCapture(log([call, failure]), { nonce: 'n' }), /not produced by the capture tooling/);
  assert.throws(() => parseCapture(log([sealRecord(GENESIS, 0, 'in', '{}')]), { nonce: 'n' }), /not bound to this walkthrough session/);
});
