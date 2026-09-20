#!/usr/bin/env node
/**
 * Next compiles `instrumentation.ts` for Edge (middleware) AND Node. Node APIs in that file
 * become a terminal full of "not supported in the Edge Runtime" errors on every request, and
 * under Turbopack have wedged the customer-panel dev server into 500s on every route.
 *
 * This guard fails the build if those APIs leak back. Node-only work belongs in
 * `instrumentation-node.ts`, imported only from the `NEXT_RUNTIME === "nodejs"` branch.
 *
 *   node scripts/check-instrumentation-edge.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const FORBIDDEN = [
  {
    re: /["']node:child_process["']/,
    what: "imports node:child_process",
    fix: "move spawn() into instrumentation-node.ts and import it only from the nodejs register() branch",
  },
  {
    re: /["']node:fs["']/,
    what: "imports node:fs",
    fix: "move filesystem work into instrumentation-node.ts",
  },
  {
    re: /["']node:path["']/,
    what: "imports node:path",
    fix: "move path work into instrumentation-node.ts",
  },
  {
    re: /process\.cwd\s*\(/,
    what: "calls process.cwd()",
    fix: "Edge has no cwd — keep this in instrumentation-node.ts",
  },
  {
    re: /process\.execPath/,
    what: "reads process.execPath",
    fix: "Edge has no execPath — keep this in instrumentation-node.ts",
  },
];

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Positive controls, run every time. A guard that cannot fire reports success forever.
 */
const CONTROLS = [
  [FORBIDDEN[0].re, `await import("node:child_process");`, true, "child_process import"],
  [FORBIDDEN[0].re, `await import("./instrumentation-node");`, false, "node helper import"],
  [FORBIDDEN[3].re, `join(process.cwd(), "scripts")`, true, "process.cwd()"],
  [FORBIDDEN[3].re, `process.env.NEXT_RUNTIME === "nodejs"`, false, "process.env is Edge-safe"],
  [FORBIDDEN[4].re, `spawn(process.execPath, [script])`, true, "execPath"],
  [FORBIDDEN[4].re, `process.env.NODE_ENV`, false, "NODE_ENV is Edge-safe"],
];

const controlFailures = CONTROLS.filter(([re, sample, shouldMatch]) => re.test(sample) !== shouldMatch);
if (controlFailures.length > 0) {
  console.error("[instrumentation-edge] THE GUARD ITSELF IS BROKEN — patterns did not behave:");
  for (const [, sample, shouldMatch, label] of controlFailures) {
    console.error(`  ✗ ${label}: expected ${shouldMatch ? "match" : "no match"} for  ${sample}`);
  }
  process.exit(2);
}

function nextApps() {
  const appsDir = join(ROOT, "apps");
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir)
    .map((entry) => join(appsDir, entry))
    .filter((full) => statSync(full).isDirectory() && existsSync(join(full, "instrumentation.ts")));
}

const findings = [];
const scanned = [];

for (const app of nextApps()) {
  const file = join(app, "instrumentation.ts");
  if (!existsSync(file)) continue;
  scanned.push(relative(ROOT, file));
  const src = stripComments(readFileSync(file, "utf8"));
  for (const rule of FORBIDDEN) {
    if (rule.re.test(src)) {
      findings.push({
        file: relative(ROOT, file),
        what: rule.what,
        fix: rule.fix,
      });
    }
  }
}

if (scanned.length < 2) {
  console.error(
    `[instrumentation-edge] only ${scanned.length} instrumentation.ts file(s) found — refusing to pass vacuously`,
  );
  process.exit(2);
}

if (findings.length > 0) {
  console.error(`\n[instrumentation-edge] FAILED — ${findings.length} Edge-unsafe API(s)\n`);
  for (const f of findings) {
    console.error(`  ✗ ${f.file}`);
    console.error(`      ${f.what}`);
    console.error(`      fix: ${f.fix}\n`);
  }
  process.exit(1);
}

console.log(`[instrumentation-edge] OK — ${scanned.join(", ")}`);
