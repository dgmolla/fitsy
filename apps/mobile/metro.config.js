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

module.exports = config;
