/** Cleanup workflow only: normalize query parameters without changing the shared guard. */
import { spawnSync } from 'node:child_process';
import { realpathSync, writeSync } from 'node:fs';
import { allowedParameters } from '../lib/db-target-guard';

export function sanitizeCleanupDatabaseUrl(value: string | undefined): { url: string; droppedKeys: string[] } {
  let url: URL;
  try { url = new URL(value ?? ''); }
  catch { throw new Error('Invalid cleanup database URL'); }
  const kept = new URLSearchParams(), seen = new Set<string>(), dropped = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key) || !allowedParameters.has(key) ||
        (key === 'options' && (value.length !== 30 || !/^reference=[a-z0-9]{20}$/.test(value)))) {
      dropped.add(key);
    } else kept.append(key, value);
    // An invalid first options value cannot promote a later duplicate into a route.
    seen.add(key);
  }
  url.search = kept.toString();
  return { url: url.toString(), droppedKeys: [...dropped] };
}

function main() {
  const { url, droppedKeys } = sanitizeCleanupDatabaseUrl(process.env['POSTGRES_PRISMA_URL']);
  // Escape workflow command data and flush masking before starting any consumer.
  const masked = url.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  writeSync(1, `::add-mask::${masked}\n`);
  // Legacy runner commands recognize ##[ anywhere in a line, including inside JSON.
  const names = JSON.stringify(droppedKeys).replaceAll('#', '\\u0023');
  if (droppedKeys.length) writeSync(1, `Dropped database URL query keys: ${names}\n`);
  const result = spawnSync('npx', ['tsx', 'scripts/maintenance/cleanup-test-fixtures.ts', ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, POSTGRES_PRISMA_URL: url },
  });
  if (result.error || result.signal) throw new Error('Cleanup process failed');
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(__filename)) {
  try { main(); }
  catch {
    // Parser/process errors can carry the credential; never render their details.
    process.stderr.write('::error::Unable to run cleanup with a sanitized database URL.\n');
    process.exitCode = 1;
  }
}
