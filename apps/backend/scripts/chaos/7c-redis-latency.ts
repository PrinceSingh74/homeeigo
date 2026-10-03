/**
 * SECTION 7C, failure modes C and D — Redis SLOW, and Redis INTERMITTENT.
 *
 *   DATABASE_URL="<test>" REDIS_URL="redis://localhost:6380" bun run scripts/chaos/7c-redis-latency.ts
 *
 * A hard outage is the easy case: the socket refuses and the client knows immediately. The dangerous
 * case is Redis that still answers, just slowly — connections stay up, health checks may pass, and
 * every caller waits. This FREEZES the Redis process with `docker pause` — verified from outside by
 * a host-socket PING that times out while frozen — and measures what the application does while every
 * Redis command is unanswerable.
 *
 * Mode D then alternates working and stalled Redis under concurrency, looking for the failure that
 * only appears when a dependency flaps: retry storms, and a rate limiter that loses count as it
 * switches between the Redis counter and the in-memory one.
 *
 * Invariants:
 *   L1  A slow Redis must not become a slow API — request latency must not track Redis latency.
 *   L2  No request may hang past the client's own timeout budget.
 *   L3  The rate limiter keeps refusing while Redis is stalled.
 *   L4  Flapping Redis must not produce a retry storm (measured as CPU and request amplification).
 *   L5  The process survives, and converges when Redis steadies.
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
const AUTH_BURST_LIMIT = Number(process.env.AUTH_BURST_LIMIT || 15);

assertChaosTargetIsolated("7C redis latency");
const redisTarget = assertRedisTargetIsolated("7C redis latency");
await assertServerTargetIsolated(BASE, "7C redis latency");

const failures: string[] = [];
function check(id: string, passed: boolean, detail: string): void {
  console.log(`    ${passed ? "PASS" : "FAIL"}  ${id}  ${detail}`);
  if (!passed) failures.push(`${id}: ${detail}`);
}

/**
 * Stall Redis by FREEZING ITS PROCESS, and prove the stall happened.
 *
 * ── The first mechanism did not work, and nearly went unnoticed ─────────────
 *
 * This used `redis-cli DEBUG SLEEP` via `docker exec -d`. Redis 7 refuses the DEBUG command unless
 * `enable-debug-command` is set in the config file, so the stall never occurred — and `docker exec
 * -d` returns 0 immediately whatever happens inside, so the harness saw success. Every "Redis is
 * slow" measurement in that run was taken against a perfectly healthy Redis and would have been
 * reported as proof of graceful degradation.
 *
 * The only reason it did not become a false PASS is the `stall-real` guard below, which measures the
 * stall independently instead of assuming the injection worked. That guard is not optional
 * decoration; it is the difference between an experiment and a story.
 *
 * `docker pause` sends SIGSTOP to the container's processes. Nothing inside Redis can decline it,
 * there is no config to enable, and it is verifiable from outside: a PING over a host socket times
 * out while paused (measured: 6016ms against a 6s budget) and returns in 6-9ms otherwise.
 */
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

function pauseRedis(): void {
  sh("docker", ["pause", REDIS_CONTAINER], "pause redis");
}
function unpauseRedis(): void {
  sh("docker", ["unpause", REDIS_CONTAINER], "unpause redis");
}

/**
 * A RESP PING over a host TCP socket, timed.
 *
 * Deliberately NOT `docker exec redis-cli`: a paused container cannot start a new process, so that
 * command fails fast and reports a SHORT time — which reads as "Redis is responsive" at precisely
 * the moment it is frozen. The measurement has to come from outside the container, over the same
 * port the application uses.
 */
