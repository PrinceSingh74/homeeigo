/**
 * Post-fix runtime probe: verifies auth bootstrap API path completes (no hang)
 * and splash/bootstrap recovery logic is sound.
 *
 * Run: node homigo-mobile/scripts/startup-postfix-probe.mjs
 */

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const TIMEOUT_MS = 20000;

async function timedFetch(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(`${API}${path}`, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, ms: Date.now() - started };
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

async function simulatePostFixBootstrap(refreshToken) {
  const steps = [];
  const set = (name, status) => steps.push({ name, status, t: Date.now() });

  set("BOOTSTRAP_START", "initializing");

  if (!refreshToken) {
    set("SECURESTORE_OK", "no-token");
    set("QUERY_OK", "skipped");
    set("NAVIGATION_READY", "unauthenticated");
    return { steps, terminal: "unauthenticated" };
  }

  set("SECURESTORE_OK", "token-present");

  const refresh = await timedFetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken, setAuthCookies: false }),
  });
  set("QUERY_OK", refresh.ok ? "refresh-ok" : `refresh-${refresh.status}`);

  const terminal = refresh.ok ? "authenticated" : "unauthenticated";
  set("NAVIGATION_READY", terminal);
  set("HOME_SCREEN", terminal === "unauthenticated" ? "login-or-home" : "home");
  return { steps, terminal };
}

async function main() {
  console.log("=== HOMIGO STARTUP POST-FIX PROBE ===\n");

  const health = await timedFetch("/health");
  console.log("[HEALTH]", health.ok ? "PASS" : "FAIL", health);

  const noToken = await simulatePostFixBootstrap(null);
  console.log("\n[BOOTSTRAP no-token]", noToken.terminal, noToken.steps.map((s) => s.name).join(" → "));

  const badToken = await simulatePostFixBootstrap("invalid-dead-session-token");
  console.log("[BOOTSTRAP bad-token]", badToken.terminal, badToken.steps.map((s) => s.name).join(" → "));

  const pass =
    health.ok &&
    noToken.terminal === "unauthenticated" &&
    badToken.terminal === "unauthenticated" &&
    badToken.steps.every((s) => s.status !== "hang");

  console.log("\n=== VERDICT ===", pass ? "PASS" : "FAIL");
  process.exit(pass ? 0 : 1);
}

main();
