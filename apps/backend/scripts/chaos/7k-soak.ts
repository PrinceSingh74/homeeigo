/**
 * SECTION 7K — soak / memory / resource leak / long-run stability.
 *
 * The question is not whether the system works. It is whether it stays the same shape while it keeps
 * working: whether memory, timers, sockets, database and Redis connections, registries, locks and
 * queues return to a stable envelope when demand is removed, and whether repeated failure and
 * recovery leaves anything behind.
 *
 * Every resource is attributed to the soak server's own PID — its sockets are found in netstat, and
 * its database and Redis sessions are matched by the local ports those sockets use — so nothing that
 * another process on this machine is doing can be mistaken for the server's behaviour. The in-process
 * view comes from `7k-probe.ts`, loaded with `--preload`, which reports the process's own `pid`; that
 * pid must equal the port's listener or the run refuses to continue.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { createClient } from "redis";
import { assertChaosTargetIsolated, describeDatabaseTarget, describeRedisTarget } from "../../src/lib/chaos-isolation";
import { clearPort, killTree, listenerPidOn, makeRecorder, probeHealth, machineState, type Check } from "./7f-lib";
import {
  controlBurst, newWindow, pauseRedis, pct, restoreRedisIfNeeded, provisionUsers, redisPaused, rng, startRedis, startWorkload, stopRedis,
  WsProbe, type User, type Window, type Workload,
} from "./7k-work";

assertChaosTargetIsolated("7K harness import");

const PORT = Number(process.env.SEVEN_K_PORT ?? 3700);
const PROBE_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_BASE = `ws://127.0.0.1:${PORT}`;
const PROBE = `http://127.0.0.1:${PROBE_PORT}`;
const REDIS_CONTAINER = "homigo-staging-redis";
const LOG_DIR = "/tmp";

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[i + 1]! : fallback;
};
const selected = new Set(arg("test", "gates").split(",").map((s) => s.trim()));
const want = (n: string) => selected.has("all") || selected.has(n);
const RUN_TAG = arg("tag", `K${new Date().toISOString().replace(/[^0-9]/g, "").slice(8, 14)}`);
const SOAK_MIN = Number(arg("minutes", "30"));
const SEED = Number(arg("seed", "1"));

const redisTarget = describeRedisTarget();
if (!redisTarget || redisTarget.port !== "6380") {
  throw new Error(`7K SETUP: REDIS_URL must be the isolated :6380 instance, got ${redisTarget?.redacted ?? "none"}`);
}

/**
 * Database sessions are attributed by `application_name`, not by socket ports.
 *
 * Docker Desktop proxies every connection to a published port, so Postgres sees the proxy's source
 * port, never the server's: a first version matched ports and found zero sessions for a server that
 * was plainly connected. Each server incarnation now connects under its own application_name, which
 * also separates a killed process's lingering sessions from its replacement's.
 */
function withAppName(url: string, name: string): string {
  const u = new URL(url);
  u.searchParams.set("application_name", name);
  return u.toString();
}
/**
 * The server gets the canonical isolated URL every earlier section used (`.env.test`), not the
 * harness's own — a first gate run showed the server inheriting the harness's connection_limit=25 and
 * opening a 25-connection pool, which is the harness's shape, not the application's.
 */
const SERVER_DB_URL = (await Bun.file(".env.test").text()).match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim() ?? "";
if (!/\/homigo_test(\?|$)/.test(SERVER_DB_URL)) throw new Error("7K SETUP: .env.test DATABASE_URL is not homigo_test");
const BASE_DB_URL = SERVER_DB_URL;
process.env.DATABASE_URL = withAppName(process.env.DATABASE_URL!, "7k-harness");
let serverIncarnation = 0;
let currentAppName = "";

const prisma = (await import("../../src/lib/prisma")).default;

/**
 * The harness's own Redis connection, used only to OBSERVE the isolated instance.
 *
 * Bounded on purpose. node-redis's default reconnect strategy never rejects `connect()`, so an
 * unreachable Redis hung the first version of this harness silently before it printed a single line —
 * which is how a Docker Desktop outage was first discovered. Every observation now has a deadline and
 * reconnects on demand, and an unreachable instance is reported as unavailable rather than as zero.
 */
type Obs = ReturnType<typeof createClient>;
let obs: Obs | null = null;

function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`7K: ${what} exceeded ${ms}ms`)), ms)),
  ]);
}

async function observer(): Promise<Obs> {
  if (obs?.isReady) return obs;
  /**
   * A client that gave up is abandoned, not disconnected: `disconnect()` on a closed node-redis client
   * throws synchronously, which a `.catch()` cannot intercept, and a first version therefore never
   * reconnected after an outage — reporting Redis as unreachable long after it was back.
   */
  if (obs) {
    try {
      void obs.disconnect().catch(() => {});
    } catch {
      /* already closed */
    }
    obs = null;
  }
  const c = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 4000, reconnectStrategy: false } });
  c.on("error", () => {});
  await withDeadline(c.connect(), 6000, "observer Redis connect");
  obs = c;
  return c;
}

await observer().catch((e) => {
  throw new Error(`7K SETUP: the isolated Redis :6380 is unreachable — ${(e as Error).message}`);
});

const checks: Check[] = [];
const record = makeRecorder(checks);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── server lifecycle ──────────────────────────────────────────────────────────────────────────────

/**
 * Production-shaped where it matters for a soak:
 *  - LOAD_TEST_MODE=0 — the global rate limiter is ON. `.env` ships it as 1, and 7F proved dotenv
 *    would otherwise switch it off silently.
 *  - TRUST_PROXY=true — client identity comes from X-Forwarded-For, as behind the production load
 *    balancer, so the workload can be many distinct clients rather than one address.
 *  - outbox, consumers and scheduled jobs enabled, so every background loop is running.
 */
const SERVER_ENV: Record<string, string> = {
  APP_ENV: "chaos",
  NODE_ENV: "development",
  PORT: String(PORT),
  LOAD_TEST_MODE: "0",
  TRUST_PROXY: "true",
  HOMIGO_ALLOW_PAYMENT_MOCKS: "0",
  EVENTS_OUTBOX_ENABLED: "true",
  EVENTS_CONSUMERS_ENABLED: "true",
  SEVEN_K_PROBE_PORT: String(PROBE_PORT),
};

type Server = { spawnPid: number; pid: number; startedAt: number; label: string; proc: ReturnType<typeof Bun.spawn> };
let server: Server | null = null;
let bootLagMaxMs = 0;
/** Declared here, above the top-level run, so no scenario can reach them in their temporal dead zone. */
let users: User[] = [];
let serviceId = "";

async function startServer(label: string, extraEnv: Record<string, string> = {}): Promise<Server> {
  assertChaosTargetIsolated("7K server start");
  for (const p of [PORT, PROBE_PORT]) {
    const stale = clearPort(p);
    if (stale > 0) console.log(`  [warn] cleared ${stale} stale listener(s) on :${p}`);
  }
  const logPath = `${LOG_DIR}/7k-server-${label}.log`;
  await Bun.write(logPath, "");
  serverIncarnation += 1;
  currentAppName = `7k-srv-${RUN_TAG}-${serverIncarnation}`;
  const proc = Bun.spawn(["bun", "--preload", "./scripts/chaos/7k-probe.ts", "src/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...(process.env as Record<string, string>),
      ...SERVER_ENV,
      ...extraEnv,
      DATABASE_URL: withAppName(BASE_DB_URL, currentAppName),
    },
    stdout: Bun.file(logPath),
    stderr: Bun.file(logPath),
  });
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await sleep(500);
    const h = await probeHealth(PORT).catch(() => null);
    if (h?.ready && h.isolatedDatabase) {
      const listener = listenerPidOn(PORT);
      const snap = await probeSnap().catch(() => null);
      if (listener !== null && snap) {
        /**
         * Ownership, proven rather than assumed: the probe runs inside the server and reports its own
         * process.pid. 7H found `bun run` interposing a parent process whose PID is not the listener;
         * a mismatch here would mean every per-PID measurement below belongs to someone else.
         */
        if (snap.pid !== listener) {
          throw new Error(`7K SETUP: probe pid ${snap.pid} != listener pid ${listener} on :${PORT} — ownership unproven`);
        }
        server = { spawnPid: proc.pid, pid: listener, startedAt: Date.now(), label, proc };
        /**
         * The boot itself blocks the event loop for tens of seconds (module load, registry
         * certification). That stall is recorded once, then the lag window is reset so every
         * steady-state figure afterwards describes the running server rather than its startup.
         */
        const bootSnap = await probeSnap({ reset: true });
        bootLagMaxMs = bootSnap.eventLoopLagMs.maxEver;
        return server;
      }
    }
  }
  const tail = (await Bun.file(logPath).text().catch(() => "")).slice(-2000);
  killTree(proc.pid);
  throw new Error(`7K SETUP: server "${label}" never became semantically ready.\n${tail}`);
}

function stopServer(): void {
  if (!server) return;
  killTree(server.pid);
  killTree(server.spawnPid);
  clearPort(PORT);
  clearPort(PROBE_PORT);
  server = null;
}

async function killHard(): Promise<{ pid: number; gone: boolean; ms: number }> {
  if (!server) throw new Error("7K: no server to kill");
  const pid = server.pid;
  const t0 = Date.now();
  killTree(pid);
  killTree(server.spawnPid);
  let gone = false;
  for (let i = 0; i < 80; i++) {
    if (listenerPidOn(PORT) === null && !pidAlive(pid)) {
      gone = true;
      break;
    }
    await sleep(250);
  }
  clearPort(PROBE_PORT);
  server = null;
  return { pid, gone, ms: Date.now() - t0 };
}

function pidAlive(pid: number): boolean {
  const r = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], { encoding: "utf8" });
  return (r.stdout ?? "").includes(String(pid));
}

// ── telemetry ─────────────────────────────────────────────────────────────────────────────────────

type ProbeSnap = {
  pid: number;
  uptimeSec: number;
  wallMs: number;
  monoMs: number;
  memory: { rss: number; heapUsed: number; heapTotal: number; external: number; arrayBuffers: number };
  cpuMicros: { user: number; system: number };
  timers: {
    liveIntervals: number;
    liveTimeouts: number;
    intervalsCreated: number;
    timeoutsCreated: number;
    intervalsBySite: Record<string, number>;
    timeoutsBySite: Record<string, number>;
  };
  eventLoopLagMs: { samples: number; p50: number; p99: number; max: number; maxEver: number };
  registries: Record<string, { size: number | null; sampleKey: string } | "not-yet-identified">;
  app: {
    heartbeatIntervals: number;
    heartbeatTimeouts: number;
    rooms: number;
    roomMemberships: number;
    usersWithConnections: number;
    userMemberships: number;
    connectionMap: number;
    fanoutSubscribed: boolean;
    redisSubscribers: number;
    redisAvailable: boolean;
    redisHealthTimer: boolean;
  };
  processListeners: Record<string, number>;
  egressRefused: Record<string, number>;
  egressSelfTest?: string;
  heap?: { heapSize: number; objectCount: number; extraMemorySize: number; topTypes: Record<string, number> };
};

async function probeSnap(opts: { heap?: boolean; gc?: boolean; reset?: boolean } = {}): Promise<ProbeSnap> {
  const q = new URLSearchParams();
  if (opts.heap) q.set("heap", "1");
  if (opts.gc) q.set("gc", "1");
  if (opts.reset) q.set("reset", "1");
  const res = await fetch(`${PROBE}/snap?${q}`, { signal: AbortSignal.timeout(20_000) });
  const body = (await res.json()) as ProbeSnap & { error?: string };
  if (!res.ok || body.error) throw new Error(`7K PROBE FAILURE: ${body.error ?? res.status}`);
  return body;
}

type WinProc = { handles: number; threads: number | null; workingSetMb: number; bunProcesses: number; unmeasured: string[] };

/**
 * OS handle and thread figures for the server PID, measured as separate small queries.
 *
 * A single combined Get-Process query (handles + threads + CPU time + a bun process enumeration) hung
 * past 60 seconds while Redis was down, even though a plain PowerShell and a HandleCount-only query
 * issued immediately afterwards completed in ~300ms. Handles are the primary descriptor metric and
 * must succeed or the sample fails; threads are secondary and, if that query stalls, the sample says
 * so explicitly instead of carrying a number. CPU comes from the probe's process.cpuUsage().
 */
