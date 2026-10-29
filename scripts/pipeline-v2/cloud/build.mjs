import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const revision = process.env.SOURCE_REVISION ?? 'uncommitted';
if (revision !== 'uncommitted' && !/^[a-f0-9]{40}$/.test(revision)) throw new Error('SOURCE_REVISION must be a full Git SHA or uncommitted');
const out = resolve(process.argv[2] ?? join(root, '.evidence/pipeline-v2/cloud-build'));
mkdirSync(out, { recursive: true });
const files = [];
function collect(path) {
  for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
    if (['node_modules', '.tsbuild', '__pycache__'].includes(entry.name)) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) collect(child);
    else if (/\.(?:ts|mjs|json|prisma|sql)$/.test(child) && !/\.(?:test|spec)\./.test(child)) files.push(child);
  }
}
for (const path of ['scripts', 'apps/api/services', 'packages/shared/src', 'prisma']) collect(path);
files.push('package.json', 'package-lock.json');
const hash = createHash('sha256');
for (const file of files.sort()) hash.update(relative(root, join(root, file)) + '\0').update(readFileSync(join(root, file))).update('\0');
writeFileSync(join(out, 'source.json'), JSON.stringify({ event: 'source', sourceHash: hash.digest('hex'),
  head: revision, at: new Date().toISOString() }) + '\n');
await build({ absWorkingDir: root, entryPoints: { 'pipeline-cloud-worker': 'scripts/pipeline-cloud-worker.ts',
  'pipeline-worker-preflight': 'scripts/deploy/pipeline-worker-preflight.ts' },
  outdir: out, outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', target: 'node22', format: 'cjs',
  external: ['@prisma/client'], tsconfig: 'scripts/tsconfig.json', metafile: true,
}).then(result => writeFileSync(join(out, 'bundle-inputs.json'), JSON.stringify(Object.keys(result.metafile.inputs).sort()) + '\n'));
process.stdout.write('Worker bundles and source manifest built\n');
