const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch all files in the monorepo
config.watchFolders = [monorepoRoot];

// Resolve modules from both the project and monorepo root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Force core RN packages to resolve from mobile workspace (prevent duplicate instances)
config.resolver.extraNodeModules = new Proxy(
  {
    react: path.resolve(projectRoot, "node_modules/react"),
    "react-native": path.resolve(projectRoot, "node_modules/react-native"),
    "react-native-screens": path.resolve(projectRoot, "node_modules/react-native-screens"),
  },
  {
    get: (target, name) =>
      target[name] ?? path.resolve(projectRoot, "node_modules", name),
  }
);

// Hard-pin packages that must match Expo Go's native binary versions.
// extraNodeModules is only a fallback; resolveRequest overrides all resolutions.
const PINNED_MODULES = {
  "react-native-screens": path.resolve(projectRoot, "node_modules/react-native-screens"),
};
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const pinned = Object.keys(PINNED_MODULES).find(
    (pkg) => moduleName === pkg || moduleName.startsWith(pkg + "/")
  );
  if (pinned) {
    const suffix = moduleName.slice(pinned.length);
    const redirected = PINNED_MODULES[pinned] + suffix;
    return context.resolveRequest(context, redirected, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