function winProc(pid: number): WinProc {
  /**
   * CIM, not Get-Process. `Get-Process -Id` stalled past 30-60s at the moment a Redis outage began under
   * load — while a CIM query of the same process, issued in the same conditions, returned in 1-3s every
   * time and showed the server's threads (43-53) and handles (308-385) perfectly stable. The stall was
   * in the probe path, not the server, so the probe path was changed.
   */
  const unmeasured: string[] = [];
  let out = "";
  let lastErr = "";
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    const r = spawnSync("powershell", ["-NoProfile", "-Command",
      `$x = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($x) { "$($x.HandleCount) $($x.ThreadCount) $($x.WorkingSetSize)" }`],
      { encoding: "utf8", timeout: 60_000 });
    const t = (r.stdout ?? "").trim();
    if (r.status === 0 && /^\d+ \d+ \d+$/.test(t)) out = t;
    else lastErr = r.error?.message ?? `status ${r.status} out="${t.slice(0, 80)}"`;
  }
  if (!out) {
    const alive = pidAlive(pid);
    throw new Error(`7K TELEMETRY FAILURE: CIM query for pid ${pid} failed twice (${lastErr}). ` +
      (alive ? "The server process IS still alive — this is a probe failure." : "THE SERVER PROCESS IS GONE — it died during the run."));
  }
  const [h, t, ws] = out.split(" ").map(Number);
  const tl = spawnSync("tasklist", ["/FI", "IMAGENAME eq bun.exe", "/NH", "/FO", "CSV"], { encoding: "utf8", timeout: 15_000 });
  const bun = (tl.stdout ?? "").split(String.fromCharCode(10)).filter((l) => l.startsWith('"bun.exe"')).length;
  return { handles: h!, threads: t!, workingSetMb: Math.round(ws! / 1048576), bunProcesses: bun, unmeasured };
}

type Sockets = {
  byState: Record<string, number>;
  dbLocalPorts: number[];
  redisLocalPorts: number[];
  listening: number[];
  timeWaitToServer: number;
  closeWait: number;
  /** Remote-port histogram of the PID's ESTABLISHED sockets — the audit trail for attribution. */
  remotePorts: Record<string, number>;
  /** ESTABLISHED sockets to any non-loopback address. The isolation invariant is that this is empty. */
  external: Record<string, number>;
};

/**
 * Every TCP socket the server PID owns, from the OS. DB and Redis sessions are identified by the
 * remote port, and their LOCAL ports are what tie a Postgres backend or a Redis client entry back to
 * this exact process. TIME_WAIT has no owning PID on Windows, so the server-side TIME_WAIT population
 * is counted by local port instead and reported separately: transient teardown, not a held resource.
 */
