#!/usr/bin/env node
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Use the @expo/fingerprint version shipped with this checkout's Expo SDK,
// exactly as expo-updates does when resolving a fingerprint runtime.
export async function nativeFingerprint(root) {
  const mobile = resolve(root, 'apps/mobile');
  const require = createRequire(resolve(mobile, 'package.json'));
  const expoRequire = createRequire(require.resolve('expo/package.json'));
  const { createFingerprintAsync } = expoRequire('@expo/fingerprint');
  const { version } = expoRequire('@expo/fingerprint/package.json');
  // Expo can warn and omit a failed config/autolinking source. Such a partial
  // fingerprint must never establish native compatibility.
  let warnings = 0;
  const warn = console.warn;
  console.warn = (...args) => { warnings++; warn(...args); };
  let result;
  try { result = await createFingerprintAsync(mobile, { platforms: ['ios'] }); }
  finally { console.warn = warn; }
  const config = result.sources.find(source => source.type === 'contents' && source.id === 'expoConfig' && source.hash);
  if (warnings || !config || !/^[a-f0-9]{40}$/.test(result.hash))
    throw new Error('Expo fingerprint collection is incomplete; fix configuration or autolinking before OTA');
  if (existsSync(resolve(mobile, 'ios')) && !result.sources.some(source =>
    source.hash && source.filePath && /^ios(?:\/|$)/.test(source.filePath)))
    throw new Error('Local iOS sources are omitted by Expo; ship and verify a binary before OTA');
  const app = JSON.parse(config.contents);
  return { fingerprint: { hash: result.hash, package_version: version },
    app: { bundle_id: app.ios?.bundleIdentifier, version: app.version,
      runtime_version: app.ios?.runtimeVersion ?? app.runtimeVersion } };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await nativeFingerprint(resolve(fileURLToPath(new URL('../..', import.meta.url)))))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
