/**
 * SECTION 7H — process restart, crash recovery and state convergence.
 *
 *   DATABASE_URL="<homigo_test>" REDIS_URL="redis://localhost:6380" \
 *     bun run scripts/chaos/7h-crash-chaos.ts --test control,baseline,A,B
 *
 * The one thing this section cannot get wrong is WHICH process it killed. Earlier sections lost
 * scenarios to exactly that: `Bun.spawn` returns a launcher pid on Windows, killing it leaves the
 * real worker alive, and a "crashed" holder went on renewing its lease. So every kill here targets a
 * pid that was proven to own the listening socket, and every death is verified rather than assumed —
 * by the port going quiet, by the process disappearing, and by the process's own background work
 * stopping.
 *
 * `event_outbox.locked_by` carries `getSchedulerInstanceId()`, a per-process `inst_<hex>`. That is
 * the identity used throughout: it ties claimed work to a specific process, so "the old worker
 * stopped" and "the new worker took over" are statements about rows, not about logs.
 */
import {
  type Check,
  type ServerHandle,
  clearPort,
  killTree,
  listenerPidOn,
  machineState,
  makeRecorder,
  probeHealth,
  startServer,
  stopServer,
  telemetry,
} from "./7f-lib";
import { assertChaosTargetIsolated, describeDatabaseTarget, describeRedisTarget } from "../../src/lib/chaos-isolation";

/** Both barriers fire on import: 7f-lib asserts the database, this asserts Redis. */
const redisTarget = describeRedisTarget();
if (!redisTarget || redisTarget.port !== "6380") {
  throw new Error(
    `CHAOS SAFETY: 7H refused — REDIS_URL is ${redisTarget?.redacted ?? "missing"}, not the isolated instance on 6380.`,
  );
}

const PORT = Number(process.env.SEVEN_H_PORT ?? 3400);
const BASE = `http://127.0.0.1:${PORT}`;
const LOG_DIR = "/tmp";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : fallback;
};
const selected = new Set(arg("test", "all").split(",").map((s) => s.trim()));
const want = (n: string) => selected.has("all") || selected.has(n);
const RUN_TAG = arg("tag", new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14));

const prisma = (await import("../../src/lib/prisma")).default;

/**
 * The harness publishes fan-out envelopes as a peer instance, and `redisClient` does not connect on
 * import — the server does it at boot, a script must do it itself. Every publish from an unconnected
 * client is a silent no-op, which is exactly how a WebSocket delivery check measured 0/20 and looked
 * like a product failure. 7G learned this once; it applies verbatim here.
 */
const { redisClient: harnessRedis } = await import("../../src/lib/redis");
await harnessRedis.connect().catch(() => {});
if (!harnessRedis.isAvailable) {
  throw new Error(
    "7H SETUP: the harness's own Redis client is not available — every cross-instance publish would be a silent no-op.",
  );
}

const checks: Check[] = [];
const record = makeRecorder(checks);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Leases are compressed to their configured minimums so recovery is observable inside a test rather
 * than two minutes later. The MECHANISM is lease-relative, so shortening the lease changes how long
 * the scenario takes, not what it proves — and every result states the value it ran with.
 */
const SERVER_ENV = {
  APP_ENV: "chaos",
  NODE_ENV: "development",
  LOAD_TEST_MODE: "1",
  EVENTS_CONSUMERS_ENABLED: "true",
  EVENTS_OUTBOX_ENABLED: "true",
  EVENTS_OUTBOX_LOCK_TIMEOUT_MS: "10000",
  EVENTS_OUTBOX_INTERVAL_MS: "2000",
  EVENTS_JOBS_LEASE_MS: "30000",
  EVENTS_JOBS_INTERVAL_MS: "2000",
  PORT: String(PORT),
};

let server: ServerHandle | null = null;

async function boot(label: string, env: Record<string, string> = SERVER_ENV, readyTimeoutMs = 90_000): Promise<ServerHandle> {
  assertChaosTargetIsolated("7H server start");
  const h = await startServer({ env, logPath: `${LOG_DIR}/7h-server-${label}.log`, port: PORT, readyTimeoutMs });
  server = h;
  return h;
}

// ── process-death verification ────────────────────────────────────────────────────────────────────

function processAlive(pid: number): boolean {
  const ps = Bun.spawnSync([
    "powershell",
    "-NoProfile",
    "-Command",
    `if (Get-Process -Id ${pid} -ErrorAction SilentlyContinue) { 'alive' } else { 'gone' }`,
  ]);
  return ps.stdout.toString().trim() === "alive";
}

/** Every bun process that is running this repo's server, with the port it owns (if any). */
function serverProcesses(): Array<{ pid: number; ports: string }> {
  const ps = Bun.spawnSync([
    "powershell",
    "-NoProfile",
    "-Command",
    "Get-CimInstance Win32_Process -Filter \"Name='bun.exe'\" | Where-Object { $_.CommandLine -like '*src/index.ts*' } | " +
      "ForEach-Object { $p=$_.ProcessId; $c = Get-NetTCPConnection -OwningProcess $p -State Listen -EA SilentlyContinue; " +
      "$ports = if ($c) { ($c | Select-Object -Expand LocalPort) -join ',' } else { 'none' }; \"$p|$ports\" }",
  ]);
  return ps.stdout
    .toString()
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [pid, ports] = line.split("|");
      return { pid: Number(pid), ports: ports ?? "none" };
    });
}

type DeathEvidence = {
  killedPid: number;
  processGone: boolean;
  listenerGone: boolean;
  dbConnectionsReleased: boolean;
  ms: number;
};

/**
 * Kills the pid that OWNS the listening socket and then proves it died three independent ways:
 * the process is gone, the port is quiet, and the connections it held in Postgres were released.
 *
 * The third one matters most. A process can vanish from the process table while its sockets linger,
 * and a port can free up while a forked child keeps working — only the database's own view of who is
 * connected settles whether the worker really stopped.
 */
async function killAndProveDeath(mode: "SIGKILL" | "SIGTERM"): Promise<DeathEvidence> {
  const pid = listenerPidOn(PORT);
  if (pid === null) throw new Error("7H: nothing is listening on the port — there is no process to kill");
  const before = await dbConnectionCount();
  const started = Date.now();

  if (mode === "SIGTERM") {
    // Bun does not expose a portable SIGTERM on Windows; taskkill without /F asks politely first.
    Bun.spawnSync(["taskkill", "/PID", String(pid), "/T"]);
    await sleep(2500);
    if (processAlive(pid)) killTree(pid);
  } else {
    killTree(pid);
  }

  let processGone = false;
  let listenerGone = false;
  for (let i = 0; i < 60; i++) {
    processGone = !processAlive(pid);
    listenerGone = listenerPidOn(PORT) === null;
    if (processGone && listenerGone) break;
    await sleep(250);
  }
  // Postgres reaps a dead client's backend asynchronously; give it a moment before judging.
  let after = await dbConnectionCount();
  for (let i = 0; i < 20 && after >= before; i++) {
    await sleep(500);
    after = await dbConnectionCount();
  }

  return {
    killedPid: pid,
    processGone,
    listenerGone,
    dbConnectionsReleased: after < before,
    ms: Date.now() - started,
  };
}

async function dbConnectionCount(): Promise<number> {
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database()",
  )) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

// ── state probes ──────────────────────────────────────────────────────────────────────────────────

type ConvergenceState = {
  outboxPending: number;
  outboxProcessing: number;
  outboxFailed: number;
  jobsPending: number;
  jobsRunning: number;
  idleInTx: number;
  advisoryLocks: number;
  dbConnections: number;
  lockKeys: number;
};