function sockets(pid: number): Sockets {
  // No `-p tcp`: that is IPv4 only, and Windows resolves `localhost` to ::1 first.
  const r = spawnSync("netstat", ["-ano"], { encoding: "utf8", timeout: 20_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`7K TELEMETRY FAILURE: netstat exited ${r.status}`);
  const byState: Record<string, number> = {};
  const db: number[] = [];
  const redis: number[] = [];
  const listening: number[] = [];
  let tw = 0;
  let cw = 0;
  const remote: Record<string, number> = {};
  const external: Record<string, number> = {};
  for (const line of (r.stdout ?? "").split(/\r?\n/)) {
    const m = line.trim().match(/^TCP\s+(\S+):(\d+)\s+(\S+):(\d+)\s+(\S+)\s+(\d+)$/);
    if (!m) continue;
    const [, , lport, raddr, rport, state, owner] = m;
    if (state === "TIME_WAIT" && (Number(lport) === PORT || Number(rport) === PORT)) tw++;
    if (Number(owner) !== pid) continue;
    byState[state!] = (byState[state!] ?? 0) + 1;
    if (state === "CLOSE_WAIT") cw++;
    if (state === "LISTENING") listening.push(Number(lport));
    if (state === "ESTABLISHED") {
      remote[rport!] = (remote[rport!] ?? 0) + 1;
      const host = raddr!.replace(/^\[|\]$/g, "");
      if (!["127.0.0.1", "::1", "0.0.0.0", "::"].includes(host)) external[`${host}:${rport}`] = (external[`${host}:${rport}`] ?? 0) + 1;
    }
    if (state === "ESTABLISHED" && Number(rport) === 5433) db.push(Number(lport));
    if (state === "ESTABLISHED" && Number(rport) === 6380) redis.push(Number(lport));
  }
  return { byState, dbLocalPorts: db, redisLocalPorts: redis, listening: [...new Set(listening)].sort(), timeWaitToServer: tw, closeWait: cw, remotePorts: remote, external };
}

type DbView = { total: number; active: number; idle: number; idleInTx: number; oldestXactSec: number; advisoryLocks: number };

/** A server incarnation's own Postgres backends, matched by its application_name. */
async function dbView(appName: string): Promise<DbView> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE state = 'active')::int AS active,
            count(*) FILTER (WHERE state = 'idle')::int AS idle,
            count(*) FILTER (WHERE state = 'idle in transaction')::int AS idletx,
            coalesce(max(extract(epoch FROM now() - xact_start)) FILTER (WHERE xact_start IS NOT NULL), 0)::float AS oldest,
            (SELECT count(*)::int FROM pg_locks l WHERE l.locktype = 'advisory'
               AND l.pid IN (SELECT pid FROM pg_stat_activity WHERE application_name = $1)) AS adv
       FROM pg_stat_activity WHERE application_name = $1`,
    appName,
  )) as Array<{ total: number; active: number; idle: number; idletx: number; oldest: number; adv: number }>;
  const r = rows[0]!;
  return { total: r.total, active: r.active, idle: r.idle, idleInTx: r.idletx, oldestXactSec: Math.round(r.oldest), advisoryLocks: r.adv };
}

type RedisView = { serverClients: number; serverSubscribers: number; totalClients: number; fanoutSubs: number; lockKeys: number; rateKeys: number };

/**
 * Redis clients cannot be matched by port through Docker's proxy either, and the application does not
 * name its connections. The isolated :6380 instance is used by nothing but this run — the contamination
 * check proves no other chaos server is up, and the developer's own backend uses :6379 — so the server's
 * clients are everything except the observer. `G2` verifies that premise: before the server starts the
 * instance holds exactly the observer, and after the server is killed it returns to exactly that.
 */
async function redisView(): Promise<RedisView | null> {
  let o: Obs;
  try {
    o = await observer();
  } catch {
    return null;
  }
  const cmd = <T>(args: string[]) => withDeadline(o.sendCommand(args) as Promise<T>, 3000, `Redis ${args[0]}`);
  const list = await cmd<string>(["CLIENT", "LIST"]).catch(() => null);
  if (list === null) return null;
  const myId = await cmd<number>(["CLIENT", "ID"]);
  let serverClients = 0;
  let serverSubscribers = 0;
  let total = 0;
  for (const line of list.split("\n")) {
    if (!line.trim()) continue;
    total++;
    const id = line.match(/^id=(\d+)/);
    if (id && Number(id[1]) === Number(myId)) continue;
    serverClients++;
    const sub = line.match(/ sub=(\d+)/);
    if (sub && Number(sub[1]) > 0) serverSubscribers++;
  }
  const numsub = await cmd<Array<string | number>>(["PUBSUB", "NUMSUB", "ws:fanout"]);
  const count = async (pattern: string): Promise<number> => {
    let cursor = "0";
    let n = 0;
    do {
      const r = await cmd<[string, string[]]>(["SCAN", cursor, "MATCH", pattern, "COUNT", "1000"]);
      cursor = r[0];
      n += r[1].length;
    } while (cursor !== "0");
    return n;
  };
  return {
    serverClients,
    serverSubscribers,
    totalClients: total,
    fanoutSubs: Number(numsub[1] ?? 0),
    lockKeys: await count("lock:*"),
    rateKeys: await count("*global-api:*"),
  };
}

// ── one complete sample ───────────────────────────────────────────────────────────────────────────

type Sample = {
  t: number;
  phase: string;
  probe: ProbeSnap;
  win: WinProc;
  sock: Sockets;
  db: DbView;
  /** null ONLY when Redis is unreachable — recorded explicitly, never as zeroes. */
  redis: RedisView | null;
  clockSkewMs: number;
};

let lastClock: { wall: number; mono: number } | null = null;
let clockJumps = 0;

/**
 * A sample is all-or-nothing. If any source cannot be read the sample throws and the run stops —
 * a partially-blank row is how a leak hides.
 *
 * Machine suspend is detected directly: wall-clock and monotonic time advance together unless the
 * machine slept. 7F lost a soak to Windows Modern Standby and read it as a 4.6-hour latency.
 */
async function sample(phase: string, opts: { heap?: boolean; gc?: boolean } = {}): Promise<Sample> {
  if (!server) throw new Error("7K: sample() with no server");
  const probe = await probeSnap({ ...opts, reset: true });
  if (probe.pid !== server.pid) throw new Error(`7K: probe now reports pid ${probe.pid}, expected ${server.pid} — listener changed underneath the run`);
  const win = winProc(server.pid);
  const sock = sockets(server.pid);
  const db = await dbView(currentAppName);
  const redis = await redisView();
  const wall = Date.now();
  const mono = performance.now();
  let skew = 0;
  if (lastClock) {
    skew = Math.abs(wall - lastClock.wall - (mono - lastClock.mono));
    if (skew > 5_000) {
      clockJumps++;
      console.log(`  [!!] clock jump of ${Math.round(skew)}ms between samples — possible machine suspend`);
    }
  }
  lastClock = { wall, mono };
  return { t: wall, phase, probe, win, sock, db, redis, clockSkewMs: Math.round(skew) };
}

function describe(s: Sample): string {
  const p = s.probe;
  const mb = (b: number) => Math.round(b / 1048576);
  return (
    `rss=${mb(p.memory.rss)}MB heap=${mb(p.memory.heapUsed)}/${mb(p.memory.heapTotal)}MB ext=${mb(p.memory.external)}MB ` +
    `handles=${s.win.handles} threads=${s.win.threads ?? "UNMEASURED"} ` +
    `timers(int=${p.timers.liveIntervals},to=${p.timers.liveTimeouts}) lag(p99=${p.eventLoopLagMs.p99.toFixed(1)},max=${p.eventLoopLagMs.max.toFixed(1)})ms ` +
    `ws(conn=${p.app.connectionMap},rooms=${p.app.rooms},memb=${p.app.roomMemberships},hb=${p.app.heartbeatIntervals}) ` +
    `sock(est=${s.sock.byState.ESTABLISHED ?? 0},cw=${s.sock.closeWait},tw=${s.sock.timeWaitToServer},ext=${Object.keys(s.sock.external).length}) ` +
    `db(${s.db.total} idle=${s.db.idle} act=${s.db.active} iit=${s.db.idleInTx} adv=${s.db.advisoryLocks}) ` +
    (s.redis
      ? `redis(cli=${s.redis.serverClients},sub=${s.redis.serverSubscribers},fanout=${s.redis.fanoutSubs},locks=${s.redis.lockKeys})`
      : "redis(UNREACHABLE)")
  );
}

// ── run header ────────────────────────────────────────────────────────────────────────────────────

console.log("SECTION 7K — soak / memory / resource leak / long-run stability");
console.log(`  run id      : ${RUN_TAG}   seed=${SEED}`);
console.log(`  timestamp   : ${new Date().toISOString()}`);
console.log(`  db          : ${describeDatabaseTarget()?.redacted}`);
console.log(`  redis       : ${redisTarget.redacted}`);
console.log(`  ports       : app :${PORT}  probe :${PROBE_PORT}`);
console.log(`  env         : ${JSON.stringify({ ...SERVER_ENV, SEVEN_K_PROBE_PORT: undefined })}`);
console.log(`  gateway     : NOT CALLED — no payment, payout, refund or wallet mutation in the workload`);
console.log(`  machine     : ${await machineState()}`);
console.log(`  harness pid : ${process.pid}`);

/**
 * Contamination check before anything is spawned: the long-lived :3100 backend and the :3300 realtime
 * harness from earlier sections must not be running, and no other 7K instance may hold these ports.
 */
const foreign = [3100, 3200, 3300, 3400, 3500, 3600, PORT, PROBE_PORT]
  .map((p) => ({ p, pid: listenerPidOn(p) }))
  .filter((x) => x.pid !== null);
if (foreign.length) {
  throw new Error(`7K SETUP: foreign listeners present before the run: ${JSON.stringify(foreign)}`);
}
console.log(`  contamination: no listeners on :3100 :3200 :3300 :3400 :3500 :3600 :${PORT} :${PROBE_PORT}`);

let exitCode = 0;
try {
  if (want("gates")) await testGates();
  if (want("soak")) await primarySoak();
  if (want("rldiag")) await diagOutage();
  if (want("idleoutage")) await diagIdleOutage();
  if (want("busy")) await diagBusyAfterOutage();
  if (want("threads")) await diagThreads();
  if (want("redisrecovery")) await expRedisRecovery();
  if (want("ratelimit")) await expRateLimitStore();
  if (want("memstore")) await expCacheMemStore();
  if (want("wschurn")) await expWsChurn();
  if (want("restart")) await expRestartSoak();
  if (want("lifecycle")) await expLifecycle();
  if (want("retry")) await expRetryLoop();
  if (want("bootnoredis")) await expBootWithoutRedis();
  if (want("wsrace")) await expWsCloseRace();
} finally {
  stopServer();
  const restored = restoreRedisIfNeeded();
  if (restored !== "already running") console.log(`  [restore] isolated Redis was left down by an aborted step — ${restored}`);
  const o = obs as Obs | null;
  if (o) await o.quit().catch(() => {});
  console.log("\n── POST-RUN ──────────────────────────────────────────");
  record("Z1", "no 7K listener left behind", listenerPidOn(PORT) === null && listenerPidOn(PROBE_PORT) === null ? "PASS" : "FAIL",
    `:${PORT}=${listenerPidOn(PORT) ?? "none"} :${PROBE_PORT}=${listenerPidOn(PROBE_PORT) ?? "none"}`);
  record("Z0", "no machine suspend or clock jump during the run", clockJumps === 0 ? "PASS" : "FAIL", `clock jumps detected: ${clockJumps}`);
  const fails = checks.filter((c) => c.status === "FAIL");
  const unproven = checks.filter((c) => c.status === "NOT_PROVEN");
  console.log("\n══ 7K RESULT ═════════════════════════════════════════");
  console.log(`  PASS=${checks.filter((c) => c.status === "PASS").length}  FAIL=${fails.length}  NOT_PROVEN=${unproven.length}  INFO=${checks.filter((c) => c.status === "INFO").length}`);
  for (const f of fails) console.log(`  FAIL  ${f.id} ${f.title}\n        ${f.detail}`);
  for (const u of unproven) console.log(`  ????  ${u.id} ${u.title}\n        ${u.detail}`);
  exitCode = fails.length > 0 ? 1 : 0;
  await prisma.$disconnect();
}
process.exit(exitCode);

// ══ SHARED: fixtures, business safety, series, classification ════════════════════════════════════


async function sweep7k(): Promise<number> {
  const rows = (await prisma.$queryRawUnsafe(`SELECT id FROM bookings WHERE description LIKE '7K %'`)) as Array<{ id: string }>;
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return 0;
  const del = async (sql: string) => prisma.$executeRawUnsafe(sql, ids).catch(() => 0);
  await del(`DELETE FROM assignment_attempts WHERE job_id IN (SELECT id FROM assignment_jobs WHERE booking_id = ANY($1::text[]))`);
  await del(`DELETE FROM assignment_jobs WHERE booking_id = ANY($1::text[])`);
  await del(`DELETE FROM event_consumer_receipts WHERE event_id IN (SELECT event_id FROM event_outbox WHERE aggregate_id = ANY($1::text[]))`);
  await del(`DELETE FROM scheduled_jobs WHERE trigger_event_id IN (SELECT event_id FROM event_outbox WHERE aggregate_id = ANY($1::text[]))`);
  await del(`DELETE FROM event_outbox WHERE aggregate_id = ANY($1::text[])`);
  await del(`DELETE FROM notifications WHERE reference_id = ANY($1::text[])`);
  await del(`DELETE FROM activity_logs WHERE booking_id = ANY($1::text[])`);
  await del(`DELETE FROM bookings WHERE id = ANY($1::text[])`);
  return ids.length;
}

async function ensureFixtures(): Promise<void> {
  if (users.length) return;
  const svc = (await prisma.$queryRawUnsafe(`SELECT id FROM services WHERE is_active = true ORDER BY created_at LIMIT 1`)) as Array<{ id: string }>;
  if (!svc[0]) throw new Error("7K FIXTURE: no active service");
  serviceId = svc[0].id;
  users = await provisionUsers(BASE, prisma as never, 24);
}

type Money = { journals: number; unbalanced: number; walletTxnsForSoakUsers: number; soakUserBalancePaise: string; paymentsForSoakBookings: number };

/** The soak must not create financial truth. Read before and after, over the whole ledger. */
async function money(): Promise<Money> {
  const ids = users.map((u) => u.userId);
  const one = async <T>(sql: string, ...a: unknown[]) => ((await prisma.$queryRawUnsafe(sql, ...a)) as T[])[0]!;
  const j = await one<{ n: number }>(`SELECT count(*)::int AS n FROM journal_entries`);
  const u = await one<{ n: number }>(`SELECT count(*)::int AS n FROM (SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING round(sum(debit)::numeric,2) <> round(sum(credit)::numeric,2)) x`);
  const w = await one<{ n: number }>(`SELECT count(*)::int AS n FROM wallet_transactions WHERE user_id = ANY($1::text[])`, ids);
  const b = await one<{ s: bigint }>(`SELECT coalesce(sum(wallet_balance_paise),0) AS s FROM users WHERE id = ANY($1::text[])`, ids);
  const p = await one<{ n: number }>(`SELECT count(*)::int AS n FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE description LIKE '7K %')`);
  return { journals: j.n, unbalanced: u.n, walletTxnsForSoakUsers: w.n, soakUserBalancePaise: String(b.s), paymentsForSoakBookings: p.n };
}

type Row = { s: Sample; w: Window | null; ctrl?: Awaited<ReturnType<typeof controlBurst>>; dbRttMs?: number; redisRttMs?: number; note?: string };

async function rtts(): Promise<{ db: number; redis: number }> {
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) await prisma.$queryRawUnsafe(`SELECT 1`);
  const db = (performance.now() - t0) / 10;
  let redis = -1;
  try {
    const o = await observer();
    const t1 = performance.now();
    for (let i = 0; i < 10; i++) await o.ping();
    redis = (performance.now() - t1) / 10;
  } catch {
    redis = -1;
  }
  return { db: Math.round(db * 100) / 100, redis: Math.round(redis * 100) / 100 };
}

function mb(b: number): number {
  return Math.round(b / 1048576);
}

/** One line per sample, for the time-series evidence. */
function line(r: Row): string {
  const w = r.w;
  let reqs = 0;
  let errs = 0;
  let r429 = 0;
  const lat: number[] = [];
  if (w) {
    for (const o of Object.values(w.ops)) {
      reqs += o.n;
      errs += o.s5xx + o.net;
      r429 += o.s429;
      lat.push(...o.lat);
    }
  }
  const secs = 15;
  const eg = Object.values(r.s.probe.egressRefused).reduce((a, b) => a + b, 0);
  return (
    `${r.s.phase.padEnd(10)} ${describe(r.s)} ` +
    (w ? `| rps=${(reqs / secs).toFixed(1)} p95=${pct(lat, 95).toFixed(0)} p99=${pct(lat, 99).toFixed(0)} err=${errs} 429=${r429} ws=${w.wsOpened}/${w.wsFailed} deliv=${w.delivered}/${w.delivered + w.missed}` : "") +
    ` egress=${eg}` +
    (r.ctrl ? ` | CONTROL p50=${r.ctrl.p50.toFixed(1)} p95=${r.ctrl.p95.toFixed(1)} p99=${r.ctrl.p99.toFixed(1)} ok=${r.ctrl.ok}/${r.ctrl.n} rps=${r.ctrl.rps} dbRtt=${r.dbRttMs} redisRtt=${r.redisRttMs}` : "") +
    (r.note ? ` | ${r.note}` : "")
  );
}

type Verdict = "A stable" | "B bounded oscillation" | "C workload-proportional" | "D monotonic unexplained growth" | "E recovery failure" | "F insufficient evidence";

/**
 * §7 classification, applied the same way to every resource.
 *
 * The steady window is cut into quarters. Monotonic growth requires every quarter to exceed the one
 * before AND the total rise to exceed the resource's noise threshold AND the resource to stay up after
 * demand is removed. A sawtooth — GC, pool breathing, connection churn — rises and falls inside the
 * quarters and is classified as bounded oscillation, not as a leak.
 */
function classify(steady: number[], idleBaseline: number, cooldownEnd: number, threshold: number): { verdict: Verdict; detail: string } {
  if (steady.length < 8) return { verdict: "F insufficient evidence", detail: `only ${steady.length} steady samples` };
  const q = 4;
  const size = Math.floor(steady.length / q);
  const qm = Array.from({ length: q }, (_, i) => {
    const part = steady.slice(i * size, i === q - 1 ? steady.length : (i + 1) * size);
    return part.reduce((a, b) => a + b, 0) / part.length;
  });
  const rising = qm.every((v, i) => i === 0 || v > qm[i - 1]!);
  const rise = qm[q - 1]! - qm[0]!;
  const range = Math.max(...steady) - Math.min(...steady);
  const staysUp = cooldownEnd - idleBaseline > threshold;
  const r = (x: number) => Math.round(x * 10) / 10;
  const detail = `quarters=[${qm.map(r).join(", ")}] range=${r(range)} idle-baseline=${r(idleBaseline)} cooldown-end=${r(cooldownEnd)} threshold=${threshold}`;
  if (rising && rise > threshold && staysUp) return { verdict: "D monotonic unexplained growth", detail };
  if (staysUp) return { verdict: "E recovery failure", detail };
  if (qm[0]! - idleBaseline > threshold && !staysUp) return { verdict: "C workload-proportional", detail };
  if (range <= threshold) return { verdict: "A stable", detail };
  return { verdict: "B bounded oscillation", detail };
}

// ══ §5–§9, §13, §15–§20, §27 — THE PRIMARY SOAK ══════════════════════════════════════════════════

async function primarySoak(): Promise<void> {
  const pass = arg("pass", "1");
  console.log(`\n── PRIMARY SOAK pass ${pass} · ${SOAK_MIN} min · seed ${SEED} ──`);
  const swept = await sweep7k();
  if (swept) console.log(`  swept ${swept} booking(s) from earlier 7K runs`);
  const pre = await redisView();
  if (!pre || pre.serverClients !== 0) throw new Error(`7K: :6380 is not clean before the soak (${pre?.serverClients ?? "unreachable"} foreign clients)`);

  await startServer(`soak${pass}`);
  await ensureFixtures();
  const moneyBefore = await money();

  const rows: Row[] = [];
  const push = (r: Row) => {
    rows.push(r);
    console.log(`  ${line(r)}`);
  };

  // ── baseline: idle, then two short control passes (§5) ──
  await sleep(20_000);
  const idle = await sample("idle-gc", { gc: true, heap: true });
  push({ s: idle, w: null, note: `heapObjects=${idle.probe.heap?.objectCount}` });
  for (const c of [1, 2]) {
    const r = await rtts();
    push({ s: await sample(`control${c}`), w: null, ctrl: await controlBurst(BASE), dbRttMs: r.db, redisRttMs: r.redis });
  }

  // Timings: warmup, steady A, fault segment, steady C, cooldown.
  const warm = 2;
  const faultMin = 12;
  const steadyC = Math.max(6, Math.round(SOAK_MIN / 3));
  const steadyA = Math.max(10, SOAK_MIN - warm - faultMin - steadyC);
  const cooldownMin = 6;
  console.log(`  schedule: warmup ${warm}m · steady A ${steadyA}m · faults ${faultMin}m · steady C ${steadyC}m · cooldown ${cooldownMin}m`);

  const wl: Workload = startWorkload({
    base: BASE,
    wsBase: WS_BASE,
    users,
    serviceId,
    publicVus: 4,
    runTag: RUN_TAG,
    seed: SEED,
    authPaceMs: 1500,
    publicPaceMs: 450,
  });

  const allBookings: string[] = [];
  let lastControl = 0;
  const tick = async (phase: string, note?: string) => {
    const w = wl.swap();
    allBookings.push(...w.bookingsCreated);
    let ctrl: Row["ctrl"];
    let r: { db: number; redis: number } | undefined;
    if (Date.now() - lastControl > 5 * 60_000 && (phase === "steadyA" || phase === "steadyC")) {
      ctrl = await controlBurst(BASE);
      r = await rtts();
      lastControl = Date.now();
    }
    push({ s: await sample(phase), w, ctrl, dbRttMs: r?.db, redisRttMs: r?.redis, note });
  };
  const runFor = async (phase: string, minutes: number) => {
    const end = Date.now() + minutes * 60_000;
    while (Date.now() < end) {
      await sleep(15_000);
      await tick(phase);
    }
  };

  await runFor("warmup", warm);
  const aStart = await sample("A-start-gc", { gc: true, heap: true });
  push({ s: aStart, w: wl.swap(), note: `heapObjects=${aStart.probe.heap?.objectCount}` });
  lastControl = 0;
  await runFor("steadyA", steadyA);
  const aEnd = await sample("A-end-gc", { gc: true, heap: true });
  push({ s: aEnd, w: wl.swap(), note: `heapObjects=${aEnd.probe.heap?.objectCount}` });

  // ── §13 failure-recovery during the long run; pass 2 runs them in a different order ──
  const faults: Array<[string, () => Promise<string>]> = [
    ["redis-pause", async () => {
      const on = pauseRedis(true);
      await sleep(25_000);
      const off = pauseRedis(false);
      return `docker pause verified=${on}, unpause verified=${off}`;
    }],
    ["db-terminate", async () => {
      const r = (await prisma.$queryRawUnsafe(
        `SELECT count(*)::int AS n FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1) x`,
        currentAppName,
      )) as Array<{ n: number }>;
      return `terminated ${r[0]?.n ?? 0} server Postgres backend(s)`;
    }],
    ["ws-storm", async () => {
      const u = users[0]!;
      const socks = Array.from({ length: 200 }, (_, i) => new WsProbe(`${WS_BASE}/ws/notifications?token=${encodeURIComponent(users[i % users.length]!.token)}`));
      const opened = (await Promise.all(socks.map((x) => x.open()))).filter(Boolean).length;
      await sleep(3000);
      socks.forEach((x) => x.abort());
      void u;
      return `200 WebSocket connections opened (${opened} succeeded) and dropped ungracefully at once`;
    }],
    ["table-lock", async () => {
      let release: () => void = () => {};
      const held = new Promise<void>((res) => (release = res));
      const tx = prisma.$transaction(async (t) => {
        await t.$executeRawUnsafe(`LOCK TABLE bookings IN ACCESS EXCLUSIVE MODE`);
        await held;
      }, { timeout: 30_000, maxWait: 10_000 }).catch(() => undefined);
      await sleep(8000);
      const w = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND application_name = $1`, currentAppName)) as Array<{ n: number }>;
      release();
      await tx;
      return `bookings held ACCESS EXCLUSIVE for 8s; server sessions waiting on it at release: ${w[0]?.n ?? 0}`;
    }],
    ["redis-restart", async () => {
      const stopped = stopRedis();
      await sleep(8000);
      const started = await startRedis();
      return `docker stop verified=${stopped}, start+healthy=${started}`;
    }],
  ];
  const order = pass === "2" ? [4, 2, 0, 3, 1] : [0, 1, 2, 3, 4];
  const faultEnd = Date.now() + faultMin * 60_000;
  const gap = (faultMin * 60_000) / order.length;
  for (const idx of order) {
    const [name, fn] = faults[idx]!;
    const slotEnd = Date.now() + gap;
    const outcome = await fn().catch((e) => `FAILED: ${(e as Error).message}`);
    await tick("fault", `${name}: ${outcome}`);
    while (Date.now() < slotEnd && Date.now() < faultEnd) {
      await sleep(15_000);
      await tick("recover", name);
    }
  }
  if (redisPaused()) pauseRedis(false);

  lastControl = 0;
  const cStart = await sample("C-start-gc", { gc: true, heap: true });
  push({ s: cStart, w: wl.swap(), note: `heapObjects=${cStart.probe.heap?.objectCount}` });
  await runFor("steadyC", steadyC);

  await wl.stop();
  allBookings.push(...wl.swap().bookingsCreated);
  console.log("  workload stopped — cooldown");
  const cdEnd = Date.now() + cooldownMin * 60_000;
  while (Date.now() < cdEnd) {
    await sleep(30_000);
    push({ s: await sample("cooldown"), w: null });
  }
  const final = await sample("final-gc", { gc: true, heap: true });
  push({ s: final, w: null, note: `heapObjects=${final.probe.heap?.objectCount} topTypes=${JSON.stringify(final.probe.heap?.topTypes)}` });

  await Bun.write(`${LOG_DIR}/7k-series-${RUN_TAG}-pass${pass}.json`, JSON.stringify(rows.map((r) => ({ ...r, s: { ...r.s } })), null, 0));

  // ── analysis ──
  const A = rows.filter((r) => r.s.phase === "steadyA");
  const C = rows.filter((r) => r.s.phase === "steadyC");
  const cool = rows.filter((r) => r.s.phase === "cooldown");
  const coolEnd = cool.length ? cool[cool.length - 1]!.s : final;
  const series = (rs: Row[], f: (s: Sample) => number) => rs.map((r) => f(r.s));
  const report = (id: string, title: string, f: (s: Sample) => number, threshold: number, unit: string) => {
    const c = classify(series(A, f), f(idle), f(coolEnd), threshold);
    const cMeans = series(C, f);
    const cMean = cMeans.length ? cMeans.reduce((a, b) => a + b, 0) / cMeans.length : NaN;
    const bad = c.verdict.startsWith("D") || c.verdict.startsWith("E");
    record(id, `${title} — ${c.verdict}`, bad ? "FAIL" : c.verdict.startsWith("F") ? "NOT_PROVEN" : "PASS",
      `${c.detail} (${unit}); steady C mean=${Math.round(cMean * 10) / 10} after the fault segment`);
  };

  report(`P${pass}.rss`, "RSS", (s) => mb(s.probe.memory.rss), 60, "MB");
  report(`P${pass}.heap`, "heap used (natural, sawtooth expected)", (s) => mb(s.probe.memory.heapUsed), 60, "MB");
  report(`P${pass}.ext`, "external + array-buffer memory", (s) => mb(s.probe.memory.external + s.probe.memory.arrayBuffers), 30, "MB");
  report(`P${pass}.handles`, "OS handles", (s) => s.win.handles, 80, "handles");
  report(`P${pass}.threads`, "OS threads", (s) => s.win.threads ?? NaN, 8, "threads");
  report(`P${pass}.intervals`, "live JS intervals", (s) => s.probe.timers.liveIntervals, 3, "timers");
  report(`P${pass}.timeouts`, "live JS timeouts", (s) => s.probe.timers.liveTimeouts, 60, "timers");
  report(`P${pass}.hb`, "heartbeat intervals", (s) => s.probe.app.heartbeatIntervals, 40, "intervals");
  report(`P${pass}.conn`, "WebSocket connection registry", (s) => s.probe.app.connectionMap, 40, "connections");
  report(`P${pass}.rooms`, "room registry", (s) => s.probe.app.rooms, 40, "rooms");
  report(`P${pass}.db`, "server Postgres sessions", (s) => s.db.total, 3, "sessions");
  report(`P${pass}.redis`, "server Redis clients", (s) => s.redis?.serverClients ?? NaN, 1, "clients");
  report(`P${pass}.est`, "server ESTABLISHED sockets", (s) => s.sock.byState.ESTABLISHED ?? 0, 60, "sockets");
  report(`P${pass}.lag`, "event-loop lag p99", (s) => s.probe.eventLoopLagMs.p99, 40, "ms");

  // Forced-GC heap at the four segment boundaries: the controlled comparison for retained memory.
  const gcHeap = [idle, aStart, aEnd, cStart, final].map((s) => ({ phase: s.phase, heapMb: mb(s.probe.memory.heapUsed), objects: s.probe.heap?.objectCount ?? 0 }));
  const retained = gcHeap[4]!.heapMb - gcHeap[0]!.heapMb;
  record(`P${pass}.gc`, "retained heap after forced GC returns to the idle envelope", Math.abs(retained) <= 25 ? "PASS" : "FAIL",
    `post-GC heap at segment boundaries: ${JSON.stringify(gcHeap)}; final − idle = ${retained}MB. Forced GC is used only at these ` +
      `five boundaries, so the natural sawtooth between them is left intact.`);

  // Registries identified by shape.
  const regs = (s: Sample) => JSON.stringify(s.probe.registries);
  record(`P${pass}.regs`, "module-private registries after the soak", "INFO", `idle ${regs(idle)} → final ${regs(final)}`);

  // Listeners and timers by site must be where they started.
  const sitesIdle = idle.probe.timers.intervalsBySite;
  const sitesFinal = final.probe.timers.intervalsBySite;
  const siteDrift = Object.keys({ ...sitesIdle, ...sitesFinal }).filter((k) => !k.includes("distributed-scheduler") && (sitesIdle[k] ?? 0) !== (sitesFinal[k] ?? 0));
  record(`P${pass}.workers`, "NO WORKER OR SCHEDULER DUPLICATION — every interval site holds the same count after the soak", siteDrift.length === 0 ? "PASS" : "FAIL",
    `interval sites whose count changed (leader-lock renewals excluded as they exist only while a lock is held): ${siteDrift.length ? JSON.stringify(siteDrift.map((k) => [k, sitesIdle[k] ?? 0, sitesFinal[k] ?? 0])) : "none"}; ` +
      `outbox processors ${sitesFinal["src/events/core/outbox-processor.ts:231"] ?? 0}, job processors ${sitesFinal["src/events/core/job-processor.ts:202"] ?? 0}, ` +
      `maintenance timers ${Object.keys(sitesFinal).filter((k) => k.includes("maintenance")).length}`);
  record(`P${pass}.listeners`, "process listeners do not accumulate", JSON.stringify(idle.probe.processListeners) === JSON.stringify(final.probe.processListeners) ? "PASS" : "FAIL",
    `idle ${JSON.stringify(idle.probe.processListeners)} → final ${JSON.stringify(final.probe.processListeners)}`);

  // Cooldown end state.
  record(`P${pass}.cool`, "after cooldown the per-connection state is back to zero", final.probe.app.connectionMap === 0 && final.probe.app.heartbeatIntervals === 0 && final.probe.app.roomMemberships === 0 ? "PASS" : "FAIL",
    `connections ${final.probe.app.connectionMap}, heartbeat intervals ${final.probe.app.heartbeatIntervals}, room memberships ${final.probe.app.roomMemberships}, ` +
      `rooms ${final.probe.app.rooms}, idle-in-transaction ${final.db.idleInTx}, advisory locks ${final.db.advisoryLocks}, CLOSE_WAIT ${final.sock.closeWait}, ` +
      `Redis subscribers ${final.redis?.serverSubscribers ?? "UNREACHABLE"}, fan-out subs on the instance ${final.redis?.fanoutSubs ?? "UNREACHABLE"}`);

  // Delivery, client counted.
  const allW = rows.filter((r) => r.w).map((r) => r.w!);
  const deliveredA = A.reduce((a, r) => a + (r.w?.delivered ?? 0), 0);
  const expectedA = A.reduce((a, r) => a + (r.w ? r.w.delivered + r.w.missed : 0), 0);
  const deliveredC = C.reduce((a, r) => a + (r.w?.delivered ?? 0), 0);
  const expectedC = C.reduce((a, r) => a + (r.w ? r.w.delivered + r.w.missed : 0), 0);
  record(`P${pass}.deliv`, "client-counted realtime delivery holds in steady state before and after the faults",
    expectedA > 0 && deliveredA === expectedA && expectedC > 0 && deliveredC === expectedC ? "PASS" : expectedA === 0 ? "NOT_PROVEN" : "FAIL",
    `steady A ${deliveredA}/${expectedA}, steady C ${deliveredC}/${expectedC} cancellation frames received by the subscribed client after the cancel; ` +
      `whole run ${allW.reduce((a, w) => a + w.delivered, 0)}/${allW.reduce((a, w) => a + w.delivered + w.missed, 0)}`);

  // Latency drift (control bursts).
  const ctrls = rows.filter((r) => r.ctrl).map((r) => ({ phase: r.s.phase, p50: Math.round(r.ctrl!.p50), p95: Math.round(r.ctrl!.p95), p99: Math.round(r.ctrl!.p99), rps: r.ctrl!.rps, db: r.dbRttMs, redis: r.redisRttMs }));
  record(`P${pass}.drift`, "latency drift across fixed control bursts", "INFO", JSON.stringify(ctrls));

  // CPU drift: CPU seconds consumed per 15s window during steady A, first vs last quarter.
  const cpu = A.map((r, i) => (i === 0 ? null : (r.s.probe.cpuMicros.user + r.s.probe.cpuMicros.system - A[i - 1]!.s.probe.cpuMicros.user - A[i - 1]!.s.probe.cpuMicros.system) / 1e6)).filter((x): x is number => x !== null);
  const qlen = Math.max(1, Math.floor(cpu.length / 4));
  const cpuFirst = cpu.slice(0, qlen).reduce((a, b) => a + b, 0) / qlen;
  const cpuLast = cpu.slice(-qlen).reduce((a, b) => a + b, 0) / qlen;
  const reqA = A.map((r) => Object.values(r.w?.ops ?? {}).reduce((a, o) => a + o.n, 0));
  const reqFirst = reqA.slice(0, qlen).reduce((a, b) => a + b, 0) / qlen;
  const reqLast = reqA.slice(-qlen).reduce((a, b) => a + b, 0) / qlen;
  const perReqFirst = cpuFirst / Math.max(1, reqFirst);
  const perReqLast = cpuLast / Math.max(1, reqLast);
  record(`P${pass}.cpu`, "CPU cost per request does not drift upward under equivalent workload",
    perReqLast <= perReqFirst * 1.5 ? "PASS" : "FAIL",
    `CPU-seconds per 15s window: first quarter ${cpuFirst.toFixed(2)}, last quarter ${cpuLast.toFixed(2)}; requests per window ` +
      `${reqFirst.toFixed(0)} → ${reqLast.toFixed(0)}; CPU per request ${(perReqFirst * 1000).toFixed(2)}ms → ${(perReqLast * 1000).toFixed(2)}ms`);

  // Throughput and errors.
  const totals = allW.reduce((acc, w) => {
    for (const [k, o] of Object.entries(w.ops)) {
      const t = (acc[k] ??= { n: 0, ok: 0, e: 0, r429: 0, s4xx: 0 });
      t.n += o.n;
      t.ok += o.ok;
      t.e += o.s5xx + o.net;
      t.r429 += o.s429;
      t.s4xx += o.s4xx;
    }
    return acc;
  }, {} as Record<string, { n: number; ok: number; e: number; r429: number; s4xx: number }>);
  record(`P${pass}.work`, "workload actually ran (positive control for everything above)", Object.values(totals).reduce((a, t) => a + t.ok, 0) > 1000 ? "PASS" : "FAIL",
    `per operation ${JSON.stringify(totals)}; booking cycles ${allW.reduce((a, w) => a + w.cycles, 0)}; WebSockets opened ${allW.reduce((a, w) => a + w.wsOpened, 0)}, ` +
      `failed ${allW.reduce((a, w) => a + w.wsFailed, 0)}, closed cleanly ${allW.reduce((a, w) => a + w.wsCleanClose, 0)}, dropped ungracefully ${allW.reduce((a, w) => a + w.wsAbort, 0)}`);

  // Outbox: this run's events only.
  const ob = (await prisma.$queryRawUnsafe(
    `SELECT status, count(*)::int AS n, max(attempts)::int AS maxAttempts FROM event_outbox WHERE aggregate_id = ANY($1::text[]) GROUP BY status`,
    allBookings,
  )) as Array<{ status: string; n: number; maxattempts: number }>;
  const stuck = ob.filter((r) => r.status === "PROCESSING" || r.status === "PENDING").reduce((a, r) => a + r.n, 0);
  record(`P${pass}.outbox`, "this run's events drained — nothing left PENDING or PROCESSING after cooldown", stuck === 0 && ob.length > 0 ? "PASS" : ob.length === 0 ? "NOT_PROVEN" : "FAIL",
    `events for ${allBookings.length} soak bookings by status: ${JSON.stringify(ob)}`);
  const sj = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM scheduled_jobs WHERE status = 'running'`)) as Array<{ n: number }>;
  record(`P${pass}.jobs`, "no scheduled job left running", (sj[0]?.n ?? 0) === 0 ? "PASS" : "FAIL", `scheduled_jobs running: ${sj[0]?.n ?? 0}`);

  // Isolation over the whole run.
  const extSeen = rows.filter((r) => Object.keys(r.s.sock.external).length > 0).map((r) => r.s.sock.external);
  const egressTotal = Object.entries(final.probe.egressRefused);
  record(`P${pass}.iso`, "ISOLATION HELD FOR THE WHOLE RUN — no external socket in any sample", extSeen.length === 0 ? "PASS" : "FAIL",
    `samples with an external ESTABLISHED socket: ${extSeen.length}; outbound attempts refused by the harness over the whole run: ${JSON.stringify(egressTotal)}`);

  // Business safety.
  const moneyAfter = await money();
  record(`P${pass}.money`, "THE SOAK CREATED NO FINANCIAL TRUTH",
    moneyAfter.walletTxnsForSoakUsers === moneyBefore.walletTxnsForSoakUsers && moneyAfter.soakUserBalancePaise === moneyBefore.soakUserBalancePaise &&
      moneyAfter.paymentsForSoakBookings === 0 && moneyAfter.unbalanced === 0 ? "PASS" : "FAIL",
    `before ${JSON.stringify(moneyBefore)} → after ${JSON.stringify(moneyAfter)}. Journals may change only through the server's own ` +
      `maintenance (reconciliation/backfill); the soak users' wallet transactions and balances must not move and no payment may exist.`);

  stopServer();
  await sleep(4000);
  const post = await redisView();
  const dbPost = await dbView(currentAppName);
  record(`P${pass}.release`, "stopping the soak server releases every Redis client and Postgres session", post?.serverClients === 0 && dbPost.total === 0 ? "PASS" : "FAIL",
    `Redis clients other than the observer: ${post?.serverClients ?? "UNREACHABLE"}; Postgres sessions under ${currentAppName}: ${dbPost.total}`);
  const cleaned = await sweep7k();
  console.log(`  swept ${cleaned} soak booking(s)`);
}

