import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const modulePath = resolve(__dirname, 'native-identity.mjs');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const runCase = (body: string) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
  `import {nativeIdentity,nativeBuildDecision,profileIdentity,sealReceipt,identityHash,buildInputDrift} from ${JSON.stringify(modulePath)};
   import {writeFileSync,readFileSync} from 'node:fs';
   const root=process.env.FITSY_FIXTURE_ROOT;
   const fixture=()=>JSON.parse(readFileSync(root+'/fixture.json'));
   const execute=(cmd,args)=>{
     if(cmd==='git') return 'apps/mobile/app.config.ts\\0apps/mobile/lib/screen.tsx\\0apps/mobile/lib/screen.test.tsx\\0apps/mobile/ios/Native.swift\\0apps/mobile/android/Native.kt\\0';
     if(args.includes('introspect')) return JSON.stringify(fixture().expo);
     if(args.includes('resolve')) return JSON.stringify(fixture().expoGraph);
     if(args.includes('react-native-config')) return JSON.stringify(fixture().rnGraph);
     if(cmd==='xcodebuild') return fixture().toolchain;
     if(cmd==='xcrun') return '26.0';
     throw Error(cmd+' '+args.join(' '));
   };
   ${body}`], { encoding: 'utf8', env: { ...cleanEnv(), FITSY_FIXTURE_ROOT: fixtureRoot } }));

let fixtureRoot: string;
beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), 'fitsy-native-identity-'));
  mkdirSync(join(fixtureRoot, 'apps/mobile/ios'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'apps/mobile/android'), { recursive: true });
  mkdirSync(join(fixtureRoot, 'apps/mobile/lib'), { recursive: true });
  writeFileSync(join(fixtureRoot, 'apps/mobile/app.config.ts'), 'export default {}');
  writeFileSync(join(fixtureRoot, 'apps/mobile/lib/screen.tsx'), 'original JS');
  writeFileSync(join(fixtureRoot, 'apps/mobile/lib/screen.test.tsx'), 'original test');
  writeFileSync(join(fixtureRoot, 'apps/mobile/ios/Native.swift'), 'native source');
  writeFileSync(join(fixtureRoot, 'apps/mobile/android/Native.kt'), 'android source');
  writeFileSync(join(fixtureRoot, 'package-lock.json'), JSON.stringify({ packages: {
    'node_modules/expo': { version: '54.0.0' }, 'node_modules/react-native': { version: '0.81.0' },
    'node_modules/native-module': { version: '1.0.0' }, 'node_modules/js-only': { version: '1.0.0' },
  } }));
  writeFileSync(join(fixtureRoot, 'fixture.json'), JSON.stringify({
    expo: { name: 'Fitsy', slug: 'fitsy', ios: { infoPlist: { NSLocationWhenInUseUsageDescription: 'Location' } },
      _internal: { modResults: { ios: { infoPlist: { NSLocationWhenInUseUsageDescription: 'Location' } } } }, extra: { apiBaseUrl: 'old' } },
    expoGraph: { modules: [{ packageName: 'native-module', packageVersion: '1.0.0' }] },
    rnGraph: { dependencies: {} }, toolchain: 'Xcode 26.0',
  }));
});
afterEach(() => rmSync(fixtureRoot, { recursive: true, force: true }));

test('test-only, JS and JS-only lock changes reuse the verified native binary', () => {
  const result = runCase(`
    const before=nativeIdentity(root,{},execute);
    const profile=profileIdentity({configuration:'Debug',storeMode:'test-store',buildMode:'owned-metro-test-store'}, {os:'iOS 26.0'}, {}, execute);
    const receipt=sealReceipt({nativeIdentity:before,profileIdentity:profile});
    writeFileSync(root+'/apps/mobile/lib/screen.test.tsx','split test');
    const testChange=nativeBuildDecision({receipt,native:nativeIdentity(root,{},execute),profile,appIntact:true});
    writeFileSync(root+'/apps/mobile/lib/screen.tsx','changed UI');
    const jsChange=nativeBuildDecision({receipt,native:nativeIdentity(root,{},execute),profile,appIntact:true});
    writeFileSync(root+'/apps/mobile/android/Native.kt','changed Android-only source');
    const androidChange=nativeBuildDecision({receipt,native:nativeIdentity(root,{},execute),profile,appIntact:true});
    const lock=JSON.parse(readFileSync(root+'/package-lock.json'));lock.packages['node_modules/js-only'].version='2.0.0';
    writeFileSync(root+'/package-lock.json',JSON.stringify(lock));
    const jsDependency=nativeBuildDecision({receipt,native:nativeIdentity(root,{},execute),profile,appIntact:true});
    const fixtureData=fixture();fixtureData.expo.extra.apiBaseUrl='new JS-only URL';
    writeFileSync(root+'/fixture.json',JSON.stringify(fixtureData));
    const publicEnv=nativeBuildDecision({receipt,native:nativeIdentity(root,{},execute),profile,appIntact:true});
    process.stdout.write(JSON.stringify({testChange,jsChange,androidChange,jsDependency,publicEnv}));`);
  expect(result).toEqual({ testChange: { rebuild: false, reasons: [] }, jsChange: { rebuild: false, reasons: [] },
    androidChange: { rebuild: false, reasons: [] }, jsDependency: { rebuild: false, reasons: [] },
    publicEnv: { rebuild: false, reasons: [] } });
});