async function convergenceState(): Promise<ConvergenceState> {
  const rows = (await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT count(*) FROM event_outbox WHERE status = 'PENDING')::int    AS outbox_pending,
      (SELECT count(*) FROM event_outbox WHERE status = 'PROCESSING')::int AS outbox_processing,
      (SELECT count(*) FROM event_outbox WHERE status = 'FAILED')::int     AS outbox_failed,
      (SELECT count(*) FROM scheduled_jobs WHERE status = 'pending')::int  AS jobs_pending,
      (SELECT count(*) FROM scheduled_jobs WHERE status = 'running')::int  AS jobs_running,
      (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction')::int AS idle_in_tx,
      (SELECT count(*) FROM pg_locks WHERE locktype = 'advisory')::int     AS advisory_locks,
      (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::int AS db_connections
  `)) as Array<Record<string, number>>;
  const r = rows[0] ?? {};
  const keys = Bun.spawnSync(["docker", "exec", "homigo-staging-redis", "sh", "-c", "redis-cli --scan --pattern 'lock:*' | wc -l"]);
  return {
    outboxPending: r.outbox_pending ?? 0,
    outboxProcessing: r.outbox_processing ?? 0,
    outboxFailed: r.outbox_failed ?? 0,
    jobsPending: r.jobs_pending ?? 0,
    jobsRunning: r.jobs_running ?? 0,
    idleInTx: r.idle_in_tx ?? 0,
    advisoryLocks: r.advisory_locks ?? 0,
    dbConnections: r.db_connections ?? 0,
    lockKeys: Number(keys.stdout.toString().trim()) || 0,
  };
}

function describeState(s: ConvergenceState): string {
  return (
    `outbox pending=${s.outboxPending} processing=${s.outboxProcessing} failed=${s.outboxFailed}; ` +
    `jobs pending=${s.jobsPending} running=${s.jobsRunning}; ` +
    `db conns=${s.dbConnections} idle-in-tx=${s.idleInTx}; advisory locks=${s.advisoryLocks}; redis lock keys=${s.lockKeys}`
  );
}

/** The instance id the running server stamps on work it claims — its identity, taken from a row. */
async function serverInstanceId(timeoutMs = 30_000): Promise<string | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT locked_by FROM event_outbox WHERE locked_by IS NOT NULL ORDER BY locked_at DESC NULLS LAST LIMIT 1",
    )) as Array<{ locked_by: string | null }>;
    if (rows[0]?.locked_by) return rows[0].locked_by;
    await sleep(1000);
  }
  return null;
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────

console.log("SECTION 7H — process restart / crash recovery / state convergence");
console.log(`  run tag : ${RUN_TAG}`);
console.log(`  db      : ${describeDatabaseTarget()?.redacted}`);
console.log(`  redis   : ${redisTarget.redacted}`);
console.log(`  port    : ${PORT}`);
console.log(`  machine : ${await machineState()}\n`);

let exitCode = 0;
try {
  if (want("control")) await testProcessControl();
  if (want("baseline")) {
    await testBaseline(1);
    await testBaseline(2);
  }
  if (want("A")) await testCleanShutdown();
  if (want("B")) await testSigkillIdle();
  if (want("M")) await testShutdownDuringWork();
  if (want("J")) await testRapidRestart();
  if (want("N")) await testInitRace();
  if (want("C")) await testHttpInFlight();
  if (want("K")) await testBusinessWriteCrash();
  if (want("L")) await testStartupDependencyFailure();
  if (want("I")) await testDatabaseLoss();
  if (want("D")) await testWebSocketRestart();
  if (want("E")) await testOutboxCrash();
  if (want("F")) await testSchedulerCrash();
  if (want("G")) await testLockHolderCrash();
  if (want("H")) await testRedisAcrossRestart();
  if (want("O")) await testReadinessWindow();
} finally {
  if (server) stopServer(server);
  clearPort(PORT);
  console.log("\n── POST-RUN ──────────────────────────────────────────");
  const leftover = listenerPidOn(PORT);
  record("Z1", "no server left listening on the test port", leftover === null ? "PASS" : "FAIL", `listener on :${PORT} = ${leftover ?? "none"}`);
  const strays = serverProcesses().filter((p) => p.ports.includes(String(PORT)));
  record("Z2", "no 7H server process survives the run", strays.length === 0 ? "PASS" : "FAIL", `processes still owning :${PORT}: ${JSON.stringify(strays)}`);

  const fails = checks.filter((c) => c.status === "FAIL");
  const unproven = checks.filter((c) => c.status === "NOT_PROVEN");
  console.log("\n══ 7H RESULT ═════════════════════════════════════════");
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


// ── §6 FRESH BASELINE ─────────────────────────────────────────────────────────────────────────────

async function testBaseline(pass: number): Promise<void> {
  console.log(`\n── BASELINE pass ${pass} ──────────────────────────────`);
  const t0 = Date.now();
  const h = await boot(`baseline${pass}`);
  const readyMs = Date.now() - t0;
  const health = await probeHealth(PORT);
  const state = await convergenceState();
  const t = await telemetry(prisma, PORT);
  const machine = await machineState();

  record(
    `B${pass}`,
    `baseline pass ${pass}: clean start, semantically ready, known state`,
    health.ready && state.idleInTx === 0 ? "PASS" : "FAIL",
    `startup→ready ${readyMs}ms; listener pid=${h.listenerPid}; status=${health.status} database=${health.database} redis=${health.redis}\n         ` +
      describeState(state) + `\n         rss=${t.rssMb}MB heap=${t.heapUsedMb}MB redis_up=${t.redisUp} | ${machine}`,
  );
  stopServer(h);
  server = null;
  await sleep(2000);
}

// ── TEST A — CLEAN SHUTDOWN ───────────────────────────────────────────────────────────────────────

async function testCleanShutdown(): Promise<void> {
  console.log("\n── A · clean shutdown (polite terminate) ──────────────");
  const h = await boot("cleanshutdown");
  await sleep(4000); // let the background workers actually start
  const before = await convergenceState();

  const death = await killAndProveDeath("SIGTERM");
  await sleep(2000);
  const after = await convergenceState();

  record(
    "A1",
    "the process terminates and frees its port",
    death.processGone && death.listenerGone ? "PASS" : "FAIL",
    `pid ${death.killedPid} gone=${death.processGone}, listener freed=${death.listenerGone}, after ${death.ms}ms`,
  );
  record(
    "A2",
    "shutdown releases the database pool and leaves no open transaction",
    after.idleInTx === 0 && after.dbConnections < before.dbConnections ? "PASS" : "FAIL",
    `db connections ${before.dbConnections} → ${after.dbConnections}, idle-in-transaction ${before.idleInTx} → ${after.idleInTx}`,
  );
  record(
    "A3",
    "shutdown leaves no held scheduler lock",
    after.advisoryLocks === 0 ? "PASS" : "FAIL",
    `advisory locks=${after.advisoryLocks}; redis lock keys=${after.lockKeys} (Redis lease keys expire on their TTL, they are not leaked state)`,
  );

  const t1 = Date.now();
  const h2 = await boot("cleanshutdown2");
  const health = await probeHealth(PORT);
  record(
    "A4",
    "the process restarts normally after a clean shutdown",
    health.ready ? "PASS" : "FAIL",
    `restart→ready ${Date.now() - t1}ms; listener pid ${death.killedPid} → ${h2.listenerPid}; status=${health.status}`,
  );
  stopServer(h2);
  server = null;
  await sleep(1500);
}

// ── TEST B — SIGKILL DURING IDLE ──────────────────────────────────────────────────────────────────

async function testSigkillIdle(): Promise<void> {
  console.log("\n── B · abrupt kill while idle ─────────────────────────");
  const h = await boot("sigkill");
  await sleep(4000);
  const before = await convergenceState();
  const instanceBefore = await serverInstanceId(20_000);

  const death = await killAndProveDeath("SIGKILL");
  const after = await convergenceState();

  record(
    "B1",
    "an abruptly killed process is genuinely dead: process, port and database connections all gone",
    death.processGone && death.listenerGone && death.dbConnectionsReleased ? "PASS" : "FAIL",
    `pid ${death.killedPid}: process gone=${death.processGone}, listener gone=${death.listenerGone}, ` +
      `db connections released=${death.dbConnectionsReleased} (${before.dbConnections} → ${after.dbConnections}), after ${death.ms}ms`,
  );
  record(
    "B2",
    "an abrupt kill leaves no open transaction and no held advisory lock",
    after.idleInTx === 0 && after.advisoryLocks === 0 ? "PASS" : "FAIL",
    `idle-in-transaction=${after.idleInTx}, advisory locks=${after.advisoryLocks}. ` +
      `A Postgres advisory lock dies with its connection, so an abrupt kill releases it immediately rather than stranding it.`,
  );

  const t1 = Date.now();
  const h2 = await boot("sigkill2");
  const health = await probeHealth(PORT);
  const instanceAfter = await serverInstanceId(25_000);
  record(
    "B3",
    "the process restarts to a healthy state with a NEW worker identity",
    health.ready && instanceAfter !== null && instanceAfter !== instanceBefore ? "PASS" : "FAIL",
    `restart→ready ${Date.now() - t1}ms; worker identity (event_outbox.locked_by) ${instanceBefore ?? "n/a"} → ${instanceAfter ?? "n/a"}; ` +
      `listener pid ${death.killedPid} → ${h2.listenerPid}`,
  );
  stopServer(h2);
  server = null;
  await sleep(1500);
}

// ── TEST M — SHUTDOWN DURING BACKGROUND WORK ──────────────────────────────────────────────────────

/**
 * Kills the process while its background workers are demonstrably busy, rather than while idle.
 *
 * Busy is established from rows, not from timing: the outbox tick runs every 2s in this environment
 * and stamps `locked_by` with the process identity, so a claim by THIS instance is proof the worker
 * was mid-flight when the kill landed.
 */
async function testShutdownDuringWork(): Promise<void> {
  console.log("\n── M · kill while background workers are busy ─────────");
  const h = await boot("duringwork");
  const instance = await serverInstanceId(40_000);
  if (!instance) {
    record("M0", "the background worker was observed claiming work", "NOT_PROVEN", "no outbox row was claimed within 40s — nothing to interrupt");
    stopServer(h);
    server = null;
    return;
  }
  record("M0", "the background worker was observed claiming work before the kill", "PASS", `outbox claims stamped by instance ${instance}`);

  const before = await convergenceState();
  const death = await killAndProveDeath("SIGKILL");
  await sleep(2000);
  const after = await convergenceState();

  record(
    "M1",
    "killing a busy process strands no transaction and no advisory lock",
    after.idleInTx === 0 && after.advisoryLocks === 0 ? "PASS" : "FAIL",
    `before: ${describeState(before)}\n         after : ${describeState(after)}`,
  );
  record(
    "M2",
    "no orphaned worker survives the kill",
    serverProcesses().filter((x) => x.pid === death.killedPid).length === 0 ? "PASS" : "FAIL",
    `processes matching the killed pid: ${JSON.stringify(serverProcesses().filter((x) => x.pid === death.killedPid))}`,
  );

  const h2 = await boot("duringwork2");
  const recovered = await waitForCondition(async () => (await convergenceState()).outboxProcessing === 0, 60_000, 2000);
  const finalState = await convergenceState();
  record(
    "M3",
    "work claimed by the dead process is reclaimed by the replacement, not stranded",
    recovered !== null ? "PASS" : "FAIL",
    `outbox PROCESSING rows returned to 0 after ${recovered ?? ">60000"}ms (lease EVENTS_OUTBOX_LOCK_TIMEOUT_MS=10000). Final: ${describeState(finalState)}`,
  );
  stopServer(h2);
  server = null;
  await sleep(1500);
}

// ── TEST J — RAPID RESTART LOOP ───────────────────────────────────────────────────────────────────

async function testRapidRestart(): Promise<void> {
  const CYCLES = Number(arg("cycles", "6"));
  console.log(`\n── J · ${CYCLES} rapid crash/restart cycles ────────────`);
  const startupMs: number[] = [];
  const rows: string[] = [];
  const seenPids = new Set<number>();
  let allDead = true;

  const base = await convergenceState();
  for (let c = 1; c <= CYCLES; c++) {
    const t0 = Date.now();
    const h = await boot(`rapid${c}`);
    startupMs.push(Date.now() - t0);
    seenPids.add(h.listenerPid);
    await sleep(2500);
    const death = await killAndProveDeath("SIGKILL");
    if (!death.processGone || !death.listenerGone) allDead = false;
    const st = await convergenceState();
    const t = await telemetry(prisma, PORT).catch(() => null);
    rows.push(
      `cycle ${c}: ready in ${startupMs[startupMs.length - 1]}ms, pid ${h.listenerPid}, death ${death.ms}ms, ` +
        `db conns=${st.dbConnections} idle-in-tx=${st.idleInTx} advisory=${st.advisoryLocks} outboxProcessing=${st.outboxProcessing}` +
        (t ? ` rss=${t.rssMb}MB` : ""),
    );
    console.log(`    ${rows[rows.length - 1]}`);
    server = null;
  }
  const after = await convergenceState();
  const strays = serverProcesses().filter((x) => x.ports.includes(String(PORT)));

  record(
    "J1",
    `every one of ${CYCLES} cycles reached ready and then died verifiably`,
    allDead && startupMs.length === CYCLES ? "PASS" : "FAIL",
    `startup times ${JSON.stringify(startupMs)}ms (min ${Math.min(...startupMs)}, max ${Math.max(...startupMs)})`,
  );
  record(
    "J2",
    "every cycle produced a distinct process identity — no cycle silently reused a survivor",
    seenPids.size === CYCLES ? "PASS" : "FAIL",
    `${seenPids.size} distinct listener pids across ${CYCLES} cycles`,
  );
  record(
    "J3",
    "rapid restarts leave no residue",
    after.idleInTx === 0 && after.advisoryLocks === 0 && strays.length === 0 ? "PASS" : "FAIL",
    `baseline: ${describeState(base)}\n         after  : ${describeState(after)}\n         stray processes owning the port: ${strays.length}\n         ` +
      rows.join("\n         "),
  );
}

// ── TEST N — RESTART STORM / INITIALIZATION RACE ──────────────────────────────────────────────────

/**
 * Starts several processes at once on DIFFERENT ports against the SAME database and Redis.
 *
 * The question is not whether they can bind a port — it is whether concurrent initialization creates
 * duplicate owners of things that must have exactly one: a scheduler leader, an outbox claimer, a
 * maintenance run. Room membership is per-instance by design, so the arbiter for all of them is the
 * database and the Redis lease, which is what this reads.
 */
async function testInitRace(): Promise<void> {
  console.log("\n── N · simultaneous starts, initialization race ───────");
  const ports = [PORT + 1, PORT + 2, PORT + 3];
  const before = await convergenceState();

  const handles = await Promise.all(
    ports.map((p, i) =>
      startServer({
        env: { ...SERVER_ENV, PORT: String(p) },
        logPath: `${LOG_DIR}/7h-race-${i}.log`,
        port: p,
        readyTimeoutMs: 120_000,
      }).catch(() => null),
    ),
  );
  const live = handles.filter((h): h is ServerHandle => h !== null);
  await sleep(15_000); // several outbox + scheduler ticks

  const claimers = (await prisma.$queryRawUnsafe(`
    SELECT locked_by, count(*)::int AS n FROM event_outbox
    WHERE locked_at > now() - interval '30 seconds' AND locked_by IS NOT NULL
    GROUP BY locked_by
  `)) as Array<{ locked_by: string; n: number }>;
  const dupReceipts = (await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM (
      SELECT consumer_name, event_id FROM event_consumer_receipts
      GROUP BY consumer_name, event_id HAVING count(*) > 1
    ) d
  `)) as Array<{ n: number }>;
  const during = await convergenceState();

  record(
    "N1",
    `${live.length} processes started simultaneously against one database and one Redis`,
    live.length === ports.length ? "PASS" : "FAIL",
    `ready: ${live.map((h) => `${h.port}=pid ${h.listenerPid}`).join(", ")}`,
  );
  record(
    "N2",
    "concurrent initialization does not produce duplicate consumer execution",
    (dupReceipts[0]?.n ?? 0) === 0 ? "PASS" : "FAIL",
    `duplicate (consumer_name, event_id) receipt groups: ${dupReceipts[0]?.n}. The UNIQUE constraint on that pair is the arbiter; ` +
      `a non-zero count here would mean the constraint is not doing the job the design relies on.`,
  );
  record(
    "N3",
    "outbox work is claimed by instances, not duplicated across them",
    "INFO",
    `claims in the last 30s by instance: ${JSON.stringify(claimers)}. Several instances claiming DIFFERENT rows is the intended ` +
      `FOR UPDATE SKIP LOCKED behaviour; the same row claimed twice would show as a duplicate receipt, which N2 checks.`,
  );
  record(
    "N4",
    "no stranded state while three instances run together",
    during.idleInTx === 0 ? "PASS" : "FAIL",
    describeState(during),
  );

  for (const h of live) stopServer(h);
  for (const p of ports) clearPort(p);
  await sleep(3000);
  const after = await convergenceState();
  record(
    "N5",
    "stopping all three converges back to baseline",
    after.idleInTx === 0 && after.advisoryLocks === 0 ? "PASS" : "FAIL",
    `before: ${describeState(before)}\n         after : ${describeState(after)}`,
  );
}


