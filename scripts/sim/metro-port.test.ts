import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';

function listen(host?: string): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', reject);
    const done = () => resolvePromise({ port: (server.address() as { port: number }).port,
      close: () => new Promise(r => { server.close(() => r()); }) });
    if (host) server.listen(0, host, done); else server.listen(0, done);
  });
}

// product-flow.mjs is exercised in a child process, as the other sim tests do; the listener below stays bound in this one.
function check(port: number): string {
  const script = `import { assertPortFree } from ${JSON.stringify(resolve(__dirname, 'product-flow.mjs'))};`
    + `try { await assertPortFree(${port}); process.stdout.write('free'); } catch (error) { process.stdout.write(error.message); }`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).stdout;
}

describe('Metro port ownership check', () => {
  test.each([['a wildcard (dual-stack) listener', undefined], ['a 127.0.0.1 listener', '127.0.0.1']])('reports %s as busy with the owner action', async (_name, host) => {
    const held = await listen(host);
    try {
      expect(check(held.port)).toMatch(/already in use by another process.*stop-metro/);
    } finally { await held.close(); }
  });

  test('a free port passes', async () => {
    const probe = await listen();
    const { port } = probe;
    await probe.close();
    expect(check(port)).toBe('free');
  });
});
