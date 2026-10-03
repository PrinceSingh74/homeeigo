#!/usr/bin/env node
/**
 * Fails the build when the JavaScript a page ships grows past its budget.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * On 2026-09-17 `apps/partner-web` was found shipping 227 kB of shared JS against `apps/web`'s
 * 188 kB — the exact figure the customer app had *before* its LazyMotion and lazy-Sentry-replay
 * work. Two specific regressions had been sitting there: thirteen files importing the full
 * framer-motion `motion` engine, and Sentry Session Replay bundled eagerly and sampling 10% of
 * sessions. Neither was noticed, because nothing measured it. A person eventually noticed instead,
 * by feel, and reported the app as slow.
 *
 * Making those two things faster was a cleanup. This is the part that makes it permanent: the next
 * regression stops the build rather than waiting for someone to complain. A budget nobody enforces
 * is a number in a document.
 *
 * ── How to use it ───────────────────────────────────────────────────────────
 *
 *   node scripts/check-bundle-budget.mjs --app apps/partner-web
 *   node scripts/check-bundle-budget.mjs --app apps/partner-web --update   # after a deliberate rise
 *
 * `--update` rewrites the budget file. Raising a budget is therefore a deliberate, reviewable line
 * in a commit, which is the only honest way to allow an increase: someone decided, and it is on the
 * record with their name on it.
 *
 * ── On the numbers ──────────────────────────────────────────────────────────
 *
 * Sizes are gzipped bytes summed from the build manifest, which lands ~5 kB BELOW the "First Load
 * JS" Next prints (Next counts a small runtime chunk this does not). The offset is constant, so the
 * numbers are directly comparable to each other across builds — just not identical to the build
 * output. Budgets are stored in the units this script measures.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const args = process.argv.slice(2);
const appArg = args[args.indexOf("--app") + 1];
const UPDATE = args.includes("--update");
if (!appArg || appArg.startsWith("--")) {
  console.error("usage: check-bundle-budget.mjs --app <path-to-next-app> [--update]");
  process.exit(2);
}

const APP = resolve(process.cwd(), appArg);
const DIST = join(APP, process.env.NEXT_DIST_DIR ?? ".next");
const BUDGET_FILE = join(APP, "bundle-budget.json");
/** A build is allowed to drift by this much before it is called a regression. */
const HEADROOM = 1.05;

if (!existsSync(join(DIST, "app-build-manifest.json"))) {
  console.error(`[bundle-budget] no build found at ${DIST} — run the build first`);
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(DIST, "app-build-manifest.json"), "utf8"));
const gzCache = new Map();
const gzKb = (file) => {
  if (gzCache.has(file)) return gzCache.get(file);
  let kb = 0;
  try {
    const abs = join(DIST, file);
    if (statSync(abs).isFile()) kb = gzipSync(readFileSync(abs), { level: 9 }).length / 1024;
  } catch {
    // A manifest entry with no file on disk contributes nothing rather than throwing — the build
    // output is the authority on what shipped, and a missing chunk is the build's problem, not this
    // check's to guess about.
  }
  gzCache.set(file, kb);
  return kb;
};

/** Only real pages. `/loading` and `/layout` entries are not things a person navigates to. */
const pages = Object.entries(manifest.pages).filter(([k]) => k.endsWith("/page"));
if (pages.length === 0) {
  console.error("[bundle-budget] manifest contained no page entries — refusing to pass vacuously");
  process.exit(2);
}

/** Shared = the chunks every single page carries. This is the number that hurts everywhere at once. */
let sharedSet = null;
for (const [, files] of pages) {
  const s = new Set(files);
  sharedSet = sharedSet ? new Set([...sharedSet].filter((f) => s.has(f))) : s;
}
const sharedRawKb = [...sharedSet].reduce((a, f) => a + gzKb(f), 0);

/** `/(partner)/requests/page` → `/requests`; route groups never appear in a URL. */
const toRoute = (key) =>
  "/" +
  key
    .replace(/\/page$/, "")
    .split("/")
    .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")))
    .join("/");

const routeRawKb = {};
const routeKb = {};
for (const [key, files] of pages) {
  const raw = files.reduce((a, f) => a + gzKb(f), 0);
  routeRawKb[toRoute(key)] = raw;
  routeKb[toRoute(key)] = Number(raw.toFixed(1));
}

const measured = {
  sharedKb: Number(sharedRawKb.toFixed(1)),
  routes: Object.fromEntries(Object.entries(routeKb).sort(([a], [b]) => a.localeCompare(b))),
};

if (UPDATE || !existsSync(BUDGET_FILE)) {
  writeFileSync(
    BUDGET_FILE,
    JSON.stringify(
      {
        _comment:
          "Gzipped kB from the build manifest, measured by scripts/check-bundle-budget.mjs. " +
          "Regenerate deliberately with `--update`; raising a number should be a reviewed decision, " +
          "not a silent drift. Runs ~5 kB below the First Load JS that `next build` prints.",
        headroom: HEADROOM,
        ...measured,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `[bundle-budget] wrote ${BUDGET_FILE.replace(process.cwd(), ".")} — shared ${measured.sharedKb} kB across ${pages.length} pages`,
  );
  process.exit(0);
}

const budget = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));
const limit = (n) => n * (budget.headroom ?? HEADROOM);
const breaches = [];

if (sharedRawKb > limit(budget.sharedKb)) {
  breaches.push(
    `shared JS ${measured.sharedKb} kB > ${limit(budget.sharedKb).toFixed(1)} kB ` +
      `(budget ${budget.sharedKb} kB) — this is carried by EVERY route`,
  );
}
for (const [route, kb] of Object.entries(measured.routes)) {
  const budgeted = budget.routes?.[route];
  // A brand-new route has no budget yet and is not a regression; it is recorded on the next --update.
  if (budgeted == null) continue;
  if (routeRawKb[route] > limit(budgeted)) {
    breaches.push(`${route} ${kb} kB > ${limit(budgeted).toFixed(1)} kB (budget ${budgeted} kB)`);
  }
}

if (breaches.length > 0) {
  console.error(`\n[bundle-budget] FAILED — ${breaches.length} budget(s) exceeded in ${appArg}\n`);
  for (const b of breaches) console.error(`  ✗ ${b}`);
  console.error(
    "\n  If the growth is intentional, re-run with --update and commit the new budget so the\n" +
      "  decision is on the record. If it is not, the usual causes are an eager `motion` import\n" +
      "  (see MotionProvider), an eagerly-bundled Sentry integration, or a heavy library pulled\n" +
      "  into a shared module.\n",
  );
  process.exit(1);
}

const sharedLimit = limit(budget.sharedKb);
console.log(
  `[bundle-budget] OK — shared ${measured.sharedKb} kB <= ${sharedLimit.toFixed(1)} kB ` +
    `(budget ${budget.sharedKb} kB × ${budget.headroom ?? HEADROOM} headroom), ` +
    `${Object.keys(measured.routes).length} routes within budget`,
);