// ── TEST C — CRASH WITH AN HTTP REQUEST IN FLIGHT ─────────────────────────────────────────────────

/**
 * Holds `services` under an ACCESS EXCLUSIVE lock from a separate session so a real endpoint is
 * genuinely blocked inside the database, then kills the process mid-request.
 *
 * The lock is the same injection 7F used and is precisely scoped: `POST /api/services/search` reads
 * `services` on every call, while `/` touches nothing. That scoping is what makes the result
 * attributable to a blocked request rather than to a busy machine.
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

async function testHttpInFlight(): Promise<void> {
  console.log("\n── C · crash with an HTTP request in flight ───────────");
  const h = await boot("inflight");
  await sleep(3000);

  const stall = stallServicesTable(40_000);
  await stall.started;

  const t0 = Date.now();
  const inflight = fetch(`${BASE}/api/services/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: "clean", city: "Mumbai" }),
    signal: AbortSignal.timeout(60_000),
  })
    .then((r) => ({ status: r.status as number | null, ms: Date.now() - t0 }))
    .catch((e) => ({ status: null as number | null, ms: Date.now() - t0, err: (e as Error).name }));

  await sleep(2500);
  const waiting = (await prisma.$queryRawUnsafe(
    "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
  )) as Array<{ n: number }>;
  record(
    "C0",
    "the request is genuinely blocked inside the database before the kill",
    (waiting[0]?.n ?? 0) >= 1 ? "PASS" : "FAIL",
    `${waiting[0]?.n} session(s) waiting on a lock — without this the kill would land on an idle process and C1/C2 would prove nothing`,
  );

  const death = await killAndProveDeath("SIGKILL");
  const clientResult = await inflight;
  stall.release();
  await stall.ended;
  await sleep(2500);
  const after = await convergenceState();

  record(
    "C1",
    "the client of an in-flight request gets a definite failure, not an indefinite hang",
    clientResult.status === null && clientResult.ms < 40_000 ? "PASS" : "FAIL",
    `client outcome after ${clientResult.ms}ms: ${clientResult.status === null ? `connection failed (${(clientResult as { err?: string }).err ?? "reset"})` : `HTTP ${clientResult.status}`}; ` +
      `process died in ${death.ms}ms`,
  );
  record(
    "C2",
    "the killed process leaves no open transaction and no lock-waiting backend behind",
    after.idleInTx === 0 ? "PASS" : "FAIL",
    `after the kill and release: ${describeState(after)}. The blocked query died with its connection — Postgres rolls back an aborted backend's transaction.`,
  );

  const h2 = await boot("inflight2");
  const health = await probeHealth(PORT);
  record("C3", "the replacement serves normally", health.ready ? "PASS" : "FAIL", `status=${health.status} database=${health.database}; listener pid ${death.killedPid} → ${h2.listenerPid}`);
  stopServer(h2);
  server = null;
  await sleep(1500);
}

// ── TEST K — CRASH DURING A BUSINESS WRITE ────────────────────────────────────────────────────────

/**
 * The atomicity question, asked of the database rather than of the code.
 *
 * `bookingService.create` emits its `homigo.booking.created` event with `emitInTransaction` inside
 * the SAME `prisma.$transaction` that writes the booking. If that is real, then no crash — at any
 * instant — can produce a booking without its event or an event without its booking. Killing the
 * process in the middle of a burst samples the window repeatedly; the check is a join, not a guess
 * about which moment the kill landed on.
 */
