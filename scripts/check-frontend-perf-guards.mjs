#!/usr/bin/env node
/**
 * Catches the two regressions that made partner-web slow, at the source, before a build exists.
 *
 *   node scripts/check-frontend-perf-guards.mjs --app apps/partner-web
 *
 * The bundle budget (scripts/check-bundle-budget.mjs) is the backstop and catches anything that
 * makes a page heavier. This one is the fast, specific check: it names the mistake, points at the
 * file, and runs in a second without compiling anything.
 *
 * ── The two mistakes it knows about ─────────────────────────────────────────
 *
 * 1. Importing framer-motion's full `motion` engine. `LazyMotion` only helps if components import
 *    the lightweight `m` primitive; a single `import { motion }` drags the whole feature set back
 *    into the shared chunk and silently undoes the provider. Thirteen files were doing this.
 *
 * 2. Bundling Sentry Session Replay eagerly, or sampling sessions ambiently. The recorder buffers
 *    DOM mutations continuously — flamegraphed at ~90 ms of CPU per navigation in the customer app —
 *    so it is loaded lazily and left off unless someone is actively investigating.
 *
 * Both are easy to reintroduce by copying a snippet from an older file, and neither is visible in
 * review unless you already know to look. That is exactly what a guard is for.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const args = process.argv.slice(2);
const appArg = args[args.indexOf("--app") + 1];
if (!appArg || appArg.startsWith("--")) {
  console.error("usage: check-frontend-perf-guards.mjs --app <path-to-next-app>");
  process.exit(2);
}
const APP = resolve(process.cwd(), appArg);
const SRC = join(APP, "src");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx|ts|jsx|js)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * A full-engine import: `motion` as a plain named import from framer-motion.
 *
 * Deliberately NOT one clever regex. The first attempt was
 * `/import\s*\{[^}]*(?<![\w.])motion\s*(?:,|\})[^}]*\}\s*from ... /` and it matched nothing at
 * all: the `(?:,|\})` alternation consumed the closing brace, leaving the trailing `\}` with
 * nothing to match. The positive controls below caught it before it shipped, which is the only
 * reason it is not still sitting here reporting success forever.
 *
 * So: find each framer-motion import, split its named bindings, and check whether any of them is
 * exactly `motion`. `m as motion` is the correct form and must NOT be flagged — a guard that
 * condemns the fix along with the bug is a guard people delete.
 */
const IMPORT_FROM_FRAMER = /import\s*\{([^}]*)\}\s*from\s*["']framer-motion["']/g;

function importsEagerMotion(src) {
  for (const m of src.matchAll(IMPORT_FROM_FRAMER)) {
    const bindings = m[1].split(",").map((b) => b.trim()).filter(Boolean);
    if (bindings.some((b) => b === "motion")) return true;
  }
  return false;
}
const EAGER_MOTION = { test: importsEagerMotion };
/** Replay listed in the eager `integrations` array rather than loaded through lazyLoadIntegration. */
const EAGER_REPLAY = /integrations\s*:\s*\[[^\]]*Sentry\.replayIntegration\s*\(/s;
/** Ambient session sampling: a non-zero default for replaysSessionSampleRate. */
const AMBIENT_REPLAY = /replaysSessionSampleRate\s*:\s*Number\([^)]*\?\?\s*0*\.?[1-9]/;

/**
 * Positive controls, run every time.
 *
 * A guard that cannot fire is worse than no guard: it reports success forever. Earlier in this
 * project a regex written through a shell heredoc had `\b` turned into a literal backspace and
 * matched nothing at all — it passed against a deliberately broken file. So each pattern is proved
 * against a known-bad string and a known-good one before it is trusted with the real tree.
 */
const CONTROLS = [
  [EAGER_MOTION, `import { motion } from "framer-motion";`, true, "eager motion"],
  [EAGER_MOTION, `import { motion, AnimatePresence } from "framer-motion";`, true, "eager motion + others"],
  [EAGER_MOTION, `import { m as motion } from "framer-motion";`, false, "correct `m as motion`"],
  [EAGER_MOTION, `import { AnimatePresence } from "framer-motion";`, false, "AnimatePresence only"],
  [EAGER_MOTION, `import { LazyMotion } from "framer-motion";`, false, "the provider itself"],
  [EAGER_REPLAY, `integrations: [Sentry.replayIntegration({ maskAllText: true }), x],`, true, "eager replay"],
  [EAGER_REPLAY, `integrations: [Sentry.browserTracingIntegration()],`, false, "tracing only"],
  [AMBIENT_REPLAY, `replaysSessionSampleRate: Number(process.env.X ?? 0.1),`, true, "ambient 10%"],
  [AMBIENT_REPLAY, `replaysSessionSampleRate: Number(process.env.X ?? 0),`, false, "off by default"],
];

const controlFailures = CONTROLS.filter(([re, sample, shouldMatch]) => re.test(sample) !== shouldMatch);
if (controlFailures.length > 0) {
  console.error("[perf-guards] THE GUARDS THEMSELVES ARE BROKEN — patterns did not behave:");
  for (const [, sample, shouldMatch, label] of controlFailures) {
    console.error(`  ✗ ${label}: expected ${shouldMatch ? "match" : "no match"} for  ${sample}`);
  }
  process.exit(2);
}

const findings = [];

// ── framer-motion ──────────────────────────────────────────────────────────
if (existsSync(SRC)) {
  const files = walk(SRC);
  if (files.length < 20) {
    console.error(`[perf-guards] only ${files.length} source files found under ${SRC} — refusing to pass vacuously`);
    process.exit(2);
  }
  for (const file of files) {
    // The provider is the one place allowed to touch the real engine.
    if (file.includes("MotionProvider")) continue;
    const src = readFileSync(file, "utf8");
    if (EAGER_MOTION.test(src)) {
      findings.push({
        file: relative(APP, file),
        what: "imports the full framer-motion `motion` engine",
        fix: 'use `import { m as motion } from "framer-motion";` — LazyMotion supplies the features',
      });
    }
  }
}

// ── Sentry replay ──────────────────────────────────────────────────────────
for (const name of ["sentry.client.config.ts", "sentry.client.config.js"]) {
  const file = join(APP, name);
  if (!existsSync(file)) continue;
  const src = readFileSync(file, "utf8");
  if (EAGER_REPLAY.test(src)) {
    findings.push({
      file: name,
      what: "bundles Sentry Session Replay eagerly (~40 kB on every route)",
      fix: "keep `integrations: [browserTracingIntegration()]` and load replay via Sentry.lazyLoadIntegration",
    });
  }
  if (AMBIENT_REPLAY.test(src)) {
    findings.push({
      file: name,
      what: "samples sessions for replay by default (continuous DOM-mutation recording, ~90 ms CPU per navigation)",
      fix: "default replaysSessionSampleRate to 0; error sessions are still captured at 100%",
    });
  }
}

if (findings.length > 0) {
  console.error(`\n[perf-guards] FAILED — ${findings.length} regression(s) in ${appArg}\n`);
  for (const f of findings) {
    console.error(`  ✗ ${f.file}`);
    console.error(`      ${f.what}`);
    console.error(`      fix: ${f.fix}\n`);
  }
  process.exit(1);
}

console.log(`[perf-guards] OK — ${appArg}: no eager motion engine, no eager or ambient session replay`);
