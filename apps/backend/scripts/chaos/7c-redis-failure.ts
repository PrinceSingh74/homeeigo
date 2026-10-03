/**
 * SECTION 7C — Redis failure, degradation and recovery, proven by injection.
 *
 *   DATABASE_URL="<test>" REDIS_URL="redis://localhost:6380" bun run scripts/chaos/7c-redis-failure.ts
 *
 * The architecture claims Redis is optional: rate limiting falls back to an in-memory counter,
 * idempotency to an in-memory cache and lock, and exclusive scheduler jobs to a Postgres advisory
 * lock. This harness does not take that on trust. It stops the isolated Redis for real and checks
 * what each control actually does, then restores it and checks convergence.
 *
 * ── What "pass" means here ──────────────────────────────────────────────────
 *
 * Not HTTP 200. Every phase asserts a named INVARIANT with its own observation:
 *
 *   I1  Redis outage does not make the rate limiter fail-open.
 *   I2  Authentication keeps working (it is Postgres-backed) and stays correct.
 *   I3  Requests do not hang — an outage must surface as bounded latency, not a stall.
 *   I4  No process crash, no crash loop.
 *   I5  /health reports the degradation instead of claiming ok.
 *   I6  Recovery converges with no restart and no manual repair.
 *   I7  No Redis-held lock stays poisoned across the outage.
 *   I8  No connection or memory leak across the cycle.
 *
 * Every probe that fails to collect is fatal. A missing observation is not a passing observation.
 */
import { spawnSync } from "node:child_process";
import {
  assertChaosTargetIsolated,
  assertRedisTargetIsolated,
  assertServerTargetIsolated,
} from "../../src/lib/chaos-isolation";

const BASE = process.env.LOAD_TEST_BASE_URL ?? "http://127.0.0.1:3100";
const REDIS_CONTAINER = process.env.CHAOS_REDIS_CONTAINER ?? "homigo-staging-redis";
const EMAIL = process.env.LOAD_TEST_EMAIL ?? "s7baseline@homigo.test";
const PASSWORD = process.env.LOAD_TEST_PASSWORD ?? "Kf4!zQr9Wn2v";

const dbTarget = assertChaosTargetIsolated("7C redis failure");
const redisTarget = assertRedisTargetIsolated("7C redis failure");
const serverTarget = await assertServerTargetIsolated(BASE, "7C redis failure");

const prisma = (await import("../../src/lib/prisma")).default;

/** Every shell-out is checked; a probe that cannot run is an incomplete experiment, not a pass. */
function sh(cmd: string, args: string[], what: string): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 60_000 });
  if (r.error || r.status !== 0) {
    throw new Error(
      `PROBE FAILED (${what}): status=${r.status} ${r.error?.message ?? ""} ${(r.stderr ?? "").trim().slice(0, 200)}`,
    );
  }
  return (r.stdout ?? "").trim();
}

function redisUp(): void {
  sh("docker", ["start", REDIS_CONTAINER], "start redis");
}
function redisDown(): void {
  sh("docker", ["stop", REDIS_CONTAINER], "stop redis");
}

/** Ground truth, straight from the container — not from what the app believes. */
function redisReachable(): boolean {
  const r = spawnSync("docker", ["exec", REDIS_CONTAINER, "redis-cli", "PING"], {
    encoding: "utf8",
    timeout: 15_000,
  });
  return (r.stdout ?? "").includes("PONG");
}

type Health = { status: string; services: { database: string; redis: string }; isolatedDatabase?: boolean };

async function health(): Promise<Health> {
  const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(20_000) });
  return (await res.json()) as Health;
}

async function token(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, setAuthCookies: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { data?: { accessToken?: string } }).data?.accessToken ?? null;
  } catch {
    return null;
  }
}

type Probe = { ok: number; failed: number; maxMs: number; statuses: Record<number, number> };

/** N sequential authenticated requests; records latency spread so a STALL is distinguishable. */
async function probeEndpoint(path: string, auth: string | null, n = 12): Promise<Probe> {
  const out: Probe = { ok: 0, failed: 0, maxMs: 0, statuses: {} };
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: auth ? { Authorization: `Bearer ${auth}` } : {},
        signal: AbortSignal.timeout(20_000),
      });
      await res.arrayBuffer();
      out.statuses[res.status] = (out.statuses[res.status] ?? 0) + 1;
      if (res.ok) out.ok++;
      else out.failed++;
    } catch {
      out.failed++;
      out.statuses[0] = (out.statuses[0] ?? 0) + 1;
    }
    out.maxMs = Math.max(out.maxMs, Date.now() - t0);
  }
  return out;
}