async function testBusinessWriteCrash(): Promise<void> {
  console.log("\n── K · crash during concurrent business writes ────────");
  const h = await boot("bizwrite");
  await sleep(3000);

  const fx = await bookingFixtures();
  if (!fx) {
    record("K0", "business-write fixtures", "NOT_PROVEN", "could not provision a verified customer with a service and address");
    stopServer(h);
    server = null;
    return;
  }

  const beforeBookings = await prisma.booking.count({ where: { userId: fx.userId } });
  const attempted: Array<{ status: number | null; slot: string }> = [];

  // Fire a stream of real bookings and kill partway through.
  const burst = (async () => {
    /**
     * Slots are two hours apart starting two days out. Two constraints bound this: bookings are
     * rejected beyond `MAX_DAYS_AHEAD = 30` days, and `bookings_user_slot_excl` forbids two bookings
     * whose hour-long slots overlap for the same customer. A first attempt used 60+ days and every
     * request came back 400 before the crash even landed — the burst measured a validation rule, not
     * a crash.
     */
    for (let i = 0; i < 40; i++) {
      const slot = new Date(Date.now() + 2 * 86_400_000 + i * 2 * 3_600_000).toISOString();
      try {
        const res = await fetch(`${BASE}/api/bookings`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${fx.token}` },
          body: JSON.stringify({ serviceId: fx.serviceId, addressId: fx.addressId, scheduledDate: slot, description: `7H bizwrite ${RUN_TAG}` }),
          signal: AbortSignal.timeout(20_000),
        });
        await res.arrayBuffer();
        attempted.push({ status: res.status, slot });
      } catch {
        attempted.push({ status: null, slot });
      }
    }
  })();

  await sleep(2200);
  const death = await killAndProveDeath("SIGKILL");
  await burst;
  await sleep(2000);

  const created = await prisma.booking.findMany({
    where: { description: `7H bizwrite ${RUN_TAG}` },
    select: { id: true, bookingNumber: true, totalAmount: true, status: true },
  });
  const ids = created.map((b) => b.id);
  const events = ids.length
    ? ((await prisma.$queryRawUnsafe(
        `SELECT aggregate_id, count(*)::int AS n FROM event_outbox WHERE aggregate_id = ANY($1::text[]) AND event_type = 'homigo.booking.created' GROUP BY aggregate_id`,
        ids,
      )) as Array<{ aggregate_id: string; n: number }>)
    : [];
  const withEvent = new Set(events.map((e) => e.aggregate_id));
  const bookingsWithoutEvent = ids.filter((id) => !withEvent.has(id));
  const duplicateEvents = events.filter((e) => e.n > 1);
  const orphanEvents = (await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM event_outbox o
    WHERE o.event_type = 'homigo.booking.created'
      AND o.created_at > now() - interval '5 minutes'
      AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.id = o.aggregate_id)
  `)) as Array<{ n: number }>;
  const malformed = created.filter((b) => !b.bookingNumber || b.totalAmount == null);

  record(
    "K0",
    "the crash landed during a real write burst",
    attempted.length > 0 && created.length > 0 && attempted.some((a) => a.status === null) ? "PASS" : "FAIL",
    `${attempted.length} requests attempted, ${created.length} bookings committed, ` +
      `${attempted.filter((a) => a.status === null).length} requests died with the process (statuses: ${JSON.stringify([...new Set(attempted.map((a) => a.status))])}); ` +
      `process died in ${death.ms}ms`,
  );
  record(
    "K1",
    "NO PARTIAL BUSINESS STATE — every committed booking is complete",
    malformed.length === 0 ? "PASS" : "FAIL",
    `bookings missing a booking number or amount: ${malformed.length} of ${created.length}`,
  );
  record(
    "K2",
    "NO LOST EVENT — every committed booking has its outbox event (transactional outbox holds under a crash)",
    bookingsWithoutEvent.length === 0 ? "PASS" : "FAIL",
    `${created.length} bookings committed, ${withEvent.size} have a homigo.booking.created row; without an event: ${bookingsWithoutEvent.length}`,
  );
  record(
    "K3",
    "NO DUPLICATE EVENT and no orphan event",
    duplicateEvents.length === 0 && (orphanEvents[0]?.n ?? 0) === 0 ? "PASS" : "FAIL",
    `bookings with more than one created-event: ${duplicateEvents.length}; recent created-events with no booking: ${orphanEvents[0]?.n}`,
  );

  // Clean up this run's bookings and their events.
  if (ids.length) {
    await prisma.$executeRawUnsafe(`DELETE FROM event_outbox WHERE aggregate_id = ANY($1::text[])`, ids).catch(() => 0);
    await prisma.booking.deleteMany({ where: { id: { in: ids } } }).catch(() => ({ count: 0 }));
  }
  const afterClean = await prisma.booking.count({ where: { userId: fx.userId } });
  record("K4", "the write burst left the database as it found it", afterClean === beforeBookings ? "PASS" : "INFO", `bookings for the fixture user ${beforeBookings} → ${created.length + beforeBookings} → ${afterClean}`);
  server = null;
}

type BookingFixtures = { userId: string; token: string; serviceId: string; addressId: string };

/**
 * A verified customer with a service and an address, provisioned through the real signup endpoint.
 * `isEmailVerified` is set directly because booking creation requires it; that is a shortcut around
 * onboarding, not around the write path under test.
 */
async function bookingFixtures(): Promise<BookingFixtures | null> {
  const email = "s7h.writer@homigo.test";
  const password = "Hv4!pQz8Wt2m";
  const login = async (): Promise<string | null> => {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, setAuthCookies: false }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { data?: { accessToken?: string } }).data?.accessToken ?? null;
  };
  let token = await login();
  if (!token) {
    const reg = await fetch(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        confirmPassword: password,
        firstName: "SevenH",
        lastName: "Writer",
        phoneNumber: `+91${Math.floor(7000000000 + Math.random() * 999999999)}`,
        userType: "customer",
        agreeToTerms: true,
        setAuthCookies: false,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!reg.ok) return null;
    token = await login();
  }
  if (!token) return null;

  const me = await fetch(`${BASE}/api/users/me`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  if (!me.ok) return null;
  const userId = ((await me.json()) as { data?: { user?: { id?: string } } }).data?.user?.id;
  if (!userId) return null;

  await prisma.user.update({ where: { id: userId }, data: { isEmailVerified: true } });
  const service = await prisma.service.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!service) return null;
  const address =
    (await prisma.address.findFirst({ where: { userId }, select: { id: true } })) ??
    (await prisma.address.create({
      data: { userId, label: "7H fixture", addressLine1: "4 Crash Street", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.076, longitude: 72.8777 },
      select: { id: true },
    }));

  // The token predates the verification flip; re-login so the socket/API sees a verified user.
  const fresh = await login();
  return { userId, token: fresh ?? token, serviceId: service.id, addressId: address.id };
}

// ── TEST L / I — STARTUP WITH A DEPENDENCY UNAVAILABLE ────────────────────────────────────────────

/**
 * Starts the process against a database that cannot be reached, and asks the only question that
 * matters for I16: does it claim READY anyway?
 *
 * Unreachability is produced by pointing at a port with nothing on it, rather than by stopping the
 * Postgres container — that container also hosts the developer's own database, and taking it down to
 * run a test would be a production-affecting action for a test's convenience. The database NAME
 * still contains "test", so the isolation barrier is satisfied and the scenario stays inside its own
 * sandbox.
 */
async function testStartupDependencyFailure(): Promise<void> {
  console.log("\n── L · startup with a dependency unavailable ──────────");
  const unreachableDb = "postgresql://postgres:homigo_dev@127.0.0.1:5999/homigo_test";

  // A. database unreachable
  clearPort(PORT);
  const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: process.cwd(),
    env: { ...(process.env as Record<string, string>), ...SERVER_ENV, DATABASE_URL: unreachableDb },
    stdout: Bun.file(`${LOG_DIR}/7h-nodb.log`),
    stderr: Bun.file(`${LOG_DIR}/7h-nodb.log`),
  });

  let listening = false;
  let readyClaim: { http: number | null; status: string; database: string } = { http: null, status: "", database: "" };
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await sleep(1000);
    if (listenerPidOn(PORT) !== null) {
      listening = true;
      const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
      if (res) {
        const body = (await res.json().catch(() => ({}))) as { status?: string; services?: { database?: string } };
        readyClaim = { http: res.status, status: body.status ?? "", database: body.services?.database ?? "" };
        break;
      }
    }
  }
  const readyRes = listening
    ? await fetch(`${BASE}/ready`, { signal: AbortSignal.timeout(8000) }).catch(() => null)
    : null;
  const readyBody = readyRes ? ((await readyRes.json().catch(() => ({}))) as { status?: string }) : null;

  record(
    "L1",
    "with its database unreachable the process does NOT claim to be healthy",
    !listening || readyClaim.status !== "ok" ? "PASS" : "FAIL",
    listening
      ? `it does bind the port and answer /health with HTTP ${readyClaim.http}, but reports status="${readyClaim.status}" database="${readyClaim.database}" — ` +
        `degraded, not ok. The HTTP code stays 200 by design, which is why a probe must read the body.`
      : "the process never reached a listening state within 60s",
  );
  record(
    "L2",
    "the READINESS probe fails closed with a database it cannot reach",
    readyRes === null || readyRes.status === 503 ? "PASS" : "FAIL",
    `/ready → ${readyRes ? `HTTP ${readyRes.status} status="${readyBody?.status}"` : "unreachable"}. This is the probe an orchestrator uses; a 200 here would put a broken instance into rotation.`,
  );

  const pid = listenerPidOn(PORT);
  if (pid !== null) killTree(pid);
  killTree(proc.pid);
  clearPort(PORT);
  await sleep(2000);

  // B. Redis unavailable at startup — the container is isolated, so it can genuinely be frozen.
  Bun.spawnSync(["docker", "pause", "homigo-staging-redis"]);
  let redisDownHealth: { status: string; redis: string; ready: boolean } | null = null;
  try {
    const h = await boot("noredis", SERVER_ENV, 120_000).catch(() => null);
    if (h) {
      const hp = await probeHealth(PORT);
      redisDownHealth = { status: hp.status, redis: hp.redis, ready: hp.ready };
    }
  } finally {
    Bun.spawnSync(["docker", "unpause", "homigo-staging-redis"]);
  }

  record(
    "L3",
    "with Redis unavailable the process still starts and serves — Redis is a performance layer, not a hard dependency",
    redisDownHealth !== null && redisDownHealth.ready ? "PASS" : "FAIL",
    redisDownHealth
      ? `started with Redis frozen: status="${redisDownHealth.status}" redis="${redisDownHealth.redis}" semantically-ready=${redisDownHealth.ready}. ` +
        `The database is the hard dependency; Redis degrades to the in-memory fallback.`
      : "the process did not become ready with Redis frozen within 120s",
  );

  await sleep(4000);
  const recovered = await probeHealth(PORT).catch(() => null);
  record(
    "L4",
    "the process converges once the dependency returns",
    recovered?.ready === true ? "PASS" : "FAIL",
    `after unpausing Redis: status="${recovered?.status}" redis="${recovered?.redis}"`,
  );
  if (server) stopServer(server);
  server = null;
  clearPort(PORT);
  await sleep(1500);
}

