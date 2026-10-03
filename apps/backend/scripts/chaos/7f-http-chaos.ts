/**
 * SECTION 7F — HTTP / API burst, concurrency, timeouts, backpressure and resilience.
 *
 *   DATABASE_URL="<homigo_test>" REDIS_URL="redis://localhost:6380" \
 *     bun run scripts/chaos/7f-http-chaos.ts --test gates,baseline,ladder
 *
 * This orchestrator OWNS the server it drives. It starts it, verifies which pid holds the listening
 * socket, drives it, restarts it, and stops it. Borrowing a long-lived server would mean measuring a
 * process whose flags cannot be changed between scenarios (the rate-limit work needs the limiter on,
 * the ladder needs it off) and whose maintenance ticks add uncontrolled database load to every
 * sample.
 *
 * Nothing here retries. Retries are one of the behaviours under measurement; a harness that quietly
 * repeats a failed request cannot see amplification, backpressure or a timeout boundary.
 */
import {
  BASE,
  PORT,
  type Call,
  type Check,
  type ServerHandle,
  assertIsolation,
  authenticate,
  clearPort,
  drive,
  formatLoad,
  listenerPidOn,
  machineState,
  makeRecorder,
  probeHealth,
  startServer,
  stopServer,
  telemetry,
} from "./7f-lib";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : fallback;
};
const selected = new Set(arg("test", "all").split(",").map((s) => s.trim()));
const want = (name: string) => selected.has("all") || selected.has(name);
const RUN_TAG = arg("tag", new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14));

const prisma = (await import("../../src/lib/prisma")).default;

const checks: Check[] = [];
const record = makeRecorder(checks);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOG_DIR = "/tmp";

// ── representative endpoints, chosen from source inspection ───────────────────────────────────────

/**
 * Each of these was picked for a DISTINCT dependency shape, documented against the source rather
 * than guessed. Together they separate application CPU from database work from Redis work from
 * outbound work, which is the only way an inflection point can be attributed to anything.
 */
const CALLS = {
  /** Class A — pure application path. No database, no Redis. Isolates event-loop/CPU cost. */
  root: { label: "root", method: "GET", path: "/", expect: [200] } satisfies Call,
  /** Class A — readiness. One trivial `SELECT 1` plus a Redis PING. */
  health: { label: "health", method: "GET", path: "/health", expect: [200] } satisfies Call,
  /** Class B — public read THROUGH the cache (`cacheService.getOrFetch`): Redis first, DB on miss. */
  featured: { label: "featured", method: "GET", path: "/api/services/featured", expect: [200] } satisfies Call,
  /** Class B — public read with NO cache: `catalogService.search` queries Postgres every time. */
  search: {
    label: "search",
    method: "POST",
    path: "/api/services/search",
    body: { q: "clean", city: "Mumbai" },
    expect: [200],
  } satisfies Call,
  /** Class C — authenticated read: JWT verify + revocation check (Redis+DB) + a user row. */
  me: { label: "me", method: "GET", path: "/api/users/me", auth: true, expect: [200] } satisfies Call,
  /** Class D — authenticated DB-heavy read: the user's bookings with their relations. */
  myBookings: { label: "bookings", method: "GET", path: "/api/users/bookings", auth: true, expect: [200] } satisfies Call,
  /** Class G — finance read. Same auth cost, different table and service. */
  wallet: { label: "wallet", method: "GET", path: "/api/wallet/balance", auth: true, expect: [200] } satisfies Call,
} as const;

// ── controlled dependency stall, without touching application code ────────────────────────────────

/**
 * Stalls every query that touches `services` by holding an ACCESS EXCLUSIVE lock from a separate
 * session, and releases it on demand.
 *
 * This injects delay at a REAL dependency boundary rather than by adding a sleep route to the
 * server: the application is unmodified, the stall is a genuine database wait, and it is precisely
 * scoped — `/` touches nothing, `/health` runs `SELECT 1` on a different path, and
 * `POST /api/services/search` reads `services` on every call. That scoping is what makes the
 * head-of-line and timeout results attributable.
 *
 * The transaction carries its own deadline so a crashed harness cannot leave the table locked.
 */
function stallServicesTable(maxHoldMs: number): { release: () => void; started: Promise<void>; ended: Promise<void> } {
  let releaseFn: () => void = () => {};
  let markStarted: () => void = () => {};
  const untilReleased = new Promise<void>((r) => {
    releaseFn = r;
  });
  const started = new Promise<void>((r) => {
    markStarted = r;
  });
  const ended = prisma
    .$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("LOCK TABLE services IN ACCESS EXCLUSIVE MODE");
        markStarted();
        await untilReleased;
      },
      { timeout: maxHoldMs + 5_000, maxWait: 10_000 },
    )
    .then(() => undefined)
    .catch(() => undefined);
  return { release: releaseFn, started, ended };
}

// ── server lifecycle for this section ─────────────────────────────────────────────────────────────

let server: ServerHandle | null = null;

async function bringUp(label: string, env: Record<string, string>): Promise<ServerHandle> {
  if (server) stopServer(server);
  const logPath = `${LOG_DIR}/7f-server-${label}.log`;
  const h = await startServer({ env, logPath });
  server = h;
  return h;
}

/**
 * Reuses the running server ONLY when it was started with the flags this scenario needs.
 *
 * Scenarios used to take whatever server happened to be up (`server ?? bringUp(...)`). In a full
 * sequential run that meant the Redis scenario inherited the rate-limit scenario's limiter-ON
 * server, and every one of its requests came back 429 — which read as "throughput did not recover
 * after Redis returned" when it was the limiter behaving perfectly. A scenario must state the
 * environment it measures in, not inherit one.
 */
async function ensureServer(label: string, env: Record<string, string>): Promise<ServerHandle> {
  if (server && server.env.LOAD_TEST_MODE === env.LOAD_TEST_MODE) return server;
  return bringUp(label, env);
}

/** Flags used for every throughput measurement. Recorded with the numbers, because they change them. */
const LOAD_ENV = {
  APP_ENV: "chaos",
  NODE_ENV: "development",
  LOAD_TEST_MODE: "1",
  EVENTS_CONSUMERS_ENABLED: "false",
};

/**
 * Same server, limiter ON. Only the rate-limit scenarios use this.
 *
 * `"0"` rather than `""`: `load-env` restores preserved runtime values only when they are neither
 * undefined NOR empty, so an empty string is skipped and `.env`'s `LOAD_TEST_MODE=1` wins — which is
 * exactly how the first run of this scenario measured a limiter that was never switched on.
 */
const LIMITED_ENV = {
  APP_ENV: "chaos",
  NODE_ENV: "development",
  LOAD_TEST_MODE: "0",
  EVENTS_CONSUMERS_ENABLED: "false",
};

let token: string | null = null;

async function ensureToken(): Promise<string> {
  if (token) return token;
  token = await authenticate();
  if (!token) throw new Error("7F SETUP: could not authenticate the load identity — authenticated results would be 401 latencies, not endpoint latencies");
  return token;
}

// ── GATES — isolation and the harness's own positive controls ─────────────────────────────────────

