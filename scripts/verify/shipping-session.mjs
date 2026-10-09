#!/usr/bin/env node
// One live execution owns admission across simulator, verification and pre-push.
// There is no saved verdict: closing this process closes admission.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceIdentity } from './receipt-cache.mjs';
import { git } from './impact-plan.mjs';

function identity(root, env = process.env) {
  if (git(['status', '--porcelain', '--untracked-files=all'], root).trim()) throw Error('candidate must remain frozen and committed');
  const recipe = join(root, '.evidence/verify/focused-tests.json');
  const bindingFile = join(root, '.evidence/delivery/binding.json');
  const binding = existsSync(bindingFile) ? readFileSync(bindingFile, 'utf8') : null;
  const issue = binding ? JSON.parse(binding).issue : null;
  const authorization = issue ? join(env.FITSY_REVIEW_COMPLETED_HOME || join(env.FITSY_REVIEW_HOME || join(process.env.HOME, '.fitsy-review'), 'completed'), `issue-${issue}.json`) : null;
  return JSON.stringify({ head: git(['rev-parse', 'HEAD'], root).trim(),
    base: git(['rev-parse', 'origin/main'], root).trim(), source: sourceIdentity(root), binding,
    authorization: authorization && existsSync(authorization) ? readFileSync(authorization, 'utf8') : null,
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
    socket.on('connect', () => socket.end(JSON.stringify({ root: realpathSync(resolve(root)), token: env.FITSY_SHIPPING_TOKEN })));
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
  root = realpathSync(resolve(root));
  const frozen = identity(root, env);
  const controls = resolve(fileURLToPath(new URL('../..', import.meta.url)));
  const runtime = controls === root ? null : identity(controls, env);
  if (runtime && git(['rev-parse', 'HEAD'], controls).trim() !== git(['rev-parse', 'origin/main'], controls).trim()) {
    throw Error('external shipping controls must be clean exact current main');
  }
  const stable = () => identity(root, env) === frozen && (!runtime || identity(controls, env) === runtime);
  // This existing admission completes cheap/focused checks and revalidates matching trusted review.
  const code = await execute('bash', [join(controls, 'scripts/verify/review-admission.sh')], root, { ...env, FITSY_SHIPPING_ROOT: root });
  if (code !== 0) return code;
  if (!stable()) throw Error('candidate changed during admission');
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
        if (invalidated || !stable()) {
          invalidated = true;
          throw Error('candidate changed; finish edits and revalidate cheap checks and matching review');
        }
        socket.end('pass');
      } catch (error) { socket.end(error.message); }
    });
  });
  try {
    await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(socketPath, resolvePromise); });
    const result = await execute(command, args, root, { ...env, FITSY_SHIPPING_SOCKET: socketPath, FITSY_SHIPPING_TOKEN: token });
    if (invalidated || !stable()) throw Error('candidate changed during shipping');
    return result;
  } finally {
    await new Promise(resolvePromise => server.close(resolvePromise));
    rmSync(directory, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    if (process.argv[2] === '--check') await assertShippingSession();
    else {
      const args = process.argv.slice(2);
      const root = args[0] === '--root' ? args.splice(0, 2)[1] : process.cwd();
      if (args.shift() !== '--') throw Error('usage: shipping-session.mjs [--root checkout] -- <shipping command>');
      process.exitCode = await shippingSession(args.shift(), args, { root });
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