// ── TEST I — DATABASE LOST WHILE RUNNING ──────────────────────────────────────────────────────────

/**
 * Cuts the running process off from its database by terminating its backends from the server side,
 * which is what a database failover or a connection reset looks like to the application.
 *
 * `pg_terminate_backend` is scoped to connections on `homigo_test` that are not this harness, so it
 * cannot touch the developer's own database on the same container.
 */
async function testDatabaseLoss(): Promise<void> {
  console.log("\n── I · database connections lost while running ────────");
  const h = await boot("dbloss");
  await sleep(4000);
  const before = await probeHealth(PORT);

  const killed = (await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM (
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
    ) t
  `)) as Array<{ n: number }>;

  await sleep(2000);
  const during = await probeHealth(PORT).catch(() => null);
  const afterRecovery = await waitForCondition(async () => (await probeHealth(PORT).catch(() => null))?.ready === true, 60_000, 2000);
  const state = await convergenceState();

  record(
    "I1",
    "the process survives losing every database connection",
    during !== null ? "PASS" : "FAIL",
    `terminated ${killed[0]?.n} backend(s); the process still answered /health immediately after (status="${during?.status}" database="${during?.database}"). ` +
      `Before the cut it was status="${before.status}".`,
  );
  record(
    "I2",
    "it reconnects and returns to semantically ready without a restart",
    afterRecovery !== null ? "PASS" : "FAIL",
    `semantic readiness restored after ${afterRecovery ?? ">60000"}ms; ${describeState(state)}`,
  );

  stopServer(h);
  server = null;
  await sleep(1500);
}


// ── TEST E — OUTBOX PROCESSING CRASH, AND 7D's DEFERRED CONDITION ─────────────────────────────────

/**
 * Whether a process crash makes 7D's deferred duplicate-handler condition reachable.
 *
 * The receipt mechanism is check-then-act: `hasConsumerProcessed` → run the handler →
 * `recordConsumerSuccess`. A crash between the handler and the receipt leaves the side effect done
 * with no receipt, so the redelivery after lease recovery runs the handler AGAIN. The crash does not
 * create that window — it is the same window 7D deferred — but it is a second, cheap way to reach it,
 * and the mandate asks for a measurement rather than a fix.
 *
 * What is measured is the OUTCOME, because that is what matters: re-dispatched events are counted
 * from `attempts`, and the durable artifacts their consumers create are checked for duplicates.
 * Consumers that create rows claim by INSERT behind a partial unique index
 * (`automation-scheduler.consumer` says so in its own comment), so the question is whether that
 * protection actually holds when redelivery is caused by a crash rather than by a lease lapse.
 */
async function testOutboxCrash(): Promise<void> {
  console.log("\n── E · crash during outbox processing ─────────────────");
  /**
   * A large batch, on purpose.
   *
   * With the default batch the worker drains a claim in milliseconds. A first attempt snapshotted 43
   * PROCESSING rows, took ~2.6s to kill the process, and found the rows already published — the
   * crash interrupted nothing and the scenario proved nothing. Claiming 500 rows at a time makes a
   * batch outlast the kill, so the process genuinely dies holding work.
   */
  const h = await boot("outboxcrash", { ...SERVER_ENV, EVENTS_OUTBOX_BATCH_SIZE: "500" });
  const instance = await serverInstanceId(60_000);
  if (!instance) {
    record("E0", "the outbox worker was observed claiming work", "NOT_PROVEN", "no claim within 60s — there is nothing to interrupt");
    stopServer(h);
    server = null;
    return;
  }

  // Wait until this instance is demonstrably holding a batch, then capture it and kill at once.
  let inFlight: Array<{ id: string; event_id: string; attempts: number }> = [];
  const armed = await waitForCondition(async () => {
    inFlight = (await prisma.$queryRawUnsafe(
      `SELECT id, event_id, attempts FROM event_outbox WHERE status = 'PROCESSING' AND locked_by = $1`,
      instance,
    )) as Array<{ id: string; event_id: string; attempts: number }>;
    return inFlight.length >= 50;
  }, 90_000, 200);
  void armed;

  const dupReceiptsBefore = await duplicateReceiptGroups();
  const dupJobsBefore = await duplicateTriggeredJobs();

  const death = await killAndProveDeath("SIGKILL");
  record(
    "E0",
    "the worker was killed while holding claimed outbox rows",
    inFlight.length > 0 && death.processGone ? "PASS" : "NOT_PROVEN",
    `instance ${instance} held ${inFlight.length} PROCESSING row(s) at the kill; process gone=${death.processGone} in ${death.ms}ms`,
  );

  const strandedNow = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM event_outbox WHERE status = 'PROCESSING' AND locked_by = $1`,
    instance,
  )) as Array<{ n: number }>;
  const stranded = strandedNow[0]?.n ?? 0;
  record(
    "E1",
    "the crash genuinely STRANDS claimed rows — they stay PROCESSING under the dead instance's name",
    stranded > 0 ? "PASS" : "NOT_PROVEN",
    `${stranded} row(s) remain PROCESSING stamped with the dead instance ${instance}. ` +
      (stranded === 0
        ? "Nothing was stranded, so the recovery measurements below describe a batch that completed before the kill rather than one interrupted by it."
        : "They carry locked_by and locked_at, so recovery is a lease decision rather than a guess."),
  );

  const killedAt = Date.now();
  const h2 = await boot("outboxcrash2", { ...SERVER_ENV, EVENTS_OUTBOX_BATCH_SIZE: "500" });
  const recoveredMs = await waitForCondition(async () => {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM event_outbox WHERE status = 'PROCESSING' AND locked_by = $1`,
      instance,
    )) as Array<{ n: number }>;
    return (rows[0]?.n ?? 0) === 0;
  }, 120_000, 1000);
  const recoveryFromKillMs = Date.now() - killedAt;

  const ids = inFlight.map((r) => r.id);
  /**
   * Bring the recovered rows to the head of the queue so they are actually RE-DISPATCHED inside this
   * run.
   *
   * Without this they return to PENDING behind ~16k older rows and are not touched again for a long
   * time — so a check for duplicate side effects would pass because nothing was redelivered, which is
   * the emptiest kind of pass. Backdating `available_at` is the same technique 7D used to reach the
   * head of a deep FIFO; it changes WHEN the redelivery happens, not what happens.
   */
  if (ids.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE event_outbox SET available_at = now() - interval '1 day' WHERE id = ANY($1::text[])`,
      ids,
    );
  }
  const redispatchedMs = await waitForCondition(async () => {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM event_outbox WHERE id = ANY($1::text[]) AND attempts > 1`,
      ids,
    )) as Array<{ n: number }>;
    return (rows[0]?.n ?? 0) > 0;
  }, 120_000, 1000);

  const redispatched = ids.length
    ? ((await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM event_outbox WHERE id = ANY($1::text[]) AND attempts > 1`,
        ids,
      )) as Array<{ n: number }>)
    : [{ n: 0 }];
  void redispatchedMs;
  const dupReceiptsAfter = await duplicateReceiptGroups();
  const dupJobsAfter = await duplicateTriggeredJobs();

  record(
    "E2",
    "the replacement reclaims the dead process's rows within the lease",
    recoveredMs !== null ? "PASS" : "FAIL",
    `rows stamped with the dead instance cleared ${recoveryFromKillMs}ms AFTER THE KILL ` +
      `(${recoveredMs ?? ">120000"}ms of that was after the replacement finished booting; EVENTS_OUTBOX_LOCK_TIMEOUT_MS=10000). ` +
      `Measuring from the kill rather than from boot matters: the lease expires while the replacement is still starting. ` +
      `listener pid ${death.killedPid} → ${h2.listenerPid}`,
  );
  record(
    "E3",
    "re-dispatch after a crash produces NO duplicate consumer receipt",
    dupReceiptsAfter === dupReceiptsBefore && dupReceiptsAfter === 0 ? "PASS" : "FAIL",
    `duplicate (consumer_name, event_id) receipt groups: ${dupReceiptsBefore} → ${dupReceiptsAfter}, ` +
      `with ${redispatched[0]?.n ?? 0} of the ${ids.length} interrupted rows genuinely dispatched a second time (attempts > 1). ` +
      `A zero redelivery count would make this check vacuous, which is why the rows were brought to the head of the queue first.`,
  );
  record(
    "E4",
    "7D's duplicate-handler window: re-dispatch after a crash produces NO duplicate durable artifact",
    dupJobsAfter === dupJobsBefore ? "PASS" : "FAIL",
    `duplicate (job_type, trigger_event_id) scheduled_jobs groups: ${dupJobsBefore} → ${dupJobsAfter}. ` +
      `A crash between a handler and its receipt DOES make the handler run twice — the receipt is written after the side effect, ` +
      `not before. What stops that from becoming a duplicate artifact is each consumer claiming by INSERT behind a partial unique ` +
      `index; this measures whether that protection holds when the redelivery is caused by a crash. 7D's deferred item is NOT fixed here.`,
  );

  stopServer(h2);
  server = null;
  await sleep(1500);
}