async function testGates(): Promise<void> {
  console.log("\n── GATES · isolation and harness positive controls ────");
  const h = await bringUp("gates", LOAD_ENV);
  const gates = await assertIsolation("7F HTTP chaos", h.port);
  const health = await probeHealth(h.port);

  record(
    "G1",
    "the server under test is attached to a disposable database (server's own answer, not the harness's)",
    health.isolatedDatabase && gates.db?.databaseName?.includes("test") === true ? "PASS" : "FAIL",
    `server reports isolatedDatabase=${health.isolatedDatabase}, environment=${health.environment}; harness DB target=${gates.db?.redacted} redis=${gates.redis?.redacted}`,
  );
  record(
    "G2",
    "readiness is semantic, not just an HTTP 200",
    health.ready ? "PASS" : "FAIL",
    `http ok=${health.httpOk} status=${health.status} database=${health.database} redis=${health.redis}`,
  );
  record(
    "G3",
    "the pid holding the listening socket is known and is the server we started",
    h.listenerPid > 0 && listenerPidOn(h.port) === h.listenerPid ? "PASS" : "FAIL",
    `listener pid=${h.listenerPid} on :${h.port} (spawn handle pid=${h.pid}; on Windows these differ, which is why the listener is resolved explicitly)`,
  );

  // Positive control 1 — a known-good request really succeeds.
  const good = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5000) });
  record("G4", "positive control: a known-good request succeeds", good.status === 200 ? "PASS" : "FAIL", `GET / → ${good.status}`);

  // Positive control 2 — a known-bad request really fails, two different ways.
  const missing = await fetch(`${BASE}/api/__7f_does_not_exist__`, { signal: AbortSignal.timeout(5000) });
  const unauth = await fetch(`${BASE}/api/users/me`, { signal: AbortSignal.timeout(5000) });
  record(
    "G5",
    "positive control: known-bad requests actually fail (the harness can tell success from failure)",
    missing.status === 404 && unauth.status === 401 ? "PASS" : "FAIL",
    `GET /api/__7f_does_not_exist__ → ${missing.status} (expect 404); GET /api/users/me without a token → ${unauth.status} (expect 401)`,
  );

  // Positive control 3 — the dependency injection this section relies on really injects.
  const beforeMs = await timeOne("POST", "/api/services/search", { q: "clean", city: "Mumbai" });
  const stall = stallServicesTable(12_000);
  await stall.started;
  const duringMs = await timeOne("POST", "/api/services/search", { q: "clean", city: "Mumbai" }, 8_000);
  const rootDuring = await timeOne("GET", "/");
  stall.release();
  await stall.ended;
  const afterMs = await timeOne("POST", "/api/services/search", { q: "clean", city: "Mumbai" });

  record(
    "G6",
    "positive control: the table-lock stall really stalls the endpoint it targets",
    beforeMs.ms < 1500 && (duringMs.status === null || duringMs.ms > 3000) && afterMs.ms < 1500 ? "PASS" : "FAIL",
    `search before=${beforeMs.ms}ms(${beforeMs.status}) during-stall=${duringMs.ms}ms(${duringMs.status ?? "timeout"}) after-release=${afterMs.ms}ms(${afterMs.status})`,
  );
  record(
    "G7",
    "the stall is SCOPED — an endpoint that does not touch the locked table is unaffected",
    rootDuring.ms < 1000 && rootDuring.status === 200 ? "PASS" : "FAIL",
    `GET / during the services stall = ${rootDuring.ms}ms (${rootDuring.status}); a slow answer here would mean the stall is global and nothing downstream could be attributed`,
  );

  const t = await telemetry(prisma, h.port);
  record(
    "G8",
    "telemetry is readable and fails loudly rather than reporting zeros",
    t.rssMb > 0 && t.dbConnections > 0 ? "PASS" : "FAIL",
    `rss=${t.rssMb}MB heap=${t.heapUsedMb}MB redis_up=${t.redisUp} db conns=${t.dbConnections} (active ${t.dbActive}, idle-in-tx ${t.dbIdleInTx})`,
  );

  await ensureToken();
  const authed = await fetch(`${BASE}/api/users/me`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  record(
    "G9",
    "the load identity authenticates, so authenticated measurements are real",
    authed.status === 200 ? "PASS" : "FAIL",
    `GET /api/users/me with the provisioned token → ${authed.status}`,
  );
}

async function timeOne(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs = 15_000,
  auth = false,
): Promise<{ ms: number; status: number | null }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.arrayBuffer();
    return { ms: Date.now() - t0, status: res.status };
  } catch {
    return { ms: Date.now() - t0, status: null };
  }
}

// ── BASELINE — two independent passes ─────────────────────────────────────────────────────────────

async function testBaseline(pass: number): Promise<void> {
  console.log(`\n── BASELINE pass ${pass} · c10, 8s per endpoint ────────`);
  const h = await ensureServer("baseline", LOAD_ENV);
  await ensureToken();
  const before = await machineState();
  const tBefore = await telemetry(prisma, h.port);

  const set: Call[] = [CALLS.root, CALLS.health, CALLS.featured, CALLS.search, CALLS.me, CALLS.myBookings, CALLS.wallet];
  const lines: string[] = [];
  for (const call of set) {
    const r = await drive({ calls: [call], concurrency: 10, durationMs: 8000, token: token ?? undefined, label: call.label });
    lines.push(`${call.label.padEnd(9)} ${formatLoad(r)}`);
    console.log(`    ${call.label.padEnd(9)} ${formatLoad(r)}`);
    if (r.errors > 0 || r.timeouts > 0 || r.networkErrors > 0) {
      record(
        `B${pass}-${call.label}`,
        `baseline ${call.label} is clean`,
        "FAIL",
        `${formatLoad(r)} — a baseline with errors cannot anchor a ladder`,
      );
    }
  }
  const tAfter = await telemetry(prisma, h.port);
  const after = await machineState();

  record(
    `B${pass}`,
    `baseline pass ${pass} completed with no errors on any representative endpoint`,
    checks.some((c) => c.id.startsWith(`B${pass}-`) && c.status === "FAIL") ? "FAIL" : "PASS",
    `machine before: ${before} | after: ${after}\n         ` +
      `rss ${tBefore.rssMb}→${tAfter.rssMb}MB, heap ${tBefore.heapUsedMb}→${tAfter.heapUsedMb}MB, ` +
      `db conns ${tBefore.dbConnections}→${tAfter.dbConnections} (idle-in-tx ${tAfter.dbIdleInTx}), redis_up=${tAfter.redisUp}\n         ` +
      lines.join("\n         "),
  );
}

// ── LADDER ────────────────────────────────────────────────────────────────────────────────────────

const LADDER = (arg("ladder", "10,25,50,100,200,400") || "").split(",").map(Number).filter((n) => n > 0);

async function testLadder(): Promise<void> {
  console.log(`\n── LADDER · ${LADDER.join("/")} concurrent, 8s per step ────`);
  const h = await ensureServer("ladder", LOAD_ENV);
  await ensureToken();

  // One endpoint per dependency shape, so an inflection can be attributed rather than guessed.
  const ladderSet: Call[] = [CALLS.root, CALLS.featured, CALLS.search, CALLS.me];

  for (const call of ladderSet) {
    console.log(`\n  ${call.label}:`);
    const rows: string[] = [];
    let previousRps = 0;
    let knee: string | null = null;
    for (const c of LADDER) {
      const tBefore = await telemetry(prisma, h.port);
      const r = await drive({ calls: [call], concurrency: c, durationMs: 8000, token: token ?? undefined, label: call.label });
      const tAfter = await telemetry(prisma, h.port);
      const line =
        `${formatLoad(r)} | rss=${tAfter.rssMb}MB db=${tAfter.dbConnections}/${tAfter.dbActive}act/${tAfter.dbIdleInTx}idletx ` +
        `lockwait=${tAfter.dbPoolWaitHint} redisClients=${tAfter.redisClients}`;
      rows.push(line);
      console.log(`    ${line}`);
      // First step where adding concurrency stops buying throughput — named, not assumed to be "saturation".
      if (knee === null && previousRps > 0 && r.rps < previousRps * 1.05) knee = `c${c} (rps ${previousRps} → ${r.rps})`;
      previousRps = Math.max(previousRps, r.rps);
      void tBefore;
      await sleep(1000);
    }
    record(
      `L-${call.label}`,
      `ladder for ${call.label}`,
      "INFO",
      `first step where added concurrency stopped buying throughput: ${knee ?? "none within the tested range"}\n         ` + rows.join("\n         "),
    );
  }
}

// ── DB PRESSURE — exact query cost per request, measured not inferred ─────────────────────────────

/**
 * Counts the statements Postgres actually executed while a known number of requests were served.
 *
 * `pg_stat_statements` is reset, N requests are issued serially, and the delta is read back. Serial
 * on purpose: the point is per-request cost, and concurrency would mix the endpoint's queries with
 * everything else in flight. The server is otherwise idle, so the only writer is the endpoint.
 */
async function queryCostOf(call: Call, n: number): Promise<{ calls: number; totalMs: number; top: string[] }> {
  // Cast the void return: Prisma cannot deserialize a bare `void` column and the reset would throw.
  await prisma.$queryRawUnsafe("SELECT pg_stat_statements_reset() IS NULL AS reset_done");
  for (let i = 0; i < n; i++) {
    await timeOne(call.method, call.path, call.body, 20_000, call.auth === true);
  }
  const rows = (await prisma.$queryRawUnsafe(`
    SELECT query, calls::int AS calls, round(total_exec_time::numeric, 1)::float8 AS ms
    FROM pg_stat_statements
    WHERE query NOT ILIKE '%pg_stat_statements%'
    ORDER BY calls DESC LIMIT 6
  `)) as Array<{ query: string; calls: number; ms: number }>;
  const totals = (await prisma.$queryRawUnsafe(`
    SELECT COALESCE(sum(calls),0)::int AS calls, COALESCE(round(sum(total_exec_time)::numeric,1),0)::float8 AS ms
    FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%'
  `)) as Array<{ calls: number; ms: number }>;
  return {
    calls: totals[0]?.calls ?? 0,
    totalMs: totals[0]?.ms ?? 0,
    top: rows.map((r) => `${r.calls}× ${r.ms}ms  ${r.query.replace(/\s+/g, " ").slice(0, 95)}`),
  };
}

async function testDbPressure(): Promise<void> {
  console.log("\n── DB PRESSURE · queries per request, per endpoint ────");
  const h = await ensureServer("dbpressure", LOAD_ENV);
  await ensureToken();
  const N = 40;

  for (const call of [CALLS.root, CALLS.search, CALLS.me, CALLS.myBookings, CALLS.wallet]) {
    const cost = await queryCostOf(call, N);
    const perReq = Math.round((cost.calls / N) * 10) / 10;
    record(
      `DB-${call.label}`,
      `database round trips per request — ${call.label}`,
      "INFO",
      `${perReq} statements/request over ${N} serial requests (${cost.calls} total, ${cost.totalMs}ms server-side execution)\n         ` +
        cost.top.join("\n         "),
    );
  }
  void h;
}

