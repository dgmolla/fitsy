import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Derive a standalone, exactly pinned build installation from the maintained lock.
// Mobile/Expo and workspace links never enter the worker image or its dependency installation.
export function runtimeManifest(lock) {
  const dependencies = Object.fromEntries(['@prisma/client', 'prisma', '@axiomhq/js', 'zod', 'h3-js', 'jose', 'esbuild'].map(name => {
    const version = lock.packages['node_modules/' + name]?.version;
    if (!version) throw new Error('Missing locked worker dependency: ' + name);
    return [name, version];
  }));
  const manifest = { name: 'fitsy-pipeline-worker', version: '1.0.0', private: true, dependencies };
  // Keep the actual locked dependency closure, including nested versions and optional platform binaries.
  // npm ci installs lock entries even when unreachable; merely deleting workspace links is insufficient.
  const packages = {};
  function dependency(from, name, optional = false) {
    let parent = from;
    while (true) {
      const key = (parent ? parent + '/' : '') + 'node_modules/' + name, entry = lock.packages[key];
      if (entry && !entry.link) { visit(key); return; }
      if (!parent) break;
      const index = parent.lastIndexOf('/node_modules/');
      parent = index < 0 ? '' : parent.slice(0, index);
    }
    if (!optional) throw new Error('Missing locked transitive worker dependency: ' + name);
  }
  function visit(key) {
    if (packages[key]) return;
    const entry = lock.packages[key];
    packages[key] = entry;
    for (const name of Object.keys(entry.dependencies ?? {})) dependency(key, name);
    for (const name of Object.keys(entry.optionalDependencies ?? {})) dependency(key, name, true);
    for (const name of Object.keys(entry.peerDependencies ?? {})) dependency(key, name, !!entry.peerDependenciesMeta?.[name]?.optional);
  }
  for (const name of Object.keys(dependencies)) dependency('', name);
  return { manifest, lock: { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true,
    packages: { '': manifest, ...packages } } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Pass the private dependency build directory');
  const out = resolve(process.argv[2]);
  const result = runtimeManifest(JSON.parse(readFileSync(new URL('../../../package-lock.json', import.meta.url), 'utf8')));
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, 'package.json'), JSON.stringify(result.manifest, null, 2) + '\n');
  writeFileSync(resolve(out, 'package-lock.json'), JSON.stringify(result.lock, null, 2) + '\n');
}
