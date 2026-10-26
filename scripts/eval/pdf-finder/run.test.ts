import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from './run';
import { sha256 } from './types';

test('actual offline command writes legacy-shaped unverified drafts, replays without fetching, and rejects tampering/overwrite', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pdf-finder-e2e-'));
  const originalFetch = global.fetch;
  global.fetch = jest.fn(() => { throw new Error('Offline path attempted network access'); });
  const out = join(root, 'first');
  const args = ['--chain', 'Test Chain', '--input', join(__dirname, 'fixtures/table.html'),
    '--source-url', 'https://chain.example.org/nutrition', '--out', out];
  try {
    const result = await run(args);
    expect(result).toMatchObject({ chain: 'Test Chain', items: 1, status: 'unverified' });
    const review = await readFile(join(out, 'review.json'), 'utf8');
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    expect(manifest.source.sha256).toBe(sha256(await readFile(join(out, manifest.source.file))));
    expect(manifest.extraction.sha256).toBe(sha256(await readFile(join(out, 'source.txt'))));
    const legacy = JSON.parse(await readFile(join(out, 'extraction.json'), 'utf8'));
    expect(legacy[0]).toMatchObject({ brand: 'test-chain', name: 'Rice & Chicken', serving: 250,
      calories: 410, proteinG: 35, carbsG: 45, fatG: 10, factStatus: 'unverified', status: 'unverified' });
    const replayOut = join(root, 'replayed');
    await run(['--replay', out, '--out', replayOut]);
    expect(await readFile(join(replayOut, 'review.json'), 'utf8')).toBe(review);
    await expect(run(args)).rejects.toThrow('EEXIST');
    await writeFile(join(out, manifest.source.file), '<html>Altered source</html>');
    await expect(run(['--replay', out, '--out', join(root, 'tampered')])).rejects.toThrow('SHA-256');
    expect(global.fetch).not.toHaveBeenCalled();
  } finally { global.fetch = originalFetch; await rm(root, { recursive: true, force: true }); }
});

test('argument errors happen before writing any output', async () => {
  await expect(run(['--chain', 'Test', '--input', 'anything', '--out', '/not-created'])).rejects.toThrow('--input and --source-url');
  await expect(run(['--replay', 'saved', '--chain', 'Test', '--out', '/not-created'])).rejects.toThrow('--replay cannot');
});