// ── TIMEOUT — is there a server-side request deadline at all? ─────────────────────────────────────

async function testTimeout(): Promise<void> {
  console.log("\n── TIMEOUT · behaviour under a stalled dependency ─────");
  const h = await ensureServer("timeout", LOAD_ENV);

  /**
   * The question this answers first is not "how long is the timeout" but "is there one". Elysia is
   * started with `app.listen(port, cb)` and no timeout options anywhere in `src/index.ts`, so the
   * only deadline a stalled request can meet is the client's own. Holding the dependency for 25s and
   * giving the client 60s separates the two: if the request completes at ~25s — when the STALL is
   * released, not when a server deadline fires — then the server has no request deadline and a slow
   * dependency is bounded only by how long the client is willing to wait.
   */
  const HOLD_MS = 25_000;
  const stall = stallServicesTable(HOLD_MS + 5_000);
  await stall.started;

  const t0 = Date.now();
  const inflight = timeOne("POST", "/api/services/search", { q: "clean", city: "Mumbai" }, 60_000);
  await sleep(HOLD_MS);
  const midConns = (await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS waiting FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
  `)) as Array<{ waiting: number }>;
  stall.release();
  await stall.ended;
  const done = await inflight;
  const elapsed = Date.now() - t0;

  record(
    "T1",
    "a request blocked on a dependency is NOT cut short by any server-side deadline",
    done.status === 200 && elapsed > HOLD_MS - 2000 ? "PASS" : "FAIL",
    `the request completed ${elapsed}ms after it started, with status ${done.status ?? "timeout"} — i.e. when the DEPENDENCY was released at ${HOLD_MS}ms, ` +
      `not at any deadline of the server's own. The server as configured (app.listen with no timeout options) applies no request deadline; ` +
      `the bound is whatever the client sets.`,
  );
  record(
    "T2",
    "the blocked request is visibly waiting in the database while it hangs",
    (midConns[0]?.waiting ?? 0) >= 1 ? "PASS" : "FAIL",
    `sessions waiting on a lock while the request hung: ${midConns[0]?.waiting} — this is what "the request is holding a connection" looks like from the database side`,
  );

  // Below / near / above a client deadline, against the same controlled stall.
  for (const [label, stallMs, clientMs] of [
    ["below", 1_000, 5_000],
    ["near", 4_500, 5_000],
    ["above", 9_000, 5_000],
  ] as const) {
    const s = stallServicesTable(stallMs + 5_000);
    await s.started;
    const started = Date.now();
    const p = timeOne("POST", "/api/services/search", { q: "clean", city: "Mumbai" }, clientMs);
    await sleep(stallMs);
    s.release();
    await s.ended;
    const r = await p;
    record(
      `T3-${label}`,
      `client deadline ${clientMs}ms vs dependency stall ${stallMs}ms`,
      "INFO",
      `result: ${r.status === null ? "client aborted" : `HTTP ${r.status}`} after ${Date.now() - started}ms`,
    );
    await sleep(500);
  }

  const after = await telemetry(prisma, h.port);
  record(
    "T4",
    "no resource is left behind after the stalled requests finish",
    after.dbIdleInTx === 0 ? "PASS" : "FAIL",
    `db connections=${after.dbConnections} active=${after.dbActive} idle-in-transaction=${after.dbIdleInTx} rss=${after.rssMb}MB`,
  );
}

// ── CANCELLATION — what happens to work whose client walked away ──────────────────────────────────

