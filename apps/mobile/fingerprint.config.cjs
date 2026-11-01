// Shared by EAS Build, EAS Update and the local compatibility check.
// These plugins copy native files during prebuild without requiring them from
// app.config.ts, so Expo's loaded-module discovery alone cannot see them.
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

module.exports = {
  sourceSkips: [
    'PackageJsonAndroidAndIosScriptsIfNotContainRun',
    'ExpoConfigExtraSection', // `extra` is delivered in the JS update manifest.
  ],
  extraSources: [
    { type: 'file', filePath: 'fingerprint.config.cjs', reasons: ['fitsyFingerprintConfig'] },
    { type: 'dir', filePath: 'plugins', reasons: ['fitsyNativePlugins'] },
    { type: 'dir', filePath: '../../patches', reasons: ['fitsyNativePatches'] },
    { type: 'dir', filePath: '.eas/build', reasons: ['fitsyNativeBuildHooks'] },
    { type: 'dir', filePath: '../../.eas/build', reasons: ['fitsyNativeBuildHooks'] },
  ].filter(source => source.type !== 'dir' || existsSync(resolve(__dirname, source.filePath))),
};
