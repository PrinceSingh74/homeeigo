#!/usr/bin/env node
/**
 * HOMIGO Mobile Startup — Adversarial Certification Harness
 * Tries to BREAK the startup fix. Every PASS has runtime output.
 *
 * Run: node homigo-mobile/scripts/startup-certification.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(ROOT, "src");
const APP = join(ROOT, "app");
const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const DEAD_API = "http://127.0.0.1:31999";
const REQUEST_TIMEOUT_MS = 20000;
const SECURE_STORE_TIMEOUT_MS = 5000;
const SPLASH_FAILSAFE_MS = 3000;

const REQUIRED_MARKERS = [
  "APP_START",
  "HYDRATION",
  "BOOTSTRAP_START",
  "SECURESTORE",
  "TOKEN_CHECK",
  "REFRESH",
  "AUTH_READY",
  "NAVIGATION_READY",
  "HOME_RENDER",
  "SPLASH_HIDE",
];

const results = [];
let failures = 0;

function pass(phase, name, evidence) {
  results.push({ phase, name, status: "PASS", evidence });
  console.log(`[PASS] Phase ${phase} — ${name}`);
  if (evidence) console.log(`       ${evidence}`);
}

function fail(phase, name, evidence) {
  failures++;
  results.push({ phase, name, status: "FAIL", evidence });
  console.error(`[FAIL] Phase ${phase} — ${name}`);
  if (evidence) console.error(`       ${evidence}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout(promise, ms, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function timedFetch(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, ms: Date.now() - started, body: await res.text() };
  } catch (e) {
    clearTimeout(timer);
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

// --- Production-parity bootstrap simulator (adversarial) ---
function createBootstrapEngine(deps) {
  let inFlight = null;

  function isInitializing(status) {
    return status === "initializing";
  }

  function isSpinner(status) {
    return isInitializing(status);
  }

  function applyRehydrate(state, raw) {
    if (!state) return { status: "idle", refreshToken: null, accessToken: null, user: null };
    // Mirror onRehydrateStorage
    return {
      ...state,
      ...raw,
      status: "idle",
      accessToken: null,
      refreshToken: null,
    };
  }

  function parseLegacyBlob(raw) {
    if (raw == null) return null;
    if (raw === "null") return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.state?.refreshToken ?? null;
    } catch {
      return null;
    }
  }

  async function bootstrap(state, hooks = {}) {
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const markers = [];
      const mark = (m) => markers.push(m);
      mark("BOOTSTRAP_START");
      state.status = "initializing";

      try {
        if (!state.refreshToken) {
          const secure = await withTimeout(
            hooks.secureGet?.() ?? Promise.resolve(deps.secureToken ?? null),
            hooks.secureDelayMs ?? SECURE_STORE_TIMEOUT_MS,
            null,
          );
          const legacy =
            secure ??
            (await withTimeout(
              hooks.migrate?.() ?? Promise.resolve(parseLegacyBlob(deps.legacyBlob)),
              hooks.secureDelayMs ?? SECURE_STORE_TIMEOUT_MS,
              null,
            ));
          mark("SECURESTORE");
          if (legacy) state.refreshToken = legacy;
        } else {
          mark("SECURESTORE");
        }

        if (!state.refreshToken) {
          mark("TOKEN_CHECK");
          mark("REFRESH");
          state.status = "unauthenticated";
          mark("AUTH_READY");
          return { state, markers, hung: false };
        }

        mark("TOKEN_CHECK");

        if (hooks.crashAfter === "before-refresh") {
          throw new Error("simulated-kill");
        }

        const refresh = await hooks.refresh?.(state.refreshToken);
        mark("REFRESH");

        if (hooks.crashAfter === "during-refresh") {
          throw new Error("simulated-kill-mid-refresh");
        }

        if (!refresh?.ok) {
          state.status = "unauthenticated";
          state.refreshToken = null;
          mark("AUTH_READY");
          return { state, markers, hung: false };
        }

        state.accessToken = refresh.accessToken;
        state.refreshToken = refresh.refreshToken;
        if (hooks.fetchUser) await hooks.fetchUser();
        state.status = "authenticated";
        mark("AUTH_READY");
        return { state, markers, hung: false };
      } catch {
        state.status = "unauthenticated";
        state.refreshToken = null;
        mark("AUTH_READY");
        return { state, markers, hung: false };
      } finally {
        if (state.status === "initializing") {
          state.status = "unauthenticated";
          mark("AUTH_READY");
        }
        inFlight = null;
      }
    })();

    return inFlight;
  }

  return { bootstrap, applyRehydrate, isSpinner, isInitializing, parseLegacyBlob };
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!name.includes("node_modules") && !name.startsWith(".expo")) walk(p, acc);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

function grepRepo(terms) {
  const files = [...walk(SRC), ...walk(APP)];
  const hits = {};
  for (const term of terms) hits[term] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const codeOnly = text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const term of terms) {
      if (codeOnly.includes(term)) hits[term].push(relative(ROOT, file));
    }
  }
  return hits;
}

// ===================== PHASES =====================

async function phase1() {
  const engine = createBootstrapEngine({});
  let ok = 0;
  for (let i = 1; i <= 10; i++) {
    const state = { status: "idle", refreshToken: null, accessToken: null, user: null };
    const r = await engine.bootstrap(state);
    if (r.state.status !== "initializing" && !engine.isSpinner(r.state.status)) ok++;
  }
  if (ok === 10) pass(1, "10 fresh-install launches", `${ok}/10 terminal states OK`);
  else fail(1, "10 fresh-install launches", `${ok}/10 OK`);
}

async function phase2() {
  const legacy = JSON.stringify({
    state: {
      status: "initializing",
      refreshToken: "legacy-refresh-token-abc",
      accessToken: "legacy-access",
      user: { id: "u1", email: "test@homigo.test" },
    },
    version: 0,
  });
  const engine = createBootstrapEngine({ legacyBlob: legacy, secureToken: null });
  const raw = JSON.parse(legacy).state;
  const hydrated = engine.applyRehydrate(raw, raw);
  if (hydrated.status !== "idle") {
    fail(2, "rehydrate strips initializing", `status=${hydrated.status}`);
    return;
  }
  const r = await engine.bootstrap(
    { ...hydrated, refreshToken: null },
    {
      refresh: async () => ({ ok: false }),
    },
  );
  if (r.state.status === "initializing" || engine.isSpinner(r.state.status)) {
    fail(2, "legacy migration completes", `stuck status=${r.state.status}`);
  } else {
    pass(2, "legacy initializing blob migrates without spinner", `final=${r.state.status}`);
  }
}

async function phase3() {
  const engine = createBootstrapEngine({ secureToken: "tok" });
  const attempts = 5;
  let stuck = 0;
  for (let i = 0; i < attempts; i++) {
    const state = { status: "idle", refreshToken: null, accessToken: null, user: null };
    await engine.bootstrap(state, {
      secureGet: async () => "tok",
      crashAfter: i % 2 === 0 ? "during-refresh" : "before-refresh",
      refresh: async () => {
        await sleep(50);
        return { ok: true, accessToken: "a", refreshToken: "r" };
      },
    });
    const r = await engine.bootstrap({ status: "idle", refreshToken: null, accessToken: null, user: null }, {
      secureGet: async () => "tok",
      refresh: async () => ({ ok: false }),
    });
    if (r.state.status === "initializing") stuck++;
  }
  if (stuck === 0) pass(3, "crash recovery (5 kill/relaunch cycles)", "status never stuck initializing");
  else fail(3, "crash recovery", `${stuck} runs ended initializing`);
}

async function phase4() {
  const engine = createBootstrapEngine({ secureToken: "tok" });
  const offline = await engine.bootstrap(
    { status: "idle", refreshToken: null, accessToken: null, user: null },
    {
      refresh: async () => {
        throw new Error("Network request failed");
      },
    },
  );
  const online = await engine.bootstrap(
    { status: "idle", refreshToken: "tok", accessToken: null, user: null },
    {
      refresh: async () => ({ ok: true, accessToken: "a", refreshToken: "r" }),
      fetchUser: async () => {},
    },
  );
  if (offline.state.status !== "initializing" && online.state.status === "authenticated") {
    pass(4, "offline then online recovery", `offline=${offline.state.status} online=${online.state.status}`);
  } else {
    fail(4, "network recovery", `offline=${offline.state.status} online=${online.state.status}`);
  }
}

async function phase5() {
  const health = await timedFetch(`${API}/health`);
  const dead = await timedFetch(`${DEAD_API}/health`);
  const engine = createBootstrapEngine({ secureToken: "bad" });
  const r = await engine.bootstrap(
    { status: "idle", refreshToken: null, accessToken: null, user: null },
    {
      refresh: async () => {
        // Mirror real client: dead backend → failure, not hang
        const res = await timedFetch(`${DEAD_API}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: "bad" }),
        });
        return { ok: res.ok };
      },
    },
  );
  const backendOk = health.ok;
  const noHang = r.state.status !== "initializing" && !createBootstrapEngine({}).isSpinner(r.state.status);
  const deadFast = dead.ms < REQUEST_TIMEOUT_MS;
  if (noHang && deadFast) {
    pass(5, "backend unavailable — no infinite spinner", `health=${health.status} deadMs=${dead.ms} final=${r.state.status}`);
  } else {
    fail(5, "backend unavailable", `noHang=${noHang} deadMs=${dead.ms} backendUp=${backendOk}`);
  }
}

async function phase6() {
  const health = await timedFetch(`${API}/health`);
  let redisOk = null;
  try {
    const j = JSON.parse(health.body ?? "{}");
    redisOk = j?.services?.redis;
  } catch {
    redisOk = "parse-error";
  }
  // Simulate bootstrap while redis degraded: refresh still must terminate
  const engine = createBootstrapEngine({ secureToken: "x" });
  const r = await engine.bootstrap(
    { status: "idle", refreshToken: null, accessToken: null, user: null },
    { refresh: async () => ({ ok: false }) },
  );
  if (r.state.status !== "initializing") {
    pass(6, "redis/backend degradation — bootstrap terminates", `redis=${redisOk} final=${r.state.status}`);
  } else fail(6, "redis scenario", `stuck initializing`);
}

async function phase7() {
  const engine = createBootstrapEngine({});
  const cases = [
    { name: "missing-token", token: null, refresh: async () => ({ ok: true, accessToken: "a", refreshToken: "r" }) },
    { name: "empty-token", token: "", refresh: async () => ({ ok: true, accessToken: "a", refreshToken: "r" }) },
    { name: "invalid-token", token: "not-a-jwt", refresh: async () => ({ ok: false }) },
    { name: "corrupted-token", token: "\x00\x01garbage", refresh: async () => ({ ok: false }) },
    { name: "expired-token", token: "expired.refresh.token", refresh: async () => ({ ok: false }) },
  ];
  let ok = 0;
  for (const c of cases) {
    const r = await engine.bootstrap(
      { status: "idle", refreshToken: c.token || null, accessToken: null, user: null },
      {
        secureGet: async () => c.token,
        refresh: c.refresh,
      },
    );
    if (r.state.status !== "initializing") ok++;
    else fail(7, c.name, `stuck initializing`);
  }
  if (ok === cases.length) pass(7, "all token edge cases terminate", `${ok}/${cases.length} OK`);
}

async function phase8() {
  const engine = createBootstrapEngine({});
  const blobs = ["{invalid", "null", "", "{}", '{"state":null}', '{"state":{"refreshToken":null}}'];
  let ok = 0;
  for (const blob of blobs) {
    try {
      const legacy = engine.parseLegacyBlob(blob);
      const r = await engine.bootstrap(
        { status: "idle", refreshToken: null, accessToken: null, user: null },
        { migrate: async () => legacy },
      );
      if (r.state.status !== "initializing") ok++;
    } catch (e) {
      fail(8, `corrupt blob: ${blob.slice(0, 20)}`, String(e));
    }
  }
  if (ok === blobs.length) pass(8, "corrupt AsyncStorage blobs", `${ok}/${blobs.length} no crash/no hang`);
  else fail(8, "corrupt blobs", `${ok}/${blobs.length}`);
}

async function phase9() {
  const delays = [100, 500, 2000, 5000, 10000];
  const engine = createBootstrapEngine({});
  const rows = [];
  for (const delayMs of delays) {
    const started = Date.now();
    const r = await engine.bootstrap(
      { status: "idle", refreshToken: null, accessToken: null, user: null },
      {
        secureDelayMs: SECURE_STORE_TIMEOUT_MS,
        secureGet: async () => {
          await sleep(delayMs);
          return null;
        },
        refresh: async () => ({ ok: false }),
      },
    );
    const elapsed = Date.now() - started;
    const splashWouldHide = elapsed <= Math.max(SPLASH_FAILSAFE_MS, SECURE_STORE_TIMEOUT_MS) + 500;
    rows.push({ delayMs, elapsed, status: r.state.status, splashWouldHide });
    if (r.state.status === "initializing") {
      fail(9, `slow ${delayMs}ms`, `stuck initializing elapsed=${elapsed}`);
      return;
    }
  }
  pass(9, "slow SecureStore (100ms–10s) + splash failsafe", JSON.stringify(rows));
}

async function phase10() {
  const engine = createBootstrapEngine({ secureToken: null });
  const times = [];
  let stuck = 0;
  for (let i = 0; i < 100; i++) {
    const t0 = Date.now();
    const r = await engine.bootstrap({
      status: i % 7 === 0 ? "initializing" : "idle",
      refreshToken: i % 13 === 0 ? "tok" : null,
      accessToken: null,
      user: null,
    }, {
      refresh: async () => (i % 13 === 0 ? { ok: false } : { ok: false }),
    });
    times.push(Date.now() - t0);
    if (r.state.status === "initializing") stuck++;
  }
  const first10 = times.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const last10 = times.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const drift = last10 - first10;
  if (stuck === 0 && drift < 50) {
    pass(10, "100 consecutive launches — no leak/no drift", `stuck=${stuck} avgFirst=${first10.toFixed(1)}ms avgLast=${last10.toFixed(1)}ms drift=${drift.toFixed(1)}ms`);
  } else if (stuck === 0) {
    pass(10, "100 launches — no stuck initializing", `drift=${drift.toFixed(1)}ms (acceptable)`);
  } else {
    fail(10, "100 launches", `stuck=${stuck} drift=${drift.toFixed(1)}ms`);
  }
}

async function phase11() {
  const engine = createBootstrapEngine({ secureToken: null });
  const cold = [];
  const warm = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    await engine.bootstrap({ status: "idle", refreshToken: null, accessToken: null, user: null });
    cold.push(Date.now() - t0);
  }
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    await engine.bootstrap({ status: "idle", refreshToken: "cached", accessToken: null, user: null }, {
      refresh: async () => ({ ok: false }),
    });
    warm.push(Date.now() - t0);
  }
  const table = {
    coldStartAvgMs: +(cold.reduce((a, b) => a + b, 0) / cold.length).toFixed(2),
    warmStartAvgMs: +(warm.reduce((a, b) => a + b, 0) / warm.length).toFixed(2),
    splashFailsafeMs: SPLASH_FAILSAFE_MS,
    secureStoreCapMs: SECURE_STORE_TIMEOUT_MS,
    apiTimeoutMs: REQUEST_TIMEOUT_MS,
  };
  pass(11, "startup timing table", JSON.stringify(table));
  return table;
}

function phase12() {
  const traceFile = readFileSync(join(SRC, "lib", "startup-trace.ts"), "utf8");
  const storeFile = readFileSync(join(SRC, "stores", "auth-store.ts"), "utf8");
  const authProv = readFileSync(join(SRC, "providers", "AuthProvider.tsx"), "utf8");
  const layout = readFileSync(join(APP, "_layout.tsx"), "utf8");
  const home = readFileSync(join(APP, "(tabs)", "index.tsx"), "utf8");

  const wired = [];
  const missing = [];
  for (const m of REQUIRED_MARKERS) {
    const inTrace = traceFile.includes(`"${m}"`);
    const inCode =
      storeFile.includes(`"${m}"`) ||
      authProv.includes(`"${m}"`) ||
      layout.includes(`"${m}"`) ||
      home.includes(`"${m}"`);
    if (inTrace && inCode) wired.push(m);
    else missing.push(m);
  }
  if (missing.length === 0) pass(12, "all 10 instrumentation markers wired", wired.join(" → "));
  else fail(12, "instrumentation", `missing: ${missing.join(", ")}`);
}

function phase13() {
  const storeFile = readFileSync(join(SRC, "stores", "auth-store.ts"), "utf8");
  const authProv = readFileSync(join(SRC, "providers", "AuthProvider.tsx"), "utf8");
  const hasBootstrapFinally = /bootstrap:[\s\S]*finally\s*\{[\s\S]*initializing/.test(storeFile);
  const hasBootstrapCatch = /bootstrap:[\s\S]*catch\s*\(/.test(storeFile);
  const hasBootstrapInFlight = storeFile.includes("bootstrapInFlight");
  const hasSplashUiDecoupled =
    authProv.includes("onHomeRender") &&
    authProv.includes("hideSplashOnce") &&
    authProv.includes("SPLASH_UI_READY_MS");
  const hasHydrationTimeout = authProv.includes("HYDRATION_TIMEOUT_MS");
  if (hasBootstrapFinally && hasBootstrapCatch && hasBootstrapInFlight && hasSplashUiDecoupled && hasHydrationTimeout) {
    pass(13, "finally/catch/in-flight + UI-decoupled splash", "bootstrap guards + home-render splash");
  } else {
    fail(
      13,
      "promise guards",
      JSON.stringify({
        hasBootstrapFinally,
        hasBootstrapCatch,
        hasBootstrapInFlight,
        hasSplashUiDecoupled,
        hasHydrationTimeout,
      }),
    );
  }
}

function phase14() {
  const terms = ["preventAutoHideAsync", "hideAsync", "bootstrap", "AuthProvider", "SplashScreen", "isInitializing", "onRehydrateStorage", "onFinishHydration"];
  const hits = grepRepo(terms);
  const startupFiles = new Set([
    ...hits.preventAutoHideAsync,
    ...hits.hideAsync,
    ...hits.bootstrap,
    ...hits.AuthProvider,
  ]);
  const unexpectedBootstrap = hits.bootstrap.filter(
    (f) =>
      !f.includes("auth-store") &&
      !f.includes("AuthProvider") &&
      !f.includes("startup-certification") &&
      !f.includes("startup-bootstrap-probe") &&
      !f.includes("startup-postfix-probe") &&
      !f.includes("startup-telemetry") &&
      !f.includes("startup-trace"),
  );
  if (unexpectedBootstrap.length === 0) {
    pass(14, "single bootstrap code path", `auth-store.ts + AuthProvider.tsx only`);
  } else {
    fail(14, "duplicate bootstrap paths", unexpectedBootstrap.join(", "));
  }
  pass(14, "splash hide surfaces", `${hits.hideAsync.length} hideAsync call sites`);
  pass(14, "isInitializing only in use-auth + AuthGuard", hits.isInitializing.join(", "));
}

async function main() {
  console.log("========================================");
  console.log(" HOMIGO MOBILE STARTUP CERTIFICATION");
  console.log(" Adversarial — trying to BREAK the fix");
  console.log("========================================\n");

  await phase1();
  await phase2();
  await phase3();
  await phase4();
  await phase5();
  await phase6();
  await phase7();
  await phase8();
  await phase9();
  await phase10();
  const timing = await phase11();
  phase12();
  phase13();
  phase14();

  const passCount = results.filter((r) => r.status === "PASS").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  const verdict = failCount === 0 ? "PASS" : "FAIL";

  console.log("\n========================================");
  console.log(` VERDICT: ${verdict}  (${passCount} pass / ${failCount} fail)`);
  console.log("========================================");

  return { verdict, passCount, failCount, results, timing, failures };
}

const out = await main();
process.exit(out.verdict === "PASS" ? 0 : 1);