// ══ EXPERIMENTS ══════════════════════════════════════════════════════════════════════════════════

/** Distinct anonymous clients, each making one request. */
async function distinctClients(prefix: string, n: number, path: string, concurrency = 64): Promise<{ ok: number; r429: number; other: number; ms: number }> {
  let i = 0;
  let ok = 0;
  let r429 = 0;
  let other = 0;
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < n) {
        const k = i++;
        const ip = `${prefix}.${Math.floor(k / 250) % 250}.${k % 250}`;
        const res = await fetch(`${BASE}${path}`, { headers: { "x-forwarded-for": ip }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
        if (res?.status === 200) ok++;
        else if (res?.status === 429) r429++;
        else other++;
        await res?.arrayBuffer().catch(() => null);
      }
    }),
  );
  return { ok, r429, other, ms: Date.now() - t0 };
}

function regSize(s: Sample, name: string): number | null {
  const r = s.probe.registries[name];
  return r && r !== "not-yet-identified" ? r.size : null;
}

async function waitRedisAvailable(want: boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const p = await probeSnap().catch(() => null);
    if (p && p.app.redisAvailable === want) return true;
    await sleep(1000);
  }
  return false;
}

/**
 * E1 — the rate-limit fallback store across Redis outages.
 *
 * `consumeRateLimit` keeps one entry per client key in a module Map and never removes an expired
 * one: an entry is only overwritten if the same key returns. When Redis is up the Map is not used at
 * all. So the hypothesis is precise — every distinct client seen during an outage stays in memory for
 * the life of the process, and repeated outages add up.
 *
 * The control runs the same volume of distinct clients with Redis healthy first. Store size is read
 * directly from the probe; heap is compared after forced GC at matching points.
 */
