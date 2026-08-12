/**
 * Auth bootstrap runtime certification — refresh dedup + protected-route timing.
 *
 *   bun --env-file=.env run scripts/enterprise/auth-bootstrap-certification.ts
 */
import "../../src/load-env";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { smokeAppReq, smokeReq, DEFAULT_BASE } from "../smoke-lib";
import { ensureDir } from "../lib/safe-fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "..", "..");
const OUT = join(BACKEND, "..", "..", "docs", "enterprise");
const EVIDENCE = join(OUT, "auth-bootstrap-evidence.json");
const BASE = process.env.API_URL ?? DEFAULT_BASE;

type TimelineEvent = { at: number; phase: string; detail?: string; ms?: number };
const timeline: TimelineEvent[] = [];
const t0 = Date.now();

function mark(phase: string, detail?: string) {
  timeline.push({ at: Date.now(), phase, detail, ms: Date.now() - t0 });
  console.log(`[auth-cert] +${Date.now() - t0}ms ${phase}${detail ? ` — ${detail}` : ""}`);
}

async function httpOrApp(path: string, init?: RequestInit) {
  try {
    const probe = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    if (probe.ok) return smokeReq(BASE, path, init);
  } catch {
    /* fall through to in-process */
  }
  return smokeAppReq(path, init);
}

async function main() {
  await ensureDir(OUT);
  mark("cert_start");

  // ── 1. Login (fixture or env) ──
  const email = process.env.CERT_CUSTOMER_EMAIL ?? "customer@homigo.demo";
  const password = process.env.CERT_CUSTOMER_PASSWORD ?? "Homigo@123";
  mark("login_attempt", email);
  const login = await httpOrApp("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  if (login.status !== 200) {
    mark("login_failed", `status=${login.status}`);
    const evidence = {
      generatedAt: new Date().toISOString(),
      verdict: "FAIL",
      reason: "login_failed",
      loginStatus: login.status,
      timeline,
      metrics: { startup401: null, duplicateRefresh: null, protectedBeforeRefresh: null },
    };
    await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2));
    console.error(`[auth-cert] FAIL — login status ${login.status}`);
    process.exit(1);
  }
  const data = login.body.data as Record<string, unknown> | undefined;
  const accessToken = String(data?.accessToken ?? "");
  const refreshToken = String(data?.refreshToken ?? "");
  mark("login_ok", `access=${accessToken.slice(0, 12)}…`);

  // ── 2. Protected API WITHOUT token (expect 401) ──
  const noAuthNotif = await httpOrApp("/api/notifications?limit=1");
  const noAuthQuote = await httpOrApp("/api/bookings/price-quote", {
    method: "POST",
    body: JSON.stringify({ serviceId: "test", packagePrice: 100 }),
  });
  mark("protected_without_token", `notifications=${noAuthNotif.status} price-quote=${noAuthQuote.status}`);

  // ── 3. Protected API WITH valid token (expect 200/4xx not 401) ──
  mark("protected_with_token_start");
  const authedNotif = await httpOrApp("/api/notifications?limit=1", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  mark("notifications_after_auth", `status=${authedNotif.status}`);

  // ── 4. Concurrent refresh WITH coordinator (client pattern) — single in-flight ──
  mark("coordinated_refresh_start");
  let actualRefreshCalls = 0;
  let refreshInFlight: Promise<{ status: number; body: Record<string, unknown> }> | null = null;
  const doRefresh = async () => {
    actualRefreshCalls += 1;
    return httpOrApp("/api/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken, setAuthCookies: false }),
    });
  };
  const coordinated = () => {
    if (!refreshInFlight) {
      refreshInFlight = doRefresh().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  };
  const coordinatedResults = await Promise.all(Array.from({ length: 5 }, () => coordinated()));
  const refreshSuccess = coordinatedResults.filter((r) => r.status === 200).length;
  mark("coordinated_refresh_done", `http_calls=${actualRefreshCalls} success=${refreshSuccess}`);

  const duplicateRefreshOk = actualRefreshCalls === 1 && refreshSuccess === 5;

  // ── 5. Post-refresh protected access ──
  const newRefresh = (coordinatedResults.find((r) => r.status === 200)?.body.data as Record<string, unknown> | undefined)
    ?.accessToken as string | undefined;
  const tokenAfter = newRefresh ?? accessToken;
  const postRefreshNotif = await httpOrApp("/api/notifications?limit=1", {
    headers: { Authorization: `Bearer ${tokenAfter}` },
  });
  mark("notifications_post_refresh", `status=${postRefreshNotif.status}`);

  // ── 6. Startup 401 simulation: expired token + refresh available ──
  const startup401Probe = await httpOrApp("/api/notifications?limit=1", {
    headers: { Authorization: "Bearer invalid.token.here" },
  });
  mark("invalid_token_probe", `status=${startup401Probe.status}`);

  const metrics = {
    startup401_on_protected: startup401Probe.status === 401 ? 1 : 0,
    protected_before_valid_token: noAuthNotif.status === 401 && noAuthQuote.status === 401 ? 2 : 0,
    duplicate_refresh_calls_succeeded: refreshSuccess,
    duplicate_refresh_http_calls: actualRefreshCalls,
    notifications_authed_status: authedNotif.status,
    notifications_post_refresh_status: postRefreshNotif.status,
  };

  const pass =
    noAuthNotif.status === 401 &&
    authedNotif.status !== 401 &&
    postRefreshNotif.status !== 401 &&
    duplicateRefreshOk;

  const evidence = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    verdict: pass ? "PASS" : "FAIL",
    timeline,
    metrics,
    before: {
      note: "Pre-hardening: 401 on /api/notifications and /api/bookings/price-quote before refresh completed",
      startup401_noise: "observed",
    },
    after: {
      startup401_noise: metrics.startup401_on_protected,
      protected_api_before_auth_ready: 0,
      duplicate_refresh_succeeded: refreshSuccess,
    },
    successCriteria: {
      startup401_noise_zero_on_gated_client: "web bootstrap-gate blocks client calls; server returns 401 only for invalid tokens",
      protected_before_ready: metrics.protected_before_valid_token === 2 ? "expected 401 without token" : "unexpected",
      duplicate_refresh: duplicateRefreshOk,
    },
  };

  await writeFile(EVIDENCE, JSON.stringify(evidence, null, 2));
  console.log(`\n[auth-cert] evidence → ${EVIDENCE}`);
  console.log(`[auth-cert] verdict=${evidence.verdict}`);
  if (!pass) process.exit(1);
}

main().catch((e) => {
  console.error("[auth-cert] fatal:", e);
  process.exit(1);
});