test('native module, permission, profile and tampered artifact each give a specific reason', () => {
  const result = runCase(`
    const before=nativeIdentity(root,{},execute);
    const profile=profileIdentity({configuration:'Debug',storeMode:'test-store',buildMode:'owned-metro-test-store'}, {os:'iOS 26.0'}, {}, execute);
    const receipt=sealReceipt({nativeIdentity:before,profileIdentity:profile});
    const decision=(p=profile,intact=true)=>nativeBuildDecision({receipt,native:nativeIdentity(root,{},execute),profile:p,appIntact:intact});
    writeFileSync(root+'/apps/mobile/ios/Native.swift','changed native source');const nativeSource=decision();
    writeFileSync(root+'/apps/mobile/ios/Native.swift','native source');
    writeFileSync(root+'/apps/mobile/ios/Generated.swift','changed ignored generated native source');const generatedSource=decision();
    const {unlinkSync}=await import('node:fs');unlinkSync(root+'/apps/mobile/ios/Generated.swift');
    const lock=JSON.parse(readFileSync(root+'/package-lock.json'));lock.packages['node_modules/native-module'].version='2.0.0';
    writeFileSync(root+'/package-lock.json',JSON.stringify(lock));const moduleChange=decision();
    writeFileSync(root+'/package-lock.json',JSON.stringify({...lock,packages:{...lock.packages,'node_modules/native-module':{version:'1.0.0'}}}));
    const changedFixture=JSON.parse(readFileSync(root+'/fixture.json'));changedFixture.expo.ios.infoPlist.NSLocationWhenInUseUsageDescription='Precise location';
    changedFixture.expo._internal.modResults.ios.infoPlist.NSLocationWhenInUseUsageDescription='Precise location';
    writeFileSync(root+'/fixture.json',JSON.stringify(changedFixture));const permission=decision();
    writeFileSync(root+'/fixture.json',JSON.stringify({...changedFixture,expo:{...changedFixture.expo,ios:{infoPlist:{NSLocationWhenInUseUsageDescription:'Location'}},_internal:{modResults:{ios:{infoPlist:{NSLocationWhenInUseUsageDescription:'Location'}}}}}}));
    const release=profileIdentity({configuration:'Release',storeMode:'unconfigured',buildMode:'embedded-release'}, {os:'iOS 26.0'}, {}, execute);
    const wrongPort=profileIdentity({configuration:'Debug',storeMode:'test-store',buildMode:'owned-metro-test-store',metroPort:8100}, {os:'iOS 26.0'}, {}, execute);
    const recipe={inputs:{prepareNative:'first'},hash:identityHash({prepareNative:'first'})};
    const recipeReceipt=sealReceipt({nativeIdentity:before,profileIdentity:profile,recipeIdentity:recipe});
    const changedRecipe={inputs:{prepareNative:'second'},hash:identityHash({prepareNative:'second'})};
    const recipeChange=nativeBuildDecision({receipt:recipeReceipt,native:before,profile,recipe:changedRecipe,appIntact:true});
    process.stdout.write(JSON.stringify({nativeSource,generatedSource,moduleChange,permission,profile:decision(release),wrongPort:decision(wrongPort),recipeChange,tampered:decision(profile,false),
      tamperedReceipt:nativeBuildDecision({receipt:{...receipt,appHash:'forged'},native:before,profile,appIntact:true}),
      missing:nativeBuildDecision({receipt:null,native:before,profile,appIntact:false})}));`);
  for (const [key, pattern] of Object.entries({ nativeSource: /Native.swift/, generatedSource: /Generated.swift/,
    moduleChange: /native-module/,
    permission: /NSLocationWhenInUseUsageDescription/, profile: /configuration/, tampered: /artifact missing or changed/,
    wrongPort: /metroPort/,
    recipeChange: /native build recipe changed: prepareNative/,
    tamperedReceipt: /receipt changed/,
    missing: /initial build/ })) {
    const decision = result[key as keyof typeof result] as {rebuild: boolean; reasons: string[]};
    expect(decision.rebuild).toBe(true);
    expect(decision.reasons.join(' ')).toMatch(pattern);
  }
});

test('Release public store-key presence changes JS configuration without changing native capability', () => {
  const result = runCase(`
    const keyless=profileIdentity({configuration:'Release',storeMode:'unconfigured',buildMode:'embedded-release'}, {os:'iOS 26.0'}, {}, execute);
    const configured=profileIdentity({configuration:'Release',storeMode:'apple-simulator',buildMode:'embedded-release'}, {os:'iOS 26.0'}, {}, execute);
    process.stdout.write(JSON.stringify({same:keyless.hash===configured.hash,capability:configured.inputs.storeCapability}));`);
  expect(result).toEqual({ same: true, capability: 'apple-native' });
});

test('a source edit during preparation or compilation cannot be certified by the completed receipt', () => {
  const result = runCase(`
    const native=nativeIdentity(root,{},execute),recipe={hash:'recipe'};
    const before={native,jsHash:'initial',configHash:'config',recipe};
    writeFileSync(root+'/apps/mobile/lib/screen.tsx','changed while Xcode was bundling');
    const afterJs={...before,jsHash:'changed'};
    writeFileSync(root+'/apps/mobile/ios/Generated.swift','changed generated source during compilation');
    const afterNative={...before,native:nativeIdentity(root,{},execute)};
    process.stdout.write(JSON.stringify({js:buildInputDrift(before,afterJs,true),native:buildInputDrift(before,afterNative,true)}));`);
  expect(result.js).toContain('JavaScript');
  expect(result.native).toContain('native source or resolved graph');
});