async function expRateLimitStore(): Promise<void> {
  console.log("\n── E1 · rate-limit fallback store across repeated Redis outages ──");
  const N = Number(arg("clients", "30000"));
  await startServer("ratelimit", { REDIS_HEALTH_CHECK_INTERVAL: "2000" });
  const s0 = await sample("rl-idle", { gc: true });

  const ctl = await distinctClients("10.51", N, "/api/services");
  const s1 = await sample("rl-control", { gc: true });
  record("E1.0", "control: with Redis healthy the fallback store is not used at all",
    regSize(s1, "rateLimitFallbackStore") === null || regSize(s1, "rateLimitFallbackStore") === 0 ? "PASS" : "FAIL",
    `${N} distinct clients with Redis up (${JSON.stringify(ctl)}); store: ${JSON.stringify(s1.probe.registries.rateLimitFallbackStore)}; ` +
      `post-GC heap ${mb(s0.probe.memory.heapUsed)} → ${mb(s1.probe.memory.heapUsed)}MB`);

  const outage = async (label: string, prefix: string) => {
    const stopped = stopRedis();
    const noticed = await waitRedisAvailable(false, 30_000);
    const load = await distinctClients(prefix, N, "/api/services");
    const during = await sample(`${label}-during`);
    const started = await startRedis();
    const back = await waitRedisAvailable(true, 60_000);
    /** Past every 60-second window: each entry written during the outage is now semantically dead. */
    await sleep(75_000);
    /**
     * A trickle of ordinary traffic, as any live server has. Pruning is driven by the request path
     * rather than a timer, so an entirely idle server would keep the dead entries until its next
     * request — this is what production traffic looks like after an outage, not a way to force a pass.
     */
    await distinctClients(`${prefix}9`, 50, "/api/services", 5);
    await sleep(1000);
    const after = await sample(`${label}-after`, { gc: true });
    return { stopped, noticed, started, back, load, during, after };
  };

  const o1 = await outage("rl-o1", "10.52");
  const o2 = await outage("rl-o2", "10.53");
  /** And it is not pruned by anything else given more time. */
  await sleep(120_000);
  const late = await sample("rl-late", { gc: true, heap: true });

  const z = (x: Sample) => regSize(x, "rateLimitFallbackStore") ?? 0;
  record("E1.1", "the outage really happened, and the server really noticed it and recovered",
    o1.stopped && o1.noticed && o1.started && o1.back && o2.stopped && o2.noticed && o2.started && o2.back ? "PASS" : "FAIL",
    `outage 1 stop=${o1.stopped} noticed=${o1.noticed} restart=${o1.started} recovered=${o1.back}; outage 2 stop=${o2.stopped} noticed=${o2.noticed} restart=${o2.started} recovered=${o2.back}`);

  const grew1 = z(o1.after);
  const grew2 = z(o2.after);
  const leak = grew1 >= N * 0.95 && grew2 >= grew1 + N * 0.95 && z(late) >= grew2;
  const reclaimed = grew1 <= N * 0.01 && grew2 <= N * 0.01;
  record("E1.2", leak ? "RATE-LIMIT FALLBACK STORE RETAINS EVERY OUTAGE CLIENT FOREVER — monotonic across outages"
      : reclaimed ? "THE FALLBACK STORE RELEASES WHAT EACH OUTAGE LEFT BEHIND — no growth across outages" : "rate-limit fallback store after outages",
    reclaimed ? "PASS" : "FAIL",
    `${N} distinct clients per outage. Store size: during outage 1 ${z(o1.during)}, after recovery + 75s ${grew1}; ` +
      `during outage 2 ${z(o2.during)}, after recovery + 75s ${grew2}; 120s later ${z(late)}. ` +
      `Post-GC heap: idle ${mb(s0.probe.memory.heapUsed)}MB, control ${mb(s1.probe.memory.heapUsed)}MB, after outage 1 ${mb(o1.after.probe.memory.heapUsed)}MB, ` +
      `after outage 2 ${mb(o2.after.probe.memory.heapUsed)}MB, late ${mb(late.probe.memory.heapUsed)}MB. Every retained entry has resetAt in the past, ` +
      `which the limiter itself treats as absent, and with Redis back the Map is never consulted again — the entries carry no information.`);
  record("E1.3", "load during the outage was served (the limiter failed over rather than failing closed)", "INFO",
    `outage 1 ${JSON.stringify(o1.load)}; outage 2 ${JSON.stringify(o2.load)}`);
  stopServer();
}

/**
 * E2 — the cache service's in-memory store under distinct keys during an outage.
 * Same shape of hypothesis as E1, for `cacheService.memStore`, whose keys embed query parameters.
 */
async function expCacheMemStore(): Promise<void> {
  console.log("\n── E2 · cache memStore under distinct keys during a Redis outage ──");
  const pages = Number(arg("pages", "7000"));
  await startServer("memstore", { REDIS_HEALTH_CHECK_INTERVAL: "2000" });
  const cats = (await prisma.$queryRawUnsafe(`SELECT DISTINCT category FROM services WHERE is_active = true LIMIT 1`)) as Array<{ category: string }>;
  const category = cats[0]?.category ?? "cleaning";
  const s0 = await sample("ms-idle", { gc: true });
  stopRedis();
  await waitRedisAvailable(false, 30_000);
  let ok = 0;
  let other = 0;
  let i = 0;
  await Promise.all(Array.from({ length: 32 }, async () => {
    while (i < pages) {
      const k = ++i;
      const res = await fetch(`${BASE}/api/services/category/${encodeURIComponent(category)}?page=${k}&limit=10`, {
        headers: { "x-forwarded-for": `10.61.${Math.floor(k / 250) % 250}.${k % 250}` },
        signal: AbortSignal.timeout(30_000),
      }).catch(() => null);
      if (res?.ok) ok++;
      else other++;
      await res?.arrayBuffer().catch(() => null);
    }
  }));
  const during = await sample("ms-during");
  await startRedis();
  await waitRedisAvailable(true, 60_000);
  /**
   * Past the catalog category TTL (300s). A first version read the store at 90s and "failed" on
   * entries that were still valid cache — retaining a live cache entry is the cache doing its job,
   * not a leak. Only entries past their TTL are the question.
   */
  await sleep(330_000);
  /** Ordinary catalog traffic after recovery; the sweep runs on the read path. */
  await distinctClients("10.62", 30, "/api/services", 3);
  await sleep(1000);
  const after = await sample("ms-after", { gc: true });
  const sz = (x: Sample) => regSize(x, "cacheServiceMemStore") ?? 0;
  const retained = sz(after);
  record("E2.0", "the in-memory cache is capped even while an outage keeps adding distinct keys",
    sz(during) <= 5000 ? "PASS" : "FAIL",
    `${pages} distinct pages during the outage; memStore size at the end of the burst: ${sz(during)} (cap 5,000, oldest 10% dropped when exceeded)`);
  record("E2.1", retained >= pages * 0.9 ? "CACHE memStore RETAINS EVERY DISTINCT KEY SEEN DURING AN OUTAGE" : "cache memStore releases what an outage left behind",
    retained <= 50 ? "PASS" : "FAIL",
    `${pages} distinct category pages requested with Redis down (${ok} ok, ${other} other). memStore size during ${sz(during)}, ` +
      `after recovery + 330s (past the 300s TTL) ${retained}. Post-GC heap ${mb(s0.probe.memory.heapUsed)} → ${mb(after.probe.memory.heapUsed)}MB. ` +
      `Store identification: ${JSON.stringify(after.probe.registries.cacheServiceMemStore)}`);
  stopServer();
}

