const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');
const xcode = require('xcode');
const { addWidget } = require('./withMealWidget.cjs');

// Minimal prebuild input, using the real Xcode project model and serializer.
function baseProject() {
  const project = xcode.project('Fitsy.pbxproj');
  project.hash = { project: { objects: {} } };
  const id = () => project.generateUuid();
  const app = id(), main = id(), products = id(), root = id(), list = id(), debug = id(), release = id(), sources = id();
  project.hash = { project: { archiveVersion: 1, classes: {}, objectVersion: 54, rootObject: root, objects: {
    PBXBuildFile: {}, PBXFileReference: {}, PBXFrameworksBuildPhase: {},
    PBXCopyFilesBuildPhase: {}, PBXContainerItemProxy: {}, PBXTargetDependency: {},
    PBXGroup: {
      [main]: { isa: 'PBXGroup', children: [{ value: products, comment: 'Products' }], sourceTree: '"<group>"' },
      [products]: { isa: 'PBXGroup', children: [], name: 'Products', sourceTree: '"<group>"' },
    },
    PBXProject: { [root]: { isa: 'PBXProject', mainGroup: main, productRefGroup: products,
      targets: [{ value: app, comment: 'Fitsy' }], attributes: { TargetAttributes: {} } } },
    PBXNativeTarget: { [app]: { isa: 'PBXNativeTarget', name: 'Fitsy', productName: 'Fitsy',
      productType: '"com.apple.product-type.application"', buildConfigurationList: list,
      buildPhases: [{ value: sources, comment: 'Sources' }], dependencies: [], buildRules: [] } },
    PBXSourcesBuildPhase: { [`${sources}_comment`]: 'Sources', [sources]: { isa: 'PBXSourcesBuildPhase', files: [], buildActionMask: 2147483647, runOnlyForDeploymentPostprocessing: 0 } },
    XCBuildConfiguration: { [debug]: { isa: 'XCBuildConfiguration', name: 'Debug', buildSettings: {} },
      [release]: { isa: 'XCBuildConfiguration', name: 'Release', buildSettings: {} } },
    XCConfigurationList: { [list]: { isa: 'XCConfigurationList', buildConfigurations: [{ value: debug, comment: 'Debug' },
      { value: release, comment: 'Release' }], defaultConfigurationIsVisible: 0, defaultConfigurationName: 'Release' } },
  } } };
  return project;
}
const config = { version: '1.0.0', ios: { bundleIdentifier: 'com.fitsy.mobile', buildNumber: '5' } };

