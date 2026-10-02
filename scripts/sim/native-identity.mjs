import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const identityHash = value => sha(stable(value));
export const sealReceipt = receipt => ({ ...receipt, receiptHash: identityHash(receipt) });
const nativeFile = path => /^(apps\/mobile\/(ios\/|android\/)|patches\/)/.test(path) ||
  /^(apps\/mobile\/(expo|react-native)\.config\.[cm]?[jt]s|apps\/mobile\/eas\.json)$/.test(path);
const command = (cmd, args, cwd, env) => execFileSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const normalize = (value, root) => {
  if (typeof value === 'string') return value.startsWith(root) ? `<checkout>/${relative(root, value)}` : value;
  if (Array.isArray(value)) return value.map(item => normalize(item, root));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item, root)]));
  return value;
};

// The resolved graphs are authoritative. A lockfile edit to a JS-only package
// does not affect this identity; an autolinked package version or Pod does.
export function nativeIdentity(root, env = process.env, execute = command) {
  const mobile = join(root, 'apps/mobile');
  const cleanEnv = { ...Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_'))), EXPO_NO_DOTENV: '1', NODE_ENV: 'development' };
  const expo = JSON.parse(execute('node', [join(root, 'node_modules/expo/bin/cli'), 'config', '--type', 'introspect', '--json'], mobile, cleanEnv));
  const expoGraph = JSON.parse(execute('node', [join(root, 'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking'), 'resolve', '--platform', 'ios', '--json'], mobile, cleanEnv));
  const rnGraph = JSON.parse(execute('node', [join(root, 'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking'), 'react-native-config', '--platform', 'ios', '--json'], mobile, cleanEnv));
  const nativeConfig = { name: expo.name, slug: expo.slug, scheme: expo.scheme, version: expo.version,
    orientation: expo.orientation, icon: expo.icon, splash: expo.splash, ios: expo.ios, plugins: expo.plugins,
    updates: expo.updates, runtimeVersion: expo.runtimeVersion, mods: expo._internal?.modResults?.ios };
  const linked = [...new Set([...expoGraph.modules.map(module => module.packageName), ...Object.keys(rnGraph.dependencies)])].sort();
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const nativePackages = Object.fromEntries(linked.map(name => [name, lock.packages[`node_modules/${name}`]?.version || null]));
  nativePackages.expo = lock.packages['node_modules/expo']?.version || null;
  nativePackages['react-native'] = lock.packages['node_modules/react-native']?.version || null;
  const paths = execute('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'apps/mobile', 'patches'], root, cleanEnv)
    .split('\0').filter(nativeFile).sort();
  const files = Object.fromEntries(paths.map(path => [path, existsSync(join(root, path)) ? sha(readFileSync(join(root, path))) : '<deleted>']));
  for (const path of ['apps/mobile/ios/Podfile.lock']) if (existsSync(join(root, path))) files[path] = sha(readFileSync(join(root, path)));
  for (const path of [expo.icon, expo.ios?.icon, expo.ios?.splash?.image, expo.splash?.image].filter(Boolean)) {
    const absolute = resolve(mobile, path);
    if (!absolute.startsWith(mobile + '/') || !existsSync(absolute)) throw new Error(`Native resource is missing or outside mobile: ${path}`);
    files[relative(root, absolute)] = sha(readFileSync(absolute));
  }
  const inputs = normalize({ nativeConfig, expoGraph, rnGraph, nativePackages, files }, root);
  return { hash: sha(stable(inputs)), inputs };
}

export function profileIdentity(profile, device, env = process.env, execute = command) {
  const xcode = execute('xcodebuild', ['-version'], process.cwd(), env);
  const sdk = execute('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'], process.cwd(), env);
  const inputs = { target: 'iphonesimulator', os: device.os, architecture: process.arch,
    configuration: profile.configuration,
    storeCapability: profile.storeMode === 'test-store' ? 'test-store' : 'apple-native', buildMode: profile.buildMode,
    flags: ['ONLY_ACTIVE_ARCH=YES', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'FORCE_BUNDLING=1'], xcode, sdk };
  return { hash: sha(stable(inputs)), inputs };
}

export function compareNativeInputs(previous, current, prefix = '') {
  if (stable(previous) === stable(current)) return [];
  if (!previous || !current || typeof previous !== 'object' || typeof current !== 'object') return [prefix || 'native identity'];
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  return [...keys].sort().flatMap(key => compareNativeInputs(previous[key], current[key], prefix ? `${prefix}.${key}` : key));
}

export function nativeBuildDecision({ receipt, native, profile, appIntact }) {
  if (!receipt) return { rebuild: true, reasons: ['initial build: no verified compatible native artifact receipt'] };
  if (receipt.receiptHash !== identityHash(Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== 'receiptHash'))))
    return { rebuild: true, reasons: ['artifact receipt changed or lacks its recorded integrity hash'] };
  if (!receipt.nativeIdentity || !receipt.profileIdentity) return { rebuild: true, reasons: ['artifact receipt predates resolved native compatibility identity; provenance cannot be verified'] };
  const reasons = [];
  if (receipt.nativeIdentity.hash !== identityHash(receipt.nativeIdentity.inputs)) reasons.push('native identity inputs do not match their recorded digest');
  if (receipt.profileIdentity.hash !== identityHash(receipt.profileIdentity.inputs)) reasons.push('profile identity inputs do not match their recorded digest');
  if (!appIntact) reasons.push('artifact missing or changed: recorded app tree hash does not match');
  if (receipt.nativeIdentity.hash !== native.hash) {
    const paths = compareNativeInputs(receipt.nativeIdentity.inputs, native.inputs);
    reasons.push(...(paths.length ? paths : ['identity digest differs from recorded inputs']).map(path => `native input changed: ${path}`));
  }
  if (receipt.profileIdentity.hash !== profile.hash) {
    const paths = compareNativeInputs(receipt.profileIdentity.inputs, profile.inputs);
    reasons.push(...(paths.length ? paths : ['identity digest differs from recorded inputs']).map(path => `binary profile changed: ${path}`));
  }
  return { rebuild: reasons.length > 0, reasons: [...new Set(reasons)] };
}