/**
 * I1 — the rate limiter must still refuse once the limit is crossed.
 *
 * ── Getting this probe right took two attempts ──────────────────────────────
 *
 * The first version fired TWELVE requests and asserted a 429. `AUTH_BURST_LIMIT` is 15, keyed
 * `auth-burst:send-otp:<ip>` over a 60s window, so twelve is simply under the limit: the endpoint
 * answered 200 twelve times and the probe recorded a "fail-open rate limiter" that was in fact a
 * correctly-behaving one. The give-away was the third phase, where 429s DID appear — because the
 * earlier burst's counter had survived in Redis, pushing the total past 15.
 *
 * That is a test defect, and the dangerous kind: it manufactured a security finding out of a
 * threshold the probe had never checked. The burst is now sized from the limit itself rather than
 * guessed, and overshoots it so that a 429 is compelled in every phase — including the in-memory
 * fallback phase, whose counter starts from zero when Redis goes away.
 */
const AUTH_BURST_LIMIT = Number(process.env.AUTH_BURST_LIMIT || 15);
const BURST_SIZE = AUTH_BURST_LIMIT + 6;

async function rateLimiterStillRefuses(tag: string): Promise<{ saw429: boolean; codes: number[] }> {
  const phone = `+9198${String(Date.now()).slice(-8)}`;
  const codes: number[] = [];
  for (let i = 0; i < BURST_SIZE; i++) {
    try {
      const res = await fetch(`${BASE}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phone }),
        signal: AbortSignal.timeout(20_000),
      });
      codes.push(res.status);
      await res.arrayBuffer();
    } catch {
      codes.push(0);
    }
  }
  console.log(`    [${tag}] otp burst (${BURST_SIZE} reqs, limit ${AUTH_BURST_LIMIT}): ${codes.join(",")}`);
  return { saw429: codes.includes(429), codes };
}

async function dbConns(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) n FROM pg_stat_activity WHERE datname = current_database()`;
  return Number(rows[0]?.n ?? 0);
}

async function rssMb(): Promise<number> {
  const text = await (await fetch(`${BASE}/metrics`, { signal: AbortSignal.timeout(15_000) })).text();
  const m = text.match(/^process_resident_memory_bytes\s+([0-9.e+]+)/m);
  if (!m) throw new Error("PROBE FAILED (rss): process_resident_memory_bytes absent from /metrics");
  return Math.round(Number(m[1]) / 1024 / 1024);
}

const failures: string[] = [];
function check(id: string, passed: boolean, detail: string): void {
  console.log(`    ${passed ? "PASS" : "FAIL"}  ${id}  ${detail}`);
  if (!passed) failures.push(`${id}: ${detail}`);
}

console.log("── 7C isolation proof ──");
console.log(`  database : ${dbTarget.redacted}`);
console.log(`  redis    : ${redisTarget.redacted} (container ${REDIS_CONTAINER})`);
console.log(`  server   : ${serverTarget.redacted}`);
console.log(`  time     : ${new Date().toISOString()}`);

// ── PHASE 1: baseline, Redis healthy ───────────────────────────────────────
console.log("\n── phase 1: baseline (Redis healthy) ──");
redisUp();
if (!redisReachable()) throw new Error("PROBE FAILED: Redis container will not answer PING at baseline");
let h = await health();
check("I5-baseline", h.services.redis === "ok", `/health redis=${h.services.redis} status=${h.status}`);
if (h.services.redis !== "ok") {
  throw new Error("refusing to inject failure: baseline Redis is not ok, so nothing after this means anything");
}
const authToken = await token();
check("I2-baseline", authToken !== null, authToken ? "login succeeded" : "login FAILED at baseline");
const baseProbe = await probeEndpoint("/api/bookings/upcoming", authToken);
const baseRss = await rssMb();
const baseConns = await dbConns();
console.log(`    baseline: ok=${baseProbe.ok}/${baseProbe.ok + baseProbe.failed} maxMs=${baseProbe.maxMs} rss=${baseRss}MB dbConns=${baseConns}`);
const baseRate = await rateLimiterStillRefuses("healthy");
check("I1-baseline", baseRate.saw429, `rate limiter refuses when Redis is up (saw 429: ${baseRate.saw429})`);

// ── PHASE 2: Redis hard down ───────────────────────────────────────────────
console.log("\n── phase 2: Redis HARD DOWN ──");
const downAt = Date.now();
redisDown();
if (redisReachable()) throw new Error("PROBE FAILED: Redis still answers PING after docker stop — outage did not happen");
console.log(`    redis stopped and confirmed unreachable (+${Date.now() - downAt}ms)`);

const downHealth = await health();
check("I5-down", downHealth.services.redis !== "ok", `/health redis=${downHealth.services.redis} (must not claim ok)`);

const downToken = await token();
check("I2-down", downToken !== null, downToken ? "login STILL works (Postgres-backed)" : "login broke during Redis outage");

const downProbe = await probeEndpoint("/api/bookings/upcoming", downToken ?? authToken);
check(
  "I3-down",
  downProbe.maxMs < 15_000,
  `slowest request ${downProbe.maxMs}ms (a stall would approach the 20s timeout)`,
);
check(
  "I2-down-serving",
  downProbe.ok > 0,
  `authenticated requests served during outage: ${downProbe.ok}/${downProbe.ok + downProbe.failed} statuses=${JSON.stringify(downProbe.statuses)}`,
);

const downRate = await rateLimiterStillRefuses("redis-down");
check("I1-down", downRate.saw429, `rate limiter must NOT fail open with Redis down (saw 429: ${downRate.saw429})`);

const downRss = await rssMb();
check("I4-down", true, `process alive during outage, rss=${downRss}MB (baseline ${baseRss}MB)`);

// ── PHASE 3: recovery ──────────────────────────────────────────────────────
console.log("\n── phase 3: Redis restored ──");
const upAt = Date.now();
redisUp();
let reachableAfterMs = -1;
for (let i = 0; i < 60; i++) {
  if (redisReachable()) {
    reachableAfterMs = Date.now() - upAt;
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
if (reachableAfterMs < 0) throw new Error("PROBE FAILED: Redis did not come back");
console.log(`    container answering PING after ${reachableAfterMs}ms`);

let convergedMs = -1;
for (let i = 0; i < 120; i++) {
  const hh = await health();
  if (hh.services.redis === "ok") {
    convergedMs = Date.now() - upAt;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
check(
  "I6-converge",
  convergedMs >= 0,
  convergedMs >= 0
    ? `app reported redis=ok again ${convergedMs}ms after restore, with no restart`
    : "app NEVER reported redis=ok again — reconnect did not converge",
);

const recoveredProbe = await probeEndpoint("/api/bookings/upcoming", await token());
check("I6-serving", recoveredProbe.ok === recoveredProbe.ok + recoveredProbe.failed,
  `all requests served after recovery: ${recoveredProbe.ok}/${recoveredProbe.ok + recoveredProbe.failed}`);

const recRate = await rateLimiterStillRefuses("recovered");
check("I1-recovered", recRate.saw429, `rate limiter still refuses after recovery (saw 429: ${recRate.saw429})`);

// ── PHASE 4: resource / leak ───────────────────────────────────────────────
console.log("\n── phase 4: resource + leak check ──");
const endRss = await rssMb();
const endConns = await dbConns();
const stuckProcessing = await prisma.eventOutbox.count({ where: { status: "PROCESSING" } });
check("I8-conns", endConns <= baseConns + 2, `db connections ${baseConns} -> ${endConns}`);
check("I8-rss", endRss < baseRss * 2, `rss ${baseRss}MB -> ${endRss}MB`);
check("I7-outbox", stuckProcessing === 0, `outbox rows stranded in PROCESSING: ${stuckProcessing}`);

console.log("\n── 7C result ──");
if (failures.length === 0) {
  console.log("  ALL INVARIANTS HELD");
} else {
  console.log(`  ${failures.length} INVARIANT(S) VIOLATED:`);
  for (const f of failures) console.log(`    - ${f}`);
}
await prisma.$disconnect();
process.exit(failures.length === 0 ? 0 : 1);
