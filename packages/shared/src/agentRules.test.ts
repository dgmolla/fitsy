import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Load the actual config and rules, relocating only TypeScript project roots.
// Tiny real projects keep this regression independent of native/Next type graphs.
test('API, mobile and shared reject incorrect async/type constructs and accept awaited work', () => {
  const root = mkdtempSync(join(tmpdir(), 'fitsy-app-lint-'));
  const files = ['apps/api/app/fixture.ts', 'apps/mobile/fixture.ts', 'packages/shared/fixture.ts'];
  const code = [
    // Assemble invalid test input separately from source-policy syntax, as in structural.test.ts.
    'export const value: ' + 'any = 1;',
    'export async function invalidAwait() { await 42; }',
    'export function condition() { if (Promise.resolve(false)) return 1; return 0; }',
    'export const task = new Promise(async (resolve) => { resolve(1); });',
    'export const constant = 1 + 2 ?? 0;',
    'export async function valid() { if (await Promise.resolve(false)) return 1; return 0; }',
    'Promise.resolve(1);',
  ].join('\n');
  for (const file of files) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), code);
  }
  for (const workspace of ['apps/api', 'apps/mobile', 'packages/shared']) {
    writeFileSync(join(root, workspace, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, lib: ['ES2022'], types: [] }, include: ['**/*.ts'] }));
  }
  writeFileSync(join(root, 'apps/mobile/tsconfig.eslint.json'), '{"extends":"./tsconfig.json"}');
  writeFileSync(join(root, 'apps/api/tsconfig.eslint.json'), '{"extends":"./tsconfig.json"}');
  const program = `
    import { ESLint } from 'eslint';
    import { pathToFileURL } from 'node:url';
    const { default: config } = await import(pathToFileURL(process.cwd() + '/eslint.config.mjs'));
    const cwd = process.argv[1];
    const lint = new ESLint({ cwd, overrideConfigFile: true, overrideConfig: config.map(entry =>
      entry.languageOptions?.parserOptions ? { ...entry, languageOptions: { ...entry.languageOptions,
        parserOptions: { ...entry.languageOptions.parserOptions, tsconfigRootDir: cwd } } } : entry) });
    const results = await lint.lintFiles(${JSON.stringify(files)});
    process.stdout.write(JSON.stringify(results.map(result => ({
      file: result.filePath.slice(cwd.length + 1), messages: result.messages,
    }))));
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', program, root], {
      cwd: resolve(__dirname, '../../..'),
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=512' },
      encoding: 'utf8', timeout: 30000,
    });
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
    const probes = JSON.parse(result.stdout) as { file: string; messages: { ruleId: string; line: number; severity: number }[] }[];
    expect(probes.map(probe => probe.file).sort()).toEqual([...files].sort());
    for (const probe of probes) {
      expect(probe.messages).toContainEqual(expect.objectContaining({
        ruleId: '@typescript-eslint/no-explicit-any', line: 1, severity: 2,
      }));
      for (const ruleId of ['@typescript-eslint/await-thenable',
        '@typescript-eslint/no-misused-promises', 'no-async-promise-executor', 'no-constant-binary-expression']) {
        expect(probe.messages).toContainEqual(expect.objectContaining({ ruleId, severity: 2 }));
      }
      expect(probe.messages.filter(message => message.line === 6)).toEqual([]);
      if (!probe.file.startsWith('apps/mobile/')) {
        expect(probe.messages).toContainEqual(expect.objectContaining({ ruleId: '@typescript-eslint/no-floating-promises', line: 7, severity: 2 }));
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 35000);
