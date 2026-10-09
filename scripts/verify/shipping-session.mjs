#!/usr/bin/env node
// One live execution owns admission across simulator, verification and pre-push.
// There is no saved verdict: closing this process closes admission.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceIdentity } from './receipt-cache.mjs';
import { git } from './impact-plan.mjs';

function identity(root) {
  if (git(['status', '--porcelain', '--untracked-files=all'], root).trim()) throw Error('candidate must remain frozen and committed');
  const recipe = join(root, '.evidence/verify/focused-tests.json');
  return JSON.stringify({ head: git(['rev-parse', 'HEAD'], root).trim(),
    base: git(['rev-parse', 'origin/main'], root).trim(), source: sourceIdentity(root),
    focused: existsSync(recipe) ? readFileSync(recipe, 'utf8') : null });
}
export function inShippingSession(env = process.env) {
  return Boolean(env.FITSY_SHIPPING_SOCKET || env.FITSY_SHIPPING_TOKEN);
}
export async function assertShippingSession(root = process.cwd(), env = process.env) {
  if (!env.FITSY_SHIPPING_SOCKET || !env.FITSY_SHIPPING_TOKEN) throw Error('run final acceptance inside scripts/verify/shipping-session.mjs -- <shipping command>');
  await new Promise((resolvePromise, reject) => {
    const socket = createConnection(env.FITSY_SHIPPING_SOCKET);
    let response = '';
    socket.setTimeout(5000, () => socket.destroy(Error('shipping session did not respond')));
    socket.on('error', reject);
    socket.on('connect', () => socket.end(JSON.stringify({ root: resolve(root), token: env.FITSY_SHIPPING_TOKEN })));
    socket.on('data', data => { response += data; });
    socket.on('end', () => {
      if (response === 'pass') resolvePromise();
      else reject(Error(response || 'shipping session is no longer active'));
    });
  });
}
function execute(command, args, root, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    const forward = signal => child.kill(signal);
    const interrupt = () => forward('SIGINT');
    const terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', reject);
    child.once('close', (code) => {
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
      resolvePromise(code ?? 1);
    });
  });
}
export async function shippingSession(command, args, { root = process.cwd(), env = process.env } = {}) {
  if (!command) throw Error('usage: shipping-session.mjs -- <shipping command>');
  if (inShippingSession(env)) throw Error('nested shipping sessions are forbidden');
  root = resolve(root);
  const frozen = identity(root);
  // This existing admission completes cheap/focused checks and fresh trusted review.
  const code = await execute('bash', ['scripts/verify/review-admission.sh'], root, env);
  if (code !== 0) return code;
  if (identity(root) !== frozen) throw Error('candidate changed during admission');
  const directory = mkdtempSync(join(tmpdir(), 'fitsy-shipping-'));
  const socketPath = join(directory, 'session.sock');
  const token = randomBytes(32).toString('hex');
  let invalidated = false;
  const server = createServer({ allowHalfOpen: true }, socket => {
    let request = '';
    socket.setTimeout(5000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', data => {
      request += data;
      if (request.length > 4096) socket.destroy();
    });
    socket.on('end', () => {
      try {
        const value = JSON.parse(request);
        if (value.token !== token || value.root !== root) throw Error('shipping execution owner mismatch');
        if (invalidated || identity(root) !== frozen) {
          invalidated = true;
          throw Error('candidate changed; finish edits and start fresh cheap checks and review');
        }
        socket.end('pass');
      } catch (error) { socket.end(error.message); }
    });
  });
  try {
    await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(socketPath, resolvePromise); });
    const result = await execute(command, args, root, { ...env, FITSY_SHIPPING_SOCKET: socketPath, FITSY_SHIPPING_TOKEN: token });
    if (invalidated || identity(root) !== frozen) throw Error('candidate changed during shipping');
    return result;
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
    rmSync(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === '--check') await assertShippingSession();
    else {
      if (process.argv[2] !== '--') throw Error('usage: shipping-session.mjs -- <shipping command>');
      process.exitCode = await shippingSession(process.argv[3], process.argv.slice(4));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