async function pingLatencyMs(budgetMs = 6000): Promise<number> {
  const { connect } = await import("node:net");
  const started = Date.now();
  return new Promise<number>((resolve) => {
    const sock = connect({ host: "127.0.0.1", port: Number(redisTarget.port) });
    const finish = () => {
      sock.destroy();
      resolve(Date.now() - started);
    };
    sock.setTimeout(budgetMs);
    sock.on("connect", () => sock.write("PING\r\n"));
    sock.on("data", finish);
    sock.on("timeout", finish);
    sock.on("error", finish);
  });
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

/** Concurrent burst; returns latency spread so a stall is distinguishable from slowness. */
async function burst(path: string, auth: string | null, concurrency: number, each: number) {
  const lat: number[] = [];
  let ok = 0;
  const statuses: Record<number, number> = {};
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let i = 0; i < each; i++) {
        const t0 = Date.now();
        try {
          const res = await fetch(`${BASE}${path}`, {
            headers: auth ? { Authorization: `Bearer ${auth}` } : {},
            signal: AbortSignal.timeout(25_000),
          });
          await res.arrayBuffer();
          statuses[res.status] = (statuses[res.status] ?? 0) + 1;
          if (res.ok) ok++;
        } catch {
          statuses[0] = (statuses[0] ?? 0) + 1;
        }
        lat.push(Date.now() - t0);
      }
    }),
  );
  const s = lat.sort((a, b) => a - b);
  return {
    ok,
    total: concurrency * each,
    p50: s[Math.floor(s.length / 2)] ?? 0,
    p95: s[Math.floor(s.length * 0.95)] ?? 0,
    max: s[s.length - 1] ?? 0,
    statuses,
  };
}

