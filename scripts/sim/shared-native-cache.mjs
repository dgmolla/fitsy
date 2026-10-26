// Optional, local-machine cache. Entries are append-only and never used in place
// of current-source Metro or product acceptance.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { identityHash, nativeBuildDecision, nativeSourceIdentityHash, reusableNativeReceipt, sealReceipt } from './native-identity.mjs';

const schema = 'fitsy.native-binary-cache.v2';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const inside = (parent, child) => {
  const path = relative(realpathSync(parent), realpathSync(child));
  return path && path !== '..' && !path.startsWith('../') && !isAbsolute(path);
};
function regularDirectory(directory) {
  return lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink();
}
function treeFiles(directory) {
  // A copied app must not borrow mutable files through links, devices or pipes.
  if (!regularDirectory(directory)) throw new Error('Native cache directory is not a regular directory');
  return readdirSync(directory).flatMap(entry => {
    const path = join(directory, entry), stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Native cache contains a linked or special file');
    return stat.isDirectory() ? treeFiles(path) : [path];
  });
}
export function appTreeHash(directory) {
  const hash = createHash('sha256');
  // Retain the existing native receipt tree digest format.
  for (const file of treeFiles(directory).sort()) hash.update(relative(directory, file) + '\0').update(readFileSync(file));
  return hash.digest('hex');
}
function executableHash(directory) {
  return identityHash(treeFiles(directory).sort().map(file => [relative(directory, file), Boolean(lstatSync(file).mode & 0o111)]));
}
function readonlyTree(directory) {
  return !(lstatSync(directory).mode & 0o222) && readdirSync(directory).every(name => {
    const file = join(directory, name), stat = lstatSync(file);
    return !stat.isSymbolicLink() && !(stat.mode & 0o222) && (!stat.isDirectory() || readonlyTree(file));
  });
}
function permissions(directory, readonly) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      if (readonly) throw new Error('Native cache contains a linked or special file');
      continue; // Failed staging cleanup must never chmod through a link.
    }
    if (stat.isDirectory()) {
      if (!readonly) chmodSync(path, 0o700);
      permissions(path, readonly);
      if (readonly) chmodSync(path, 0o500);
    } else chmodSync(path, (stat.mode & 0o111 ? 0o500 : 0o400) | (readonly ? 0 : 0o200));
  }
  chmodSync(directory, readonly ? 0o500 : 0o700);
}
export function sharedNativeCacheDirectory(root, env = process.env) {
  if (env.FITSY_NATIVE_CACHE_DIR === 'off') return null;
  if (env.FITSY_NATIVE_CACHE_DIR) {
    if (!isAbsolute(env.FITSY_NATIVE_CACHE_DIR)) throw new Error('FITSY_NATIVE_CACHE_DIR must be absolute or off');
    return resolve(env.FITSY_NATIVE_CACHE_DIR);
  }
  const gitEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')));
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd: root, env: gitEnv, encoding: 'utf8' }).trim();
  return join(common, 'fitsy-native-binary-cache');
}
export function nativeArtifactKey(native, profile, recipe) {
  // Release embeds JavaScript and cannot satisfy JS-only reuse through Metro.
  if (profile?.inputs?.buildMode !== 'owned-metro-test-store') return null;
  for (const identity of [native, profile, recipe]) {
    if (!identity?.inputs || identity.hash !== identityHash(identity.inputs)) throw new Error('Incomplete or changed native cache identity');
  }
  return identityHash({ schema, native: nativeSourceIdentityHash(native), profile: profile.hash, recipe: recipe.hash });
}
function validArtifact(receipt, app) {
  return receipt?.buildMode === 'owned-metro-test-store' && receipt.configuration === 'Debug' && receipt.storeMode === 'test-store' &&
    receipt.profileIdentity?.inputs?.buildMode === receipt.buildMode && receipt.profileIdentity.inputs.configuration === receipt.configuration &&
    receipt.profileIdentity.inputs.storeCapability === 'test-store' && receipt.profileIdentity.inputs.metroPort === receipt.metroPort &&
    Number.isInteger(receipt.metroPort) && receipt.metroPort > 0 && receipt.metroPort < 65536 &&
    receipt.simulatorApplicationIdentifier?.endsWith('.com.fitsy.mobile') && receipt.recipeIdentity &&
    !nativeBuildDecision({ receipt, native: receipt.nativeIdentity, profile: receipt.profileIdentity,
      recipe: receipt.recipeIdentity, appIntact: appTreeHash(app) === receipt.appHash }).rebuild &&
    sha(readFileSync(join(app, 'main.jsbundle'))) === receipt.bundleHash;
}
function readEntry(directory, key, artifact, mutableStage = false) {
  try {
    if (!regularDirectory(directory) || ['manifest.json', 'original-receipt.json'].some(name =>
      !lstatSync(join(directory, name)).isFile() || lstatSync(join(directory, name)).isSymbolicLink())) return null;
    if (!mutableStage && !readonlyTree(directory)) return null;
    const manifest = read(join(directory, 'manifest.json'));
    const original = readFileSync(join(directory, 'original-receipt.json')), receipt = JSON.parse(original);
    if (manifest.schema !== schema || manifest.key !== key || manifest.artifact !== artifact ||
      manifest.originalReceiptHash !== sha(original) || manifest.appHash !== receipt.appHash ||
      manifest.executableHash !== executableHash(join(directory, 'Fitsy.app')) ||
      artifact !== identityHash({ appHash: receipt.appHash, originalReceiptHash: sha(original), executableHash: manifest.executableHash }) ||
      nativeArtifactKey(receipt.nativeIdentity, receipt.profileIdentity, receipt.recipeIdentity) !== key ||
      receipt.sharedNativeArtifact || !validArtifact(receipt, join(directory, 'Fitsy.app'))) return null;
    return { directory, key, artifact, receipt, original, manifest };
  } catch { return null; } // A corrupt entry is a miss, never a repair/overwrite.
}
function installCopy(parent, name, copy, verify) {
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const destination = join(parent, name), stage = mkdtempSync(join(parent, '.staging-'));
  try {
    copy(stage);
    if (!verify(stage, true)) throw new Error('Native cache staged copy failed integrity verification');
    permissions(stage, true);
    try { renameSync(stage, destination); }
    catch (error) {
      // Darwin can report EACCES for an already published read-only directory.
      // Only a complete, independently verified winning entry resolves a race.
      if (!verify(destination)) throw error;
    }
    if (!verify(destination)) throw new Error('Native cache installed copy failed integrity verification');
    return destination;
  } finally {
    if (existsSync(stage)) { permissions(stage, false); rmSync(stage, { recursive: true, force: true }); }
  }
}
export function publishNativeArtifact(cache, receiptFile) {
  if (!cache) return null;
  const original = readFileSync(receiptFile), receipt = JSON.parse(original);
  const key = nativeArtifactKey(receipt.nativeIdentity, receipt.profileIdentity, receipt.recipeIdentity);
  if (!key) return null;
  if (receipt.sharedNativeArtifact || !validArtifact(receipt, receipt.app)) throw new Error('Refusing to cache an invalid or imported native receipt');
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  if (!regularDirectory(cache)) throw new Error('Native cache root must be a regular directory');
  const executable = executableHash(receipt.app);
  const artifact = identityHash({ appHash: receipt.appHash, originalReceiptHash: sha(original), executableHash: executable });
  const parent = join(cache, key), destination = join(parent, artifact);
  if (existsSync(parent) && !regularDirectory(parent)) throw new Error('Native cache identity directory must be a regular directory');
  const verify = (directory, mutableStage) => Boolean(readEntry(directory, key, artifact, mutableStage));
  if (existsSync(destination)) {
    if (!verify(destination)) throw new Error('Existing native cache entry is corrupt; preserved for diagnosis');
    return { key, artifact };
  }
  installCopy(parent, artifact, stage => {
    cpSync(receipt.app, join(stage, 'Fitsy.app'), { recursive: true, dereference: false, mode: constants.COPYFILE_FICLONE });
    writeFileSync(join(stage, 'original-receipt.json'), original, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ schema, key, artifact,
      originalReceiptHash: sha(original), appHash: receipt.appHash, executableHash: executable }) + '\n', { flag: 'wx', mode: 0o600 });
  }, verify);
  return { key, artifact };
}
export function importedArtifactIntact(receipt, buildDir) {
  try {
    const { receiptHash: seal, ...sealed } = receipt;
    if (seal !== identityHash(sealed)) return false;
    const provenance = receipt.sharedNativeArtifact, directory = resolve(buildDir, provenance.directory);
    if (!inside(buildDir, directory)) return false;
    const found = readEntry(directory, provenance.key, provenance.artifact);
    if (!found || found.manifest.originalReceiptHash !== provenance.originalReceiptHash ||
      realpathSync(receipt.app) !== realpathSync(join(directory, 'Fitsy.app'))) return false;
    // Only local activation metadata may differ from the original build.
    const { receiptHash, app, publicConfigAcceptance, sharedNativeArtifact, ...local } = receipt;
    const { receiptHash: originalHash, app: originalApp, publicConfigAcceptance: originalConfig, ...original } = found.receipt;
    return identityHash(local) === identityHash(original);
  } catch { return false; }
}
export function importNativeArtifact(cache, buildDir, native, profile, recipe, receipts = [], intact = () => false, beforeCopy = () => {}) {
  const key = nativeArtifactKey(native, profile, recipe);
  if (!cache || !key || !existsSync(cache) || !regularDirectory(cache) || !existsSync(join(cache, key))) return null;
  const parent = join(cache, key);
  if (lstatSync(parent).isSymbolicLink()) return null;
  for (const artifact of readdirSync(parent).filter(name => /^[a-f0-9]{64}$/.test(name)).sort()) {
    const found = readEntry(join(parent, artifact), key, artifact);
    if (!found) continue;
    const imported = sealReceipt({ ...found.receipt, sharedNativeArtifact: { key, artifact,
      originalReceiptHash: found.manifest.originalReceiptHash, directory: `shared-native/${key}/${artifact}` } });
    const selected = reusableNativeReceipt([...receipts, imported], native, profile, recipe,
      receipt => receipt === imported || intact(receipt));
    if (selected !== imported) continue;
    const localParent = join(buildDir, 'shared-native', key), destination = join(localParent, artifact);
    const verify = (directory, mutableStage) => Boolean(readEntry(directory, key, artifact, mutableStage));
    if (existsSync(destination)) {
      if (!verify(destination)) continue; // Preserve the corrupt copy and use another artifact or rebuild.
    } else {
      beforeCopy();
      installCopy(localParent, artifact, stage => cpSync(found.directory, stage, { recursive: true, mode: constants.COPYFILE_FICLONE }), verify);
    }
    const local = sealReceipt({ ...imported, app: join(destination, 'Fitsy.app') });
    if (!importedArtifactIntact(local, buildDir)) throw new Error('Imported native provenance failed integrity verification');
    return local;
  }
  return null;
}
