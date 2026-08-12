/**
 * Reproduces the mobile startup deadlock: persisted status "initializing"
 * blocks bootstrap() and leaves isInitializing=true forever.
 *
 * Run: node homigo-mobile/scripts/startup-bootstrap-probe.mjs
 */

const REQUEST_TIMEOUT_MS = 20000;

function isInitializingBuggy(status) {
  return status === "initializing" || status === "idle";
}

function isInitializingFixed(status) {
  return status === "initializing";
}

function simulateCurrentBootstrap(get, set) {
  return async function bootstrap() {
    if (get().status === "initializing") return; // early exit — deadlock if persisted
    set({ status: "initializing" });
    try {
      await new Promise((r) => setTimeout(r, 50));
      set({ status: "unauthenticated" });
    } catch {
      set({ status: "unauthenticated" });
    }
  };
}

function simulateFixedBootstrap(get, set, inFlightRef) {
  return async function bootstrap() {
    if (inFlightRef.current) return inFlightRef.current;
    inFlightRef.current = (async () => {
      set({ status: "initializing" });
      try {
        await new Promise((r) => setTimeout(r, 50));
        set({ status: "unauthenticated" });
      } catch {
        set({ status: "unauthenticated" });
      } finally {
        if (get().status === "initializing") set({ status: "unauthenticated" });
        inFlightRef.current = null;
      }
    })();
    return inFlightRef.current;
  };
}

async function runScenario(label, makeBootstrap, initialStatus, triggerBootstrap, extra) {
  let state = { status: initialStatus };
  const get = () => state;
  const set = (patch) => {
    state = { ...state, ...patch };
  };
  const boot = makeBootstrap(get, set, extra);

  if (triggerBootstrap === "idle-only" && state.status === "idle") {
    await boot();
  } else if (triggerBootstrap === "always") {
    await boot();
  }

  await new Promise((r) => setTimeout(r, 100));
  return { label, finalStatus: state.status, spinner: isInitializingBuggy(state.status) };
}

async function probeBackend() {
  const base = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, base };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: e instanceof Error ? e.message : String(e), base };
  }
}

async function main() {
  console.log("=== HOMIGO STARTUP BOOTSTRAP PROBE ===\n");

  const health = await probeBackend();
  console.log("[NETWORK]", health.ok ? "PASS" : "FAIL", health);

  const inFlightRef = { current: null };

  const scenarios = [
    await runScenario(
      "BUG: persisted initializing + idle-only trigger (AuthProvider pattern)",
      simulateCurrentBootstrap,
      "initializing",
      "idle-only",
    ),
    await runScenario(
      "BUG: isInitializing treats idle as loading forever if bootstrap never runs",
      () => async () => {},
      "idle",
      "never",
    ),
    await runScenario(
      "FIX: persisted initializing + fixed bootstrap (always recovers)",
      simulateFixedBootstrap,
      "initializing",
      "always",
      inFlightRef,
    ),
    await runScenario(
      "FIX: isInitializing only during initializing",
      () => async () => {},
      "idle",
      "never",
    ),
  ];

  for (const s of scenarios.slice(0, 3)) {
    console.log(`[${s.label}]`);
    console.log(`  finalStatus=${s.finalStatus} spinner=${s.spinner}`);
  }

  const fixedSpinnerScenario = scenarios[3];
  const fixedSpinner = isInitializingFixed(fixedSpinnerScenario.finalStatus);
  console.log(`[${fixedSpinnerScenario.label}]`);
  console.log(`  finalStatus=${fixedSpinnerScenario.finalStatus} spinner=${fixedSpinner}`);

  const deadlock = scenarios[0].finalStatus === "initializing" && scenarios[0].spinner;
  const fixed = scenarios[2].finalStatus !== "initializing" && !scenarios[2].spinner;
  console.log("\n=== VERDICT ===");
  console.log(deadlock ? "ROOT CAUSE REPRODUCED: status stuck on initializing" : "Deadlock not reproduced");
  console.log(fixed ? "FIX PATH: bootstrap recovers from persisted initializing" : "Fix path failed");
  process.exit(deadlock && fixed ? 0 : 1);
}

main();