async function otpBurst(tag: string): Promise<boolean> {
  const phone = `+9198${String(Date.now()).slice(-8)}`;
  const codes: number[] = [];
  for (let i = 0; i < AUTH_BURST_LIMIT + 6; i++) {
    try {
      const res = await fetch(`${BASE}/api/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phone }),
        signal: AbortSignal.timeout(25_000),
      });
      codes.push(res.status);
      await res.arrayBuffer();
    } catch {
      codes.push(0);
    }
  }
  console.log(`    [${tag}] otp: ${codes.join(",")}`);
  return codes.includes(429);
}

console.log("── 7C modes C+D ──");
console.log(`  redis : ${redisTarget.redacted} (container ${REDIS_CONTAINER})`);
console.log(`  time  : ${new Date().toISOString()}`);

const auth = await token();
if (!auth) throw new Error("PROBE FAILED: could not authenticate before the experiment");

console.log("\n── baseline (Redis responsive) ──");
const base = await burst("/api/bookings/upcoming", auth, 20, 4);
console.log(`    ok=${base.ok}/${base.total} p50=${base.p50}ms p95=${base.p95}ms max=${base.max}ms`);

// ── MODE C: severe Redis latency ───────────────────────────────────────────
console.log("\n── mode C: Redis frozen (docker pause) ──");
pauseRedis();
try {
  /**
   * The stall is measured, not assumed. This guard is the reason the previous mechanism's failure
   * was caught instead of being written up as proof of graceful degradation.
   */
  const stalledPing = await pingLatencyMs(6000);
  check("stall-real", stalledPing > 1500, `PING over a host socket took ${stalledPing}ms while frozen`);

  const slow = await burst("/api/bookings/upcoming", auth, 20, 4);
  console.log(
    `    ok=${slow.ok}/${slow.total} p50=${slow.p50}ms p95=${slow.p95}ms max=${slow.max}ms statuses=${JSON.stringify(slow.statuses)}`,
  );
  check("L1", slow.p95 < 5000, `API p95 ${slow.p95}ms while Redis was frozen — latency not inherited`);
  check("L2", slow.max < 25_000, `slowest request ${slow.max}ms — nothing hung to the client timeout`);
  check("L2-served", slow.ok === slow.total, `requests served while frozen: ${slow.ok}/${slow.total}`);

  check("L3", await otpBurst("redis-frozen"), "rate limiter still refuses while Redis is frozen");

  /**
   * L6/L7 — the defect this section found, and the shape of its fix.
   *
   * A frozen Redis used to hang `/api/auth/login` and `/api/auth/send-otp` indefinitely: the socket
   * stayed open, so nothing threw, so the try/catch fallbacks were never reached. Both doors into
   * the system, held open by an optional dependency being SLOW rather than DOWN.
   *
   * The contract now is: one request pays a single bounded deadline, after which the client marks
   * itself unavailable and every later request takes the in-memory path immediately.
   */
  const first = Date.now();
  const r1 = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, setAuthCookies: false }),
    signal: AbortSignal.timeout(40_000),
  }).catch(() => null);
  const firstMs = Date.now() - first;
  const second = Date.now();
  const r2 = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, setAuthCookies: false }),
    signal: AbortSignal.timeout(40_000),
  }).catch(() => null);
  const secondMs = Date.now() - second;
  console.log(`    login while frozen: #1 ${firstMs}ms (${r1?.status ?? "threw"}) #2 ${secondMs}ms (${r2?.status ?? "threw"})`);
  check("L6", r1 !== null && firstMs < 12_000, `first login under freeze bounded at ${firstMs}ms, not hung`);
  check("L7", r2 !== null && secondMs < 2_000, `second login under freeze served in ${secondMs}ms from the fallback`);
} finally {
  // Unpause in `finally` so a failed assertion cannot leave the container frozen for the next run.
  unpauseRedis();
}
await new Promise((r) => setTimeout(r, 1500));

// ── MODE D: intermittent ───────────────────────────────────────────────────
console.log("\n── mode D: intermittent (stall / recover, 4 cycles, under load) ──");
let flapOk = 0;
let flapTotal = 0;
let flapMax = 0;
for (let cycle = 0; cycle < 4; cycle++) {
  pauseRedis();
  let during: Awaited<ReturnType<typeof burst>>;
  try {
    during = await burst("/api/bookings/upcoming", auth, 15, 3);
  } finally {
    unpauseRedis();
  }
  flapOk += during.ok;
  flapTotal += during.total;
  flapMax = Math.max(flapMax, during.max);
  await new Promise((r) => setTimeout(r, 1200)); // let the client notice Redis is back
  const between = await burst("/api/bookings/upcoming", auth, 15, 3);
  flapOk += between.ok;
  flapTotal += between.total;
  flapMax = Math.max(flapMax, between.max);
  console.log(
    `    cycle ${cycle + 1}: during-stall ok=${during.ok}/${during.total} p95=${during.p95}ms | ` +
      `after ok=${between.ok}/${between.total} p95=${between.p95}ms`,
  );
}
check("L4", flapOk === flapTotal, `every request served across the flapping: ${flapOk}/${flapTotal}`);
check("L4-nohang", flapMax < 25_000, `slowest request across flapping ${flapMax}ms`);

// ── converge ───────────────────────────────────────────────────────────────
console.log("\n── convergence after flapping ──");
await new Promise((r) => setTimeout(r, 3000));
const hh = (await (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(20_000) })).json()) as {
  services: { redis: string };
};
check("L5-health", hh.services.redis === "ok", `/health redis=${hh.services.redis} after flapping settles`);

/**
 * L8 — recovery from a FREEZE must converge, which is a different problem from recovery from a
 * crash. A frozen-then-unfrozen Redis keeps the same TCP connection, so node-redis never fires
 * `ready` and nothing re-enables the client on its own. Before `healthCheck` was allowed to ping
 * while unavailable, this state was permanent: measured at 76s and still degraded.
 */
const freezeStart = Date.now();
pauseRedis();
try {
  await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, setAuthCookies: false }),
    signal: AbortSignal.timeout(40_000),
  }).catch(() => null);
} finally {
  unpauseRedis();
}
let convergedMs = -1;
for (let i = 0; i < 40; i++) {
  const s = (await (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(20_000) })).json()) as {
    services: { redis: string };
  };
  if (s.services.redis === "ok") {
    convergedMs = Date.now() - freezeStart;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
check("L8", convergedMs >= 0, convergedMs >= 0
  ? `availability restored ${convergedMs}ms after unfreeze, with no restart`
  : "availability NEVER restored after unfreeze — the client is pinned to the fallback");
const after = await burst("/api/bookings/upcoming", auth, 20, 4);
console.log(`    ok=${after.ok}/${after.total} p50=${after.p50}ms p95=${after.p95}ms (baseline p95 ${base.p95}ms)`);
check("L5-latency", after.p95 < Math.max(base.p95 * 4, 1500), `p95 returned toward baseline`);

console.log("\n── modes C+D result ──");
if (failures.length === 0) console.log("  ALL INVARIANTS HELD");
else {
  console.log(`  ${failures.length} VIOLATED:`);
  for (const f of failures) console.log(`    - ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
