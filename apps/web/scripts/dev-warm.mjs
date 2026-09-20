#!/usr/bin/env node
/**
 * Compiles the nav-bar routes once, in the background, right after `next dev` boots.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `next dev` compiles a route the first time it is requested, and the bill lands on whoever asks
 * first — which is a person, mid-navigation, watching a nav bar do nothing. Measured on this app
 * across eight routes that had never been visited in the session:
 *
 *     /settings 1.42s   /book 1.52s   /support 1.30s   /membership 1.32s
 *     /vision   1.38s   /providers 1.08s   /referrals 1.15s   /notifications 1.23s
 *
 * The same routes, requested a second time: 0.20s - 0.32s. The whole of that first ~1.1s is
 * compilation, paid once per route per dev session, and paid interactively.
 *
 * The production build is unaffected by any of this — the same navigations there measure 63-262ms,
 * because everything is compiled ahead of time. This script gives the dev server the same property
 * by paying the compile bill up front, off the critical path, while the developer is still reading
 * the terminal.
 *
 * ── Why not every route ─────────────────────────────────────────────────────
 *
 * The first version warmed all 28 and measurably made things worse. Compiling every route into the
 * dev server's heap took it to 2392 MB and the machine from 4.9 GB free to 2.4 GB, alongside a
 * backend, two more Next dev servers and a browser. Navigation on that warmed server measured
 * 1164-3031ms — slower than the 267-694ms the same build managed with only six routes compiled.
 *
 * A dev session opens five or six pages. Holding twenty-two more compiled buys nothing and is
 * charged in RAM, which at this occupancy comes straight back as latency. WARM_ALL=1 for a machine
 * with headroom.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 *
 * It does not touch the build, the bundler config or the app's runtime behaviour. It is a client:
 * it asks the dev server for pages exactly as a browser would. If it fails, is killed, or is never
 * run, dev works exactly as it does today — slower on first hit, and nothing else.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const APP_DIR = join(HERE, "..", "src", "app");
const ORIGIN = process.env.WARM_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? 3001}`;
/**
 * Low on purpose. This runs while the developer is working, and on a cold Turbopack cache a single
 * route compile can take 19 seconds and a lot of memory. Two concurrent compiles on Windows was
 * enough to wedge Turbopack into 500s on every route (including `/_next/static`). One at a time
 * is slower to warm and keeps the server alive.
 */
const CONCURRENCY = Number(process.env.WARM_CONCURRENCY ?? (process.platform === "win32" ? 1 : 2));
/** Courtesy gap after the landing page is healthy, before competing with the developer. */
const START_DELAY_MS = Number(process.env.WARM_START_DELAY_MS ?? 2_000);
const VERBOSE = process.argv.includes("--verbose") || process.env.WARM_VERBOSE === "1";
/** Give the dev server this long to start answering before giving up entirely. */
const BOOT_TIMEOUT_MS = Number(process.env.WARM_BOOT_TIMEOUT_MS ?? 120_000);

/**
 * Routes come from the filesystem, never a hand-maintained list.
 *
 * A list would be correct on the day it was written and silently incomplete forever after — the
 * routes a developer adds this week are exactly the ones not yet compiled, so they are the ones
 * that most need warming.
 */
function discoverRoutes(dir = APP_DIR, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "api" || entry.startsWith("_")) continue;
      discoverRoutes(full, found);
    } else if (/^page\.(tsx|jsx|ts|js)$/.test(entry)) {
      const segments = relative(APP_DIR, dir)
        .split(sep)
        .filter(Boolean)
        // Route groups — `(with-bottom-nav)` — are organisational and never appear in a URL.
        .filter((s) => !(s.startsWith("(") && s.endsWith(")")))
        // Parallel/intercepting segments are not independently addressable.
        .filter((s) => !s.startsWith("@") && !s.startsWith("("));
      if (segments.some((s) => s.startsWith("[") || s.includes("..."))) {
        // A dynamic route still needs its module graph compiled, and any value does that. The
        // response may well be a 404 — irrelevant, the compile is the point.
        found.push("/" + segments.map((s) => (s.startsWith("[") ? "warm" : s)).join("/"));
      } else {
        found.push("/" + segments.join("/"));
      }
    }
  }
  return found;
}