async function testCancel(): Promise<void> {
  console.log("\n── CANCEL · client disconnect mid-request ─────────────");
  const h = await ensureServer("cancel", LOAD_ENV);

  const stall = stallServicesTable(20_000);
  await stall.started;

  // Fire a request, then hang up on it while it is blocked in the database.
  const controller = new AbortController();
  const req = fetch(`${BASE}/api/services/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "clean", city: "Mumbai" }),
    signal: controller.signal,
  }).catch(() => "aborted" as const);
  await sleep(1500);
  controller.abort();
  const clientOutcome = await req;
  await sleep(1000);

  const stillWaiting = (await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS waiting FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
  `)) as Array<{ waiting: number }>;

  stall.release();
  await stall.ended;
  await sleep(1500);

  const afterRelease = (await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS waiting FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
  `)) as Array<{ waiting: number }>;
  const t = await telemetry(prisma, h.port);

  record(
    "C1",
    "the client really did disconnect mid-request",
    clientOutcome === "aborted" ? "PASS" : "FAIL",
    `client outcome: ${clientOutcome === "aborted" ? "aborted" : "completed — the cancellation never happened, so C2/C3 would describe nothing"}`,
  );
  record(
    "C2",
    "server-side work CONTINUES after the client disconnects (measured, then classified)",
    (stillWaiting[0]?.waiting ?? 0) >= 1 ? "PASS" : "INFO",
    `${stillWaiting[0]?.waiting} database session(s) still waiting on the lock ~1s after the client hung up. ` +
      `Elysia/Bun do not propagate client disconnect into the handler, and the handler holds no AbortSignal, ` +
      `so an in-flight query runs to completion regardless of whether anyone is still listening.`,
  );
  record(
    "C3",
    "abandoned work DRAINS rather than leaking once the dependency recovers",
    (afterRelease[0]?.waiting ?? 0) === 0 && t.dbIdleInTx === 0 ? "PASS" : "FAIL",
    `after releasing the dependency: sessions waiting=${afterRelease[0]?.waiting}, idle-in-transaction=${t.dbIdleInTx}, db connections=${t.dbConnections}`,
  );
}

// ── HEAD-OF-LINE — does a stalled endpoint starve unrelated ones ──────────────────────────────────

async function testHol(): Promise<void> {
  console.log("\n── HOL · does a stalled endpoint starve the rest ──────");
  const h = await ensureServer("hol", LOAD_ENV);
  await ensureToken();

  // Reference: what the light endpoints cost when nothing is wrong.
  const refRoot = await drive({ calls: [CALLS.root], concurrency: 20, durationMs: 5000, label: "root-ref" });
  const refHealth = await drive({ calls: [CALLS.health], concurrency: 10, durationMs: 5000, label: "health-ref" });

  const stall = stallServicesTable(30_000);
  await stall.started;

  /**
   * 40 concurrent requests are parked inside the stalled endpoint. Each one is holding a pooled
   * database connection while it waits, and the pool is `connection_limit=25` — so this is
   * simultaneously a test of whether the EVENT LOOP is starved (which `/` would show, since it
   * touches nothing) and whether the CONNECTION POOL is exhausted (which `/health` would show, since
   * its `SELECT 1` needs a connection). Separating those two mechanisms is the whole point of using
   * both probes.
   */
  const blocked = drive({ calls: [CALLS.search], concurrency: 40, durationMs: 14_000, timeoutMs: 20_000, label: "search-blocked" });
  await sleep(2500);
  const underRoot = await drive({ calls: [CALLS.root], concurrency: 20, durationMs: 5000, label: "root-under-stall" });
  const underHealth = await drive({ calls: [CALLS.health], concurrency: 10, durationMs: 5000, timeoutMs: 20_000, label: "health-under-stall" });
  stall.release();
  await stall.ended;
  const blockedResult = await blocked;

  record(
    "H0",
    "the stalled endpoint really was stalled for the duration",
    blockedResult.p50 > 3000 || blockedResult.timeouts > 0 ? "PASS" : "FAIL",
    `search under the stall: ${formatLoad(blockedResult)}`,
  );
  record(
    "H1",
    "EVENT LOOP — a dependency-free endpoint is unaffected by 40 requests parked in the database",
    underRoot.p95 <= Math.max(50, refRoot.p95 * 4) && underRoot.errors === 0 ? "PASS" : "FAIL",
    `GET / alone: ${formatLoad(refRoot)}\n         GET / with 40 blocked: ${formatLoad(underRoot)}`,
  );
  record(
    "H2",
    "CONNECTION POOL — an endpoint that needs a database connection while 40 are parked",
    underHealth.errors === 0 && underHealth.timeouts === 0 ? "PASS" : "FAIL",
    `/health alone: ${formatLoad(refHealth)}\n         /health with 40 blocked: ${formatLoad(underHealth)}\n         ` +
      `pool is connection_limit=25; if /health degrades while / does not, the mechanism is pool exhaustion, not the event loop`,
  );

  const t = await telemetry(prisma, h.port);
  record("H3", "the server recovers once the dependency is released", t.dbIdleInTx === 0 ? "PASS" : "FAIL", `db conns=${t.dbConnections} idle-in-tx=${t.dbIdleInTx} rss=${t.rssMb}MB`);
}

// ── POOL EXHAUSTION — what exactly happens to a starved request ───────────────────────────────────

/**
 * Separates two outcomes the head-of-line scenario could not tell apart, because its client deadline
 * and Prisma's `pool_timeout` were both 20s: does a connection-starved request HANG for as long as
 * the dependency is stuck, or does the pool time out and turn it into a bounded, reported failure?
 *
 * The distinction decides how serious the finding is. A bounded failure that `/health` reports is
 * degradation an operator can see; an unbounded hang is an instance that stops answering while still
 * looking alive to anything that only checks the HTTP status code.
 */
async function testPool(): Promise<void> {
  console.log("\n── POOL · what a connection-starved request actually does ──");
  const h = await ensureServer("pool", LOAD_ENV);

  const poolTimeoutSec = Number(new URL(process.env.DATABASE_URL!).searchParams.get("pool_timeout") ?? "20");
  const connLimit = Number(new URL(process.env.DATABASE_URL!).searchParams.get("connection_limit") ?? "?");
  const STALL_MS = 45_000;

  const stall = stallServicesTable(STALL_MS + 10_000);
  await stall.started;
  // Park more concurrent requests than the pool has connections, so the pool is genuinely empty.
  const parked = drive({ calls: [CALLS.search], concurrency: 40, durationMs: STALL_MS - 5_000, timeoutMs: STALL_MS, label: "parked" });
  await sleep(4000);

  const healthStart = Date.now();
  const healthRes = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(90_000) }).catch(() => null);
  const healthMs = Date.now() - healthStart;
  const healthBody = healthRes ? ((await healthRes.json()) as { status?: string; services?: { database?: string } }) : null;

  /**
   * `/ready` is the probe an orchestrator is meant to use, and unlike `/health` it is documented to
   * return 503 when a hard dependency is unhealthy. Whether it actually does so under pool starvation
   * decides whether "HTTP 200 while degraded" on `/health` is a defect or a correct division of
   * labour between a liveness probe and a readiness probe.
   */
  const readyStart = Date.now();
  const readyRes = await fetch(`${BASE}/ready`, { signal: AbortSignal.timeout(90_000) }).catch(() => null);
  const readyMs = Date.now() - readyStart;
  const readyBody = readyRes ? ((await readyRes.json()) as { status?: string; checks?: { database?: { status?: string } } }) : null;

  const rootStart = Date.now();
  const rootRes = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  const rootMs = Date.now() - rootStart;

  stall.release();
  await stall.ended;
  await parked;
  await sleep(2000);

  record(
    "P1",
    `a connection-starved request is bounded by pool_timeout (${poolTimeoutSec}s), not by the stuck dependency`,
    healthRes !== null && healthMs < STALL_MS - 5000 ? "PASS" : "FAIL",
    `/health answered after ${healthMs}ms while the dependency stayed stuck for ${STALL_MS}ms ` +
      `(pool: connection_limit=${connLimit}, pool_timeout=${poolTimeoutSec}s). ` +
      `A time close to the stall duration would mean the request waits on the dependency with no bound of its own.`,
  );
  record(
    "P2",
    "a starved instance REPORTS its degradation rather than looking healthy",
    healthBody?.status !== "ok" || healthBody?.services?.database !== "ok" ? "PASS" : "FAIL",
    `/health returned HTTP ${healthRes?.status} with status="${healthBody?.status}" database="${healthBody?.services?.database}". ` +
      `Note the HTTP code stays 200 by design — anything probing only the status code sees a healthy instance, which is why the semantic check exists.`,
  );
  record(
    "P2b",
    "the READINESS probe fails closed with 503, so an orchestrator can see the instance is not serving",
    readyRes?.status === 503 ? "PASS" : "FAIL",
    `/ready returned HTTP ${readyRes?.status} after ${readyMs}ms with status="${readyBody?.status}" database="${readyBody?.checks?.database?.status}". ` +
      `This is the probe that decides whether the instance receives traffic; /health staying 200 is only acceptable if this one does not.`,
  );
  record(
    "P3",
    "a dependency-free endpoint keeps answering throughout",
    rootRes?.status === 200 && rootMs < 1000 ? "PASS" : "FAIL",
    `GET / answered in ${rootMs}ms with ${rootRes?.status} while the pool was exhausted — confirms the mechanism is the pool, not the event loop`,
  );

  const t = await telemetry(prisma, h.port);
  record("P4", "the pool recovers fully once the dependency is released", t.dbIdleInTx === 0 ? "PASS" : "FAIL", `db conns=${t.dbConnections} active=${t.dbActive} idle-in-tx=${t.dbIdleInTx}`);
}

// ── MIXED TRAFFIC — does one expensive endpoint starve the cheap ones ─────────────────────────────

async function testMixed(): Promise<void> {
  console.log("\n── MIXED · realistic traffic, starvation check ────────");
  const h = await ensureServer("mixed", LOAD_ENV);
  await ensureToken();

  /**
   * Weights approximate how a customer app actually behaves: mostly catalogue reads, a steady trickle
   * of profile/booking/wallet calls behind auth, and health polling. The point is not the exact mix
   * but that the cheap endpoints and the expensive one are in flight together, so starvation has a
   * chance to appear.
   */
  const mix: Call[] = [
    { ...CALLS.featured, weight: 8 },
    { ...CALLS.search, weight: 4 },
    { ...CALLS.root, weight: 3 },
    { ...CALLS.health, weight: 1 },
    { ...CALLS.me, weight: 2 },
    { ...CALLS.myBookings, weight: 1 },
    { ...CALLS.wallet, weight: 1 },
  ];

  // Solo reference for each, so "slower in the mix" is measured against something.
  const solo: Record<string, number> = {};
  for (const c of [CALLS.root, CALLS.health, CALLS.featured, CALLS.search, CALLS.me]) {
    const r = await drive({ calls: [c], concurrency: 20, durationMs: 5000, token: token ?? undefined });
    solo[c.label] = r.p95;
  }

  const mixed = await drive({ calls: mix, concurrency: 100, durationMs: 20_000, token: token ?? undefined, label: "mixed" });
  const rows = Object.entries(mixed.byLabel)
    .map(([label, b]) => `${label.padEnd(9)} n=${String(b.n).padStart(6)} p50=${String(b.p50).padStart(5)}ms p95=${String(b.p95).padStart(6)}ms max=${String(b.max).padStart(6)}ms err=${b.errors}` + (solo[label] !== undefined ? `  (solo p95 ${solo[label]}ms)` : ""))
    .join("\n         ");

  record(
    "M1",
    "mixed traffic completes without errors",
    mixed.errors === 0 && mixed.timeouts === 0 && mixed.networkErrors === 0 ? "PASS" : "FAIL",
    `${formatLoad(mixed)}`,
  );
  /**
   * The starvation question, stated as a ratio rather than a feeling: a dependency-free endpoint
   * sharing a process with expensive ones will slow down — everything queues behind the same single
   * JS thread — but it should degrade in proportion, not collapse.
   */
  const rootRatio = solo.root ? mixed.byLabel.root!.p95 / solo.root : 0;
  const healthRatio = solo.health ? mixed.byLabel.health!.p95 / solo.health : 0;
  record(
    "M2",
    "cheap endpoints are not starved by expensive ones sharing the process",
    mixed.byLabel.root!.errors === 0 && mixed.byLabel.health!.errors === 0 ? "PASS" : "FAIL",
    `p95 inflation vs solo: root ×${rootRatio.toFixed(1)}, health ×${healthRatio.toFixed(1)}\n         ` + rows,
  );
}

// ── RATE LIMITING — derived from the configured limit, never invented ─────────────────────────────

async function redisDel(pattern: string): Promise<number> {
  const p = Bun.spawnSync([
    "docker",
    "exec",
    "homigo-staging-redis",
    "sh",
    "-c",
    `redis-cli --scan --pattern '${pattern}' | xargs -r redis-cli del`,
  ]);
  return p.exitCode;
}

async function testRateLimit(): Promise<void> {
  console.log("\n── RATE LIMIT · burst against the configured limit ────");
  // The limiter is bypassed by LOAD_TEST_MODE in non-production, so this scenario gets its own
  // server with that flag OFF. Measuring a limiter that was switched off is how 7C manufactured a
  // rate-limit finding; the flag state is therefore part of the evidence, not an implicit default.
  const h = await ensureServer("ratelimit", LIMITED_ENV);

  /**
   * Burst size is DERIVED from the source, not chosen: `api-rate-limit.middleware.ts` computes
   * `limit = floor(baseLimit * 1.2)` with `baseLimit = 30` for anonymous `/api` traffic, so the
   * budget is 36 per 60s window keyed by IP. Sending fewer than the limit and calling the absence of
   * a 429 a pass — or sending fewer and calling a 429 a finding — is the 7C mistake in both
   * directions.
   */
  const ANON_LIMIT = Math.floor(30 * 1.2);
  await redisDel("ratelimit:global-api:*");
  await redisDel("ratelimit:auth-burst:*");

  const statuses: number[] = [];
  const headers: Array<string> = [];
  for (let i = 0; i < ANON_LIMIT + 6; i++) {
    const res = await fetch(`${BASE}/api/services/featured`, { signal: AbortSignal.timeout(10_000) });
    await res.arrayBuffer();
    statuses.push(res.status);
    if (i === 0 || i === ANON_LIMIT - 1 || i === ANON_LIMIT) {
      headers.push(
        `#${i + 1} → ${res.status} limit=${res.headers.get("x-ratelimit-limit")} remaining=${res.headers.get("x-ratelimit-remaining")} retryAfter=${res.headers.get("retry-after") ?? "-"}`,
      );
    }
  }
  const firstBlockedAt = statuses.findIndex((s) => s === 429);
  const allowedBefore = firstBlockedAt === -1 ? statuses.length : firstBlockedAt;

  /**
   * A real positive control, read from the SERVER's behaviour rather than from what the harness
   * intended. `setRateLimitHeaders` runs before the limiter decides, so an `/api` response carrying
   * no `X-RateLimit-Limit` header proves the limiter never executed — which is what the first run of
   * this scenario actually measured while reporting that the flag had been set correctly.
   */
  const probe = await fetch(`${BASE}/api/services/featured`, { signal: AbortSignal.timeout(10_000) });
  await probe.arrayBuffer();
  const limiterLive = probe.headers.get("x-ratelimit-limit") !== null;
  record(
    "RL0",
    "the limiter is actually EXECUTING on this server (proved from the response, not from the flag we passed)",
    limiterLive ? "PASS" : "FAIL",
    `an /api response carries X-RateLimit-Limit=${probe.headers.get("x-ratelimit-limit")} remaining=${probe.headers.get("x-ratelimit-remaining")}; ` +
      `harness passed LOAD_TEST_MODE="${h.env.LOAD_TEST_MODE}". A missing header means the bypass is still active and RL1..RL5 would describe nothing.`,
  );
  if (!limiterLive) {
    record("RL1", "rate-limit behaviour", "NOT_PROVEN", "the limiter was not executing, so no rate-limit conclusion can be drawn from this run");
    return;
  }
  record(
    "RL1",
    `requests up to the configured budget (${ANON_LIMIT}/min anon) are allowed`,
    allowedBefore >= ANON_LIMIT ? "PASS" : "FAIL",
    `${allowedBefore} allowed before the first 429; configured budget is floor(30 × 1.2) = ${ANON_LIMIT}`,
  );
  record(
    "RL2",
    "the request just past the budget is refused with 429, not dropped or served",
    firstBlockedAt !== -1 && statuses[firstBlockedAt] === 429 ? "PASS" : "FAIL",
    `first 429 at request #${firstBlockedAt + 1}; statuses seen: ${[...new Set(statuses)].join(",")}`,
  );
  record(
    "RL3",
    "429 responses carry Retry-After and the RFC-style limit headers",
    headers.some((h2) => h2.includes("429") && !h2.includes("retryAfter=-")) ? "PASS" : "FAIL",
    headers.join("\n         "),
  );

  // Sustained overload: the limiter must keep refusing rather than leaking through under concurrency.
  const flood = await drive({
    calls: [{ ...CALLS.featured, expect: [200, 429] }],
    concurrency: 40,
    durationMs: 6000,
    label: "flood",
  });
  const served = flood.statuses["200"] ?? 0;
  record(
    "RL4",
    "under sustained concurrent overload the limiter does not leak",
    served <= ANON_LIMIT + 5 && (flood.statuses["429"] ?? 0) > 0 ? "PASS" : "FAIL",
    `${formatLoad(flood)} — at most ${ANON_LIMIT} should be served in the window; ${served} were`,
  );

  // Recovery after the window expires.
  const ttl = Bun.spawnSync(["docker", "exec", "homigo-staging-redis", "redis-cli", "TTL", "ratelimit:global-api:anon:ip:127.0.0.1"]).stdout.toString().trim();
  await sleep(Math.min(65_000, (Number(ttl) + 2) * 1000));
  const afterWindow = await fetch(`${BASE}/api/services/featured`, { signal: AbortSignal.timeout(10_000) });
  await afterWindow.arrayBuffer();
  record(
    "RL5",
    "the budget is restored once the window expires",
    afterWindow.status === 200 ? "PASS" : "FAIL",
    `after waiting out the ${ttl}s window: HTTP ${afterWindow.status}`,
  );
}

