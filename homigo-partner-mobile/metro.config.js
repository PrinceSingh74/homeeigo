const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Hoisted workspace packages live at the repo root. Watch only that node_modules
// tree — not the whole monorepo (.next, dist, prisma, etc.), which times out
// Metro's file watcher on Windows.
config.watchFolders = [path.resolve(monorepoRoot, "node_modules")];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Expo SDK 54 / RN 0.81.5 require React 19.1.0. Workspace hoisting can otherwise
// serve a newer peer React (19.2.x) while react-native-renderer stays 19.1.0.
const reactDir = path.resolve(monorepoRoot, "node_modules/react");
const reactDomDir = path.resolve(monorepoRoot, "node_modules/react-dom");
const queryDir = path.resolve(monorepoRoot, "node_modules/@tanstack/react-query");
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  react: reactDir,
  "react-dom": reactDomDir,
  "@tanstack/react-query": queryDir,
};
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