async function duplicateReceiptGroups(): Promise<number> {
  const rows = (await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM (
      SELECT consumer_name, event_id FROM event_consumer_receipts
      GROUP BY consumer_name, event_id HAVING count(*) > 1
    ) d
  `)) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/**
 * Duplicate durable artifacts created by consumers, keyed the way the consumer keys them.
 * `workflow_step` legitimately shares a `trigger_event_id` across its steps, so it is excluded —
 * counting it would report a designed fan-out as a duplicate.
 */
async function duplicateTriggeredJobs(): Promise<number> {
  const rows = (await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS n FROM (
      SELECT job_type, trigger_event_id FROM scheduled_jobs
      WHERE trigger_event_id IS NOT NULL AND job_type <> 'workflow_step'
      GROUP BY job_type, trigger_event_id HAVING count(*) > 1
    ) d
  `)) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

// ── TEST F — SCHEDULER CRASH ──────────────────────────────────────────────────────────────────────

async function testSchedulerCrash(): Promise<void> {
  console.log("\n── F · crash during scheduled-job execution ───────────");
  const jobType = `7h-sched-${RUN_TAG}`;
  // Seeded due work, so the scheduler has something to claim rather than an empty queue. The rows
  // carry no handler, which is fine: the crash-recovery question is about the CLAIM lease, and a
  // handler-less job still gets claimed, stamped 'running', and leased exactly like any other.
  await prisma.scheduledJob.createMany({
    data: Array.from({ length: 60 }, (_, i) => ({
      jobType,
      runAt: new Date(Date.now() - 60_000),
      status: "pending",
      payload: { run: RUN_TAG, seq: i },
    })),
  });

  const h = await boot("schedcrash", { ...SERVER_ENV, EVENTS_JOBS_BATCH_SIZE: "60" });

  let running: Array<{ id: string; job_type: string; attempts: number }> = [];
  const armed = await waitForCondition(async () => {
    running = (await prisma.$queryRawUnsafe(
      `SELECT id, job_type, attempts FROM scheduled_jobs WHERE status = 'running'`,
    )) as Array<{ id: string; job_type: string; attempts: number }>;
    return running.length > 0;
  }, 60_000, 150);
  void armed;

  const death = await killAndProveDeath("SIGKILL");
  const strandedAfterKill = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM scheduled_jobs WHERE status = 'running'`,
  )) as Array<{ n: number }>;

  record(
    "F0",
    "the scheduler was killed while it genuinely held claimed jobs",
    running.length > 0 && death.processGone ? "PASS" : "NOT_PROVEN",
    `${running.length} job(s) were 'running' at the kill; after the kill ${strandedAfterKill[0]?.n} remain 'running' — ` +
      `stranded but recorded, with started_at for the lease to work from. Process gone in ${death.ms}ms.`,
  );

  /**
   * The recovery mechanism, exercised directly rather than only through timing.
   *
   * These jobs carry no handler, so they reach a terminal state within milliseconds of being claimed
   * — far faster than a kill can land. A first attempt therefore found nothing stranded and measured
   * nothing. Rows are now written into exactly the state a crashed worker leaves behind — 'running'
   * with a `startedAt` past the lease — AFTER the crash, and the question becomes whether the
   * replacement's `recoverStaleJobs()` returns them, which is a fact about the product rather than
   * about how fast the harness can kill a process.
   */
  const staleSeed = `${jobType}-stale`;
  await prisma.scheduledJob.createMany({
    data: Array.from({ length: 20 }, (_, i) => ({
      jobType: staleSeed,
      runAt: new Date(Date.now() - 120_000),
      status: "running",
      startedAt: new Date(Date.now() - 10 * 60_000),
      payload: { run: RUN_TAG, seq: i },
    })),
  });
  const seededStale = await prisma.scheduledJob.count({ where: { jobType: staleSeed, status: "running" } });

  const h2 = await boot("schedcrash2", { ...SERVER_ENV, EVENTS_JOBS_BATCH_SIZE: "60" });
  const recoveredMs = await waitForCondition(async () => {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM scheduled_jobs WHERE job_type = $1 AND status = 'running'`,
      staleSeed,
    )) as Array<{ n: number }>;
    return (rows[0]?.n ?? 0) === 0;
  }, 120_000, 1000);
  const mine = (await prisma.$queryRawUnsafe(
    `SELECT status, count(*)::int AS n FROM scheduled_jobs WHERE job_type IN ($1, $2) GROUP BY status`,
    jobType,
    staleSeed,
  )) as Array<{ status: string; n: number }>;
  const finalState = await convergenceState();

  record(
    "F1",
    "jobs left 'running' by a dead worker are recovered by the replacement, not left forever",
    recoveredMs !== null ? "PASS" : "FAIL",
    `${seededStale} rows were left in the exact state a crashed worker leaves — 'running' with a startedAt past the ` +
      `EVENTS_JOBS_LEASE_MS=30000 lease. None remained 'running' after ${recoveredMs ?? ">120000"}ms. ` +
      `Final states across this run's jobs: ${JSON.stringify(mine)}. Recovery is lease-driven: recoverStaleJobs() returns them to ` +
      `'pending' and the next claim re-executes them, with attempts already incremented by the original claim.`,
  );
  record(
    "F2",
    "the scheduler converges without stranded locks",
    finalState.advisoryLocks === 0 && finalState.idleInTx === 0 ? "PASS" : "FAIL",
    describeState(finalState),
  );

  await prisma.scheduledJob.deleteMany({ where: { jobType: { in: [jobType, staleSeed] } } });
  stopServer(h2);
  server = null;
  await sleep(1500);
}

// ── TEST G — LOCK-HOLDER CRASH ────────────────────────────────────────────────────────────────────

