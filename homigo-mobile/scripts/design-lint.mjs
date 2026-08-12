#!/usr/bin/env node
/**
 * Design-system drift check.
 *
 * The token scales in `src/lib/typography.ts` and `src/lib/colors.ts` are good;
 * the problem has always been adoption. This script measures adoption so drift is
 * visible in CI instead of being discovered during a redesign.
 *
 *   node scripts/design-lint.mjs            # report
 *   node scripts/design-lint.mjs --strict   # exit 1 if any budget is exceeded
 *
 * Budgets are set to the CURRENT measured counts, so the check fails the moment a
 * change makes things worse. Lower them as screens are migrated — never raise them.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = ["src", "app"];
const EXT = new Set([".ts", ".tsx"]);

/** Files that legitimately hold raw values: the token definitions themselves. */
const TOKEN_SOURCES = [
  "src/lib/colors.ts",
  "src/lib/typography.ts",
  "src/lib/ai-mobile-theme.ts",
  "src/lib/tokens.ts",
  "src/components/services/theme/",
];

/**
 * Ceilings, not targets. Each equals the count measured when this check was added
 * (2026-07-30). A PR that adds raw values fails; one that migrates a screen passes
 * and should lower the number it beat.
 */
const BUDGETS = {
  hexColors: 917,
  rgba: 333,
  fontSize: 476,
  borderRadius: 298,
  padding: 447,
  margin: 359,
};

const PATTERNS = {
  hexColors: /#[0-9A-Fa-f]{3,8}\b/g,
  rgba: /rgba?\([0-9]/g,
  fontSize: /fontSize: *[0-9]+/g,
  borderRadius: /borderRadius: *[0-9]+/g,
  padding: /padding[A-Za-z]*: *[0-9]+/g,
  margin: /margin[A-Za-z]*: *[0-9]+/g,
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.has(extname(p))) out.push(p.split("\\").join("/"));
  }
  return out;
}

const files = ROOTS.flatMap((r) => walk(r));
const counts = Object.fromEntries(Object.keys(PATTERNS).map((k) => [k, 0]));
/** Per-file tallies so the report can name the worst offenders. */
const perFile = new Map();

for (const f of files) {
  if (TOKEN_SOURCES.some((t) => f.startsWith(t))) continue;
  const src = readFileSync(f, "utf8");
  let fileTotal = 0;
  for (const [key, re] of Object.entries(PATTERNS)) {
    const n = (src.match(re) || []).length;
    counts[key] += n;
    fileTotal += n;
  }
  if (fileTotal) perFile.set(f, fileTotal);
}

const strict = process.argv.includes("--strict");
let failed = false;

console.log("Design-system adoption — raw values outside the token sources\n");
for (const [key, n] of Object.entries(counts)) {
  const budget = BUDGETS[key];
  const over = n > budget;
  if (over) failed = true;
  const delta = n - budget;
  console.log(
    `  ${key.padEnd(14)} ${String(n).padStart(5)}  budget ${String(budget).padStart(5)}  ` +
      (over ? `OVER by ${delta}` : delta === 0 ? "at budget" : `${-delta} under`),
  );
}

console.log("\nHighest-density files:");
[...perFile.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([f, n]) => console.log(`  ${String(n).padStart(4)}  ${f}`));

if (strict && failed) {
  console.error("\nFAIL: raw design values increased. Use tokens, or migrate a screen and lower the budget.");
  process.exit(1);
}
console.log(`\n${failed ? "OVER BUDGET" : "OK"} — ${files.length} files scanned.`);