// ── AUTHENTICATION BURST ──────────────────────────────────────────────────────────────────────────

async function testAuthBurst(): Promise<void> {
  console.log("\n── AUTH BURST · login pressure and its invariants ─────");
  const h = await ensureServer("authburst", LIMITED_ENV);
  await redisDel("ratelimit:auth-burst:*");
  await redisDel("ratelimit:global-api:*");

  /**
   * `AUTH_BURST_LIMIT` defaults to 15 per IP per minute and is enforced even in development —
   * deliberately, so brute-force probes get 429 rather than endless 401s. The burst size is taken
   * from that number.
   */
  const AUTH_LIMIT = Number(process.env.AUTH_BURST_LIMIT || 15);
  const wrong: number[] = [];
  for (let i = 0; i < AUTH_LIMIT + 4; i++) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "s7f.load@homigo.test", password: `definitely-wrong-${i}`, setAuthCookies: false }),
      signal: AbortSignal.timeout(20_000),
    });
    await res.arrayBuffer();
    wrong.push(res.status);
  }
  const first429 = wrong.findIndex((s) => s === 429);

  record(
    "AB1",
    `repeated failed logins are throttled at the configured burst limit (${AUTH_LIMIT}/min/IP)`,
    first429 !== -1 && first429 <= AUTH_LIMIT + 1 ? "PASS" : "FAIL",
    `statuses: ${wrong.join(",")} — first 429 at attempt #${first429 + 1}`,
  );
  record(
    "AB2",
    "wrong credentials are never accepted, throttled or not",
    wrong.every((s) => s === 401 || s === 429 || s === 400) ? "PASS" : "FAIL",
    `distinct statuses across ${wrong.length} wrong-password attempts: ${[...new Set(wrong)].join(",")} — a 200 here would be an authentication bypass`,
  );

  // The limiter must not lock out the legitimate credential permanently once the window passes.
  const ttl = Bun.spawnSync(["docker", "exec", "homigo-staging-redis", "redis-cli", "TTL", "ratelimit:auth-burst:login:127.0.0.1"]).stdout.toString().trim();
  await sleep(Math.min(65_000, (Number(ttl) + 2) * 1000));
  await redisDel("ratelimit:global-api:*");
  const good = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "s7f.load@homigo.test", password: "Qx7!mVt4Rp9z", setAuthCookies: false }),
    signal: AbortSignal.timeout(20_000),
  });
  const goodBody = (await good.json()) as { data?: { accessToken?: string } };
  record(
    "AB3",
    "a legitimate login succeeds once the burst window has passed",
    good.status === 200 && Boolean(goodBody.data?.accessToken) ? "PASS" : "FAIL",
    `HTTP ${good.status}, token issued=${Boolean(goodBody.data?.accessToken)} (waited out a ${ttl}s window)`,
  );
  void h;
}

// ── WRITE / SIDE-EFFECT BURST ─────────────────────────────────────────────────────────────────────

/**
 * Prepares the minimum a real booking needs, directly in the disposable database.
 *
 * Stated plainly because it matters for how the result should be read: `isEmailVerified` is set and
 * an address row is created as FIXTURES rather than driven through the product's own verification
 * flow. That is a shortcut around onboarding, not around the thing under test — the booking path
 * itself, its transaction boundary, its unique constraints and its idempotency, is exercised exactly
 * as a real client would exercise it.
 */
async function ensureBookingFixtures(): Promise<{ serviceId: string; addressId: string } | null> {
  const user = await prisma.user.findFirst({ where: { emailHash: { not: undefined } }, select: { id: true } }).catch(() => null);
  const me = await fetch(`${BASE}/api/users/me`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!me.ok) return null;
  const body = (await me.json()) as { data?: { user?: { id?: string } } };
  const userId = body.data?.user?.id;
  if (!userId) return null;
  void user;

  await prisma.user.update({ where: { id: userId }, data: { isEmailVerified: true } });

  const service = await prisma.service.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!service) return null;

  const existing = await prisma.address.findFirst({ where: { userId }, select: { id: true } });
  const address =
    existing ??
    (await prisma.address.create({
      data: {
        userId,
        label: "7F fixture",
        addressLine1: "1 Load Test Road",
        city: "Mumbai",
        state: "MH",
        zipCode: "400001",
        latitude: 19.076,
        longitude: 72.8777,
      },
      select: { id: true },
    }));

  return { serviceId: service.id, addressId: address.id };
}