test('dish cards contain only the name and exact nutrition values over the photo fade', () => {
  const view = readFileSync(join(__dirname, 'widget/FitsyMealWidget.swift'), 'utf8');
  assert.match(view, /Text\(dish\.name\)/);
  for (const nutrient of ['proteinG', 'carbsG', 'fatG', 'calories']) {
    assert.match(view, new RegExp(`macro\\(dish\\.${nutrient},`));
  }
  assert.match(view, /let value = WidgetDish\.number\(amount\)/);
  assert.doesNotMatch(view, /dish\.range\(|Text\("FITSY"\)|"shuffle"|dish\.restaurantName|Estimated nutrition|, estimated|snapshot\.offline|"~"/);
  assert.match(view, /Image\(decorative: photo, scale: 1\)\.resizable\(\)\.scaledToFill\(\)/);
  assert.match(view, /LinearGradient\(colors: \[\.black\.opacity/);
});

test('Expo plugin embeds and compiles a WidgetKit target and the app bridge, idempotently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-widget-project-'));
  try {
    const project = baseProject();
    addWidget(project, dir, config);
    const target = Object.values(project.pbxNativeTargetSection()).find(value => value?.name === '"FitsyMealWidget"');
    assert.equal(target.productType, '"com.apple.product-type.app-extension"');
    const sourcePhase = target.buildPhases.find(phase => phase.comment === 'Sources');
    assert.equal(project.hash.project.objects.PBXSourcesBuildPhase[sourcePhase.value].files.length, 4);
    const configs = project.hash.project.objects.XCConfigurationList[target.buildConfigurationList].buildConfigurations;
    for (const { value } of configs) {
      const settings = project.pbxXCBuildConfigurationSection()[value].buildSettings;
      assert.equal(settings.CODE_SIGN_ENTITLEMENTS, 'FitsyMealWidget/FitsyMealWidget.entitlements');
      assert.equal(settings.APPLICATION_EXTENSION_API_ONLY, 'YES');
      assert.equal(settings.IPHONEOS_DEPLOYMENT_TARGET, '17.0');
      assert.equal(settings.PRODUCT_BUNDLE_IDENTIFIER.replaceAll('"', ''), 'com.fitsy.mobile.widget');
    }
    const embed = Object.values(project.hash.project.objects.PBXCopyFilesBuildPhase).find(value => value?.files);
    assert.equal(embed.dstSubfolderSpec, 13);
    assert.equal(embed.files.length, 1);
    const app = project.getTarget('com.apple.product-type.application').target;
    assert.equal(app.dependencies.length, 1);
    assert.equal(project.hash.project.objects.PBXSourcesBuildPhase[app.buildPhases[0].value].files.length, 5);
    for (const file of ['FitsyMealWidget/WidgetImage.swift', 'FitsyWidgetBridge/AppWidgetImage.swift']) {
      assert.equal(readFileSync(join(dir, file), 'utf8'), readFileSync(join(__dirname, 'widget/WidgetImage.swift'), 'utf8'));
    }
    assert.match(readFileSync(join(dir, 'FitsyMealWidget/FitsyMealWidget.entitlements'), 'utf8'), /group\.com\.fitsy\.mobile\.widget/);
    assert.match(readFileSync(join(dir, 'FitsyMealWidget/FitsyMealWidget-Info.plist'), 'utf8'), /com\.apple\.widgetkit-extension/);
    const before = project.writeSync();
    addWidget(project, dir, config);
    assert.equal(project.writeSync(), before, 'prebuild must not duplicate targets, embeds or sources');
    const file = join(dir, 'project.pbxproj'); writeFileSync(file, before);
    const parsed = xcode.project(file); parsed.parseSync();
    assert.equal(Object.keys(parsed.pbxNativeTargetSection()).filter(key => !key.endsWith('_comment')).length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function nativeSuite(mutate, suite = 'WidgetData') {
  const dir = mkdtempSync(join(tmpdir(), 'fitsy-widget-data-'));
  try {
    const source = readFileSync(join(__dirname, `widget/${suite === 'WidgetImage' ? 'WidgetImage' : 'WidgetData'}.swift`), 'utf8');
    const candidate = mutate ? mutate(source) : source;
    if (mutate) assert.notEqual(candidate, source, 'negative control must actually change production code');
    const model = join(dir, `${suite}.swift`); writeFileSync(model, candidate);
    mkdirSync(join(dir, 'cache'));
    const built = spawnSync('xcrun', ['swiftc', '-swift-version', '5', '-module-cache-path', join(dir, 'cache'), model,
      ...(suite === 'WidgetImage' ? [join(__dirname, 'widget/WidgetData.swift')] : []),
      join(__dirname, `widget/tests/${suite}Tests.swift`), '-o', join(dir, 'tests')], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(built.status, 0, built.stderr);
    return spawnSync(join(dir, 'tests'), [], { encoding: 'utf8', timeout: 20_000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('actual Swift fetch, first-result selection and cache/access regressions', { skip: process.platform !== 'darwin' }, () => {
  const result = nativeSuite();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Widget data: 37 checks passed/);
});
test('negative control: rounding API nutrition fails the native suite', { skip: process.platform !== 'darwin' }, () => {
  const result = nativeSuite(source => source.replace('let number = String(value)', 'let number = String(value.rounded())'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact API decimals/);
});
test('negative control: selecting the last result fails the native suite', { skip: process.platform !== 'darwin' }, () => {
  const result = nativeSuite(source => source.replace('.data.first', '.data.last'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /select data\[0\]/);
});
test('negative control: an unscoped data-fetch credential fails the native suite', { skip: process.platform !== 'darwin' }, () => {
  const result = nativeSuite(source => source.replace('setValue("Widget ', 'setValue("Bearer '));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /scoped authorization/);
});
test('actual Swift photo download, bounded disk cache, offline reuse and dark fallback', { skip: process.platform !== 'darwin' }, () => {
  const result = nativeSuite(null, 'WidgetImage');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Widget photo: 19 checks passed/);
});
test('negative control: a photo from a different restaurant fails the native suite', { skip: process.platform !== 'darwin' }, () => {
  const result = nativeSuite(source => source.replace('cached.url == rawURL', 'true'), 'WidgetImage');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /different restaurant/);
});