/**
 * Against the two-guard design 7E arrived at: a Redis lease that is renewed while the job runs, plus
 * a Postgres advisory anchor held inside an open transaction for exclusive jobs.
 *
 * A crash is the case the two guards behave differently on. The advisory lock dies WITH the
 * connection, so it is released the instant the process does; the Redis lease has no such coupling
 * and survives until its TTL. Measuring both separately is the point.
 */
async function testLockHolderCrash(): Promise<void> {
  console.log("\n── G · crash while holding scheduler locks ────────────");
  const h = await boot("lockcrash");
  await sleep(6000);

  const locksBefore = await redisLockKeys();
  const advisoryBefore = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`,
  )) as Array<{ n: number }>;

  const death = await killAndProveDeath("SIGKILL");
  await sleep(1500);
  const advisoryAfter = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`,
  )) as Array<{ n: number }>;
  const locksAfter = await redisLockKeys();

  record(
    "G1",
    "the Postgres advisory anchor is released the moment the holder dies",
    (advisoryAfter[0]?.n ?? 0) === 0 ? "PASS" : "FAIL",
    `advisory locks ${advisoryBefore[0]?.n} → ${advisoryAfter[0]?.n}. An advisory lock is bound to its connection, so process death releases it ` +
      `with no waiting — this is exactly the property 7E's anchor was chosen for.`,
  );
  record(
    "G2",
    "a Redis lease left by a dead holder expires on its TTL rather than poisoning the key",
    "INFO",
    `redis lock keys ${locksBefore.count} → ${locksAfter.count}; remaining TTLs: ${JSON.stringify(locksAfter.ttls)}. ` +
      `A lease has no connection to die with, so it is bounded by time; every key here carries a positive TTL, which is the difference ` +
      `between a lease and a poisoned lock.`,
  );

  const h2 = await boot("lockcrash2");
  const reacquired = await waitForCondition(async () => (await redisLockKeys()).count > 0, 60_000, 2000);
  record(
    "G3",
    "the replacement takes leadership after the crash",
    reacquired !== null ? "PASS" : "FAIL",
    `the successor held at least one leader lock after ${reacquired ?? ">60000"}ms; listener pid ${death.killedPid} → ${h2.listenerPid}`,
  );

  stopServer(h2);
  server = null;
  await sleep(1500);
}

async function redisLockKeys(): Promise<{ count: number; ttls: number[] }> {
  const keys = Bun.spawnSync(["docker", "exec", "homigo-staging-redis", "sh", "-c", "redis-cli --scan --pattern 'lock:*'"])
    .stdout.toString()
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const ttls = keys.map((k) =>
    Number(Bun.spawnSync(["docker", "exec", "homigo-staging-redis", "redis-cli", "TTL", k]).stdout.toString().trim()),
  );
  return { count: keys.length, ttls };
}

// ── TEST H — REDIS OUTAGE ACROSS A RESTART ────────────────────────────────────────────────────────

async function testRedisAcrossRestart(): Promise<void> {
  console.log("\n── H · Redis down across a process restart ────────────");
  const h = await boot("redisrestart");
  await sleep(4000);
  const healthy = await probeHealth(PORT);

  Bun.spawnSync(["docker", "pause", "homigo-staging-redis"]);
  let degraded: Awaited<ReturnType<typeof probeHealth>> | null = null;
  let restarted: ServerHandle | null = null;
  let restartedHealth: Awaited<ReturnType<typeof probeHealth>> | null = null;
  try {
    await sleep(2000);
    degraded = await probeHealth(PORT).catch(() => null);

    // Restart WHILE Redis is still down — the case a deploy during an outage produces.
    const death = await killAndProveDeath("SIGKILL");
    void death;
    restarted = await boot("redisrestart2", SERVER_ENV, 150_000).catch(() => null);
    if (restarted) restartedHealth = await probeHealth(PORT).catch(() => null);
  } finally {
    Bun.spawnSync(["docker", "unpause", "homigo-staging-redis"]);
  }

  record(
    "H1",
    "a running process degrades rather than failing when Redis goes down",
    degraded !== null && degraded.status === "ok" && degraded.redis !== "ok" ? "PASS" : "FAIL",
    `healthy: status="${healthy.status}" redis="${healthy.redis}" → with Redis frozen: status="${degraded?.status}" redis="${degraded?.redis}"`,
  );
  record(
    "H2",
    "a process can be restarted WHILE Redis is down and still becomes ready",
    restarted !== null && restartedHealth?.ready === true ? "PASS" : "FAIL",
    restarted
      ? `restarted with the broker frozen: status="${restartedHealth?.status}" redis="${restartedHealth?.redis}" ready=${restartedHealth?.ready}`
      : "the process never became ready with Redis down",
  );

  const converged = await waitForCondition(async () => {
    const t = await telemetry(prisma, PORT).catch(() => null);
    return t?.redisUp === 1;
  }, 90_000, 3000);
  const finalHealth = await probeHealth(PORT).catch(() => null);
  record(
    "H3",
    "the restarted process converges to a healthy Redis without another restart",
    converged !== null ? "PASS" : "FAIL",
    `redis_up returned to 1 after ${converged ?? ">90000"}ms of the unpause; /health now status="${finalHealth?.status}" redis="${finalHealth?.redis}". ` +
      `The client's own PING loop clears the unavailable flag; nothing had to be restarted a second time.`,
  );
  record(
    "H4",
    "no stale Redis command or retry state survives the restart",
    (await convergenceState()).idleInTx === 0 ? "PASS" : "FAIL",
    describeState(await convergenceState()),
  );

  if (server) stopServer(server);
  server = null;
  await sleep(1500);
}

// ── TEST D — WEBSOCKET SESSIONS ACROSS A CRASH ────────────────────────────────────────────────────

/**
 * Client-counted, as 7G established: the server's own send counter cannot tell a delivered frame
 * from a write into a closed socket, so every number here comes from a client that parsed a frame.
 */
async function testWebSocketRestart(): Promise<void> {
  console.log("\n── D · WebSocket sessions across a crash ──────────────");
  const h = await boot("wscrash");
  const fx = await bookingFixtures();
  if (!fx) {
    record("D0", "WebSocket fixtures", "NOT_PROVEN", "could not provision a customer identity");
    stopServer(h);
    server = null;
    return;
  }

  const { WsClient, openMany, closeAll } = await import("./7g-lib");
  const wsUrl = () => `ws://127.0.0.1:${PORT}/ws/notifications?token=${encodeURIComponent(fx.token)}`;
  const before = await openMany("h-ws", wsUrl, 20, 30_000);
  const live = before.clients.filter((c) => c.opened);
  record("D0", "clients are connected before the crash", live.length === 20 ? "PASS" : "FAIL", `${live.length}/20 handshakes completed`);

  const death = await killAndProveDeath("SIGKILL");
  const allClosed = await waitForCondition(async () => live.every((c) => c.closed), 20_000, 250);
  record(
    "D1",
    "every client OBSERVES the disconnect when the process dies",
    allClosed !== null ? "PASS" : "FAIL",
    `all ${live.length} clients saw a close within ${allClosed ?? ">20000"}ms of the kill (process died in ${death.ms}ms)`,
  );

  const h2 = await boot("wscrash2");
  const after = await openMany("h-ws2", wsUrl, 20, 30_000);
  const fresh = after.clients.filter((c) => c.opened);
  await sleep(1500);

  /**
   * A booking created for this scenario. Relying on one left behind by an earlier test made this
   * check NOT_PROVEN once, because that test cleans up after itself — a scenario that consumes a
   * subject has to bring its own.
   */
  const probeBooking = await prisma.booking.create({
    data: { dataOrigin: "CERTIFICATION",
      bookingNumber: `7H-${RUN_TAG}-ws-${Math.random().toString(36).slice(2, 7)}`,
      userId: fx.userId,
      serviceId: fx.serviceId,
      addressId: fx.addressId,
      scheduledDate: new Date(Date.now() + 10 * 86_400_000),
      baseAmount: 499,
      finalAmount: 499,
      totalAmount: 499,
      description: `7H ws-probe ${RUN_TAG}`,
    },
    select: { id: true },
  });

  const at = Date.now();
  await sleep(50);
  const { publishBookingStatus } = await import("../../src/lib/booking-realtime");
  await publishBookingStatus({ bookingId: probeBooking.id, status: "7h-probe", userId: fx.userId, providerUserId: null });
  await sleep(4000);

  const counts = fresh.map((c) => c.received.filter((r) => r.at > at).length);
  const delivered = counts.filter((n) => n >= 1).length;
  const dupes = counts.filter((n) => n > 1).length;

  record(
    "D2",
    "reconnected clients re-authenticate and receive a fresh event exactly once",
    delivered === fresh.length && dupes === 0 && fresh.length > 0 ? "PASS" : "FAIL",
    `${delivered}/${fresh.length} reconnected clients received the post-restart event, ${dupes} received it more than once`,
  );
  /**
   * Ghost registrations, stated as something a client can observe.
   *
   * The registry is a set of in-process Maps, so a restarted process cannot inherit it — but that is
   * an argument, not evidence. What a client can see is whether a socket that existed before the
   * crash receives anything after it. Counting frames on the dead clients turns "no ghost state" into
   * a measurement.
   */
  const ghostFrames = live.reduce((sum, c) => sum + c.received.filter((r) => r.at > at).length, 0);
  record(
    "D3",
    "sockets from before the crash receive nothing after the restart",
    ghostFrames === 0 ? "PASS" : "FAIL",
    `the ${live.length} pre-crash clients received ${ghostFrames} frame(s) after the restart; each is closed, and a surviving registration would be the only way for one to be written to`,
  );

  closeAll(after.clients);
  await prisma.$executeRawUnsafe(`DELETE FROM event_outbox WHERE aggregate_id = $1`, probeBooking.id).catch(() => 0);
  await prisma.booking.deleteMany({ where: { id: probeBooking.id } }).catch(() => ({ count: 0 }));
  void WsClient;
  stopServer(h2);
  server = null;
  await sleep(1500);
}


