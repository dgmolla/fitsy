const { withEntitlementsPlist, withXcodeProject, IOSConfig } = require('expo/config-plugins');
const { mkdirSync, copyFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const plist = require('@expo/plist').default;

const name = 'FitsyMealWidget';
const group = 'group.com.fitsy.mobile.widget';

function addWidget(project, iosRoot, config) {
  const existing = Object.entries(project.pbxNativeTargetSection()).find(([, value]) =>
    typeof value === 'object' && value.name?.replaceAll('"', '') === name);
  const target = existing ? { uuid: existing[0], pbxNativeTarget: existing[1] }
    : project.addTarget(name, 'app_extension', name, `${config.ios.bundleIdentifier}.widget`);
  if (!existing) {
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
  }
  const app = IOSConfig.XcodeUtils.getApplicationNativeTarget({ project, projectName: 'Fitsy' });
  const sourceRoot = join(__dirname, 'widget');
  for (const [folder, targetUuid, files] of [
    [name, target.uuid, ['WidgetData.swift', 'WidgetStore.swift', 'FitsyMealWidget.swift']],
    ['FitsyWidgetBridge', app.uuid, ['FitsyWidgetBridge.swift', 'FitsyWidgetBridge.m', 'WidgetData.swift', 'WidgetStore.swift']],
  ]) {
    IOSConfig.XcodeUtils.ensureGroupRecursively(project, folder);
    mkdirSync(join(iosRoot, folder), { recursive: true });
    for (const file of files) {
      const filename = folder === 'FitsyWidgetBridge' && file.startsWith('Widget') ? `App${file}` : file;
      copyFileSync(join(sourceRoot, file), join(iosRoot, folder, filename));
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: join(folder, filename), groupName: folder, project, targetUuid,
      });
    }
  }
  const entitlements = { 'com.apple.security.application-groups': [group] };
  writeFileSync(join(iosRoot, name, `${name}.entitlements`), plist.build(entitlements));
  writeFileSync(join(iosRoot, name, `${name}-Info.plist`), plist.build({
    CFBundleDisplayName: 'Fitsy', CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
    CFBundleExecutable: '$(EXECUTABLE_NAME)', CFBundleName: '$(PRODUCT_NAME)', CFBundlePackageType: 'XPC!',
    CFBundleShortVersionString: config.version, CFBundleVersion: config.ios.buildNumber,
    NSExtension: { NSExtensionPointIdentifier: 'com.apple.widgetkit-extension' },
  }));
  for (const [, configuration] of IOSConfig.XcodeUtils.getBuildConfigurationsForListId(project, target.pbxNativeTarget.buildConfigurationList)) {
    Object.assign(configuration.buildSettings, {
      SWIFT_VERSION: '5.0', IPHONEOS_DEPLOYMENT_TARGET: '17.0', TARGETED_DEVICE_FAMILY: '1',
      APPLICATION_EXTENSION_API_ONLY: 'YES', CODE_SIGN_ENTITLEMENTS: `${name}/${name}.entitlements`,
      MARKETING_VERSION: config.version, CURRENT_PROJECT_VERSION: config.ios.buildNumber,
      GENERATE_INFOPLIST_FILE: 'NO', SWIFT_EMIT_LOC_STRINGS: 'YES',
      ...(config.ios.appleTeamId ? { DEVELOPMENT_TEAM: config.ios.appleTeamId } : {}),
    });
  }
  return project;
}

function withMealWidget(config) {
  // EAS credentials discovery can see the extension before prebuild. This does
  // not contact Apple or modify provisioning profiles.
  config.extra ??= {};
  config.extra.eas ??= {};
  config.extra.eas.build ??= {};
  config.extra.eas.build.experimental ??= {};
  const extensions = config.extra.eas.build.experimental.ios?.appExtensions ?? [];
  config.extra.eas.build.experimental.ios = {
    ...config.extra.eas.build.experimental.ios,
    appExtensions: [...extensions.filter(extension => extension.targetName !== name), {
      targetName: name, bundleIdentifier: `${config.ios.bundleIdentifier}.widget`,
      entitlements: { 'com.apple.security.application-groups': [group] },
    }],
  };
  config = withEntitlementsPlist(config, mod => {
    mod.modResults['com.apple.security.application-groups'] = [...new Set([
      ...(mod.modResults['com.apple.security.application-groups'] ?? []), group,
    ])];
    return mod;
  });
  return withXcodeProject(config, mod => {
    addWidget(mod.modResults, mod.modRequest.platformProjectRoot, config);
    return mod;
  });
}

module.exports = withMealWidget;
module.exports.addWidget = addWidget;
