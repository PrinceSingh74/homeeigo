#!/usr/bin/env node
/**
 * Verify @sentry/react-native is installed and wired at app entry.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MONOREPO_ROOT = join(ROOT, "..");

function sentryInstalled() {
  return (
    existsSync(join(ROOT, "node_modules/@sentry/react-native/package.json")) ||
    existsSync(join(MONOREPO_ROOT, "node_modules/@sentry/react-native/package.json"))
  );
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const indexJs = readFileSync(join(ROOT, "index.js"), "utf8");
const sentryTs = readFileSync(join(ROOT, "src/lib/observability/sentry.ts"), "utf8");

const errors = [];

if (!pkg.dependencies?.["@sentry/react-native"]) {
  errors.push("package.json missing @sentry/react-native dependency");
}
if (pkg.main !== "index.js") {
  errors.push(`package.json main must be index.js (got ${pkg.main})`);
}
if (!indexJs.includes("initSentry")) {
  errors.push("index.js must call initSentry() before expo-router entry");
}
if (!sentryTs.includes("captureException")) {
  errors.push("sentry.ts missing captureException wiring");
}
if (!sentryInstalled()) {
  errors.push("@sentry/react-native not installed in node_modules (checked workspace + monorepo root)");
}

const dsnConfigured = Boolean(process.env.EXPO_PUBLIC_SENTRY_DSN?.trim());

if (errors.length) {
  console.error("[verify:sentry] FAIL");
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}

console.log("[verify:sentry] PASS — SDK installed and entry wired");
if (dsnConfigured) {
  console.log("[verify:sentry] EXPO_PUBLIC_SENTRY_DSN is set — runtime delivery can be verified on device");
} else {
  console.log("[verify:sentry] EXPO_PUBLIC_SENTRY_DSN unset — SDK no-ops until DSN is provisioned (expected for local dev)");
}