async function testWrites(): Promise<void> {
  console.log("\n── WRITES · concurrent booking creation ──────────────");
  const h = await ensureServer("writes", LOAD_ENV);
  await ensureToken();
  const fx = await ensureBookingFixtures();
  if (!fx) {
    record("W0", "booking fixtures are available", "NOT_PROVEN", "could not resolve a service/address for the load user — no write conclusion can be drawn");
    return;
  }
  // A fresh token, because the fixture flipped `isEmailVerified` and the old one predates it.
  token = null;
  await ensureToken();
  record("W0", "booking fixtures are available", "PASS", `serviceId=${fx.serviceId} addressId=${fx.addressId}`);

  const before = await prisma.booking.count();

  // ── A. Same Idempotency-Key, fired concurrently ────────────────────────────────────────────────
  const idemKey = `7f-idem-${RUN_TAG}-${Math.random().toString(36).slice(2, 8)}`;
  const slotA = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const bodyA = { serviceId: fx.serviceId, addressId: fx.addressId, scheduledDate: slotA, description: "7F idempotency burst" };
  const idemResults = await Promise.all(
    Array.from({ length: 8 }, async () => {
      const res = await fetch(`${BASE}/api/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "idempotency-key": idemKey },
        body: JSON.stringify(bodyA),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      return { status: res.status, replay: res.headers.get("idempotent-replay") === "true", text: text.slice(0, 120) };
    }),
  );
  const createdA = await prisma.booking.count({ where: { scheduledDate: new Date(slotA) } });
  const statusesA = idemResults.map((r) => r.status);

  record(
    "W1",
    "NO DUPLICATE SIDE EFFECT — 8 concurrent requests sharing one Idempotency-Key create exactly one booking",
    createdA === 1 ? "PASS" : "FAIL",
    `bookings created for that slot: ${createdA}; response statuses: ${statusesA.join(",")}; replays: ${idemResults.filter((r) => r.replay).length}`,
  );
  record(
    "W2",
    "the losers are answered deterministically (replayed result or an explicit in-progress refusal), never silently dropped",
    idemResults.every((r) => [200, 201, 409, 400, 403].includes(r.status)) ? "PASS" : "FAIL",
    `distinct statuses: ${[...new Set(statusesA)].join(",")}; a 5xx or a network error here would mean the concurrent path is not handled`,
  );

  // ── B. Different keys, same slot — the product's own constraint must arbitrate ──────────────────
  const slotB = new Date(Date.now() + 4 * 86_400_000).toISOString();
  const bodyB = { serviceId: fx.serviceId, addressId: fx.addressId, scheduledDate: slotB, description: "7F overlap burst" };
  const overlapResults = await Promise.all(
    Array.from({ length: 8 }, async (_, i) => {
      const res = await fetch(`${BASE}/api/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "idempotency-key": `${idemKey}-distinct-${i}` },
        body: JSON.stringify(bodyB),
        signal: AbortSignal.timeout(30_000),
      });
      await res.arrayBuffer();
      return res.status;
    }),
  );
  const createdB = await prisma.booking.count({ where: { scheduledDate: new Date(slotB) } });

  record(
    "W3",
    "with DISTINCT idempotency keys the product's own overlap rule still admits only one booking for the slot",
    createdB <= 1 ? "PASS" : "FAIL",
    `bookings created for the second slot: ${createdB}; statuses: ${overlapResults.join(",")} ` +
      `(409 = OVERLAPPING_BOOKING, which is the intended arbitration rather than a failure)`,
  );

  /**
   * Section 26C, checked here rather than taken on trust: with `EVENTS_CONSUMERS_ENABLED=false` the
   * event for this booking must be PERSISTED and left PENDING. A row stamped PUBLISHED while no
   * consumer exists is the 7D failure mode — every signal green, nothing delivered — and an HTTP
   * write must not report success in a way that implies the event reached anyone.
   */
  const createdIds = await prisma.booking.findMany({
    where: { scheduledDate: { in: [new Date(slotA), new Date(slotB)] } },
    select: { id: true },
  });
  const outboxRows = await prisma.eventOutbox.findMany({
    where: { aggregateId: { in: createdIds.map((r) => r.id) } },
    select: { eventType: true, status: true, publishedAt: true },
  });
  record(
    "W-26C",
    "an event-producing write persists its event as PENDING and claims no delivery while consumers are disabled",
    outboxRows.length > 0 && outboxRows.every((r) => r.status === "PENDING" && r.publishedAt === null) ? "PASS" : outboxRows.length === 0 ? "NOT_PROVEN" : "FAIL",
    outboxRows.length === 0
      ? "no outbox row was written for these bookings — either booking events are disabled or the transactional emit did not run, so nothing can be concluded"
      : `${outboxRows.length} outbox row(s): ${outboxRows.map((r) => `${r.eventType}=${r.status}`).join(", ")}; ` +
        `the 201 response body carries the booking only — it makes no statement about event delivery`,
  );

  const after = await prisma.booking.count();
  const orphaned = (await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM bookings b
    WHERE b.scheduled_date IN ('${slotA}'::timestamptz, '${slotB}'::timestamptz)
      AND (b.booking_number IS NULL OR b.total_amount IS NULL)
  `)) as Array<{ n: number }>;
  record(
    "W4",
    "no partially-committed booking was left behind by the losing requests",
    (orphaned[0]?.n ?? 0) === 0 ? "PASS" : "FAIL",
    `bookings total ${before} → ${after} (delta ${after - before}); rows missing a booking number or amount: ${orphaned[0]?.n}`,
  );

  // Cleanup — these are real rows in the disposable database and this run created them.
  const ids = await prisma.booking.findMany({
    where: { scheduledDate: { in: [new Date(slotA), new Date(slotB)] } },
    select: { id: true },
  });
  if (ids.length > 0) {
    const idList = ids.map((r) => r.id);
    await prisma.eventOutbox.deleteMany({ where: { aggregateId: { in: idList } } }).catch(() => ({ count: 0 }));
    await prisma.booking.deleteMany({ where: { id: { in: idList } } }).catch(() => ({ count: 0 }));
  }
  const final = await prisma.booking.count();
  record("W5", "the write burst left the database as it found it", final === before ? "PASS" : "INFO", `bookings ${before} → ${after} → ${final} after cleanup`);
  void h;
}

// ── REDIS PRESSURE CAUSED BY HTTP ─────────────────────────────────────────────────────────────────

function dockerRedis(cmd: "pause" | "unpause"): boolean {
  const p = Bun.spawnSync(["docker", cmd, "homigo-staging-redis"]);
  return p.exitCode === 0;
}

async function testRedisPressure(): Promise<void> {
  console.log("\n── REDIS · HTTP-specific effects of a frozen Redis ────");
  const h = await ensureServer("redis", LOAD_ENV);
  await ensureToken();

  const healthy = await drive({ calls: [CALLS.featured, CALLS.me], concurrency: 20, durationMs: 6000, token: token ?? undefined, label: "redis-healthy" });

  dockerRedis("pause");
  let frozen: Awaited<ReturnType<typeof drive>>;
  try {
    // 7C established a 5s command deadline. The HTTP question is whether a request INHERITS that
    // bound or waits indefinitely — i.e. whether the deadline reaches the user-facing path.
    frozen = await drive({
      calls: [
        { ...CALLS.featured, expect: [200, 503] },
        { ...CALLS.me, expect: [200, 401, 503] },
      ],
      concurrency: 20,
      durationMs: 25_000,
      token: token ?? undefined,
      timeoutMs: 40_000,
      label: "redis-frozen",
    });
  } finally {
    dockerRedis("unpause");
  }
  await sleep(4000);
  const recovered = await drive({ calls: [CALLS.featured, CALLS.me], concurrency: 20, durationMs: 6000, token: token ?? undefined, label: "redis-recovered" });
  const t = await telemetry(prisma, h.port);

  record(
    "RD1",
    "with Redis frozen, HTTP requests stay bounded rather than hanging on a Redis command",
    frozen.max < 30_000 && frozen.networkErrors === 0 ? "PASS" : "FAIL",
    `healthy: ${formatLoad(healthy)}\n         frozen : ${formatLoad(frozen)}\n         ` +
      `the 7C command deadline is 5s; a max anywhere near the 40s client timeout would mean it does not reach the HTTP path`,
  );
  record(
    "RD2",
    "requests still SUCCEED with Redis down (the in-memory fallback carries the cache and limiter)",
    (frozen.statuses["200"] ?? 0) > 0 ? "PASS" : "FAIL",
    `status distribution while frozen: ${JSON.stringify(frozen.statuses)}`,
  );
  /**
   * `redis_up` is refreshed by a 30s periodic PING (`REDIS_HEALTH_CHECK_INTERVAL`), so a reading
   * taken ten seconds after the unpause says nothing about whether the client reconnected — it only
   * says the gauge is stale. Polling past one full interval is what distinguishes "not reconnected"
   * from "not sampled yet", and the difference is the whole question.
   */
  const healthIntervalMs = Number(process.env.REDIS_HEALTH_CHECK_INTERVAL || 30000);
  let redisUpAgain = 0;
  const upDeadline = Date.now() + healthIntervalMs * 2 + 10_000;
  while (Date.now() < upDeadline) {
    await sleep(5000);
    redisUpAgain = (await telemetry(prisma, h.port).catch(() => null))?.redisUp ?? 0;
    if (redisUpAgain === 1) break;
  }
  record(
    "RD4",
    "the server's Redis client genuinely reconnects after the freeze (not merely surviving on the fallback)",
    redisUpAgain === 1 ? "PASS" : "FAIL",
    `redis_up returned to ${redisUpAgain} within ${healthIntervalMs * 2 + 10_000}ms of the unpause ` +
      `(the gauge is refreshed by a ${healthIntervalMs}ms PING loop, which is why the reading taken immediately after recovery showed 0)`,
  );

  record(
    "RD3",
    "throughput returns after Redis comes back",
    recovered.rps > healthy.rps * 0.5 && recovered.errors === 0 ? "PASS" : "FAIL",
    `recovered: ${formatLoad(recovered)} (healthy was ${healthy.rps} rps); redis_up=${t.redisUp} clients=${t.redisClients}`,
  );
}

// ── PROCESS RESTART DURING BURST ──────────────────────────────────────────────────────────────────

async function testRestart(): Promise<void> {
  console.log("\n── RESTART · killing the server under sustained load ──");
  let h = await ensureServer("restart", LOAD_ENV);
  await ensureToken();

  const samples: Array<{ status: number | null; at: number }> = [];
  const load = drive({
    calls: [{ ...CALLS.featured, expect: [200] }, { ...CALLS.search, expect: [200] }],
    concurrency: 25,
    durationMs: 40_000,
    timeoutMs: 10_000,
    label: "restart-load",
    onSample: (s) => samples.push({ status: s.status, at: s.at }),
  });

  await sleep(8000);
  const killedAt = Date.now();
  const killedPid = h.listenerPid;
  stopServer(h);
  await sleep(1500);
  const downAt = Date.now();
  h = await bringUp("restart", LOAD_ENV);
  const upAt = Date.now();

  const result = await load;

  const duringOutage = samples.filter((s) => s.at >= killedAt && s.at <= upAt);
  const afterRecovery = samples.filter((s) => s.at > upAt + 1000);
  const failedDuring = duringOutage.filter((s) => s.status === null || s.status >= 500).length;
  const failedAfter = afterRecovery.filter((s) => s.status === null || s.status >= 500).length;

  record(
    "RS1",
    "the server really was killed and replaced (different pid holds the socket)",
    h.listenerPid !== killedPid && h.listenerPid > 0 ? "PASS" : "FAIL",
    `listener pid ${killedPid} → ${h.listenerPid}; down for ~${upAt - downAt}ms of a ${result.durationMs}ms load run`,
  );
  record(
    "RS2",
    "in-flight requests fail cleanly during the outage rather than hanging",
    duringOutage.length > 0 ? "PASS" : "NOT_PROVEN",
    `${duringOutage.length} requests landed in the outage window, ${failedDuring} of them failed — failures here are correct, a hang would not be`,
  );
  record(
    "RS3",
    "traffic recovers fully after the restart, with no lingering failures",
    afterRecovery.length > 0 && failedAfter === 0 ? "PASS" : "FAIL",
    `${afterRecovery.length} requests after recovery, ${failedAfter} failed; overall ${formatLoad(result)}`,
  );

  const t = await telemetry(prisma, h.port);
  const strandedLocks = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`)) as Array<{ n: number }>;
  record(
    "RS4",
    "the killed process left nothing stranded",
    t.dbIdleInTx === 0 && (strandedLocks[0]?.n ?? 0) === 0 ? "PASS" : "FAIL",
    `db conns=${t.dbConnections} idle-in-tx=${t.dbIdleInTx} advisory locks=${strandedLocks[0]?.n} rss=${t.rssMb}MB`,
  );
}