/** §9/§10/§14 — connection and subscription churn, with client-side and server-side evidence. */
async function expWsChurn(): Promise<void> {
  console.log("\n── E3 · WebSocket connect/subscribe/receive/unsubscribe churn ──");
  const cycles = Number(arg("cycles", "2000"));
  await startServer("wschurn");
  await ensureFixtures();
  const s0 = await sample("ws-idle", { gc: true, heap: true });
  let opened = 0;
  let failed = 0;
  let welcomed = 0;
  let aborted = 0;
  let i = 0;
  const peak = { conn: 0, hb: 0 };
  const watcher = (async () => {
    while (i < cycles) {
      const p = await probeSnap().catch(() => null);
      if (p) {
        peak.conn = Math.max(peak.conn, p.app.connectionMap);
        peak.hb = Math.max(peak.hb, p.app.heartbeatIntervals);
      }
      await sleep(500);
    }
  })();
  const r = rng(SEED + 7);
  await Promise.all(Array.from({ length: 24 }, async (_, v) => {
    const u = users[v % users.length]!;
    while (i < cycles) {
      i++;
      const ws = new WsProbe(`${WS_BASE}/ws/notifications?token=${encodeURIComponent(u.token)}`);
      if (await ws.open()) opened++;
      else failed++;
      await sleep(50 + Math.floor(r() * 250));
      if (ws.frames.length > 0) welcomed++;
      if (r() < 0.4) {
        ws.abort();
        aborted++;
      } else ws.close();
      await sleep(20);
    }
  }));
  await watcher;
  const settle = Date.now();
  let s1 = await sample("ws-after");
  while (Date.now() - settle < 60_000 && (s1.probe.app.connectionMap > 0 || s1.probe.app.heartbeatIntervals > 0)) {
    await sleep(3000);
    s1 = await sample("ws-after");
  }
  const s2 = await sample("ws-final", { gc: true, heap: true });
  record("E3.1", "THE CONNECTION AND SUBSCRIPTION REGISTRIES RETURN TO ZERO AFTER CHURN",
    s2.probe.app.connectionMap === 0 && s2.probe.app.roomMemberships === 0 && s2.probe.app.userMemberships === 0 && s2.probe.app.heartbeatIntervals === 0 ? "PASS" : "FAIL",
    `${cycles} cycles (${opened} opened, ${failed} failed, ${welcomed} received a server frame before leaving, ${aborted} dropped without a close frame); ` +
      `server peak connections ${peak.conn}, peak heartbeat intervals ${peak.hb}; after: connections ${s2.probe.app.connectionMap}, rooms ${s2.probe.app.rooms}, ` +
      `room memberships ${s2.probe.app.roomMemberships}, user memberships ${s2.probe.app.userMemberships}, heartbeat intervals ${s2.probe.app.heartbeatIntervals} ` +
      `(settled in ${Date.now() - settle}ms)`);
  record("E3.2", "sockets, handles and memory return to the idle envelope after churn",
    s2.sock.closeWait === 0 && s2.win.handles - s0.win.handles < 80 && mb(s2.probe.memory.heapUsed) - mb(s0.probe.memory.heapUsed) < 25 ? "PASS" : "FAIL",
    `handles ${s0.win.handles} → ${s2.win.handles}; ESTABLISHED ${s0.sock.byState.ESTABLISHED ?? 0} → ${s2.sock.byState.ESTABLISHED ?? 0}; CLOSE_WAIT ${s2.sock.closeWait}; ` +
      `TIME_WAIT to the server ${s2.sock.timeWaitToServer} (teardown, not held); post-GC heap ${mb(s0.probe.memory.heapUsed)} → ${mb(s2.probe.memory.heapUsed)}MB; ` +
      `heap objects ${s0.probe.heap?.objectCount} → ${s2.probe.heap?.objectCount}; live timeouts ${s0.probe.timers.liveTimeouts} → ${s2.probe.timers.liveTimeouts}`);
  record("E3.3", "Redis subscriptions do not multiply with client churn",
    (s2.redis?.serverSubscribers ?? -1) === (s0.redis?.serverSubscribers ?? -2) && (s2.redis?.fanoutSubs ?? -1) === (s0.redis?.fanoutSubs ?? -2) ? "PASS" : "FAIL",
    `server subscriber connections ${s0.redis?.serverSubscribers} → ${s2.redis?.serverSubscribers}; ws:fanout subscribers ${s0.redis?.fanoutSubs} → ${s2.redis?.fanoutSubs}`);
  stopServer();
}

/** §21 — repeated start → ready → work → SIGKILL → verify release → restart. */
async function expRestartSoak(): Promise<void> {
  console.log("\n── E4 · process restart soak ──");
  const cyclesN = Number(arg("restarts", "6"));
  const rowsR: Array<Record<string, unknown>> = [];
  for (let c = 1; c <= cyclesN; c++) {
    const srv = await startServer(`restart${c}`);
    if (c === 1) await ensureFixtures();
    else for (const u of users) u.tokenAt = 0;
    const ready = await sample(`r${c}-ready`);
    const wl = startWorkload({ base: BASE, wsBase: WS_BASE, users, serviceId, publicVus: 2, runTag: RUN_TAG, seed: SEED + c, authPaceMs: 1500, publicPaceMs: 500 });
    await sleep(60_000);
    const busy = await sample(`r${c}-busy`);
    const w = wl.swap();
    /** Kill while the workload is still running, so the process dies with work in flight. */
    const app = currentAppName;
    const killed = await killHard();
    await wl.stop();
    await sleep(4000);
    const redisAfter = await redisView();
    const dbAfter = await dbView(app);
    const portFree = listenerPidOn(PORT) === null && listenerPidOn(PROBE_PORT) === null;
    rowsR.push({
      cycle: c,
      pid: srv.pid,
      readyRssMb: mb(ready.probe.memory.rss),
      readyHandles: ready.win.handles,
      readyThreads: ready.win.threads ?? "UNMEASURED",
      readyIntervals: ready.probe.timers.liveIntervals,
      readyDb: ready.db.total,
      readyRedis: ready.redis?.serverClients,
      busyConn: busy.probe.app.connectionMap,
      requests: Object.values(w.ops).reduce((a, o) => a + o.n, 0),
      killedGoneMs: killed.gone ? killed.ms : -1,
      redisAfterKill: redisAfter?.serverClients,
      dbAfterKill: dbAfter.total,
      fanoutAfterKill: redisAfter?.fanoutSubs,
      portFree,
    });
    console.log(`  cycle ${c}: ${JSON.stringify(rowsR[rowsR.length - 1])}`);
  }
  const allReleased = rowsR.every((r) => r.redisAfterKill === 0 && r.dbAfterKill === 0 && r.fanoutAfterKill === 0 && r.portFree === true && (r.killedGoneMs as number) >= 0);
  record("E4.1", "EVERY KILLED INCARNATION RELEASED ALL EXTERNAL RESOURCES — nothing accumulates cycle after cycle", allReleased ? "PASS" : "FAIL",
    `per cycle: ${JSON.stringify(rowsR.map((r) => ({ c: r.cycle, redis: r.redisAfterKill, db: r.dbAfterKill, fanout: r.fanoutAfterKill, port: r.portFree, goneMs: r.killedGoneMs })))}`);
  const first = rowsR[0]!;
  const last = rowsR[rowsR.length - 1]!;
  const drift = ["readyRssMb", "readyHandles", "readyThreads", "readyIntervals", "readyDb", "readyRedis"].map((k) => [k, first[k], last[k]]);
  const stableBoot = (last.readyIntervals === first.readyIntervals) && (last.readyRedis === first.readyRedis) && Math.abs((last.readyRssMb as number) - (first.readyRssMb as number)) < 80;
  record("E4.2", "each fresh incarnation boots into the same resource envelope", stableBoot ? "PASS" : "FAIL", `first → last: ${JSON.stringify(drift)}; all: ${JSON.stringify(rowsR)}`);
}

/**
 * §12 — the background-loop lifecycle, exercised inside a live process.
 * Destructive to that process's workers by design, so it runs on its own instance which is then killed.
 */
async function expLifecycle(): Promise<void> {
  console.log("\n── E5 · scheduler / outbox / job-processor lifecycle in-process ──");
  await startServer("lifecycle");
  const res = await fetch(`${PROBE}/lifecycle`, { method: "POST", signal: AbortSignal.timeout(60_000) });
  const body = (await res.json()) as { steps?: Array<{ step: string; census: { total: number; bySite: Record<string, number> } }>; error?: string };
  if (!res.ok || !body.steps) throw new Error(`7K: lifecycle probe failed: ${body.error ?? res.status}`);
  const t = (k: string) => body.steps!.find((x) => x.step === k)!.census.total;
  const maint = (k: string) => Object.entries(body.steps!.find((x) => x.step === k)!.census.bySite).filter(([s]) => s.includes("maintenance")).length;
  /**
   * Compared per call site, excluding `distributed-scheduler` lease renewals: those exist only while a
   * leader-locked job is running and come and go on their own, so counting them made a first version
   * of this check report a duplication that was two transient renewals.
   */
  const sites = (k: string) => Object.fromEntries(Object.entries(body.steps!.find((x) => x.step === k)!.census.bySite).filter(([site]) => !site.includes("distributed-scheduler")));
  const a = sites("initial");
  const b = sites("double-start while running");
  const changed = Object.keys({ ...a, ...b }).filter((k) => (a[k] ?? 0) !== (b[k] ?? 0)).map((k) => [k, a[k] ?? 0, b[k] ?? 0]);
  record("E5.1", "double-starting outbox, job processor and maintenance while running adds no timer at any site", changed.length === 0 ? "PASS" : "FAIL",
    `interval sites that changed on a second start of all three (lease renewals excluded): ${changed.length ? JSON.stringify(changed) : "none"}; ` +
      `raw totals ${t("initial")} → ${t("double-start while running")}`);
  record("E5.2", "stopMaintenance clears its timers, and a restart restores the same set exactly once",
    maint("stopMaintenance") === 0 && maint("startMaintenance after stop") === maint("initial") && maint("startMaintenance again (double)") === maint("initial") ? "PASS" : "FAIL",
    `maintenance interval sites: initial ${maint("initial")}, after stop ${maint("stopMaintenance")}, after restart ${maint("startMaintenance after stop")}, after a second start ${maint("startMaintenance again (double)")}; ` +
      `all steps ${JSON.stringify(body.steps.map((x) => ({ step: x.step, total: x.census.total })))}`);

  /**
   * After stop → start the processors' timers exist again, but `shuttingDown` was set by stop and
   * start never resets it, so every tick returns immediately. Production only ever stops at process
   * shutdown and only ever starts at boot, so this is measured and recorded, not called a defect.
   */
  const u = (await prisma.$queryRawUnsafe(`SELECT id FROM users WHERE email LIKE 's7k.u%' LIMIT 1`)) as Array<{ id: string }>;
  const eventId = crypto.randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO event_outbox (id, event_id, event_type, event_version, aggregate_type, aggregate_id, actor_type, actor_id, payload, status, attempts, available_at, created_at, updated_at)
     SELECT gen_random_uuid()::text, $1, o.event_type, o.event_version, o.aggregate_type, $2, o.actor_type, $3,
            jsonb_set(o.payload, '{id}', to_jsonb($1::text)), 'PENDING', 0, now(), now(), now()
       FROM event_outbox o WHERE o.event_type = 'homigo.booking.created' AND o.status = 'PUBLISHED' ORDER BY o.created_at DESC LIMIT 1`,
    eventId, `7k-lifecycle-${RUN_TAG}`, u[0]?.id ?? "none",
  );
  await sleep(20_000);
  const st = (await prisma.$queryRawUnsafe(`SELECT status, attempts FROM event_outbox WHERE event_id = $1`, eventId)) as Array<{ status: string; attempts: number }>;
  record("E5.3", "OBSERVED: an in-process stop → start leaves the outbox processor's timer running but inert", "INFO",
    `an event enqueued after the in-process restart, 20s later (4 ticks at the 5s interval): ${JSON.stringify(st)}. ` +
      `stopOutboxProcessor() sets shuttingDown = true and startOutboxProcessor() never resets it, so the restarted timer's ticks return ` +
      `immediately. No production path stops and restarts these loops inside one process — stop runs only in gracefulShutdown and start only ` +
      `at boot — so a restart always comes with fresh module state. Recorded as an observation about the lifecycle contract, not a defect.`);
  await prisma.$executeRawUnsafe(`DELETE FROM event_outbox WHERE event_id = $1`, eventId);
  stopServer();
}

/**
 * §18 — a safe recurring failure, and proof the retry loop is bounded and leaves nothing behind.
 * Run-tagged events with an envelope the platform rejects are enqueued; each must retry with backoff,
 * stop at the attempt ceiling, end FAILED, and leave no PROCESSING row and no extra timer.
 */