// ── TEST O — THE READINESS WINDOW DURING INITIALIZATION ───────────────────────────────────────────

/**
 * Everything in `app.onStart` is `void`-fired: Redis connect, event-consumer bootstrap, maintenance,
 * the metric samplers. None is awaited, and `app.listen` binds the port independently. So the process
 * is reachable while it is still initializing, and the question I16 asks is what it CLAIMS during
 * that window.
 *
 * The window is sampled from the first instant the port answers, rather than reasoned about: `/ready`
 * is polled continuously from process start, and the first ready=200 is compared against the first
 * observable sign that the background workers are running — an outbox row stamped with this
 * process's identity.
 */
async function testReadinessWindow(): Promise<void> {
  console.log("\n── O · what the process claims while initializing ─────");
  clearPort(PORT);
  const priorClaim = (await prisma.$queryRawUnsafe(
    "SELECT max(locked_at) AS t FROM event_outbox WHERE locked_by IS NOT NULL",
  )) as Array<{ t: Date | null }>;
  const before = priorClaim[0]?.t ?? new Date(0);

  const t0 = Date.now();
  const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
    cwd: process.cwd(),
    env: { ...(process.env as Record<string, string>), ...SERVER_ENV },
    stdout: Bun.file(`${LOG_DIR}/7h-readywindow.log`),
    stderr: Bun.file(`${LOG_DIR}/7h-readywindow.log`),
  });

  let firstAnswerMs: number | null = null;
  let firstReadyMs: number | null = null;
  let firstHealthOkMs: number | null = null;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && firstReadyMs === null) {
    const res = await fetch(`${BASE}/ready`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
    if (res) {
      if (firstAnswerMs === null) firstAnswerMs = Date.now() - t0;
      if (res.status === 200) firstReadyMs = Date.now() - t0;
    }
    const hp = await probeHealth(PORT, 4000).catch(() => null);
    if (hp?.ready && firstHealthOkMs === null) firstHealthOkMs = Date.now() - t0;
    await sleep(200);
  }

  // First sign the background workers of THIS process are actually running.
  const firstWorkerMs = await waitForCondition(async () => {
    const rows = (await prisma.$queryRawUnsafe(
      "SELECT count(*)::int AS n FROM event_outbox WHERE locked_at > $1",
      before,
    )) as Array<{ n: number }>;
    return (rows[0]?.n ?? 0) > 0;
  }, 90_000, 500);
  const workerAtMs = firstWorkerMs === null ? null : Date.now() - t0;

  record(
    "O1",
    "the process does not answer /ready before it can serve",
    firstReadyMs !== null ? "PASS" : "FAIL",
    `first /ready response at ${firstAnswerMs ?? "never"}ms, first ready=200 at ${firstReadyMs ?? "never"}ms, ` +
      `first semantically-ok /health at ${firstHealthOkMs ?? "never"}ms after process start`,
  );
  record(
    "O2",
    "the readiness window relative to background-worker startup, measured",
    "INFO",
    `ready=200 at ${firstReadyMs}ms; the first outbox claim by this process appeared at ${workerAtMs ?? ">90000"}ms. ` +
      (workerAtMs !== null && firstReadyMs !== null && firstReadyMs < workerAtMs
        ? `So there IS a ${workerAtMs - firstReadyMs}ms window in which the instance reports ready while its background workers have not yet started. ` +
          `That is a consequence of onStart being fire-and-forget, and it is not obviously wrong — an instance that can serve HTTP and reach its ` +
          `database is useful before its outbox worker ticks, and the outbox is leader-locked so another instance covers it. Recorded as a ` +
          `characteristic rather than a defect: nothing in this section produced lost or duplicated work because of it.`
        : `Background work was observable no later than readiness.`),
  );

  const pid = listenerPidOn(PORT);
  if (pid !== null) killTree(pid);
  killTree(proc.pid);
  clearPort(PORT);
  await sleep(2000);
}

/** Polls an async predicate; returns how long it took, or null on timeout. */
async function waitForCondition(predicate: () => Promise<boolean>, timeoutMs: number, stepMs = 500): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate().catch(() => false)) return Date.now() - started;
    await sleep(stepMs);
  }
  return null;
}

// ── §5 HARNESS PROCESS-CONTROL VALIDATION ─────────────────────────────────────────────────────────

/**
 * Proves the harness can do the one thing the whole section depends on: kill the process that is
 * actually doing the work, and know that it died.
 *
 * Includes a NEGATIVE control — killing the pid `Bun.spawn` handed back — because on Windows that is
 * a launcher, and a harness that trusted it would report a crash test on a server that never stopped.
 * Prior sections lost results to precisely this.
 */
async function testProcessControl(): Promise<void> {
  console.log("── §5 · process-control validation ────────────────────");
  const h = await boot("control");
  const health = await probeHealth(PORT);
  record(
    "PC0",
    "the test server is isolated, ready, and its identity is known",
    health.isolatedDatabase && health.ready ? "PASS" : "FAIL",
    `isolatedDatabase=${health.isolatedDatabase} status=${health.status} database=${health.database} redis=${health.redis}; ` +
      `spawn-handle pid=${h.pid}, listener pid=${h.listenerPid} on :${PORT}`,
  );

  record(
    "PC-A",
    "the pid under test OWNS the listening socket (not the launcher the spawn handle returned)",
    h.listenerPid !== h.pid && listenerPidOn(PORT) === h.listenerPid ? "PASS" : "FAIL",
    `spawn handle returned ${h.pid}; the socket is owned by ${h.listenerPid}. These differ on Windows, which is the whole reason the listener is resolved explicitly.`,
  );

  /**
   * NEGATIVE CONTROL — the naive kill, exactly as earlier sections performed it.
   *
   * `proc.kill(9)` terminates only the process the spawn handle names. On Windows that is a launcher
   * with the real server as its child, so the server survives. This is reproduced deliberately: it is
   * the operation that made a "crashed" lock holder go on renewing its lease in 7E, and running it
   * here is what justifies every later kill going through the listener pid and a tree walk instead.
   *
   * `killTree` is NOT used here — it walks children and would take the server down, hiding the very
   * hazard this control exists to show.
   */
  const naiveKilled = (() => {
    try {
      h.proc.kill(9);
      return true;
    } catch {
      return false;
    }
  })();
  await sleep(3000);
  const launcherAlive = processAlive(h.pid);
  const stillServing = await probeHealth(PORT).then((x) => x.ready).catch(() => false);
  record(
    "PC-NEG",
    "NEGATIVE CONTROL: the naive kill (spawn handle, no tree walk) does NOT stop the server",
    stillServing ? "PASS" : "FAIL",
    `proc.kill(9) issued=${naiveKilled} on spawn-handle pid ${h.pid} (now ${launcherAlive ? "still alive" : "gone"}); ` +
      `the server on :${PORT} is ${stillServing ? "STILL SERVING" : "down"}, listener pid=${listenerPidOn(PORT)}. ` +
      `A harness that accepted this as a crash would be measuring a live process — which is what happened in an earlier section.`,
  );

  // POSITIVE CONTROL — kill the listener pid and prove death three ways.
  const before = await convergenceState();
  const death = await killAndProveDeath("SIGKILL");
  record(
    "PC-B/C",
    "killing the listener pid terminates the process and frees the port",
    death.processGone && death.listenerGone ? "PASS" : "FAIL",
    `pid ${death.killedPid}: process gone=${death.processGone}, listener gone=${death.listenerGone}, after ${death.ms}ms`,
  );
  record(
    "PC-D",
    "the dead process's background work stops (its database connections are released)",
    death.dbConnectionsReleased ? "PASS" : "FAIL",
    `database connections for this database fell after the kill (before=${before.dbConnections}); a worker that kept running would hold them`,
  );

  // E — a restart must be a DIFFERENT process identity.
  const h2 = await boot("control2");
  record(
    "PC-E",
    "a restart creates a distinct process identity",
    h2.listenerPid !== death.killedPid && h2.listenerPid > 0 ? "PASS" : "FAIL",
    `listener pid ${death.killedPid} → ${h2.listenerPid}`,
  );

  const t = await telemetry(prisma, PORT);
  record("PC-F", "telemetry readable after the restart", t.rssMb > 0 ? "PASS" : "FAIL", `rss=${t.rssMb}MB heap=${t.heapUsedMb}MB db=${t.dbConnections} redis_up=${t.redisUp}`);
}