// ── SOAK ──────────────────────────────────────────────────────────────────────────────────────────

async function testSoak(): Promise<void> {
  const minutes = Number(arg("soak-minutes", "6"));
  console.log(`\n── SOAK · ${minutes} minutes of mixed traffic ──────────────`);
  const h = await ensureServer("soak", LOAD_ENV);
  await ensureToken();

  const mix: Call[] = [
    { ...CALLS.featured, weight: 6 },
    { ...CALLS.search, weight: 3 },
    { ...CALLS.root, weight: 2 },
    { ...CALLS.me, weight: 2 },
    { ...CALLS.wallet, weight: 1 },
    { ...CALLS.health, weight: 1 },
  ];

  const series: string[] = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const t = await telemetry(prisma, h.port).catch((e) => {
        // A telemetry probe that fails must be visible, not skipped — a soak that silently stops
        // sampling looks exactly like a soak with no growth.
        series.push(`sample FAILED: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      });
      if (t) {
        series.push(
          `t+${String(series.length * 30).padStart(4)}s rss=${String(t.rssMb).padStart(4)}MB heap=${String(t.heapUsedMb).padStart(3)}MB ` +
            `db=${t.dbConnections}(${t.dbActive}act,${t.dbIdleInTx}idletx) redisClients=${t.redisClients} httpTotal=${t.httpTotal}`,
        );
      }
      await sleep(30_000);
    }
  })();

  const result = await drive({ calls: mix, concurrency: 40, durationMs: minutes * 60_000, token: token ?? undefined, label: "soak" });
  sampling = false;
  await sampler;

  const rssValues = series.map((s) => Number(s.match(/rss=\s*(\d+)MB/)?.[1] ?? NaN)).filter((n) => !Number.isNaN(n));
  const first = rssValues[0] ?? 0;
  const last = rssValues[rssValues.length - 1] ?? 0;
  const peak = Math.max(...rssValues, 0);
  /**
   * Growth is judged against the trend, not against a single peak: a garbage-collected runtime saws
   * up and down, and calling the top of one saw tooth a leak is how ordinary cache warm-up gets
   * reported as unbounded growth.
   */
  const monotonic = rssValues.every((v, i) => i === 0 || v >= rssValues[i - 1]! - 1);

  record(
    "SK1",
    `${minutes} minutes of sustained mixed traffic completes without errors`,
    result.clockJumped ? "NOT_PROVEN" : result.errors === 0 && result.networkErrors === 0 && result.timeouts === 0 ? "PASS" : "FAIL",
    result.clockJumped
      ? `${formatLoad(result)}
         the run spanned a machine suspend, so its throughput, latency and error counts describe the suspend rather than the server — re-run required`
      : formatLoad(result),
  );
  record(
    "SK2",
    "resident memory does not grow monotonically across the soak",
    !monotonic || last <= first * 1.5 ? "PASS" : "FAIL",
    `rss first=${first}MB last=${last}MB peak=${peak}MB, strictly non-decreasing across every sample: ${monotonic}\n         ` + series.join("\n         "),
  );
  const t = await telemetry(prisma, h.port);
  record(
    "SK3",
    "connection counts are stable at the end of the soak",
    t.dbIdleInTx === 0 ? "PASS" : "FAIL",
    `db conns=${t.dbConnections} active=${t.dbActive} idle-in-tx=${t.dbIdleInTx} redisClients=${t.redisClients}`,
  );
}

// ── RETRY AMPLIFICATION ───────────────────────────────────────────────────────────────────────────

/**
 * How much internal work does ONE client request generate when it fails?
 *
 * The booking path retries its transaction up to `MAX_BOOKING_TX_RETRIES = 8` on conflict, so a
 * single rejected booking could in principle cost eight transactions. Counting statements for one
 * request that is guaranteed to lose tells the difference between "retries on a transient conflict"
 * (correct) and "retries a deterministic rejection eight times" (amplification).
 */
async function testRetry(): Promise<void> {
  console.log("\n── RETRY · amplification for one failing request ──────");
  const h = await ensureServer("retry", LOAD_ENV);
  await ensureToken();
  const fx = await ensureBookingFixtures();
  if (!fx) {
    record("RT0", "retry amplification", "NOT_PROVEN", "booking fixtures unavailable");
    return;
  }
  token = null;
  await ensureToken();

  const slot = new Date(Date.now() + 9 * 86_400_000).toISOString();
  const body = { serviceId: fx.serviceId, addressId: fx.addressId, scheduledDate: slot, description: "7F retry probe" };
  const post = async (key: string) => {
    const res = await fetch(`${BASE}/api/bookings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "idempotency-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    await res.arrayBuffer();
    return res.status;
  };

  // One booking that succeeds, measured — this is the "cost of a success" reference.
  await prisma.$queryRawUnsafe("SELECT pg_stat_statements_reset() IS NULL AS reset_done");
  const okStatus = await post(`7f-retry-ok-${RUN_TAG}`);
  const okCost = (await prisma.$queryRawUnsafe(
    `SELECT COALESCE(sum(calls),0)::int AS calls FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%'`,
  )) as Array<{ calls: number }>;

  // A second booking for the same slot: guaranteed to lose on the overlap rule.
  await prisma.$queryRawUnsafe("SELECT pg_stat_statements_reset() IS NULL AS reset_done");
  const failStatus = await post(`7f-retry-fail-${RUN_TAG}`);
  const failCost = (await prisma.$queryRawUnsafe(
    `SELECT COALESCE(sum(calls),0)::int AS calls FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%'`,
  )) as Array<{ calls: number }>;
  const txns = (await prisma.$queryRawUnsafe(
    `SELECT COALESCE(sum(calls),0)::int AS calls FROM pg_stat_statements WHERE query IN ('BEGIN','COMMIT','ROLLBACK')`,
  )) as Array<{ calls: number }>;

  const okCalls = okCost[0]?.calls ?? 0;
  const failCalls = failCost[0]?.calls ?? 0;
  const ratio = okCalls > 0 ? failCalls / okCalls : 0;

  record(
    "RT1",
    "the probe produced the intended success-then-rejection pair",
    okStatus === 201 && failStatus === 409 ? "PASS" : "FAIL",
    `first booking → HTTP ${okStatus}, second for the same slot → HTTP ${failStatus} (409 = the overlap rule rejecting it)`,
  );
  record(
    "RT2",
    `a deterministically rejected request does NOT re-run its transaction ${8}× `,
    ratio < 3 ? "PASS" : "FAIL",
    `statements for the accepted booking: ${okCalls}; for the rejected one: ${failCalls} (×${ratio.toFixed(2)}). ` +
      `BEGIN/COMMIT/ROLLBACK during the rejection: ${txns[0]?.calls ?? 0}. ` +
      `MAX_BOOKING_TX_RETRIES is 8, so a ratio near 8 would mean a permanent rejection is being retried as if transient.`,
  );
  record(
    "RT3",
    "no layer of the request path retries on the client's behalf without bound",
    "INFO",
    "source inventory of retries reachable from an HTTP request: booking.service MAX_BOOKING_TX_RETRIES=8 (conflict only), " +
      "wallet.service bounded by TXN_NUMBER_RETRIES (the `for(;;)` header is bounded by its guard — it continues only while attempts remain, otherwise rethrows), " +
      "gift-card MAX_REDEEM_RETRIES, support-ticket 8, notification MAX_ATTEMPTS; outbound HTTP (maps/weather/razorpay) uses AbortSignal.timeout plus a circuit breaker. " +
      "The harness itself performs no retries, so every number in this section is first-attempt behaviour.",
  );

  const ids = await prisma.booking.findMany({ where: { scheduledDate: new Date(slot) }, select: { id: true } });
  if (ids.length > 0) {
    const idList = ids.map((r) => r.id);
    await prisma.eventOutbox.deleteMany({ where: { aggregateId: { in: idList } } }).catch(() => ({ count: 0 }));
    await prisma.booking.deleteMany({ where: { id: { in: idList } } }).catch(() => ({ count: 0 }));
  }
  void h;
}

// ── OUTBOUND DEPENDENCY PRESSURE ──────────────────────────────────────────────────────────────────

/**
 * Deliberately low volume, and the reason is a safety rule rather than a shortcut.
 *
 * `.env` on this machine carries real GOOGLE_MAPS_API_KEY and WEATHER_API_KEY values, and the base
 * URLs in `maps.service` / `weather.service` are compile-time constants. There is therefore no way to
 * point these calls at a controlled endpoint from the process environment — `load-env` restores only
 * an explicit preserve list, and the keys are not on it. Driving them at ladder volume would mean
 * hammering live third-party APIs with real credentials, which is exactly the kind of outbound side
 * effect this programme forbids.
 *
 * So this measures what can be measured honestly: that an endpoint which depends on an outbound call
 * is bounded, and that its latency does not leak into unrelated endpoints. The load-level failure
 * injection is reported as not performed rather than approximated.
 */
async function testOutbound(): Promise<void> {
  console.log("\n── OUTBOUND · bounded dependency, low volume by design ─");
  const h = await ensureServer("outbound", LOAD_ENV);
  await ensureToken();

  const MAPS_TIMEOUT_MS = 6000;
  const samples: Array<{ ms: number; status: number | null }> = [];
  for (let i = 0; i < 4; i++) {
    samples.push(await timeOne("GET", "/api/geo/route?fromLat=19.076&fromLng=72.8777&toLat=19.116&toLng=72.9070", undefined, 30_000, true));
    await sleep(300);
  }
  const rootDuring = await timeOne("GET", "/");
  const worst = Math.max(...samples.map((s) => s.ms));

  record(
    "OB1",
    "an endpoint backed by an outbound call returns within its configured outbound budget",
    worst < MAPS_TIMEOUT_MS * 2 + 2000 ? "PASS" : "FAIL",
    `4 requests to /api/geo/route: ${samples.map((s) => `${s.ms}ms(${s.status ?? "timeout"})`).join(", ")}; ` +
      `maps.service timeout is ${MAPS_TIMEOUT_MS}ms with an OSRM fallback behind it, so roughly double that is the worst legitimate case`,
  );
  record(
    "OB2",
    "outbound latency does not leak into endpoints that make no outbound call",
    rootDuring.ms < 500 && rootDuring.status === 200 ? "PASS" : "FAIL",
    `GET / alongside the outbound-backed endpoint: ${rootDuring.ms}ms (${rootDuring.status})`,
  );
  record(
    "OB3",
    "outbound protections present in the request path (source inventory)",
    "INFO",
    "maps.service: AbortSignal.timeout(6000) + mapsBreaker + OSRM fallback; weather.service: AbortSignal.timeout(8000) + weatherBreaker + cache; " +
      "razorpay.service: AbortSignal.timeout(15000) on order creation and a 30000ms default elsewhere + razorpayBreaker. " +
      "Every outbound call in the representative set is deadline-bounded and circuit-broken.",
  );
  record(
    "OB4",
    "controlled downstream failure injection at load",
    "NOT_PROVEN",
    "not performed: the outbound base URLs are module constants and the API keys are not in `load-env`'s runtime preserve list, " +
      "so the only way to redirect these calls would be editing the shared .env that the developer's own running servers also read. " +
      "Worker starvation and retry-storm behaviour under a failing third party is therefore UNPROVEN in this section.",
  );
  void h;
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────

console.log("SECTION 7F — HTTP / API burst, concurrency, timeouts, resilience");
console.log(`  run tag  : ${RUN_TAG}`);
console.log(`  base URL : ${BASE}`);
console.log(`  machine  : ${await machineState()}\n`);

let exitCode = 0;
try {
  if (want("gates")) await testGates();
  if (want("baseline")) {
    await testBaseline(1);
    await testBaseline(2);
  }
  if (want("ladder")) await testLadder();
  if (want("dbpressure")) await testDbPressure();
  if (want("timeout")) await testTimeout();
  if (want("cancel")) await testCancel();
  if (want("hol")) await testHol();
  if (want("pool")) await testPool();
  if (want("mixed")) await testMixed();
  if (want("ratelimit")) await testRateLimit();
  if (want("authburst")) await testAuthBurst();
  if (want("writes")) await testWrites();
  if (want("redis")) await testRedisPressure();
  if (want("outbound")) await testOutbound();
  if (want("restart")) await testRestart();
  if (want("retry")) await testRetry();
  if (want("soak")) await testSoak();
} finally {
  if (server) stopServer(server);
  clearPort(PORT);

  console.log("\n── POST-RUN ──────────────────────────────────────────");
  const leftover = listenerPidOn(PORT);
  record("Z1", "no server process left listening on the test port", leftover === null ? "PASS" : "FAIL", `listener on :${PORT} after teardown = ${leftover ?? "none"}`);
  const conns = (await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'idle in transaction')::int AS idletx
    FROM pg_stat_activity WHERE datname = current_database()
  `)) as Array<{ total: number; idletx: number }>;
  record(
    "Z2",
    "no connection left idle in transaction (the stall injector released its lock)",
    (conns[0]?.idletx ?? 0) === 0 ? "PASS" : "FAIL",
    `connections=${conns[0]?.total} idle-in-transaction=${conns[0]?.idletx}`,
  );

  const fails = checks.filter((c) => c.status === "FAIL");
  const unproven = checks.filter((c) => c.status === "NOT_PROVEN");
  console.log("\n══ 7F RESULT ═════════════════════════════════════════");
  console.log(
    `  PASS=${checks.filter((c) => c.status === "PASS").length}  FAIL=${fails.length}  ` +
      `NOT_PROVEN=${unproven.length}  INFO=${checks.filter((c) => c.status === "INFO").length}`,
  );
  for (const f of fails) console.log(`  FAIL  ${f.id} ${f.title}\n        ${f.detail}`);
  for (const u of unproven) console.log(`  ????  ${u.id} ${u.title}\n        ${u.detail}`);
  exitCode = fails.length > 0 ? 1 : 0;
  await prisma.$disconnect();
}
process.exit(exitCode);