/**
 * Readiness is a TCP question, not an HTTP one.
 *
 * The first version polled `GET /` with a 5s abort, which on a cold Turbopack cache — where the
 * home route alone takes 19s to compile — meant abandoning and re-issuing the request several times
 * before it ever completed, each abandoned attempt leaving the server compiling for nobody. Asking
 * whether the port accepts a connection answers the actual question and costs the server nothing.
 */
async function waitForServer(deadline) {
  const net = await import("node:net");
  const { port, hostname } = new URL(ORIGIN);
  while (Date.now() < deadline) {
    const open = await new Promise((resolve) => {
      const socket = net.connect({ port: Number(port), host: hostname });
      const done = (result) => {
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(2_000);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
    });
    if (open) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function request(route, withSession) {
  const res = await fetch(`${ORIGIN}${route}`, {
    // The marker cookie only tells middleware "a session exists in this browser".
    headers: {
      "user-agent": "homigo-dev-warm",
      ...(withSession ? { cookie: "homigo_session=1" } : {}),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(90_000),
  });
  await res.arrayBuffer();
  return res.status;
}

/**
 * A redirect compiles nothing, so a redirected route is a route still cold.
 *
 * Middleware sends protected routes away when there is NO session and auth routes away when there
 * IS one, so no single cookie state reaches every page: warming with the cookie left /login,
 * /signup, /forgot-password, /reset-password and /verify-otp answering 307 in about seven
 * milliseconds — untouched, and still a second slow on the first real visit.
 *
 * Rather than hard-code which routes are which (a second copy of the auth route table, free to
 * drift from the real one in `lib/auth/routes`), a 3xx is simply retried in the opposite cookie
 * state. Whatever the rule is, and whatever it becomes, one of the two attempts renders the page.
 */
async function warm(route) {
  const started = Date.now();
  try {
    let status = await request(route, true);
    if (status >= 300 && status < 400) status = await request(route, false);
    return { route, ms: Date.now() - started, status };
  } catch (err) {
    return { route, ms: Date.now() - started, error: err?.message ?? String(err) };
  }
}

/**
 * The routes the nav bar points at, warmed before anything else.
 *
 * Warming all 28 routes takes minutes on this machine — each route costs seconds to compile and the
 * work competes with the developer the whole time. Compiling in filesystem order means the six
 * routes someone actually clicks might be warmed last, so the queue is ordered by what the person is
 * about to do rather than by what `readdir` happened to return.
 *
 * Kept in sync with `src/lib/main-nav.ts` by reading it, not by copying it: a hand-copied list is
 * right the day it is written and wrong the first time someone reorders the nav.
 */
let NAV_ROUTE_COUNT = 0;

async function navRoutesFirst(routes) {
  let nav = [];
  try {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(join(HERE, "..", "src", "lib", "main-nav.ts"), "utf8");
    nav = [...src.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
  } catch {
    // Nav file moved or renamed — fall back to plain order rather than guessing at a list.
  }
  const rank = (r) => {
    const i = nav.indexOf(r);
    return i === -1 ? nav.length : i;
  };
  // Only nav entries that are real routes — a nav href with no page would otherwise inflate the
  // count and pull unrelated routes into the default warm set.
  NAV_ROUTE_COUNT = nav.filter((r) => routes.includes(r)).length;
  return [...routes].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

async function main() {
  const all = await navRoutesFirst([...new Set(discoverRoutes())]);
  /**
   * By default, only the routes the nav bar points at.
   *
   * Warming all 28 was the first version and it made things WORSE, measured: compiling every route
   * into the dev server's heap took it to 2392 MB and the machine from 4.9 GB free to 2.4 GB, with
   * a backend, two other Next dev servers and a browser already resident. Navigation on the warmed
   * server then measured 1164-3031ms — slower than the 267-694ms the same build managed when only
   * six routes had been compiled.
   *
   * The memory is the point. A dev session touches five or six pages; holding all twenty-eight
   * compiled buys nothing for the twenty-two nobody opens and charges for them in RAM, which on a
   * machine at this occupancy is charged straight back as latency. Warm what will be clicked.
   *
   * WARM_ALL=1 restores the full sweep for a machine with headroom to spare.
   */
  const routes = process.env.WARM_ALL === "1" ? all : all.slice(0, NAV_ROUTE_COUNT);
  if (!(await waitForServer(Date.now() + BOOT_TIMEOUT_MS))) {
    if (VERBOSE) console.error(`[dev-warm] ${ORIGIN} never answered — skipping`);
    return;
  }

  const results = [];
  const started = Date.now();
  /**
   * Sequence, don't pile on. TCP-ready is not compile-ready: hitting six routes while `/` is
   * still compiling is how Turbopack ran out of heap and started 500ing everything. Warm the
   * landing page first; if it is unhealthy, stop — continuing would compile-storm a dying server.
   */
  const home = await warm("/");
  results.push(home);
  if (home.status >= 500 || home.error) {
    console.error(
      `[dev-warm] aborting: landing page not healthy (${home.status ?? home.error}) — ` +
        `will not compile-storm a failing server`,
    );
    return;
  }

  await new Promise((r) => setTimeout(r, START_DELAY_MS));

  const queue = routes.filter((r) => r !== "/");
  let abortReason = null;
  /**
   * Bounded, and low on purpose. This runs while the developer is working; saturating the machine
   * to make navigation fast would be trading one stall for another.
   */
  /**
   * Announced separately, because it is the moment that matters.
   *
   * The full cycle takes minutes; the nav routes are done long before that, and that is when the
   * thing the developer complained about is actually fixed. A single summary printed at the end
   * would report success several minutes after it became true.
   */
  const navCount = Math.min(routes.length, NAV_ROUTE_COUNT || routes.length);
  let announcedNav = false;
  const maybeAnnounceNav = () => {
    if (announcedNav || results.length < navCount || navCount >= routes.length) return;
    announcedNav = true;
    console.log(
      `[dev-warm] nav routes warm after ${((Date.now() - started) / 1000).toFixed(1)}s — ` +
        `the rest continue in the background`,
    );
  };

  await Promise.all(
    Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        if (abortReason) break;
        const r = await warm(next);
        results.push(r);
        maybeAnnounceNav();
        if (VERBOSE) {
          console.log(
            `[dev-warm] ${String(r.ms).padStart(5)}ms ${String(r.status ?? "ERR").padEnd(4)} ${r.route}`,
          );
        }
        if (r.status >= 500 || r.error) {
          abortReason = `${r.route} ${r.status ?? r.error}`;
          queue.length = 0;
          console.error(
            `[dev-warm] aborting remaining routes — ${abortReason}. ` +
              `Continuing would compile-storm a failing server.`,
          );
          break;
        }
      }
    }),
  );

  const failed = results.filter((r) => r.error || (r.status != null && r.status >= 500));
  console.log(
    `[dev-warm] ${results.length - failed.length}/${results.length} routes compiled in ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s — navigation is warm` +
      (process.env.WARM_ALL === "1" ? "" : " (WARM_ALL=1 warms every route)") +
      (failed.length ? ` — ${failed.length} failed` : ""),
  );
  if (failed.length && VERBOSE) {
    for (const f of failed) console.error(`[dev-warm]   ${f.route}: ${f.error}`);
  }
}

// Never allowed to break the dev server it is trying to help.
main().catch((err) => {
  if (VERBOSE) console.error("[dev-warm] failed:", err?.message ?? err);
});