async function expRetryLoop(): Promise<void> {
  console.log("\n── E6 · bounded retry loop ──");
  await startServer("retry", { EVENTS_OUTBOX_INTERVAL_MS: "1000" });
  const s0 = await sample("retry-idle");
  const tag = `7k-retry-${RUN_TAG}`;
  const n = 20;
  for (let i = 0; i < n; i++) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO event_outbox (id, event_id, event_type, event_version, aggregate_type, aggregate_id, actor_type, actor_id, payload, status, attempts, available_at, created_at, updated_at)
       VALUES (gen_random_uuid()::text, gen_random_uuid()::text, 'homigo.booking.created', '1.0', 'booking', $1, 'system', 'system',
               '{"bad": true}'::jsonb, 'PENDING', 0, now(), now(), now())`,
      tag,
    );
  }
  const trail: Array<Record<string, unknown>> = [];
  const t0 = Date.now();
  let done = false;
  while (Date.now() - t0 < 12 * 60_000) {
    await sleep(15_000);
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT status, count(*)::int AS n, max(attempts)::int AS maxa, min(available_at) AS next FROM event_outbox WHERE aggregate_id = $1 GROUP BY status`,
      tag,
    )) as Array<{ status: string; n: number; maxa: number; next: Date }>;
    const sm = await sample("retry");
    trail.push({ tSec: Math.round((Date.now() - t0) / 1000), rows: rows.map((r) => ({ s: r.status, n: r.n, maxAttempts: r.maxa })), liveTimeouts: sm.probe.timers.liveTimeouts, intervals: sm.probe.timers.liveIntervals });
    if (rows.length === 1 && rows[0]!.status === "FAILED" && rows[0]!.n === n) {
      done = true;
      break;
    }
  }
  await sleep(20_000);
  const s1 = await sample("retry-after");
  const final = (await prisma.$queryRawUnsafe(`SELECT status, count(*)::int AS n, max(attempts)::int AS maxa FROM event_outbox WHERE aggregate_id = $1 GROUP BY status`, tag)) as Array<{ status: string; n: number; maxa: number }>;
  record("E6.1", "A RECURRING FAILURE IS RETRIED A BOUNDED NUMBER OF TIMES AND THEN STOPS", done ? "PASS" : "NOT_PROVEN",
    `${n} events the platform rejects: final ${JSON.stringify(final)} after ${Math.round((Date.now() - t0) / 1000)}s; trail ${JSON.stringify(trail)}`);
  record("E6.2", "the retry loop leaves no timer, PROCESSING row or growth behind once it ends",
    s1.probe.timers.liveIntervals === s0.probe.timers.liveIntervals && final.every((r) => r.status !== "PROCESSING") ? "PASS" : "FAIL",
    `intervals ${s0.probe.timers.liveIntervals} → ${s1.probe.timers.liveIntervals}; live timeouts ${s0.probe.timers.liveTimeouts} → ${s1.probe.timers.liveTimeouts}; ` +
      `heap ${mb(s0.probe.memory.heapUsed)} → ${mb(s1.probe.memory.heapUsed)}MB`);
  await prisma.$executeRawUnsafe(`DELETE FROM event_outbox WHERE aggregate_id = $1`, tag);
  stopServer();
}

/** Diagnostic: what the server and the machine do while Redis is down under distinct-client load. */
async function diagOutage(): Promise<void> {
  console.log("\n── DIAG · server behaviour during a Redis outage ──");
  await startServer("rldiag", { REDIS_HEALTH_CHECK_INTERVAL: "2000" });
  const machineCpu = () => {
    const r = spawnSync("typeperf", ["\Processor(_Total)\% Processor Time", "-sc", "1"], { encoding: "utf8", timeout: 15_000 });
    const m = (r.stdout ?? "").match(/"[^"]+","([\d.]+)"/);
    return m ? Math.round(Number(m[1])) : -1;
  };
  const probeCpu = async () => {
    const t0 = performance.now();
    const p = await probeSnap().catch(() => null);
    return { rttMs: Math.round(performance.now() - t0), cpu: p ? p.cpuMicros.user + p.cpuMicros.system : -1, lag: p?.eventLoopLagMs.p99 ?? -1, redisAvail: p?.app.redisAvailable, liveTimeouts: p?.timers.liveTimeouts ?? -1, store: p ? JSON.stringify(p.registries.rateLimitFallbackStore) : "?" };
  };
  console.log(`  before: machineCpu=${machineCpu()}% ${JSON.stringify(await probeCpu())}`);
  stopRedis();
  await waitRedisAvailable(false, 30_000);
  console.log(`  redis stopped: machineCpu=${machineCpu()}% ${JSON.stringify(await probeCpu())}`);
  let done = false;
  const load = distinctClients("10.54", 6000, "/api/services").then((r) => { done = true; return r; });
  let last = await probeCpu();
  const t0 = Date.now();
  while (!done && Date.now() - t0 < 180_000) {
    await sleep(5000);
    const now = await probeCpu();
    console.log(`  t+${Math.round((Date.now() - t0) / 1000)}s machineCpu=${machineCpu()}% serverCpuSec/5s=${((now.cpu - last.cpu) / 1e6).toFixed(2)} probeRtt=${now.rttMs}ms lagP99=${now.lag.toFixed(0)} redisAvail=${now.redisAvail} liveTimeouts=${now.liveTimeouts} store=${now.store}`);
    last = now;
  }
  console.log(`  load: ${JSON.stringify(await load)}`);
  await startRedis();
  await waitRedisAvailable(true, 60_000);
  console.log(`  recovered: machineCpu=${machineCpu()}% ${JSON.stringify(await probeCpu())}`);
  stopServer();
}

/** Diagnostic: an outage with NO load — CPU, timers and subscription recovery. */
async function diagIdleOutage(): Promise<void> {
  console.log("\n── DIAG · idle Redis outage ──");
  const outageSec = Number(arg("outage", "60"));
  await startServer("idleoutage", { REDIS_HEALTH_CHECK_INTERVAL: "5000" });
  await sleep(10_000);
  const snapCpu = async () => {
    const p = await probeSnap();
    const r = await redisView();
    return { cpu: p.cpuMicros.user + p.cpuMicros.system, avail: p.app.redisAvailable, to: p.timers.liveTimeouts, int: p.timers.liveIntervals, fanoutSubscribedFlag: p.app.fanoutSubscribed, subsArr: p.app.redisSubscribers, rClients: r?.serverClients ?? null, rSubs: r?.serverSubscribers ?? null, fanout: r?.fanoutSubs ?? null };
  };
  let prev = await snapCpu();
  for (let i = 0; i < 6; i++) {
    await sleep(5000);
    const n = await snapCpu();
    console.log(`  up    t+${(i + 1) * 5}s cpu/5s=${((n.cpu - prev.cpu) / 1e6).toFixed(2)}s ${JSON.stringify({ ...n, cpu: undefined })}`);
    prev = n;
  }
  stopRedis();
  for (let i = 0; i < outageSec / 5; i++) {
    await sleep(5000);
    const n = await snapCpu();
    console.log(`  DOWN  t+${(i + 1) * 5}s cpu/5s=${((n.cpu - prev.cpu) / 1e6).toFixed(2)}s ${JSON.stringify({ ...n, cpu: undefined })}`);
    prev = n;
  }
  await startRedis();
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    const n = await snapCpu();
    console.log(`  back  t+${(i + 1) * 5}s cpu/5s=${((n.cpu - prev.cpu) / 1e6).toFixed(2)}s ${JSON.stringify({ ...n, cpu: undefined })}`);
    prev = n;
  }
  const tail = (await Bun.file(`${LOG_DIR}/7k-server-idleoutage.log`).text()).split("\n").filter((l) => l.includes("[redis]") || l.toLowerCase().includes("fanout") || l.includes("ws_fanout")).slice(-12);
  console.log(`  server redis log lines:\n    ${tail.join("\n    ")}`);
  stopServer();
}

/**
 * E7 — recovery after a HARD Redis outage (connection refused, not a freeze).
 *
 * The client's reconnect strategy gives up after REDIS_MAX_RETRIES attempts (10 in `.env`, about 11
 * seconds of backoff in total). 7C exercised a frozen Redis, where the socket stays open and no
 * reconnect is needed; a stopped Redis closes the socket and the strategy runs. The question: does the
 * server come back once Redis does, if the outage outlasted the retry budget?
 *
 * A short outage inside the budget is the control. Each is followed by a long observation window so
 * "recovers slowly" cannot be mistaken for "never recovers".
 */
async function expRedisRecovery(): Promise<void> {
  console.log("\n── E7 · recovery after a hard Redis outage ──");
  const longSec = Number(arg("outage", "40"));
  const watchSec = Number(arg("watch", "180"));
  const state = async () => {
    const p = await probeSnap();
    const r = await redisView();
    return { avail: p.app.redisAvailable, flag: p.app.fanoutSubscribed, subsArr: p.app.redisSubscribers, clients: r?.serverClients ?? null, subs: r?.serverSubscribers ?? null, fanout: r?.fanoutSubs ?? null, store: regSize({ probe: p } as Sample, "rateLimitFallbackStore") };
  };
  const run = async (label: string, outageSec: number) => {
    await startServer(`recovery-${label}`);
    await sleep(8000);
    const before = await state();
    const stopped = stopRedis();
    await sleep(outageSec * 1000);
    const started = await startRedis();
    const t0 = Date.now();
    let recoveredAfter: number | null = null;
    let last = await state();
    while (Date.now() - t0 < watchSec * 1000) {
      await sleep(5000);
      last = await state();
      if (recoveredAfter === null && last.avail && last.fanout === 1 && last.clients === before.clients) recoveredAfter = Date.now() - t0;
      if (recoveredAfter !== null) break;
    }
    /** A consequence that matters for 7K: while the server believes Redis is down, every new client is written into the never-evicted fallback store. */
    const clients = await distinctClients(`10.7${label === "short" ? 1 : 2}`, 2000, "/api/services");
    const after = await state();
    const snap = await probeSnap();
    const storeNow = snap.registries.rateLimitFallbackStore;
    stopServer();
    return { outageSec, stopped, started, before, last, recoveredAfter, clients, storeNow, after };
  };
  const short = await run("short", 5);
  console.log(`  short: ${JSON.stringify(short)}`);
  const long = await run("long", longSec);
  console.log(`  long : ${JSON.stringify(long)}`);

  record("E7.0", "control: an outage inside the retry budget recovers fully",
    short.recoveredAfter !== null ? "PASS" : "FAIL",
    `5s hard outage (stop verified=${short.stopped}, restart+healthy=${short.started}): recovered ${short.recoveredAfter === null ? "NEVER within " + watchSec + "s" : "after " + short.recoveredAfter + "ms"}; ` +
      `before ${JSON.stringify(short.before)} → ${JSON.stringify(short.last)}`);
  const permanent = long.recoveredAfter === null;
  record("E7.1", permanent
      ? "A HARD REDIS OUTAGE LONGER THAN THE RETRY BUDGET LEAVES THE SERVER PERMANENTLY ON THE FALLBACK"
      : "a hard outage longer than the retry budget recovers",
    permanent ? "FAIL" : "PASS",
    `${longSec}s hard outage (stop verified=${long.stopped}, restart+healthy=${long.started}); watched ${watchSec}s after Redis was healthy again. ` +
      `before: ${JSON.stringify(long.before)}; at the end of the watch: ${JSON.stringify(long.last)}. ` +
      `The server's own flag says fan-out is subscribed=${long.last.flag} while the instance shows ws:fanout subscribers=${long.last.fanout} ` +
      `and server Redis clients=${long.last.clients}.`);
  record("E7.2", "consequence: with Redis back but unused, new clients keep landing in the never-evicted fallback store",
    permanent && typeof long.storeNow === "object" && (long.storeNow as { size: number }).size >= 1900 ? "FAIL" : "INFO",
    `2,000 new distinct clients after Redis had recovered: short-outage server store ${JSON.stringify(short.storeNow)}; ` +
      `long-outage server store ${JSON.stringify(long.storeNow)}. requests ${JSON.stringify(long.clients)}`);
}

