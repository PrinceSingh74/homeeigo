#!/usr/bin/env node
/**
 * Static guards against known startup regression patterns.
 * Exit 1 on violation — intended for CI.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(ROOT, "src");
const APP = join(ROOT, "app");

const violations = [];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!name.includes("node_modules") && !name.startsWith(".expo")) walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(name)) acc.push(p);
  }
  return acc;
}

function stripComments(text) {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const files = [...walk(SRC), ...walk(APP)];

for (const file of files) {
  const rel = relative(ROOT, file);
  const raw = readFileSync(file, "utf8");
  const code = stripComments(raw);

  // Never persist initializing status (check partialize block only)
  if (file.includes("auth-store")) {
    const partializeMatch = code.match(/partialize:\s*\([^)]*\)\s*=>\s*\(\{[\s\S]*?\}\)/);
    if (partializeMatch && /status/.test(partializeMatch[0])) {
      violations.push(`${rel}: partialize must not persist status`);
    }
  }

  // Splash must not await bootstrap or hide in bootstrap finally
  if (/await\s+bootstrap\s*\(/.test(code) && file.includes("AuthProvider")) {
    violations.push(`${rel}: await bootstrap() blocks provider render`);
  }
  if (/bootstrap\s*\([^)]*\)\.finally\s*\([^)]*hideAsync/.test(code)) {
    violations.push(`${rel}: splash hide in bootstrap().finally — auth-coupled splash`);
  }
  if (/hideAsync[\s\S]*await\s+bootstrap/.test(code)) {
    violations.push(`${rel}: splash hide appears to await bootstrap`);
  }

  // Unbounded bootstrap / refresh retry loops
  if (/while\s*\([\s\S]*bootstrap/.test(code)) {
    violations.push(`${rel}: unbounded bootstrap while-loop`);
  }
  if (/while\s*\(\s*true\s*\)[\s\S]*refresh/.test(code) && file.includes("auth-store")) {
    violations.push(`${rel}: infinite refresh loop in auth-store`);
  }
}

const authStore = readFileSync(join(SRC, "stores", "auth-store.ts"), "utf8");
const authProv = readFileSync(join(SRC, "providers", "AuthProvider.tsx"), "utf8");
const layout = readFileSync(join(APP, "_layout.tsx"), "utf8");

if (!authStore.includes("bootstrapInFlight")) {
  violations.push("auth-store.ts: missing bootstrapInFlight dedup");
}
if (!/bootstrap:[\s\S]*finally\s*\{/.test(authStore)) {
  violations.push("auth-store.ts: bootstrap missing finally guard");
}
if (!authProv.includes("hideSplashOnce")) {
  violations.push("AuthProvider.tsx: missing hideSplashOnce dedup");
}
if (!authProv.includes("HYDRATION_TIMEOUT_MS")) {
  violations.push("AuthProvider.tsx: missing hydration timeout");
}
if (!authProv.includes("onHomeRender")) {
  violations.push("AuthProvider.tsx: splash must follow onHomeRender");
}
if (!authStore.includes('startupMark("HYDRATION_START")')) {
  violations.push("auth-store.ts: missing HYDRATION_START marker");
}
if (!authStore.includes('startupMark("HYDRATION_END"')) {
  violations.push("auth-store.ts: missing HYDRATION_END marker");
}
if (!authStore.includes('startupMark("BOOTSTRAP_END"')) {
  violations.push("auth-store.ts: missing BOOTSTRAP_END marker");
}
if (!authProv.includes("reportInteractiveColdStart")) {
  violations.push("AuthProvider.tsx: missing interactive telemetry on splash hide");
}

const preventCount = files
  .map((f) => stripComments(readFileSync(f, "utf8")).match(/preventAutoHideAsync/g)?.length ?? 0)
  .reduce((a, b) => a + b, 0);
if (preventCount !== 1) {
  violations.push(`preventAutoHideAsync call count=${preventCount} (expected 1)`);
}

if (layout.includes("initOfflineSync()") && !layout.includes("scheduleOfflineSync")) {
  violations.push("_layout.tsx: initOfflineSync at mount competes with bootstrap — use scheduleOfflineSync");
}

if (violations.length) {
  console.error("[FAIL] startup-lint-guards");
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log("[PASS] startup-lint-guards — no regression patterns detected");
process.exit(0);
