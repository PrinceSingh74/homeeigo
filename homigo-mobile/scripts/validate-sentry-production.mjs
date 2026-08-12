#!/usr/bin/env node
/**
 * Phase 3: Sentry production readiness check (DSN, wiring, EAS source map config).
 * Event delivery requires EXPO_PUBLIC_SENTRY_DSN + physical build — reported separately.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MONOREPO = join(ROOT, "..");

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() ?? "";
const authToken = process.env.SENTRY_AUTH_TOKEN?.trim() ?? "";

const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  console.log(`[validate:sentry] ${ok ? "PASS" : "BLOCKED"} ${name}: ${detail}`);
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const appJson = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8"));
const easPath = join(ROOT, "eas.json");
const eas = existsSync(easPath) ? JSON.parse(readFileSync(easPath, "utf8")) : {};

check("sdk_installed", !!pkg.dependencies?.["@sentry/react-native"], pkg.dependencies?.["@sentry/react-native"] ?? "missing");
check(
  "sdk_in_node_modules",
  existsSync(join(MONOREPO, "node_modules/@sentry/react-native/package.json")),
  "monorepo node_modules",
);
check("entry_wired", readFileSync(join(ROOT, "index.js"), "utf8").includes("initSentry"), "index.js");
check(
  "expo_plugin",
  JSON.stringify(appJson.expo?.plugins ?? []).includes("@sentry/react-native/expo"),
  "app.json plugin",
);

check("dsn_configured", !!dsn, dsn ? "EXPO_PUBLIC_SENTRY_DSN set" : "EXPO_PUBLIC_SENTRY_DSN unset — delivery BLOCKED");
check(
  "source_map_token",
  !!authToken,
  authToken ? "SENTRY_AUTH_TOKEN set" : "SENTRY_AUTH_TOKEN unset — source map upload BLOCKED",
);

const wiringOk = checks.filter((c) => !c.name.includes("dsn") && !c.name.includes("source_map")).every((c) => c.ok);
if (!wiringOk) {
  process.exit(1);
}

if (!dsn) {
  console.log("\n[validate:sentry] Wiring OK — event delivery BLOCKED (no DSN)");
  process.exit(2);
}

// Attempt synthetic event when DSN is present (Node cannot run RN SDK — note limitation)
console.log("\n[validate:sentry] DSN present — verify crash on device via /dev/diagnostics");
console.log("[validate:sentry] Native crash capture requires EAS dev/production build (not Expo Go)");
process.exit(0);