/** Diagnostic: why the server stays busy after load during a Redis outage. */
async function diagBusyAfterOutage(): Promise<void> {
  console.log("\n── DIAG · post-load busyness during a Redis outage ──");
  const n = Number(arg("clients", "15000"));
  await startServer("busy");
  await sleep(8000);
  const logs = async () => ((await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM app_log_entries`)) as Array<{ n: number }>)[0]!.n;
  const cpu = async () => { const p = await probeSnap(); return { c: p.cpuMicros.user + p.cpuMicros.system, lag: p.eventLoopLagMs.p99, to: p.timers.liveTimeouts, eg: Object.values(p.egressRefused).reduce((a, b) => a + b, 0), heap: mb(p.memory.heapUsed), rss: mb(p.memory.rss) }; };
  const phase = async (label: string, secs: number, fire?: () => Promise<unknown>) => {
    const l0 = await logs();
    let prev = await cpu();
    const f = fire ? fire() : null;
    const t0 = Date.now();
    while (Date.now() - t0 < secs * 1000) {
      await sleep(5000);
      const now = await cpu();
      console.log(`  ${label} t+${Math.round((Date.now() - t0) / 1000)}s cpu/5s=${((now.c - prev.c) / 1e6).toFixed(2)} lagP99=${now.lag.toFixed(0)} liveTimeouts=${now.to} egressRefusedTotal=${now.eg} heap=${now.heap} rss=${now.rss} appLogs+${(await logs()) - l0}`);
      prev = now;
    }
    if (f) console.log(`  ${label} load: ${JSON.stringify(await f)}`);
  };
  await phase("UP-load", 30, () => distinctClients("10.81", n, "/api/services"));
  await phase("UP-idle", 30);
  stopRedis();
  await waitRedisAvailable(false, 30_000);
  await phase("DOWN-load", 45, () => distinctClients("10.82", n, "/api/services"));
  await phase("DOWN-idle", 60);
  await startRedis();
  stopServer();
}

/** Diagnostic: OS thread/handle counts and query latency around an outage under load. */
async function diagThreads(): Promise<void> {
  console.log("\n── DIAG · threads and handles during a Redis outage under load ──");
  const srv = await startServer("threads");
  const q = (label: string) => {
    const t0 = Date.now();
    const r = spawnSync("powershell", ["-NoProfile", "-Command",
      `$x = Get-CimInstance Win32_Process -Filter "ProcessId=${srv.pid}"; $h = Get-CimInstance Win32_Process -Filter "ProcessId=${process.pid}"; ` +
      `$all = Get-CimInstance Win32_Process | Measure-Object -Property ThreadCount -Sum; ` +
      `"srvThreads=$($x.ThreadCount) srvHandles=$($x.HandleCount) harnessThreads=$($h.ThreadCount) harnessHandles=$($h.HandleCount) systemThreads=$($all.Sum)"`],
      { encoding: "utf8", timeout: 90_000 });
    console.log(`  ${label} [${Date.now() - t0}ms status=${r.status}] ${(r.stdout ?? "").trim()}`);
  };
  q("idle");
  const load1 = distinctClients("10.91", 30000, "/api/services");
  await sleep(4000);
  q("UP under load");
  await load1;
  q("UP after load");
  stopRedis();
  await waitRedisAvailable(false, 30_000);
  q("DOWN idle");
  const load2 = distinctClients("10.92", 30000, "/api/services");
  await sleep(2000);
  q("DOWN under load");
  await load2;
  q("DOWN after load");
  await sleep(10_000);
  q("DOWN +10s");
  await startRedis();
  await waitRedisAvailable(true, 60_000);
  q("recovered");
  stopServer();
}

/**
 * E8 — regression for the reconnect fix: a Redis that is absent AT BOOT must still not hold the
 * server's startup open. That is what the original retry ceiling was for, and the fix keeps it for a
 * client that has never connected.
 */
async function expBootWithoutRedis(): Promise<void> {
  console.log("\n── E8 · boot with Redis absent ──");
  const stopped = stopRedis();
  const t0 = Date.now();
  let booted = false;
  let err = "";
  try {
    await startServer("bootnoredis");
    booted = true;
  } catch (e) {
    err = (e as Error).message.slice(0, 300);
  }
  const bootMs = Date.now() - t0;
  let s: Sample | null = null;
  if (booted) s = await sample("bootnoredis");
  record("E8.1", "WITH REDIS ABSENT AT BOOT THE SERVER STILL STARTS — the fix did not remove the boot-time bound",
    stopped && booted ? "PASS" : "FAIL",
    `Redis stopped before spawn=${stopped}; server semantically ready=${booted} after ${bootMs}ms${err ? ` (${err})` : ""}; ` +
      `redisAvailable=${s?.probe.app.redisAvailable}; a request served: ${booted ? (await fetch(`${BASE}/api/services`, { headers: { "x-forwarded-for": "10.95.0.1" } }).then((r) => r.status).catch(() => "net")) : "n/a"}`);
  await startRedis();
  let joined: number | null = null;
  if (booted) {
    const t1 = Date.now();
    while (Date.now() - t1 < 60_000) {
      const p = await probeSnap().catch(() => null);
      if (p?.app.redisAvailable) { joined = Date.now() - t1; break; }
      await sleep(3000);
    }
  }
  record("E8.2", "OBSERVED: a server that booted without Redis does not adopt it when it appears later", "INFO",
    `after Redis started, the server reported redisAvailable within 60s: ${joined === null ? "no" : `yes, after ${joined}ms`}. ` +
      `This is the unchanged, pre-existing boot contract (the retry ceiling still applies before the first connection) and is ` +
      `outside the defect 7K fixed, which was losing a Redis the process HAD been using.`);
  stopServer();
}

/**
 * E9 — a client that leaves while the server is still authenticating it.
 *
 * Elysia completes the upgrade and only then runs the async `open` handler, which awaits two
 * authorisation lookups before it registers the connection, starts its heartbeat and records its
 * state. If the client closes inside that window, `close` runs first, finds no state, cleans nothing —
 * and then `open` resumes and registers a socket that is already gone. The heartbeat for it never
 * stops, because Bun's `send` on a closed socket does not throw.
 *
 * The control leaves only after the server's first frame, i.e. after `open` has finished.
 */
async function expWsCloseRace(): Promise<void> {
  console.log("\n── E9 · close during the async open handler ──");
  const n = Number(arg("races", "60"));
  await startServer("wsrace");
  await ensureFixtures();
  const u = users[0]!;
  const created = await fetch(`${BASE}/api/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${u.token}`, "x-forwarded-for": u.ip },
    body: JSON.stringify({ serviceId, addressId: u.addressId, scheduledDate: new Date(Date.now() + 5 * 86_400_000).toISOString().replace(/:\d\d\.\d+Z$/, ":00.000Z"), description: `7K ${RUN_TAG} wsrace` }),
  }).then((r) => r.json()).catch(() => null) as { data?: { booking?: { id?: string }; id?: string } } | null;
  const bookingId = created?.data?.booking?.id ?? created?.data?.id ?? null;

  const measure = async () => { const p = await probeSnap(); return { conn: p.app.connectionMap, hb: p.app.heartbeatIntervals, memb: p.app.roomMemberships, rooms: p.app.rooms }; };
  const run = async (label: string, url: string, hold: boolean) => {
    const before = await measure();
    let early = 0;
    for (let i = 0; i < n; i++) {
      const ws = new WsProbe(url);
      await ws.open();
      if (hold) {
        const t0 = Date.now();
        while (ws.frames.length === 0 && Date.now() - t0 < 5000) await sleep(20);
      } else if (ws.frames.length === 0) early++;
      ws.close();
      await sleep(30);
    }
    await sleep(10_000);
    const after = await measure();
    return { label, before, after, early };
  };
  const tok = encodeURIComponent(u.token);
  const results = [
    await run("notifications, hold until first frame (control)", `${WS_BASE}/ws/notifications?token=${tok}`, true),
    await run("notifications, close on open", `${WS_BASE}/ws/notifications?token=${tok}`, false),
  ];
  if (bookingId) {
    results.push(await run("booking, hold until first frame (control)", `${WS_BASE}/ws/booking/${bookingId}?token=${tok}`, true));
    results.push(await run("booking, close on open", `${WS_BASE}/ws/booking/${bookingId}?token=${tok}`, false));
  }
  /** Zombies do not age out: re-read after a full heartbeat period has elapsed. */
  await sleep(35_000);
  const late = await measure();
  for (const r of results) console.log(`  ${JSON.stringify(r)}`);
  console.log(`  after a further 35s (> one 30s heartbeat period): ${JSON.stringify(late)}`);

  const ctrl = results.filter((r) => r.label.includes("control"));
  const race = results.filter((r) => !r.label.includes("control"));
  const leaked = race.reduce((a, r) => a + (r.after.conn - r.before.conn), 0);
  record("E9.0", "control: a client that leaves after the server finished opening leaves nothing behind",
    ctrl.every((r) => r.after.conn === r.before.conn && r.after.hb === r.before.hb) ? "PASS" : "FAIL",
    ctrl.map((r) => `${r.label}: conn ${r.before.conn}→${r.after.conn}, heartbeats ${r.before.hb}→${r.after.hb}`).join("; "));
  record("E9.1", leaked > 0
      ? "A CLIENT THAT DISCONNECTS DURING THE ASYNC OPEN LEAVES A ZOMBIE CONNECTION AND A HEARTBEAT THAT NEVER STOPS"
      : "a client that disconnects during the async open leaves nothing behind",
    leaked > 0 ? "FAIL" : "PASS",
    race.map((r) => `${r.label}: ${n} connections, ${r.early} closed before any server frame; conn ${r.before.conn}→${r.after.conn}, ` +
      `heartbeats ${r.before.hb}→${r.after.hb}, memberships ${r.before.memb}→${r.after.memb}`).join("; ") +
      `; 35s later: ${JSON.stringify(late)}`);
  if (bookingId) await prisma.$executeRawUnsafe(`UPDATE bookings SET status = 'CANCELLED_BY_USER' WHERE id = $1`, bookingId).catch(() => 0);
  stopServer();
}

// ── GATES ─────────────────────────────────────────────────────────────────────────────────────────

async function testGates(): Promise<void> {
  console.log("\n── §3/§4 · isolation, ownership, telemetry positive controls ──");
  const before = await redisView();
  const s = await startServer("gates");
  const h = await probeHealth(PORT);
  record("G0", "isolated, semantically ready, and owned", h.isolatedDatabase && h.ready ? "PASS" : "FAIL",
    `isolatedDatabase=${h.isolatedDatabase} status=${h.status} db=${h.database} redis=${h.redis}; listener pid ${s.pid} == probe pid (spawn pid ${s.spawnPid})`);

  const s0 = await sample("gate-idle", { heap: true });
  console.log(`  idle: ${describe(s0)}`);
  console.log(`  boot event-loop stall (excluded from steady state): ${Math.round(bootLagMaxMs)}ms; remote ports: ${JSON.stringify(s0.sock.remotePorts)}`);
  record("G1", "every telemetry source answers with real, non-zero data", s0.probe.memory.rss > 0 && s0.win.handles > 0 && s0.db.total > 0 && (s0.redis?.serverClients ?? 0) > 0 ? "PASS" : "FAIL",
    `rss=${s0.probe.memory.rss} handles=${s0.win.handles} dbSessions=${s0.db.total} (application_name ${currentAppName}) ` +
      `redisClients=${s0.redis?.serverClients ?? "UNREACHABLE"} intervals=${s0.probe.timers.liveIntervals} ` +
      `bySite=${JSON.stringify(s0.probe.timers.intervalsBySite)} registries=${JSON.stringify(s0.probe.registries)} ` +
      `listeners=${JSON.stringify(s0.probe.processListeners)} heapObjects=${s0.probe.heap?.objectCount}`);

  record(
    "G2",
    "Redis attribution premise: the isolated instance holds nothing but the observer when no server is up",
    before !== null && before.serverClients === 0 ? "PASS" : "FAIL",
    `clients on :6380 other than the observer before the server started: ${before?.serverClients ?? "UNREACHABLE"}. ` +
      `If anything else were connected, every Redis figure attributed to the server below would include it.`,
  );

  record(
    "G3",
    "ISOLATION: the soak server holds no connection to any external host, and every outbound attempt is refused",
    Object.keys(s0.sock.external).length === 0 && String(s0.probe.egressSelfTest).startsWith("refused") ? "PASS" : "FAIL",
    `external ESTABLISHED sockets: ${JSON.stringify(s0.sock.external)}; outbound requests refused by the harness so far: ` +
      `${JSON.stringify(s0.probe.egressRefused)}; node:https self-test against example.com: ${s0.probe.egressSelfTest}. Without the egress guard this same idle boot held 33 connections to ` +
      `the production Sentry ingest (34.160.81.0).`,
  );

  const killed = await killHard();
  await sleep(3000);
  const after = await redisView();
  const dbAfter = await dbView(currentAppName);
  record(
    "G4",
    "positive control for release: killing the server returns Redis and Postgres to exactly the pre-start state",
    killed.gone && after?.serverClients === 0 && dbAfter.total === 0 ? "PASS" : "FAIL",
    `SIGKILL-equivalent on pid ${killed.pid}: gone=${killed.gone} in ${killed.ms}ms; Redis clients other than the observer ` +
      `${s0.redis?.serverClients} → ${after?.serverClients ?? "UNREACHABLE"}; Postgres sessions under ${currentAppName} ` +
      `${s0.db.total} → ${dbAfter.total}. This is also what proves the attribution: the figures fall to zero exactly when ` +
      `this process dies.`,
  );
}
