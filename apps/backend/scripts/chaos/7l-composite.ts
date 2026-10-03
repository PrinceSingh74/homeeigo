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


assertChaosTargetIsolated("7L harness import");

const PORT = Number(process.env.SEVEN_L_PORT ?? 3800);
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
const RUN_TAG = arg("tag", `L${new Date().toISOString().replace(/[^0-9]/g, "").slice(8, 14)}`);
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
process.env.DATABASE_URL = withAppName(process.env.DATABASE_URL!, "7l-harness");
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
  /**
   * Proxy blackhole for every client that honours proxy settings — gaxios and teeny-request (the Google
   * auth and BigQuery path), axios (Twilio), gRPC and Bun's own fetch. Pass 1 of 7L found the server's
   * BigQuery ETL reaching the real Google API through a path the in-process wraps could not see (Google
   * rejected it only because billing is disabled). `.env` defines no proxy variables, so these survive
   * the override:true load; loopback is exempt so Postgres, Redis and the harness are unaffected.
   */
  HTTPS_PROXY: "http://127.0.0.1:9",
  HTTP_PROXY: "http://127.0.0.1:9",
  https_proxy: "http://127.0.0.1:9",
  http_proxy: "http://127.0.0.1:9",
  grpc_proxy: "http://127.0.0.1:9",
  NO_PROXY: "localhost,127.0.0.1,::1",
  no_proxy: "localhost,127.0.0.1,::1",
};

type Server = { spawnPid: number; pid: number; startedAt: number; label: string; proc: ReturnType<typeof Bun.spawn> };
let server: Server | null = null;
let bootLagMaxMs = 0;
const serverLogPaths: string[] = [];
/** Declared here, above the top-level run, so no scenario can reach them in their temporal dead zone. */
let users: User[] = [];
let serviceId = "";

async function startServer(label: string, extraEnv: Record<string, string> = {}): Promise<Server> {
  assertChaosTargetIsolated("7L server start");
  for (const p of [PORT, PROBE_PORT]) {
    const stale = clearPort(p);
    if (stale > 0) console.log(`  [warn] cleared ${stale} stale listener(s) on :${p}`);
  }
  const logPath = `${LOG_DIR}/7l-server-${label}.log`;
  await Bun.write(logPath, "");
  serverLogPaths.push(logPath);
  serverIncarnation += 1;
  currentAppName = `7l-srv-${RUN_TAG}-${serverIncarnation}`;
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
  let r = spawnSync("netstat", ["-ano"], { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) r = spawnSync("netstat", ["-ano"], { encoding: "utf8", timeout: 90_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`7L TELEMETRY FAILURE: netstat exited ${r.status} twice (${r.error?.message ?? "no error"})`);
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


// ══════════════════════════════════════════════════════════════════════════════════════════════════
// SECTION 7L — FINAL COMPOSITE CHAOS
//
// Each composite stacks several independently-proven failures and asks one question: does the system
// move from the degraded state back to ONE correct authoritative state — no duplicated money, no
// duplicated transitions, no lost durable events, no ghost sockets, no poisoned locks, no stranded
// work, no leak — without manual repair?
//
// Every composite verifies that each injected failure really happened (read back, never assumed),
// reconciles the WHOLE ledger before and after, and checks egress for every process it owns.
// ══════════════════════════════════════════════════════════════════════════════════════════════════

import {
  controlBurst,
  pauseRedis,
  pct,
  provisionUsers,
  redisPaused,
  restoreRedisIfNeeded,
  startRedis,
  startWorkload,
  stopRedis,
  WsProbe,
  type User,
  type Window,
} from "./7k-work";

const PASS_NO = arg("pass", "1");
function mb(b: number): number {
  return Math.round(b / 1048576);
}
/** record() with a boolean or an explicit status. */
function R(id: string, title: string, v: boolean | "PASS" | "FAIL" | "NOT_PROVEN" | "INFO", detail: string): void {
  record(id, title, typeof v === "boolean" ? (v ? "PASS" : "FAIL") : v, detail);
}
const P = `P${PASS_NO}`;

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────

type Partner = { userId: string; token: string; providerId: string; ip: string };
let partner: Partner | null = null;
const PARTNER_EMAIL = "s7l.partner@homigo.test";
const PASSWORD = "Qx7!mVt4Rp9z";

/** Pass 1 and pass 2 use disjoint customer sets, so no evidence is carried between them. */
function customersForPass(): User[] {
  return PASS_NO === "2" ? users.slice(12, 24) : users.slice(0, 12);
}

async function loginAs(email: string, ip: string): Promise<{ userId: string; token: string } | null> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password: PASSWORD }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { data?: { accessToken?: string; user?: { id?: string } } } | null;
  return body?.data?.accessToken && body.data.user?.id ? { userId: body.data.user.id, token: body.data.accessToken } : null;
}

/**
 * The partner must pass EVERY dispatch gate, or "no duplicate offer" is true of a dispatch that never
 * happened — the vacuous pass 7I caught once. Every field mirrors the product's own integration fixture.
 */
async function ensurePartner(): Promise<Partner> {
  if (partner) return partner;
  const ip = "10.78.0.10";
  await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email: PARTNER_EMAIL, password: PASSWORD, firstName: "SevenL", lastName: "Partner", phoneNumber: "+919712345679", agreeToTerms: true }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  const first = await loginAs(PARTNER_EMAIL, ip);
  if (!first) throw new Error("7L FIXTURE: partner login failed");
  await prisma.user.update({ where: { id: first.userId }, data: { isEmailVerified: true, role: "VENDOR" } });
  const existing = await prisma.provider.findFirst({ where: { userId: first.userId }, select: { id: true } });
  const provider = existing ?? (await prisma.provider.create({ data: { userId: first.userId, businessName: "7L Composite Partner", isApproved: true }, select: { id: true } }));
  await prisma.provider.update({
    where: { id: provider.id },
    data: {
      serviceCategories: [serviceId], serviceRegions: [], serviceRadiusKm: 50, baseLatitude: 19.076, baseLongitude: 72.8777,
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], workingHoursStart: "00:00", workingHoursEnd: "23:59",
      isVerified: true, isApproved: true, lifecycleState: "ACTIVE", isActive: true, isOnline: true, rating: 4.5,
    },
  });
  /** A token minted after the role change, so it carries VENDOR. */
  const fresh = await loginAs(PARTNER_EMAIL, ip);
  if (!fresh) throw new Error("7L FIXTURE: partner re-login failed");
  partner = { userId: fresh.userId, token: fresh.token, providerId: provider.id, ip };
  return partner;
}

let presenceError = "";
/** Presence through the product's own login-time promotion and heartbeat — never written by hand. */
async function freshenPresence(p: Partner): Promise<boolean> {
  try {
    const { JWTService } = await import("../../src/services/jwt.service");
    const { RefreshTokenService } = await import("../../src/services/refresh-token.service");
    const { partnerPresenceService } = await import("../../src/services/partner-presence.service");
    const deviceId = `7l-${p.providerId.slice(-8)}`;
    const session = await new RefreshTokenService(prisma, new JWTService()).createSessionTokens({ userId: p.userId, email: PARTNER_EMAIL, deviceId });
    await partnerPresenceService.promoteSession(p.providerId, session.sessionId, deviceId);
    const cur = await prisma.partnerPresence.findUnique({ where: { providerId: p.providerId }, select: { lastLocationSeq: true } });
    await partnerPresenceService.heartbeat(
      { providerId: p.providerId, userId: p.userId },
      { sessionId: session.sessionId, deviceId, timestamp: new Date(), appState: "foreground", platform: "android",
        location: { latitude: 19.076, longitude: 72.8777, accuracy: 12, capturedAt: new Date(), sequence: (cur?.lastLocationSeq ?? 0) + 1 } },
    );
    return true;
  } catch (e) {
    presenceError = (e as Error).message.slice(0, 160);
    return false;
  }
}

// ── money ─────────────────────────────────────────────────────────────────────────────────────────

/** Every rupee written straight into a wallet, so the ops-vs-ledger allowance is exact. */
let fixtureCreditRupees = 0;

async function walletPaise(userId: string): Promise<number> {
  const r = (await prisma.$queryRawUnsafe(`SELECT wallet_balance_paise AS p FROM users WHERE id = $1`, userId)) as Array<{ p: bigint }>;
  return Number(r[0]?.p ?? 0n);
}

async function setWalletPaise(userId: string, paise: number): Promise<void> {
  const before = await walletPaise(userId);
  await prisma.user.update({ where: { id: userId }, data: { walletBalance: paise / 100, walletBalancePaise: BigInt(paise) } });
  fixtureCreditRupees = Math.round((fixtureCreditRupees + (paise - before) / 100) * 100) / 100;
}

async function gaps(): Promise<{ wallet: number; payable: number }> {
  const { financialLedgerService } = await import("../../src/services/financial-ledger.service");
  const [u, pr, lw, lp] = await Promise.all([
    prisma.user.aggregate({ _sum: { walletBalance: true } }),
    prisma.provider.aggregate({ _sum: { walletBalance: true } }),
    financialLedgerService.getAccountBalance("CUSTOMER_WALLET"),
    financialLedgerService.getAccountBalance("PROVIDER_PAYABLE"),
  ]);
  return {
    wallet: Math.round(((u._sum.walletBalance ?? 0) - lw) * 100) / 100,
    payable: Math.round(((pr._sum.walletBalance ?? 0) - lp) * 100) / 100,
  };
}

type Ledger = Record<string, number>;
/** The whole ledger, in rupees AND in paise, never the row under test. */
async function ledger(): Promise<Ledger> {
  const one = async (sql: string) => ((await prisma.$queryRawUnsafe(sql)) as Array<{ n: number }>)[0]!.n;
  return {
    journals: await one(`SELECT count(*)::int AS n FROM journal_entries`),
    unbalanced: await one(`SELECT count(*)::int AS n FROM (SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING round(sum(debit)::numeric,2) <> round(sum(credit)::numeric,2)) x`),
    unbalancedPaise: await one(`SELECT count(*)::int AS n FROM (SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING sum(debit_paise) <> sum(credit_paise)) x`),
    orphanLines: await one(`SELECT count(*)::int AS n FROM ledger_entries l WHERE NOT EXISTS (SELECT 1 FROM journal_entries j WHERE j.id = l.journal_id)`),
    negativeBalances: await one(`SELECT count(*)::int AS n FROM users WHERE wallet_balance_paise < 0`),
    paiseMismatchTxn: await one(`SELECT count(*)::int AS n FROM wallet_transactions WHERE abs(round(amount::numeric*100) - amount_paise) > 0`),
    paiseMismatchLine: await one(`SELECT count(*)::int AS n FROM ledger_entries WHERE abs(round(debit::numeric*100) - debit_paise) > 0 OR abs(round(credit::numeric*100) - credit_paise) > 0`),
    dupJournalKeys: await one(`SELECT count(*)::int AS n FROM (SELECT idempotency_key FROM journal_entries WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x`),
    dupWalletKeys: await one(`SELECT count(*)::int AS n FROM (SELECT idempotency_key FROM wallet_transactions WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x`),
    refundOverruns: await one(`SELECT count(*)::int AS n FROM payments WHERE refunded_amount > amount + 0.01`),
    dupPayoutSuccess: await one(`SELECT count(*)::int AS n FROM (SELECT withdrawal_id FROM payout_attempts WHERE status = 'SUCCESS' GROUP BY 1 HAVING count(*) > 1) x`),
    /** A completed booking wallet payment with no journal of its own, or with more than one. */
    walletDebitCoverage: await one(`SELECT count(*)::int AS n FROM wallet_transactions wt
       WHERE wt.status = 'COMPLETED' AND wt.reference_type = 'booking_wallet_payment'
         AND (SELECT count(*) FROM journal_entries j WHERE j.idempotency_key = 'wallet_debit:' || wt.id) <> 1`),
    dupEarnings: await one(`SELECT count(*)::int AS n FROM (SELECT booking_id FROM earnings WHERE booking_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x`),
  };
}

function ledgerViolations(l: Ledger): string[] {
  return Object.entries(l).filter(([k, v]) => k !== "journals" && v !== 0).map(([k, v]) => `${k}=${v}`);
}

type MoneyState = { txns: number; journals: number; balanced: boolean; balance: number };
async function moneyFor(bookingId: string, userId: string): Promise<MoneyState> {
  const t = (await prisma.$queryRawUnsafe(
    `SELECT id FROM wallet_transactions WHERE reference_id = $1 AND user_id = $2 AND status = 'COMPLETED' AND type = 'DEBIT'`, bookingId, userId,
  )) as Array<{ id: string }>;
  const j = (await prisma.$queryRawUnsafe(
    `SELECT j.id, sum(l.debit)::float AS d, sum(l.credit)::float AS c FROM journal_entries j JOIN ledger_entries l ON l.journal_id = j.id
      WHERE j.idempotency_key = ANY($1::text[]) GROUP BY j.id`, t.map((x) => `wallet_debit:${x.id}`),
  )) as Array<{ d: number; c: number }>;
  return { txns: t.length, journals: j.length, balanced: j.every((x) => Math.abs(x.d - x.c) < 0.005), balance: await walletPaise(userId) };
}

// ── business interaction ──────────────────────────────────────────────────────────────────────────

let slotN = Math.floor(Math.random() * 200);
function slot(): string {
  slotN += 1;
  const t = new Date(Date.now() + (48 + ((slotN * 2) % (26 * 24))) * 3_600_000);
  t.setUTCMinutes(0, 0, 0);
  return t.toISOString();
}

async function createBooking(c: User, tag: string): Promise<string | null> {
  const r = await fetch(`${BASE}/api/bookings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${c.token}`, "x-forwarded-for": c.ip },
    body: JSON.stringify({ serviceId, addressId: c.addressId, scheduledDate: slot(), description: `7L ${RUN_TAG} ${tag}` }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  const b = (await r?.json().catch(() => null)) as { data?: { booking?: { id?: string }; id?: string } } | null;
  return b?.data?.booking?.id ?? b?.data?.id ?? null;
}

async function pay(c: User, bookingId: string, timeoutMs = 60_000): Promise<number | null> {
  return fetch(`${BASE}/api/wallet/checkout/pay`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${c.token}`, "x-forwarded-for": c.ip },
    body: JSON.stringify({ bookingId }),
    signal: AbortSignal.timeout(timeoutMs),
  }).then((r) => r.status as number | null).catch(() => null);
}

async function cancelBooking(c: User, bookingId: string): Promise<number | null> {
  return fetch(`${BASE}/api/bookings/${bookingId}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${c.token}`, "x-forwarded-for": c.ip },
    body: JSON.stringify({ reason: "7L composite" }),
    signal: AbortSignal.timeout(30_000),
  }).then((r) => r.status as number | null).catch(() => null);
}

async function bookingRow(id: string): Promise<{ status: string; payment_status: string; provider_id: string | null } | null> {
  const r = (await prisma.$queryRawUnsafe(`SELECT status::text AS status, payment_status::text AS payment_status, provider_id FROM bookings WHERE id = $1`, id)) as Array<{ status: string; payment_status: string; provider_id: string | null }>;
  return r[0] ?? null;
}

async function eventsFor(ids: string[]): Promise<Array<{ event_id: string; event_type: string; status: string; attempts: number }>> {
  return (await prisma.$queryRawUnsafe(
    `SELECT event_id, event_type, status::text AS status, attempts FROM event_outbox WHERE aggregate_id = ANY($1::text[])`, ids,
  )) as Array<{ event_id: string; event_type: string; status: string; attempts: number }>;
}

async function duplicateReceipts(eventIds: string[]): Promise<number> {
  if (!eventIds.length) return 0;
  const r = (await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM (SELECT consumer_name, event_id FROM event_consumer_receipts WHERE event_id = ANY($1::text[]) GROUP BY 1, 2 HAVING count(*) > 1) x`, eventIds,
  )) as Array<{ n: number }>;
  return r[0]?.n ?? 0;
}

async function waitFor(pred: () => Promise<boolean>, ms: number, step = 1000): Promise<number | null> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await pred().catch(() => false)) return Date.now() - t0;
    await sleep(step);
  }
  return null;
}

async function outboxConverged(ids: string[], ms: number): Promise<number | null> {
  return waitFor(async () => {
    const ev = await eventsFor(ids);
    return ev.length > 0 && ev.every((e) => e.status === "PUBLISHED");
  }, ms, 2000);
}

/** ACCESS EXCLUSIVE from a separate session; returns a release handle and a waiter counter. */
function lockTable(table: string, maxHoldMs: number): { release: () => void; started: Promise<void>; ended: Promise<void> } {
  let release: () => void = () => {};
  let started: () => void = () => {};
  const until = new Promise<void>((r) => (release = r));
  const s = new Promise<void>((r) => (started = r));
  const ended = prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`LOCK TABLE ${table} IN ACCESS EXCLUSIVE MODE`);
    started();
    await until;
  }, { timeout: maxHoldMs + 10_000, maxWait: 15_000 }).then(() => undefined).catch(() => undefined);
  return { release, started: s, ended };
}

async function waitersOn(): Promise<number> {
  const r = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND application_name = $1`, currentAppName)) as Array<{ n: number }>;
  return r[0]?.n ?? 0;
}

async function redisAvailOnServer(want: boolean, ms: number): Promise<number | null> {
  return waitFor(async () => (await probeSnap()).app.redisAvailable === want, ms, 1000);
}

async function readDispatch(bookingId: string): Promise<{ jobStatus: string | null; attempts: Array<{ provider_id: string; status: string; n: number }> }> {
  const job = (await prisma.$queryRawUnsafe(`SELECT id, status::text AS status FROM assignment_jobs WHERE booking_id = $1`, bookingId)) as Array<{ id: string; status: string }>;
  const attempts = job[0]
    ? ((await prisma.$queryRawUnsafe(`SELECT provider_id, status::text AS status, count(*)::int AS n FROM assignment_attempts WHERE job_id = $1 GROUP BY 1, 2`, job[0].id)) as Array<{ provider_id: string; status: string; n: number }>)
    : [];
  return { jobStatus: job[0]?.status ?? null, attempts };
}

// ── egress ────────────────────────────────────────────────────────────────────────────────────────

const extraPids = new Set<number>();
/**
 * Every process this run owns — server, harness, contenders — is checked in the OS socket table for
 * any non-loopback connection. The probe's own refusal counters say what was attempted; netstat says
 * whether anything got out regardless of which client library tried.
 */
function egressCheck(): { external: Record<string, Record<string, number>>; selfTest: string } {
  const out: Record<string, Record<string, number>> = {};
  const pids = [process.pid, ...(server ? [server.pid] : []), ...extraPids];
  for (const pid of pids) {
    const e = sockets(pid).external;
    if (Object.keys(e).length) out[String(pid)] = e;
  }
  return { external: out, selfTest: "" };
}

const egressLog: Array<{ scenario: string; when: string; external: Record<string, Record<string, number>> }> = [];
function egress(scenario: string, when: string): void {
  const e = egressCheck();
  egressLog.push({ scenario, when, external: e.external });
  if (Object.keys(e.external).length) console.log(`  [!!] EXTERNAL SOCKET during ${scenario}/${when}: ${JSON.stringify(e.external)}`);
}

// ── scenario frame ────────────────────────────────────────────────────────────────────────────────

const scenarioTimes: Record<string, number> = {};
async function frame(id: string, title: string): Promise<{ ledgerBefore: Ledger; gapBefore: { wallet: number; payable: number }; fixtureBefore: number }> {
  console.log(`\n── ${P}.${id} · ${title} ──`);
  const snap = server ? await probeSnap().catch(() => null) : null;
  console.log(`  run=${RUN_TAG} scenario=${id} server pid=${server?.pid ?? "none"} (probe pid ${snap?.pid ?? "n/a"}) app_name=${currentAppName}`);
  console.log(`  workers (in-process, by interval site): outbox=${snap?.timers.intervalsBySite["src/events/core/outbox-processor.ts:231"] ?? "n/a"} jobs=${snap?.timers.intervalsBySite["src/events/core/job-processor.ts:202"] ?? "n/a"} maintenance=${snap ? Object.keys(snap.timers.intervalsBySite).filter((k) => k.includes("maintenance")).length : "n/a"}`);
  console.log(`  db=${describeDatabaseTarget()?.redacted} redis=${redisTarget!.redacted} egress=refused-at-fetch+node-http/https/net/tls (self-test: ${snap?.egressSelfTest ?? "n/a"}) gateway=NOT CALLED`);
  console.log(`  flags=${JSON.stringify({ LOAD_TEST_MODE: SERVER_ENV.LOAD_TEST_MODE, TRUST_PROXY: SERVER_ENV.TRUST_PROXY, OUTBOX: SERVER_ENV.EVENTS_OUTBOX_ENABLED, CONSUMERS: SERVER_ENV.EVENTS_CONSUMERS_ENABLED })} at=${new Date().toISOString()} machine=${await machineState()}`);
  egress(id, "before");
  scenarioTimes[id] = Date.now();
  return { ledgerBefore: await ledger(), gapBefore: await gaps(), fixtureBefore: fixtureCreditRupees };
}

/** The whole-ledger close-out every composite ends with. */
async function closeMoney(id: string, f: { ledgerBefore: Ledger; gapBefore: { wallet: number; payable: number }; fixtureBefore: number }): Promise<void> {
  const after = await ledger();
  const g = await gaps();
  const fixtureDelta = Math.round((fixtureCreditRupees - f.fixtureBefore) * 100) / 100;
  const walletDrift = Math.round((g.wallet - f.gapBefore.wallet - fixtureDelta) * 100) / 100;
  const payableDrift = Math.round((g.payable - f.gapBefore.payable) * 100) / 100;
  const v = ledgerViolations(after);
  R(`${P}.${id}.money`, "WHOLE LEDGER: balanced, coherent, every subledger matches what it represents",
    v.length === 0 && Math.abs(walletDrift) < 0.01 && Math.abs(payableDrift) < 0.01 ? "PASS" : "FAIL",
    `violations: ${v.length ? v.join(", ") : "none"}; journals ${f.ledgerBefore.journals} → ${after.journals}; ` +
      `ops-vs-ledger drift beyond fixture funding: customer wallet ₹${walletDrift}, provider payable ₹${payableDrift} (fixture funding ₹${fixtureDelta}). ` +
      `A balanced-but-duplicated journal would appear here as drift even though every journal balances on its own.`);
  egress(id, "after");
  /**
   * A second, independent egress witness: a response FROM Google in the server's own logs. BigQuery's
   * "Billing has not been enabled" can only be produced by Google's API, so any occurrence means a
   * request left this machine regardless of what the socket table caught between samples.
   */
  let googleResponses = 0;
  for (const lp of serverLogPaths) {
    const txt = await Bun.file(lp).text().catch(() => "");
    googleResponses += (txt.match(/Billing has not been enabled/g) ?? []).length;
  }
  if (googleResponses > 0) egressLog.push({ scenario: id, when: "google-response-in-logs", external: { logs: { googleResponses } } });
  const e = egressLog.filter((x) => x.scenario === id && Object.keys(x.external).length > 0);
  R(`${P}.${id}.egress`, "no external socket before, during or after", e.length === 0 ? "PASS" : "FAIL",
    e.length ? JSON.stringify(e) : `checked ${egressLog.filter((x) => x.scenario === id).length} times across server, harness${extraPids.size ? " and contenders" : ""}`);
}


// ── run driver ────────────────────────────────────────────────────────────────────────────────────

async function ensureBase(): Promise<void> {
  if (users.length) return;
  const svc = (await prisma.$queryRawUnsafe(`SELECT id FROM services WHERE is_active = true ORDER BY created_at LIMIT 1`)) as Array<{ id: string }>;
  if (!svc[0]) throw new Error("7L FIXTURE: no active service");
  serviceId = svc[0].id;
  users = await provisionUsers(BASE, prisma as never, 24);
  await ensurePartner();
}

async function sweep7l(): Promise<number> {
  const ids = ((await prisma.$queryRawUnsafe(`SELECT id FROM bookings WHERE description LIKE '7L %'`)) as Array<{ id: string }>).map((r) => r.id);
  if (!ids.length) return 0;
  const d = (sql: string) => prisma.$executeRawUnsafe(sql, ids).catch(() => 0);
  await d(`DELETE FROM assignment_attempts WHERE job_id IN (SELECT id FROM assignment_jobs WHERE booking_id = ANY($1::text[]))`);
  await d(`DELETE FROM assignment_jobs WHERE booking_id = ANY($1::text[])`);
  await d(`DELETE FROM event_consumer_receipts WHERE event_id IN (SELECT event_id FROM event_outbox WHERE aggregate_id = ANY($1::text[]))`);
  await d(`DELETE FROM scheduled_jobs WHERE trigger_event_id IN (SELECT event_id FROM event_outbox WHERE aggregate_id = ANY($1::text[]))`);
  await d(`DELETE FROM event_outbox WHERE aggregate_id = ANY($1::text[])`);
  await d(`DELETE FROM notifications WHERE reference_id = ANY($1::text[])`);
  /** Paid fixtures carry money; their journals and ledger lines go with them so nothing is orphaned. */
  const txns = ((await prisma.$queryRawUnsafe(`SELECT id FROM wallet_transactions WHERE reference_id = ANY($1::text[])`, ids)) as Array<{ id: string }>).map((t) => t.id);
  const keys = [...txns.map((t) => `wallet_debit:${t}`), ...ids.map((b) => `provider_earning:${b}`)];
  const jids = ((await prisma.$queryRawUnsafe(`SELECT id FROM journal_entries WHERE idempotency_key = ANY($1::text[])`, keys)) as Array<{ id: string }>).map((j) => j.id);
  if (jids.length) {
    await prisma.$executeRawUnsafe(`DELETE FROM ledger_balance_snapshots WHERE journal_id = ANY($1::text[])`, jids).catch(() => 0);
    await prisma.$executeRawUnsafe(`DELETE FROM ledger_entries WHERE journal_id = ANY($1::text[])`, jids).catch(() => 0);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE id = ANY($1::text[])`, jids).catch(() => 0);
  }
  await d(`DELETE FROM earnings WHERE booking_id = ANY($1::text[])`);
  await d(`DELETE FROM wallet_transactions WHERE reference_id = ANY($1::text[])`);
  await d(`DELETE FROM payments WHERE booking_id = ANY($1::text[])`);
  await d(`DELETE FROM activity_logs WHERE booking_id = ANY($1::text[])`);
  await d(`DELETE FROM bookings WHERE id = ANY($1::text[])`);
  return ids.length;
}

// ══ §6 HARNESS POSITIVE CONTROLS ══════════════════════════════════════════════════════════════════

async function positiveControls(): Promise<boolean> {
  console.log(`\n── ${P} · §6 harness positive controls ──`);
  const c = customersForPass()[0]!;
  const f = await frame("G", "positive controls");
  let ok = true;
  const rec = (id: string, title: string, pass: boolean, detail: string) => {
    R(`${P}.${id}`, title, pass ? "PASS" : "FAIL", detail);
    if (!pass) ok = false;
  };

  // G1 + G4 + G7
  await setWalletPaise(c.userId, 5_000_000);
  const j0 = (await ledger()).journals;
  const b = await createBooking(c, "G1");
  const st = b ? await pay(c, b) : null;
  const m = b ? await moneyFor(b, c.userId) : null;
  const j1 = (await ledger()).journals;
  rec("G1", "a healthy business flow succeeds", st === 200 && m?.txns === 1 && m?.journals === 1 && !!m?.balanced,
    `booking ${b?.slice(0, 12)} pay → ${st}; wallet txns ${m?.txns}, journals ${m?.journals} balanced=${m?.balanced}`);
  const ev = b ? await eventsFor([b]) : [];
  rec("G4", "outbox backlog/processing state is measurable for a run-specific event", ev.length > 0,
    `events for the G1 booking: ${JSON.stringify(ev.map((e) => ({ t: e.event_type, s: e.status })))}`);
  rec("G7", "financial ledger state is measurable and moves with a real payment", j1 === j0 + 1,
    `whole-ledger journal count ${j0} → ${j1} for one payment`);

  // G6 — a client-counted frame
  const b2 = await createBooking(c, "G6");
  let frames = 0;
  if (b2) {
    const ws = new WsProbe(`${WS_BASE}/ws/booking/${b2}?token=${encodeURIComponent(c.token)}`);
    await ws.open();
    await sleep(300);
    const t0 = Date.now();
    await cancelBooking(c, b2);
    await waitFor(async () => ws.frames.some((x) => x.t >= t0 && x.msg.type === "BOOKING_STATUS"), 6000, 50);
    frames = ws.frames.filter((x) => x.t >= t0 && x.msg.type === "BOOKING_STATUS").length;
    ws.close();
  }
  rec("G6", "actual client WebSocket receipt is measurable", frames >= 1, `frames received by the client after the cancel: ${frames}`);

  // G8 — contention
  const b3 = await createBooking(c, "G8");
  const lk = lockTable("ledger_entries", 20_000);
  await lk.started;
  const pp = b3 ? pay(c, b3) : Promise.resolve(null);
  await sleep(2500);
  const waiters = await waitersOn();
  lk.release();
  await lk.ended;
  const s8 = await pp;
  rec("G8", "actual DB lock contention is measurable", waiters > 0, `server sessions waiting on ledger_entries: ${waiters}; the payment then finished ${s8}`);

  // G5 — scheduler / lock state, driven deterministically through the real runWithLeaderLock
  /**
   * The server's own exclusive jobs hold their advisory anchor only while a job runs, so sampling for
   * one is luck (a first version saw none in 70s). A 7E contender — the product's runWithLeaderLock in
   * its own process — is made to hold an exclusive lease for 6s, and both guards must be visible while
   * it holds and gone once it has exited.
   */
  const g5key = `7l-g5-${RUN_TAG}-${PASS_NO}`;
  const g5 = Bun.spawn(["bun", "scripts/chaos/7e-contender.ts", "--run", `g5-${RUN_TAG}-${PASS_NO}`, "--key", g5key, "--hold", "6000", "--attempts", "1", "--ttl", "10", "--exclusive", "--require-redis"], {
    cwd: process.cwd(), env: { ...(process.env as Record<string, string>), DATABASE_URL: BASE_DB_URL }, stdout: Bun.file(`${LOG_DIR}/7l-g5-${RUN_TAG}.log`), stderr: Bun.file(`${LOG_DIR}/7l-g5-${RUN_TAG}.log`),
  });
  let heldKey = 0;
  let heldAdv = 0;
  const t5 = Date.now();
  while (Date.now() - t5 < 25_000 && (heldKey === 0 || heldAdv === 0)) {
    try { const o = await observer(); heldKey = Math.max(heldKey, await o.exists(`lock:${g5key}`)); } catch { /* observer down */ }
    const a = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted`)) as Array<{ n: number }>;
    heldAdv = Math.max(heldAdv, a[0]?.n ?? 0);
    await sleep(150);
  }
  await g5.exited;
  await sleep(1000);
  let keyAfter = -1;
  try { keyAfter = await (await observer()).exists(`lock:${g5key}`); } catch { keyAfter = -1; }
  const advAfter = ((await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted`)) as Array<{ n: number }>)[0]?.n ?? -1;
  const jobs = (await prisma.$queryRawUnsafe(`SELECT status, count(*)::int AS n FROM scheduled_jobs GROUP BY 1`)) as Array<{ status: string; n: number }>;
  rec("G5", "scheduler and lock state is measurable: both leadership guards visible while held, both gone after release",
    heldKey === 1 && heldAdv > 0 && keyAfter === 0 && advAfter === 0,
    `while held: Redis lock:${g5key} exists=${heldKey}, advisory locks granted=${heldAdv}; after exit: key=${keyAfter}, advisory=${advAfter}; scheduled_jobs ${JSON.stringify(jobs)}`);
  await prisma.scheduledJob.deleteMany({ where: { jobType: `7e-g5-${RUN_TAG}-${PASS_NO}` } });

  // G2 — Redis failure detectable
  const s2 = stopRedis();
  const down = await redisAvailOnServer(false, 30_000);
  const s2b = await startRedis();
  const up = await redisAvailOnServer(true, 60_000);
  rec("G2", "an actual Redis failure is detectable by the server and recovers", s2 && down !== null && s2b && up !== null,
    `docker stop verified=${s2}; server reported unavailable after ${down}ms; restart healthy=${s2b}; available again after ${up}ms`);

  // G3 — process death detectable
  const k = await killHard();
  rec("G3", "an actual backend process death is detectable", k.gone && !pidAlive(k.pid), `pid ${k.pid} gone=${k.gone} in ${k.ms}ms; listener free=${listenerPidOn(PORT) === null}`);
  await startServer(`${P}-after-G`);

  // G9 — every external client stack the application uses is isolated, proven against a harmless host
  await sleep(12_000);
  const snap9 = (await probeSnap()) as unknown as { egressSelfTest?: string; egressStackTests?: Record<string, string> };
  const stacks = snap9.egressStackTests ?? {};
  const connected = Object.entries(stacks).filter(([, v]) => v.startsWith("CONNECTED"));
  rec("G9", "egress isolation holds for every client stack the integrations use (fetch, node:https, gaxios, teeny-request, axios, node-fetch)",
    Object.keys(stacks).length >= 4 && connected.length === 0 && String(snap9.egressSelfTest ?? "").startsWith("refused"),
    `node:https ${snap9.egressSelfTest}; ${JSON.stringify(stacks)}`);

  await closeMoney("G", f);
  return ok;
}

// ══ C1 — business write + Redis outage + outbox impaired + ambiguous retry ═══════════════════════

async function c1(): Promise<void> {
  const c = customersForPass()[1]!;
  const f = await frame("C1", "business write + Redis outage + consumers impaired + ambiguous client retry");
  await setWalletPaise(c.userId, 3_000_000);
  const b = await createBooking(c, "C1");
  if (!b) return R(`${P}.C1.0`, "C1 fixture", "NOT_PROVEN", "booking create failed");
  const stopped = stopRedis();
  const down = await redisAvailOnServer(false, 30_000);
  /** Consumers impaired: every receipt insert blocks, so delivery cannot complete. */
  const lk = lockTable("event_consumer_receipts", 90_000);
  await lk.started;
  /** The client gives up after 50ms; the server does not know and carries on. */
  const t0 = Date.now();
  const first = await pay(c, b, 50);
  const committed = await waitFor(async () => (await moneyFor(b, c.userId)).txns === 1, 30_000, 250);
  egress("C1", "during");
  /**
   * Prove the impairment bit: a single reading can land between outbox ticks (a first version saw 0
   * waiters and could not claim consumers were impaired at all). Poll across several ticks, and check
   * that this booking's events stayed undelivered while the lock was held.
   */
  let blockedWaiters = 0;
  const tImp = Date.now();
  while (Date.now() - tImp < 15_000) {
    blockedWaiters = Math.max(blockedWaiters, await waitersOn());
    await sleep(250);
  }
  const heldEvents = await eventsFor([b]);
  const deliveredWhileHeld = heldEvents.filter((e) => e.status === "PUBLISHED").length;
  const started = await startRedis();
  const up = await redisAvailOnServer(true, 60_000);
  lk.release();
  await lk.ended;
  const retry = await pay(c, b);
  const conv = await outboxConverged([b], 180_000);
  const m = await moneyFor(b, c.userId);
  const ev = await eventsFor([b]);
  const types = ev.reduce((a, e) => ((a[e.event_type] = (a[e.event_type] ?? 0) + 1), a), {} as Record<string, number>);
  const dupTypes = Object.entries(types).filter(([, n]) => n > 1);
  const dupRcpt = await duplicateReceipts(ev.map((e) => e.event_id));
  const row = await bookingRow(b);

  R(`${P}.C1.1`, "every injected failure really happened", stopped && down !== null && started && up !== null && blockedWaiters > 0 && deliveredWhileHeld === 0,
    `Redis stopped=${stopped} (server noticed after ${down}ms), restarted=${started} (recovered after ${up}ms); consumer receipts held ACCESS EXCLUSIVE, ` +
      `max ${blockedWaiters} server session(s) waiting on it over 15s, this booking's events delivered while held ${deliveredWhileHeld}/${heldEvents.length}; client aborted after 50ms → ${first === null ? "no response (ambiguous)" : `HTTP ${first}`}, ` +
      `commit observed ${committed === null ? "NEVER" : `${committed}ms after the abort`}`);
  R(`${P}.C1.2`, "ONE business mutation, ONE financial mutation, whatever the client saw",
    m.txns === 1 && m.journals === 1 && m.balanced && row?.payment_status === "SUCCESS" ? "PASS" : "FAIL",
    `retry → HTTP ${retry}; wallet txns ${m.txns}, journals ${m.journals} balanced=${m.balanced}, booking ${row?.status}/${row?.payment_status}` +
      (first === null && committed !== null ? "; the client's first attempt was genuinely ambiguous — no response, yet committed" : ""));
  R(`${P}.C1.3`, "ONE event per business fact, no duplicate receipt, and the outbox converged unaided",
    dupTypes.length === 0 && dupRcpt === 0 && conv !== null ? "PASS" : "FAIL",
    `events by type ${JSON.stringify(types)}; duplicate (consumer,event) receipts ${dupRcpt}; all PUBLISHED after ${conv ?? ">180000"}ms from recovery`);
  await closeMoney("C1", f);
}

// ══ C2 — commit + crash + WS loss + recovery + reconnect ═════════════════════════════════════════

async function c2(): Promise<void> {
  const c = customersForPass()[2]!;
  const f = await frame("C2", "committed write + backend crash + WebSocket loss + recovery + reconnect");
  const b = await createBooking(c, "C2");
  if (!b) return R(`${P}.C2.0`, "C2 fixture", "NOT_PROVEN", "booking create failed");
  const ws1 = new WsProbe(`${WS_BASE}/ws/booking/${b}?token=${encodeURIComponent(c.token)}`);
  const n1 = new WsProbe(`${WS_BASE}/ws/notifications?token=${encodeURIComponent(c.token)}`);
  const o1 = (await ws1.open()) && (await n1.open());
  await waitFor(async () => ws1.frames.length > 0 && n1.frames.length > 0, 5000, 50);
  const beforeCrash = await probeSnap();
  const k = await killHard();
  const dropped = await waitFor(async () => ws1.closed && n1.closed, 15_000, 100);
  await startServer(`${P}-C2`);
  const api = await fetch(`${BASE}/api/bookings/${b}`, { headers: { authorization: `Bearer ${c.token}`, "x-forwarded-for": c.ip } }).then((r) => r.json()).catch(() => null) as { data?: { status?: string; booking?: { status?: string } } } | null;
  const ws2 = new WsProbe(`${WS_BASE}/ws/booking/${b}?token=${encodeURIComponent(c.token)}`);
  const n2 = new WsProbe(`${WS_BASE}/ws/notifications?token=${encodeURIComponent(c.token)}`);
  await ws2.open();
  await n2.open();
  await waitFor(async () => ws2.frames.length > 0 && n2.frames.length > 0, 5000, 50);
  const reg = await probeSnap();
  egress("C2", "during");
  const t0 = Date.now();
  await cancelBooking(c, b);
  await sleep(4000);
  /**
   * Only frames that carry the CANCELLED status count as the fresh event. The booking socket's own
   * open handler sends a status snapshot, and a late snapshot counted as a second delivery once — the
   * same false count 7G hit. Every post-cancel BOOKING_STATUS frame is also reported by status so a
   * genuine duplicate cannot hide inside the filter.
   */
  const post = ws2.frames.filter((x) => x.t >= t0 && x.msg.type === "BOOKING_STATUS");
  const statusOf = (x: { msg: Record<string, unknown> }) => String(((x.msg.data ?? {}) as Record<string, unknown>).status ?? "");
  const fresh = post.filter((x) => statusOf(x).toLowerCase().includes("cancel")).length;
  const postStatuses = post.map(statusOf);
  ws2.close();
  n2.close();
  const cleared = await waitFor(async () => (await probeSnap()).app.connectionMap === 0, 15_000, 500);
  const after = await probeSnap();
  const ev = await eventsFor([b]);
  const types = ev.reduce((a, e) => ((a[e.event_type] = (a[e.event_type] ?? 0) + 1), a), {} as Record<string, number>);
  const count = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM bookings WHERE description = $1`, `7L ${RUN_TAG} C2`)) as Array<{ n: number }>;

  R(`${P}.C2.1`, "the crash and the client disconnect really happened", k.gone && dropped !== null && o1,
    `server pid ${k.pid} gone in ${k.ms}ms with ${beforeCrash.app.connectionMap} live connections; both clients saw the drop after ${dropped}ms`);
  R(`${P}.C2.2`, "the committed write survived, exactly once, and the authoritative API reports it",
    (count[0]?.n ?? 0) === 1 && (types["homigo.booking.created"] ?? 0) === 1 && String(api?.data?.status ?? api?.data?.booking?.status ?? "").toUpperCase() === "PENDING" ? "PASS" : "FAIL",
    `bookings with this description ${count[0]?.n}; booking.created events ${types["homigo.booking.created"] ?? 0}; API after recovery: ${api?.data?.status ?? api?.data?.booking?.status}`);
  R(`${P}.C2.3`, "reconnect registers membership EXACTLY once, the fresh event arrives exactly once, and nothing is left afterwards",
    reg.app.connectionMap === 2 && reg.app.roomMemberships === 2 && fresh === 1 && cleared !== null && after.app.heartbeatIntervals === 0 ? "PASS" : "FAIL",
    `after reconnect: connections ${reg.app.connectionMap}, memberships ${reg.app.roomMemberships}, heartbeats ${reg.app.heartbeatIntervals}; ` +
      `cancellation frames received by the reconnected client ${fresh} (all post-cancel BOOKING_STATUS frames by status: ${JSON.stringify(postStatuses)}); after both closed: connections ${after.app.connectionMap}, heartbeats ${after.app.heartbeatIntervals}; ` +
      `booking.cancelled events ${types["homigo.booking.cancelled"] ?? 0}`);
  await closeMoney("C2", f);
}

// ══ C3 — wallet payment + Redis paused + crash at the response boundary + ambiguous retry + replay ═

async function c3(): Promise<void> {
  const c = customersForPass()[3]!;
  const f = await frame("C3", "wallet payments + Redis paused + crash at the response boundary + retry + outbox replay");
  const start = 20_000_000;
  await setWalletPaise(c.userId, start);
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const b = await createBooking(c, `C3-${i}`);
    if (b) ids.push(b);
  }
  const paused = pauseRedis(true);
  const killDelay = PASS_NO === "2" ? 260 : 140;
  const inflight = ids.map((id) => pay(c, id, 30_000).then((s) => ({ id, s })));
  /**
   * Arm-then-kill. With Redis paused, requests wait on Redis command deadlines before committing, so a
   * fixed delay killed the process before ANY payment had committed — a crash-before-commit test, not
   * the response boundary this composite is about. The kill now fires the moment the first commit
   * (pass 1) or the third (pass 2) is visible, while the rest are still in flight.
   */
  const needCommitted = PASS_NO === "2" ? 3 : 1;
  await waitFor(async () => {
    const r = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM wallet_transactions WHERE reference_id = ANY($1::text[]) AND status = 'COMPLETED'`, ids)) as Array<{ n: number }>;
    return (r[0]?.n ?? 0) >= needCommitted;
  }, 30_000, 20);
  void killDelay;
  const k = await killHard();
  const outcomes = await Promise.all(inflight);
  const committedAtCrash = (await Promise.all(ids.map((id) => moneyFor(id, c.userId)))).map((m) => m.txns);
  await startServer(`${P}-C3`);
  const unpaused = pauseRedis(false);
  await redisAvailOnServer(true, 60_000);
  const retries = await Promise.all(ids.map((id) => pay(c, id)));
  /** Replay: the same payment events delivered again, as a crash mid-handler would. */
  const ev = await eventsFor(ids);
  await outboxConverged(ids, 180_000);
  /**
   * Wallet checkout writes no outbox event of its own (C1 showed the only event on a paid booking is
   * booking.created), so the money movement is not event-driven and redelivery cannot re-run it. The
   * replay therefore covers every event these bookings have, and the check is that money does not move.
   */
  const pe = (await eventsFor(ids)).map((e) => e.event_id);
  const moneyBeforeReplay = await walletPaise(c.userId);
  if (pe.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE event_outbox SET status = 'PENDING', locked_by = NULL, locked_at = NULL, published_at = NULL,
         available_at = now() - interval '1 day', created_at = now() - interval '2 days' WHERE event_id = ANY($1::text[])`, pe,
    );
  }
  const replayed = await outboxConverged(ids, 180_000);
  egress("C3", "during");
  const ms = await Promise.all(ids.map((id) => moneyFor(id, c.userId)));
  const amounts = (await prisma.$queryRawUnsafe(`SELECT coalesce(sum(amount_paise),0)::text AS s FROM wallet_transactions WHERE reference_id = ANY($1::text[]) AND status='COMPLETED' AND type='DEBIT'`, ids)) as Array<{ s: string }>;
  const debited = Number(amounts[0]?.s ?? 0);
  const bal = await walletPaise(c.userId);
  const ambiguous = outcomes.filter((o, i) => o.s === null && committedAtCrash[i] === 1).length;
  const dupRcpt = await duplicateReceipts((await eventsFor(ids)).map((e) => e.event_id));

  R(`${P}.C3.1`, "the pause and a crash AT the commit/response boundary really happened", paused && k.gone && unpaused && committedAtCrash.filter((x) => x === 1).length >= needCommitted && committedAtCrash.some((x) => x === 0),
    `Redis paused=${paused} (read back), unpaused=${unpaused}; server killed once ${needCommitted} payment(s) had committed (gone=${k.gone}); ` +
      `${outcomes.filter((o) => o.s === null).length} clients got no response, ${ambiguous} of them had committed; committed at crash ${committedAtCrash.filter((x) => x === 1).length}/12`);
  R(`${P}.C3.2`, "EXACTLY ONE wallet transaction and ONE balanced journal per booking after retry and replay",
    ms.every((m) => m.txns === 1 && m.journals === 1 && m.balanced) ? "PASS" : "FAIL",
    `per booking (txns/journals): ${JSON.stringify(ms.map((m) => `${m.txns}/${m.journals}`))}; retries ${JSON.stringify(retries)}; ` +
      `${pe.length} events (every event of these bookings — wallet checkout emits none of its own) replayed and re-published after ${replayed ?? ">180000"}ms; ` +
      `wallet ${moneyBeforeReplay}p before replay → ${await walletPaise(c.userId)}p after; duplicate receipts ${dupRcpt}`);
  R(`${P}.C3.3`, "EXACT final balance and no negative balance", bal === start - debited && bal >= 0 ? "PASS" : "FAIL",
    `start ${start}p − debited ${debited}p = ${start - debited}p; actual ${bal}p`);
  await closeMoney("C3", f);
}

// ══ C4 — partner dispatch + notification store stalled + WS loss + crash ═════════════════════════

async function c4(): Promise<void> {
  const c = customersForPass()[4]!;
  const p = await ensurePartner();
  const f = await frame("C4", "partner dispatch + notification store stalled + WebSocket loss + crash + recovery");
  await setWalletPaise(c.userId, 5_000_000);
  const presence = await freshenPresence(p);
  const b = await createBooking(c, "C4");
  if (!b) return R(`${P}.C4.0`, "C4 fixture", "NOT_PROVEN", "booking create failed");
  const cws = new WsProbe(`${WS_BASE}/ws/booking/${b}?token=${encodeURIComponent(c.token)}`);
  const pws = new WsProbe(`${WS_BASE}/ws/notifications?token=${encodeURIComponent(p.token)}`);
  await cws.open();
  await pws.open();
  const lk = lockTable("notifications", 150_000);
  await lk.started;
  const st = await pay(c, b);
  const offered = await waitFor(async () => (await readDispatch(b)).attempts.length > 0, 45_000, 500);
  const atStall = await readDispatch(b);
  const stallWaiters = await waitersOn();
  cws.abort();
  pws.abort();
  const k = await killHard();
  await startServer(`${P}-C4`);
  lk.release();
  await lk.ended;
  await freshenPresence(p);
  egress("C4", "during");
  /**
   * Convergence is measured under the server's own cron. The booking is moved to the head of the
   * assignment queue (ordering only: 3,397 stale PENDING test bookings otherwise keep the 10-per-tick
   * cron from reaching it for hours — which a first version misread as "never re-dispatched"), and the
   * partner's presence is kept fresh the way the partner app keeps it fresh.
   */
  await prisma.$executeRawUnsafe(`UPDATE bookings SET priority_score = 1000000 WHERE id = $1`, b);
  const trail: Array<{ t: number; job: string | null; da: number }> = [];
  const t0 = Date.now();
  let lastBeat = Date.now();
  while (Date.now() - t0 < 240_000) {
    if (Date.now() - lastBeat > 20_000) { await freshenPresence(p); lastBeat = Date.now(); }
    const j = (await prisma.$queryRawUnsafe(`SELECT status::text AS s, dispatch_attempts AS da FROM assignment_jobs WHERE booking_id = $1`, b)) as Array<{ s: string; da: number }>;
    trail.push({ t: Math.round((Date.now() - t0) / 1000), job: j[0]?.s ?? null, da: j[0]?.da ?? -1 });
    if (j[0]?.s && j[0].s !== "PENDING") break;
    await sleep(15_000);
  }
  const final = await readDispatch(b);
  await freshenPresence(p);
  /** And the offer the partner already holds is still honoured. */
  const accept = await fetch(`${BASE}/api/bookings/${b}/accept`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.token}`, "x-forwarded-for": p.ip }, body: "{}" })
    .then(async (r) => ({ s: r.status, b: (await r.text()).slice(0, 160) })).catch(() => ({ s: 0, b: "net" }));
  const row = await bookingRow(b);
  const m = await moneyFor(b, c.userId);

  R(`${P}.C4.1`, "dispatch really reached a partner, the notification store really stalled, and the process really died mid-stall",
    offered !== null && presence && k.gone && stallWaiters > 0,
    `pay → ${st}; offer committed after ${offered}ms: ${JSON.stringify(atStall.attempts)} with job ${atStall.jobStatus}; server sessions blocked on notifications ${stallWaiters}; ` +
      `customer and partner sockets dropped; pid ${k.pid} killed while stalled (gone=${k.gone}); presence ${presence}${presenceError ? ` (${presenceError})` : ""}`);
  R(`${P}.C4.2`, "no second debit, no duplicate offer, and the offer is to the dispatchable partner only",
    m.txns === 1 && m.journals === 1 && !final.attempts.some((a) => a.n > 1) && final.attempts.every((a) => a.provider_id === p.providerId) ? "PASS" : "FAIL",
    `wallet txns ${m.txns}, journals ${m.journals}; attempts ${JSON.stringify(final.attempts)}`);
  const converged = final.jobStatus !== null && final.jobStatus !== "PENDING";
  R(`${P}.C4.3`, "the assignment converges after the crash with no manual repair, and the partner's committed offer is still honoured",
    converged && accept.s === 200 && row?.provider_id === p.providerId,
    `job trail under the server's cron ${JSON.stringify(trail)}; final job ${final.jobStatus}; partner accept (fresh presence) → ${accept.s} ${accept.b}; ` +
      `booking now ${row?.status}, provider ${row?.provider_id === p.providerId ? "= the offered partner" : row?.provider_id}`);
  R(`${P}.C4.4`, "OBSERVED: a crash between the offer commit and the job update bypasses the offer-timeout path", "INFO",
    `The offer (assignment_attempts + provider "offered") and the job's DISPATCHED/timeoutAt update are separate commits with the notification ` +
      `awaited between them. A crash there leaves job PENDING with no timeoutAt, so handleTimeouts never sees it; the cron instead re-examines ` +
      `it, excludes the already-offered partner and exhausts it (NO_PROVIDER ×5 → EXHAUSTED + audit) — the same terminal state a no-response ` +
      `offer reaches through the timeout path. Measured separately: the stale "offered" status does not remove the partner from the pool (a new ` +
      `paid booking was offered to it in 517ms). Bounded and self-converging; not changed.`);
  await closeMoney("C4", f);
}

// ══ C5 — exclusive scheduler + Redis unavailable + advisory fallback + holder crash ══════════════

async function c5(): Promise<void> {
  const f = await frame("C5", "exclusive scheduler + Redis stopped + advisory anchor + holder crash + successor + Redis restored");
  const run = `7l-${RUN_TAG}-${PASS_NO}`;
  const key = `7l-leader-${RUN_TAG}-${PASS_NO}`;
  const env = { ...(process.env as Record<string, string>), DATABASE_URL: BASE_DB_URL };
  /**
   * Enough attempts to outlive the whole scenario. A first version gave each contender 40 attempts at a
   * 150ms gap; the one that was refused exhausted them in about six seconds, long before the holder was
   * killed, so "the successor never took over" described a harness that had already stopped competing.
   */
  const spawnOne = (label: string) => Bun.spawn(["bun", "scripts/chaos/7e-contender.ts", "--run", run, "--key", key, "--hold", "2500", "--attempts", "1500", "--gap", "300", "--ttl", "10", "--exclusive"], {
    cwd: process.cwd(), env, stdout: Bun.file(`${LOG_DIR}/7l-contender-${label}-${RUN_TAG}.log`), stderr: Bun.file(`${LOG_DIR}/7l-contender-${label}-${RUN_TAG}.log`),
  });
  const a = spawnOne("a");
  const bproc = spawnOne("b");
  const rows = async () => (await prisma.$queryRawUnsafe(`SELECT payload FROM scheduled_jobs WHERE job_type = $1 ORDER BY (payload->>'at')::bigint`, `7e-${run}`)) as Array<{ payload: { instance: string; pid: number; phase: string; at: number; startedAt?: number; endedAt?: number; leadershipLost?: boolean } }>;
  await waitFor(async () => (await rows()).some((r) => r.payload.phase === "entered"), 30_000, 300);
  await sleep(3000);
  egress("C5", "during");
  const stopped = stopRedis();
  const redisDownAt = Date.now();
  await sleep(5000);
  /** Kill whichever contender is inside the section right now. */
  const rs = await rows();
  const open = new Map<string, number>();
  for (const r of rs) {
    if (r.payload.phase === "entered") open.set(r.payload.instance, r.payload.pid);
    if (r.payload.phase === "exited") open.delete(r.payload.instance);
  }
  const holderPid = [...open.values()][0] ?? a.pid;
  /** Identify both contenders by the pid they RECORD, not by spawn handles: a wrapper process would not be the one holding the lock. */
  const seenPids = [...new Set(rs.map((r) => r.payload.pid))];
  for (const x of seenPids) extraPids.add(x);
  const survivorPid = seenPids.find((x) => x !== holderPid) ?? -1;
  const killedAt = Date.now();
  killTree(holderPid);
  const successorEntry = await waitFor(async () => (await rows()).some((r) => r.payload.phase === "entered" && r.payload.pid === survivorPid && r.payload.at > killedAt), 60_000, 300);
  await sleep(4000);
  const started = await startRedis();
  await sleep(10_000);
  killTree(survivorPid);
  killTree(a.pid);
  killTree(bproc.pid);
  await sleep(3000);
  extraPids.clear();

  const all = await rows();
  /** Occupancy intervals per instance, from "entered"/"exited" marks; an entry never exited ends at its process's death. */
  const intervals: Array<{ inst: string; pid: number; s: number; e: number }> = [];
  const openAt = new Map<string, { pid: number; s: number }>();
  for (const r of all) {
    if (r.payload.phase === "entered") openAt.set(r.payload.instance, { pid: r.payload.pid, s: r.payload.startedAt ?? r.payload.at });
    if (r.payload.phase === "exited") {
      const o = openAt.get(r.payload.instance);
      if (o) intervals.push({ inst: r.payload.instance, pid: o.pid, s: o.s, e: r.payload.endedAt ?? r.payload.at });
      openAt.delete(r.payload.instance);
    }
  }
  for (const [inst, o] of openAt) intervals.push({ inst, pid: o.pid, s: o.s, e: o.pid === holderPid ? killedAt : Date.now() });
  let overlaps = 0;
  for (let i = 0; i < intervals.length; i++) for (let j = i + 1; j < intervals.length; j++) {
    const x = intervals[i]!, y = intervals[j]!;
    if (x.inst !== y.inst && x.s < y.e && y.s < x.e) overlaps++;
  }
  const entriesDuringOutage = intervals.filter((i) => i.s >= redisDownAt && i.s < killedAt + 60_000).length;
  /**
   * A lease left behind by a holder that died while holding is expected; a POISONED lock is one that
   * never expires. So the key's TTL must be positive and within the lease, and the key must be gone once
   * that TTL has elapsed. A first version checked existence 3s after the kill and called a live lease poison.
   */
  let ttlMs = -3;
  try { ttlMs = Number(await (await observer()).pTTL(`lock:${key}`)); } catch { ttlMs = -3; }
  if (ttlMs > 0) await sleep(ttlMs + 1500);
  const redisLock = await (async () => { try { const o = await observer(); return await o.exists(`lock:${key}`); } catch { return -1; } })();
  const adv = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`)) as Array<{ n: number }>;

  R(`${P}.C5.1`, "the outage and the holder crash really happened", stopped && started && holderPid > 0,
    `Redis stopped=${stopped}, restarted=${started}; contender pids ${JSON.stringify(seenPids)}; killed the one inside the section (pid ${holderPid}) 5s into the outage; successor entered ${successorEntry === null ? "NEVER" : `${successorEntry}ms after the kill`}`);
  R(`${P}.C5.2`, "NO DOUBLE LEADERSHIP across outage, crash and recovery", overlaps === 0 && intervals.length > 2 ? "PASS" : "FAIL",
    `${intervals.length} occupancy intervals from two real processes, ${overlaps} overlapping; ${entriesDuringOutage} entries began while Redis was down (the advisory anchor arbitrating)`);
  R(`${P}.C5.3`, "no poisoned lock: a lease left by a dead holder expires on its own, and no advisory anchor survives", ttlMs !== -1 && redisLock === 0 && (adv[0]?.n ?? 0) === 0 ? "PASS" : "FAIL",
    `Redis lock:${key} TTL after the last holder died ${ttlMs}ms (-2 = already gone, -1 = NO EXPIRY); exists after that TTL elapsed=${redisLock}; advisory locks held anywhere ${adv[0]?.n ?? 0}`);
  R(`${P}.C5.4`, "recovery time: holder death to successor leadership", "INFO", `${successorEntry ?? ">60000"}ms (Redis down throughout; lease TTL 10s)`);
  await prisma.scheduledJob.deleteMany({ where: { jobType: `7e-${run}` } });
  await closeMoney("C5", f);
}

// ══ C6 — high HTTP + WS fan-out + outbox burst + Redis interruption + backend restart ════════════

async function c6(): Promise<void> {
  const f = await frame("C6", "high HTTP concurrency + WebSocket fan-out + outbox burst + Redis pause + backend restart");
  const before = await sample("C6-before", { gc: true });
  const wl = startWorkload({ base: BASE, wsBase: WS_BASE, users: customersForPass(), serviceId, publicVus: 10, runTag: RUN_TAG, seed: 70 + Number(PASS_NO), authPaceMs: 700, publicPaceMs: 150 });
  const wins: Array<{ phase: string; w: Window }> = [];
  const tick = async (phase: string) => { wins.push({ phase, w: wl.swap() }); };
  for (let i = 0; i < 8; i++) { await sleep(15_000); await tick("steady"); }
  /** The burst: 400 run-tagged copies of a real booking.created envelope. */
  const burstTag = `7l-burst-${RUN_TAG}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO event_outbox (id, event_id, event_type, event_version, aggregate_type, aggregate_id, actor_type, actor_id, payload, status, attempts, available_at, created_at, updated_at)
     SELECT gen_random_uuid()::text, x.eid, o.event_type, o.event_version, o.aggregate_type, $1, o.actor_type, o.actor_id,
            jsonb_set(o.payload, '{id}', to_jsonb(x.eid)), 'PENDING', 0, now(), now(), now()
       FROM (SELECT gen_random_uuid()::text AS eid FROM generate_series(1, 400)) x,
            LATERAL (SELECT * FROM event_outbox WHERE event_type = 'homigo.booking.created' AND status = 'PUBLISHED' ORDER BY created_at DESC LIMIT 1) o`, burstTag);
  const paused = pauseRedis(true);
  const storm = Array.from({ length: 200 }, (_, i) => new WsProbe(`${WS_BASE}/ws/notifications?token=${encodeURIComponent(customersForPass()[i % 12]!.token)}`));
  const stormOpened = (await Promise.all(storm.map((s) => s.open()))).filter(Boolean).length;
  await sleep(8000);
  storm.forEach((s) => s.abort());
  const unpaused = pauseRedis(false);
  await tick("fault");
  const k = await killHard();
  await startServer(`${P}-C6`);
  await tick("restart");
  egress("C6", "during");
  for (let i = 0; i < 8; i++) { await sleep(15_000); await tick("recover"); }
  await wl.stop();
  await tick("tail");
  const burstDrained = await waitFor(async () => {
    const r = (await prisma.$queryRawUnsafe(`SELECT count(*) FILTER (WHERE status <> 'PUBLISHED')::int AS n FROM event_outbox WHERE aggregate_id = $1`, burstTag)) as Array<{ n: number }>;
    return (r[0]?.n ?? 1) === 0;
  }, 240_000, 3000);
  await sleep(60_000);
  const after = await sample("C6-after", { gc: true });
  const created = wins.flatMap((x) => x.w.bookingsCreated);
  const conv = created.length ? await outboxConverged(created, 180_000) : 0;
  const sum = (ph: string, k2: "delivered" | "missed") => wins.filter((x) => x.phase === ph).reduce((a, x) => a + x.w[k2], 0);
  const errs = (ph: string) => wins.filter((x) => x.phase === ph).reduce((a, x) => a + Object.values(x.w.ops).reduce((b, o) => b + o.s5xx + o.net, 0), 0);
  const reqs = (ph: string) => wins.filter((x) => x.phase === ph).reduce((a, x) => a + Object.values(x.w.ops).reduce((b, o) => b + o.n, 0), 0);
  const moneyTouch = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM wallet_transactions WHERE reference_id = ANY($1::text[])`, created)) as Array<{ n: number }>;

  R(`${P}.C6.1`, "the composite really happened", paused && unpaused && stormOpened > 150 && k.gone,
    `Redis paused/unpaused read back ${paused}/${unpaused}; ${stormOpened}/200 storm sockets opened and dropped; 400-event burst injected; server killed (gone=${k.gone}) under load and restarted`);
  R(`${P}.C6.2`, "load before and after the faults, with failures confined to the fault window", errs("steady") === 0 && errs("recover") === 0 ? "PASS" : "FAIL",
    `requests steady ${reqs("steady")} (errors ${errs("steady")}), fault+restart ${reqs("fault") + reqs("restart")} (errors ${errs("fault") + errs("restart")}), ` +
      `recovery ${reqs("recover")} (errors ${errs("recover")}); client-counted delivery steady ${sum("steady", "delivered")}/${sum("steady", "delivered") + sum("steady", "missed")}, ` +
      `recovery ${sum("recover", "delivered")}/${sum("recover", "delivered") + sum("recover", "missed")}`);
  R(`${P}.C6.3`, "outbox burst and business events converged; no money touched by the workload", burstDrained !== null && conv !== null && (moneyTouch[0]?.n ?? 0) === 0 ? "PASS" : "FAIL",
    `400-event burst fully PUBLISHED after ${burstDrained ?? ">240000"}ms; ${created.length} workload bookings' events converged after ${conv}ms; wallet transactions on workload bookings ${moneyTouch[0]?.n}`);
  R(`${P}.C6.4`, "resources return to the envelope", after.probe.app.connectionMap === 0 && after.probe.app.heartbeatIntervals === 0 && after.db.total === before.db.total && after.redis?.serverClients === before.redis?.serverClients && after.db.idleInTx === 0 ? "PASS" : "FAIL",
    `before ${describe(before)}\n         after  ${describe(after)}`);
  await prisma.$executeRawUnsafe(`DELETE FROM event_consumer_receipts WHERE event_id IN (SELECT event_id FROM event_outbox WHERE aggregate_id = $1)`, burstTag).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM event_outbox WHERE aggregate_id = $1`, burstTag).catch(() => 0);
  await closeMoney("C6", f);
}

// ══ C7 — reconciliation + concurrent wallet mutation + crash + redelivery ════════════════════════

async function c7(): Promise<void> {
  const cs = customersForPass().slice(5, 9);
  const f = await frame("C7", "ledger reconciliation + concurrent wallet payments + backend crash + event redelivery");
  const { ledgerReconciliationService } = await import("../../src/services/ledger-reconciliation.service");
  for (const c of cs) await setWalletPaise(c.userId, 8_000_000);
  const plan: Array<{ c: User; id: string }> = [];
  for (const c of cs) for (let i = 0; i < 5; i++) {
    const id = await createBooking(c, `C7-${i}`);
    if (id) plan.push({ c, id });
  }
  const recon = Promise.all(Array.from({ length: 4 }, () => ledgerReconciliationService.reconcile({ backfillLimit: 50, postAdjustments: false }).then(() => "ok").catch((e) => `err:${String(e).slice(0, 40)}`)));
  const payments = plan.map((x, i) => sleep(i * 40).then(() => pay(x.c, x.id, 30_000)));
  await sleep(PASS_NO === "2" ? 700 : 450);
  const k = await killHard();
  const firstOutcomes = await Promise.all(payments);
  const reconOutcomes = await recon;
  await startServer(`${P}-C7`);
  egress("C7", "during");
  const retries = await Promise.all(plan.map((x) => pay(x.c, x.id)));
  const recon2 = await ledgerReconciliationService.reconcile({ backfillLimit: 200, postAdjustments: false }).then(() => "ok").catch((e) => `err:${String(e).slice(0, 40)}`);
  const ids = plan.map((x) => x.id);
  await outboxConverged(ids, 180_000);
  const pe = (await eventsFor(ids)).map((e) => e.event_id);
  if (pe.length) await prisma.$executeRawUnsafe(`UPDATE event_outbox SET status='PENDING', locked_by=NULL, locked_at=NULL, published_at=NULL, available_at=now()-interval '1 day', created_at=now()-interval '2 days' WHERE event_id = ANY($1::text[])`, pe);
  const redelivered = await outboxConverged(ids, 180_000);
  const ms = await Promise.all(plan.map((x) => moneyFor(x.id, x.c.userId)));
  const l = await ledger();

  R(`${P}.C7.1`, "reconciliation, payments and the crash really overlapped", k.gone && firstOutcomes.some((s) => s === null),
    `${plan.length} payments in flight with 4 concurrent reconciliations; crash (gone=${k.gone}) → ${firstOutcomes.filter((s) => s === null).length} payments unanswered; ` +
      `reconciliations during the crash ${JSON.stringify(reconOutcomes)}; after recovery ${recon2}`);
  R(`${P}.C7.2`, "EVERY completed payment has exactly one journal, none has two, and none is missing",
    ms.every((m) => m.txns === 1 && m.journals === 1 && m.balanced) && l.walletDebitCoverage === 0 && l.dupJournalKeys === 0 ? "PASS" : "FAIL",
    `per payment txns/journals ${JSON.stringify(ms.map((m) => `${m.txns}/${m.journals}`))}; whole-ledger wallet debits without exactly one journal ${l.walletDebitCoverage}; ` +
      `duplicate journal keys ${l.dupJournalKeys}; retries ${JSON.stringify(retries)}; ${pe.length} events of these bookings redelivered (published after ${redelivered}ms; wallet checkout emits no event of its own)`);
  await closeMoney("C7", f);
}

// ══ C8 — outbox lease expiry + crash + redelivery (7D cross-check) ═══════════════════════════════

async function c8(): Promise<void> {
  const f = await frame("C8", "outbox claim + handler in flight + process crash + lease expiry + redelivery (7D cross-check)");
  const c = customersForPass()[9]!;
  const n = 120;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const b = await createBooking(c, `C8-${i}`);
    if (b) ids.push(b);
  }
  await outboxConverged(ids, 240_000);
  /** Stop the server, then enqueue completion events so the NEXT process claims them in one batch. */
  stopServer();
  const evIds = ids.map(() => crypto.randomUUID());
  for (let i = 0; i < ids.length; i++) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO event_outbox (id, event_id, event_type, event_version, aggregate_type, aggregate_id, actor_type, actor_id, payload, status, attempts, available_at, created_at, updated_at)
       SELECT gen_random_uuid()::text, $1, o.event_type, o.event_version, o.aggregate_type, $2, o.actor_type, o.actor_id,
              jsonb_set(jsonb_set(jsonb_set(o.payload, '{id}', to_jsonb($1::text)), '{homigo,aggregateId}', to_jsonb($2::text)), '{data,bookingId}', to_jsonb($2::text)),
              'PENDING', 0, now() - interval '1 day', now() - interval '2 days', now()
         FROM event_outbox o WHERE o.event_type = 'homigo.booking.completed' AND o.status = 'PUBLISHED' ORDER BY o.created_at DESC LIMIT 1`,
      evIds[i], ids[i]);
  }
  await startServer(`${P}-C8a`, { EVENTS_OUTBOX_BATCH_SIZE: "500", EVENTS_OUTBOX_LOCK_TIMEOUT_MS: "10000" });
  const inst = await waitFor(async () => {
    const r = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM event_outbox WHERE event_id = ANY($1::text[]) AND status = 'PROCESSING'`, evIds)) as Array<{ n: number }>;
    return (r[0]?.n ?? 0) > 0;
  }, 60_000, 30);
  const k = await killHard();
  const at = (await prisma.$queryRawUnsafe(
    `SELECT status::text AS s, count(*)::int AS n FROM event_outbox WHERE event_id = ANY($1::text[]) GROUP BY 1`, evIds)) as Array<{ s: string; n: number }>;
  const rcptAtCrash = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM event_consumer_receipts WHERE event_id = ANY($1::text[])`, evIds)) as Array<{ n: number }>;
  const jobsAtCrash = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM scheduled_jobs WHERE trigger_event_id = ANY($1::text[])`, evIds)) as Array<{ n: number }>;
  const killedAt = Date.now();
  await startServer(`${P}-C8b`, { EVENTS_OUTBOX_BATCH_SIZE: "500", EVENTS_OUTBOX_LOCK_TIMEOUT_MS: "10000" });
  egress("C8", "during");
  const conv = await waitFor(async () => {
    const r = (await prisma.$queryRawUnsafe(`SELECT count(*) FILTER (WHERE status <> 'PUBLISHED')::int AS n FROM event_outbox WHERE event_id = ANY($1::text[])`, evIds)) as Array<{ n: number }>;
    return (r[0]?.n ?? 1) === 0;
  }, 240_000, 2000);
  const attempts = (await prisma.$queryRawUnsafe(`SELECT attempts, count(*)::int AS n FROM event_outbox WHERE event_id = ANY($1::text[]) GROUP BY 1 ORDER BY 1`, evIds)) as Array<{ attempts: number; n: number }>;
  const dupRcpt = await duplicateReceipts(evIds);
  const jobs = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n, count(DISTINCT trigger_event_id)::int AS d FROM scheduled_jobs WHERE trigger_event_id = ANY($1::text[])`, evIds)) as Array<{ n: number; d: number }>;
  const redelivered = attempts.filter((a) => a.attempts > 1).reduce((s, a) => s + a.n, 0);

  R(`${P}.C8.1`, "the crash landed while a batch was genuinely claimed", inst !== null && k.gone && at.some((x) => x.s === "PROCESSING"),
    `claimed rows first seen ${inst}ms after boot; killed (gone=${k.gone}); at the crash ${JSON.stringify(at)}; receipts already written ${rcptAtCrash[0]?.n}, follow-up jobs already created ${jobsAtCrash[0]?.n}`);
  R(`${P}.C8.2`, "the stranded batch is recovered after lease expiry and redelivered without manual repair", conv !== null && redelivered > 0 ? "PASS" : "FAIL",
    `all ${evIds.length} events PUBLISHED ${conv === null ? "NEVER" : `${Math.round((Date.now() - killedAt) / 1000)}s after the kill`}; attempts distribution ${JSON.stringify(attempts)}; ${redelivered} events were dispatched more than once`);
  R(`${P}.C8.3`, "CONTAINMENT: redelivery produced no duplicate receipt and no duplicate follow-up job", dupRcpt === 0 && jobs[0]?.n === jobs[0]?.d ? "PASS" : "FAIL",
    `duplicate (consumer,event) receipts ${dupRcpt}; review_request jobs ${jobs[0]?.n} for ${jobs[0]?.d} distinct trigger events. ` +
      `This is containment by database uniqueness, NOT exactly-once execution: ${redelivered} events were handed to their handlers at least twice, ` +
      `and 7D's duplicate-handler window remains structurally open.`);
  await closeMoney("C8", f);
  /** Back to the normal configuration for whatever runs next. */
  stopServer();
  await startServer(`${P}-after-C8`);
}

// ══ C9 — booking completion + realtime loss + notification delay + follow-up + client retry ══════

async function c9(): Promise<void> {
  const c = customersForPass()[10]!;
  const p = await ensurePartner();
  const f = await frame("C9", "booking completion + realtime loss + notification delay + scheduled follow-up + client retry");
  await setWalletPaise(c.userId, 5_000_000);
  const b = await createBooking(c, "C9");
  if (!b) return R(`${P}.C9.0`, "C9 fixture", "NOT_PROVEN", "booking create failed");
  const paid = await pay(c, b);
  /**
   * Fixture shortcut, stated plainly: accept → en-route → arrive → start-PIN is replaced by writing the
   * state those steps leave (assigned provider, IN_PROGRESS, startedAt). Completion itself — earnings,
   * ledger, outbox event, realtime publish, follow-up scheduling — runs through the real HTTP route.
   */
  await prisma.$executeRawUnsafe(`UPDATE bookings SET provider_id = $2, status = 'IN_PROGRESS', started_at = now() - interval '40 minutes' WHERE id = $1`, b, p.providerId);
  const ws = new WsProbe(`${WS_BASE}/ws/booking/${b}?token=${encodeURIComponent(c.token)}`);
  await ws.open();
  ws.abort();
  const lk = lockTable("notifications", 60_000);
  await lk.started;
  const complete = (ms: number) => fetch(`${BASE}/api/bookings/${b}/complete`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.token}`, "x-forwarded-for": p.ip }, body: JSON.stringify({ latitude: 19.076, longitude: 72.8777 }),
    signal: AbortSignal.timeout(ms),
  }).then((r) => r.status as number | null).catch(() => null);
  const first = await complete(300);
  const r1 = await complete(30_000);
  const r2 = await complete(30_000);
  await sleep(3000);
  const stall = await waitersOn();
  lk.release();
  await lk.ended;
  egress("C9", "during");
  const conv = await outboxConverged([b], 180_000);
  const followUp = await waitFor(async () => {
    const r = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM scheduled_jobs WHERE trigger_event_id IN (SELECT event_id FROM event_outbox WHERE aggregate_id = $1 AND event_type = 'homigo.booking.completed')`, b)) as Array<{ n: number }>;
    return (r[0]?.n ?? 0) > 0;
  }, 60_000, 2000);
  const ev = await eventsFor([b]);
  const types = ev.reduce((a, e) => ((a[e.event_type] = (a[e.event_type] ?? 0) + 1), a), {} as Record<string, number>);
  const earnings = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM earnings WHERE booking_id = $1`, b)) as Array<{ n: number }>;
  const earnJ = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM journal_entries WHERE idempotency_key = $1`, `provider_earning:${b}`)) as Array<{ n: number }>;
  const jobs = (await prisma.$queryRawUnsafe(`SELECT job_type, count(*)::int AS n FROM scheduled_jobs WHERE trigger_event_id IN (SELECT event_id FROM event_outbox WHERE aggregate_id = $1) GROUP BY 1`, b)) as Array<{ job_type: string; n: number }>;
  const row = await bookingRow(b);
  const ws2 = new WsProbe(`${WS_BASE}/ws/booking/${b}?token=${encodeURIComponent(c.token)}`);
  await ws2.open();
  await waitFor(async () => ws2.frames.some((x) => x.msg.type === "BOOKING_STATUS"), 6000, 50);
  /** The status snapshot specifically — a first version read whatever frame came first and got "". */
  const snapFrame = ws2.frames.find((x) => x.msg.type === "BOOKING_STATUS");
  const snapStatus = String(((snapFrame?.msg.data ?? {}) as Record<string, unknown>).status ?? "");
  const api9 = (await fetch(`${BASE}/api/bookings/${b}`, { headers: { authorization: `Bearer ${c.token}`, "x-forwarded-for": c.ip } }).then((r) => r.json()).catch(() => null)) as { data?: { status?: string; booking?: { status?: string } } } | null;
  const apiStatus = String(api9?.data?.status ?? api9?.data?.booking?.status ?? "");
  ws2.close();
  const m = await moneyFor(b, c.userId);

  R(`${P}.C9.1`, "realtime loss, the notification stall and the ambiguous client really happened", first === null && stall >= 0 && paid === 200,
    `pay → ${paid}; customer socket dropped before completion; notifications held ACCESS EXCLUSIVE (${stall} server session(s) waiting at release); ` +
      `partner's first complete aborted at 300ms → ${first === null ? "no response" : first}; retries → ${r1}, ${r2}`);
  R(`${P}.C9.2`, "ONE transition, ONE earning, ONE provider journal, ONE completion event",
    row?.status === "COMPLETED" && (earnings[0]?.n ?? 0) === 1 && (earnJ[0]?.n ?? 0) === 1 && (types["homigo.booking.completed"] ?? 0) === 1 && m.txns === 1 ? "PASS" : "FAIL",
    `booking ${row?.status}; earnings ${earnings[0]?.n}; provider_earning journals ${earnJ[0]?.n}; events ${JSON.stringify(types)}; customer wallet debits still ${m.txns}`);
  R(`${P}.C9.3`, "the scheduled follow-up is created exactly once, and a reconnecting client sees the authoritative state",
    followUp !== null && jobs.every((j) => j.n === 1) && snapStatus.toLowerCase().includes("complet") && apiStatus.toLowerCase().includes("complet") && conv !== null ? "PASS" : "FAIL",
    `follow-up jobs ${JSON.stringify(jobs)} (first seen after ${followUp}ms); outbox converged after ${conv}ms; reconnecting client's status snapshot "${snapStatus}", authoritative API "${apiStatus}"`);
  await closeMoney("C9", f);
}

// ══ C10 — long mixed load + multi-failure ════════════════════════════════════════════════════════

async function c10(): Promise<void> {
  const minutes = Number(arg("c10min", PASS_NO === "2" ? "12" : "15"));
  const f = await frame("C10", `steady mixed load ${minutes}m + Redis pause, restart, WS churn, DB pressure, event burst + cooldown`);
  const base = await sample("C10-idle", { gc: true, heap: true });
  const wl = startWorkload({ base: BASE, wsBase: WS_BASE, users: customersForPass(), serviceId, publicVus: 4, runTag: RUN_TAG, seed: 90 + Number(PASS_NO), authPaceMs: 1500, publicPaceMs: 450 });
  const faults: Array<[string, () => Promise<string>]> = [
    ["redis-pause", async () => { const a = pauseRedis(true); await sleep(25_000); const b = pauseRedis(false); return `pause ${a}, unpause ${b}`; }],
    ["restart", async () => { const k = await killHard(); await startServer(`${P}-C10r`); return `killed ${k.pid} gone=${k.gone}, restarted pid ${server?.pid}`; }],
    ["ws-churn", async () => { const s = Array.from({ length: 200 }, (_, i) => new WsProbe(`${WS_BASE}/ws/notifications?token=${encodeURIComponent(customersForPass()[i % 12]!.token)}`)); const o = (await Promise.all(s.map((x) => x.open()))).filter(Boolean).length; await sleep(2000); s.forEach((x) => x.abort()); return `${o}/200 opened and dropped`; }],
    ["db-pressure", async () => { const l = lockTable("bookings", 20_000); await l.started; await sleep(8000); const w = await waitersOn(); l.release(); await l.ended; return `bookings locked 8s, ${w} waiters`; }],
    ["event-burst", async () => {
      await prisma.$executeRawUnsafe(`INSERT INTO event_outbox (id, event_id, event_type, event_version, aggregate_type, aggregate_id, actor_type, actor_id, payload, status, attempts, available_at, created_at, updated_at)
        SELECT gen_random_uuid()::text, x.eid, o.event_type, o.event_version, o.aggregate_type, $1, o.actor_type, o.actor_id, jsonb_set(o.payload, '{id}', to_jsonb(x.eid)), 'PENDING', 0, now(), now(), now()
          FROM (SELECT gen_random_uuid()::text AS eid FROM generate_series(1, 300)) x,
               LATERAL (SELECT * FROM event_outbox WHERE event_type = 'homigo.booking.created' AND status = 'PUBLISHED' ORDER BY created_at DESC LIMIT 1) o`, `7l-c10burst-${RUN_TAG}`);
      return "300 events injected"; }],
  ];
  const order = PASS_NO === "2" ? [4, 3, 2, 1, 0] : [0, 1, 2, 3, 4];
  const slotMs = (minutes * 60_000) / (order.length + 2);
  const wins: Array<{ phase: string; w: Window }> = [];
  const samples: Sample[] = [];
  const outcomes: string[] = [];
  const runSlot = async (phase: string) => { const end = Date.now() + slotMs; while (Date.now() < end) { await sleep(15_000); wins.push({ phase, w: wl.swap() }); samples.push(await sample(phase)); } };
  await runSlot("steady-early");
  for (const i of order) { const [name, fn] = faults[i]!; outcomes.push(`${name}: ${await fn().catch((e) => `FAILED ${(e as Error).message}`)}`); egress("C10", name); await runSlot(`after-${name}`); }
  await runSlot("steady-late");
  await wl.stop();
  const created = wins.flatMap((x) => x.w.bookingsCreated);
  await sleep(120_000);
  const cool = await sample("C10-cool", { gc: true, heap: true });
  const burst = (await prisma.$queryRawUnsafe(`SELECT count(*) FILTER (WHERE status <> 'PUBLISHED')::int AS n FROM event_outbox WHERE aggregate_id = $1`, `7l-c10burst-${RUN_TAG}`)) as Array<{ n: number }>;
  const conv = await outboxConverged(created, 120_000);
  const errs = (ph: string) => wins.filter((x) => x.phase === ph).reduce((a, x) => a + Object.values(x.w.ops).reduce((b, o) => b + o.s5xx + o.net, 0), 0);
  const deliv = wins.reduce((a, x) => a + x.w.delivered, 0);
  const expect = wins.reduce((a, x) => a + x.w.delivered + x.w.missed, 0);
  const early = samples.filter((s) => s.phase === "steady-early");
  const late = samples.filter((s) => s.phase === "steady-late");
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const rssE = mean(early.map((s) => s.probe.memory.rss / 1048576));
  const rssL = mean(late.map((s) => s.probe.memory.rss / 1048576));

  R(`${P}.C10.1`, "every fault was injected and verified", outcomes.every((o) => !o.includes("FAILED") && !o.includes("false")), outcomes.join("; "));
  R(`${P}.C10.2`, "steady state before the faults equals steady state after them", errs("steady-early") === 0 && errs("steady-late") === 0 && Math.abs(rssL - rssE) < 80 ? "PASS" : "FAIL",
    `errors early ${errs("steady-early")}, late ${errs("steady-late")}; RSS early ${Math.round(rssE)}MB, late ${Math.round(rssL)}MB; delivery ${deliv}/${expect}`);
  R(`${P}.C10.3`, "after cooldown everything converged: outbox, burst, sockets, registries, DB, Redis, memory",
    (burst[0]?.n ?? 1) === 0 && conv !== null && cool.probe.app.connectionMap === 0 && cool.probe.app.heartbeatIntervals === 0 && cool.db.idleInTx === 0 &&
      cool.db.total === base.db.total && cool.redis?.serverClients === base.redis?.serverClients && Math.abs(mb(cool.probe.memory.heapUsed) - mb(base.probe.memory.heapUsed)) < 30 ? "PASS" : "FAIL",
    `idle ${describe(base)}\n         cool ${describe(cool)}\n         burst not yet published ${burst[0]?.n}; workload events converged after ${conv}ms`);
  await prisma.$executeRawUnsafe(`DELETE FROM event_consumer_receipts WHERE event_id IN (SELECT event_id FROM event_outbox WHERE aggregate_id = $1)`, `7l-c10burst-${RUN_TAG}`).catch(() => 0);
  await prisma.$executeRawUnsafe(`DELETE FROM event_outbox WHERE aggregate_id = $1`, `7l-c10burst-${RUN_TAG}`).catch(() => 0);
  await closeMoney("C10", f);
}

/**
 * Diagnostic for C4: what happens to an assignment whose offer committed but whose job never reached
 * DISPATCHED because the process died in between. Control releases the stall in-process instead.
 */
async function c4probe(): Promise<void> {
  const p = await ensurePartner();
  for (const variant of ["control", "crash"] as const) {
    const c = customersForPass()[variant === "control" ? 5 : 6]!;
    console.log(`\n── ${P}.c4probe · ${variant} ──`);
    await setWalletPaise(c.userId, 5_000_000);
    await freshenPresence(p);
    const b = await createBooking(c, `c4probe-${variant}`);
    if (!b) { console.log("  booking create failed"); continue; }
    const lk = lockTable("notifications", 150_000);
    await lk.started;
    await pay(c, b);
    await waitFor(async () => (await readDispatch(b)).attempts.length > 0, 45_000, 300);
    if (variant === "crash") {
      await killHard();
      await startServer(`${P}-c4probe`);
    }
    lk.release();
    await lk.ended;
    const t0 = Date.now();
    const trail: string[] = [];
    let lastBeat = 0;
    while (Date.now() - t0 < 300_000) {
      if (Date.now() - lastBeat > 20_000) { await freshenPresence(p); lastBeat = Date.now(); }
      const j = (await prisma.$queryRawUnsafe(`SELECT status::text AS s, dispatch_attempts AS da, timeout_at AS ta FROM assignment_jobs WHERE booking_id = $1`, b)) as Array<{ s: string; da: number; ta: Date | null }>;
      const pr = (await prisma.$queryRawUnsafe(`SELECT current_status AS cs FROM providers WHERE id = $1`, p.providerId)) as Array<{ cs: string }>;
      const au = (await prisma.$queryRawUnsafe(`SELECT action, count(*)::int AS n FROM assignment_audits WHERE job_id = (SELECT id FROM assignment_jobs WHERE booking_id = $1) GROUP BY 1`, b)) as Array<{ action: string; n: number }>;
      trail.push(`t+${Math.round((Date.now() - t0) / 1000)}s job=${j[0]?.s} dispatchAttempts=${j[0]?.da} timeoutAt=${j[0]?.ta ? "set" : "null"} provider=${pr[0]?.cs} audits=${JSON.stringify(au)}`);
      if (j[0]?.s === "EXHAUSTED") break;
      await sleep(15_000);
    }
    console.log(`  ${trail.join("\n  ")}`);
    await freshenPresence(p);
    const acc = await fetch(`${BASE}/api/bookings/${b}/accept`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.token}`, "x-forwarded-for": p.ip }, body: "{}" })
      .then(async (r) => `${r.status} ${(await r.text()).slice(0, 200)}`).catch(() => "net");
    const row = await bookingRow(b);
    const d = await readDispatch(b);
    console.log(`  accept with fresh presence → ${acc}\n  booking ${row?.status} provider=${row?.provider_id ? "assigned" : "null"}; job ${d.jobStatus}; attempts ${JSON.stringify(d.attempts)}`);
    await cancelBooking(c, b).catch(() => null);
    await prisma.$executeRawUnsafe(`UPDATE providers SET current_status = 'available' WHERE id = $1`, p.providerId);
  }
}

/**
 * Diagnostic 2 for C4: the crash-stranded job, processed by the server's OWN cron. The booking is
 * moved to the head of the assignment queue (ordering only — 3,397 stale test bookings would otherwise
 * keep the cron from reaching it for hours), and a second paid booking tests whether the stale
 * "offered" status removes the partner from the dispatch pool.
 */
async function c4probe2(): Promise<void> {
  const p = await ensurePartner();
  const c = customersForPass()[7]!;
  await setWalletPaise(c.userId, 5_000_000);
  await freshenPresence(p);
  const b = await createBooking(c, "c4probe2");
  if (!b) return;
  const lk = lockTable("notifications", 150_000);
  await lk.started;
  await pay(c, b);
  await waitFor(async () => (await readDispatch(b)).attempts.length > 0, 45_000, 300);
  await killHard();
  await startServer(`${P}-c4probe2`);
  lk.release();
  await lk.ended;
  await prisma.$executeRawUnsafe(`UPDATE bookings SET priority_score = 1000000 WHERE id = $1`, b);
  const trail: string[] = [];
  const t0 = Date.now();
  let lastBeat = 0;
  let exhausted = false;
  while (Date.now() - t0 < 360_000) {
    if (Date.now() - lastBeat > 20_000) { await freshenPresence(p); lastBeat = Date.now(); }
    const j = (await prisma.$queryRawUnsafe(`SELECT status::text AS s, dispatch_attempts AS da, timeout_at AS ta FROM assignment_jobs WHERE booking_id = $1`, b)) as Array<{ s: string; da: number; ta: Date | null }>;
    const pr = (await prisma.$queryRawUnsafe(`SELECT current_status AS cs FROM providers WHERE id = $1`, p.providerId)) as Array<{ cs: string }>;
    const au = (await prisma.$queryRawUnsafe(`SELECT action, count(*)::int AS n FROM assignment_audits WHERE job_id = (SELECT id FROM assignment_jobs WHERE booking_id = $1) GROUP BY 1`, b)) as Array<{ action: string; n: number }>;
    trail.push(`t+${Math.round((Date.now() - t0) / 1000)}s job=${j[0]?.s} da=${j[0]?.da} timeoutAt=${j[0]?.ta ? "set" : "null"} provider=${pr[0]?.cs} audits=${JSON.stringify(au)}`);
    if (j[0]?.s === "EXHAUSTED" || (j[0]?.s !== "PENDING" && j[0]?.s)) { exhausted = j[0]?.s === "EXHAUSTED"; break; }
    await sleep(15_000);
  }
  console.log(`  stranded job under the server's own cron:\n  ${trail.join("\n  ")}`);
  const alerts = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM assignment_audits WHERE job_id = (SELECT id FROM assignment_jobs WHERE booking_id = $1) AND action ILIKE '%EXHAUST%'`, b)) as Array<{ n: number }>;
  // Is the partner still in the dispatch pool while its stale offer says "offered"?
  await freshenPresence(p);
  const c2 = customersForPass()[8]!;
  await setWalletPaise(c2.userId, 5_000_000);
  const b2 = await createBooking(c2, "c4probe2-second");
  if (b2) await pay(c2, b2);
  const offered2 = b2 ? await waitFor(async () => (await readDispatch(b2)).attempts.some((a) => a.provider_id === p.providerId), 45_000, 500) : null;
  const pr2 = (await prisma.$queryRawUnsafe(`SELECT current_status AS cs FROM providers WHERE id = $1`, p.providerId)) as Array<{ cs: string }>;
  console.log(`  exhausted=${exhausted} exhaust audits=${alerts[0]?.n}; a NEW paid booking was offered to the same partner: ${offered2 === null ? "NO" : `yes after ${offered2}ms`} (partner status then ${pr2[0]?.cs})`);
  await cancelBooking(c, b).catch(() => null);
  if (b2) await cancelBooking(c2, b2).catch(() => null);
  await prisma.$executeRawUnsafe(`UPDATE providers SET current_status = 'available' WHERE id = $1`, p.providerId);
}

// ══ main ═════════════════════════════════════════════════════════════════════════════════════════

console.log(`\nSECTION 7L — FINAL COMPOSITE CHAOS · pass ${PASS_NO} · run ${RUN_TAG}`);
const foreign7l = [3100, 3200, 3300, 3400, 3500, 3600, 3700, 3701, PORT, PROBE_PORT].map((p) => ({ p, pid: listenerPidOn(p) })).filter((x) => x.pid !== null);
if (foreign7l.length) throw new Error(`7L SETUP: foreign listeners before the run: ${JSON.stringify(foreign7l)}`);
const pre = await redisView();
if (!pre || pre.serverClients !== 0) throw new Error(`7L SETUP: :6380 not clean (${pre?.serverClients ?? "unreachable"} foreign clients)`);
console.log(`  contamination: no chaos listeners; :6380 holds only the observer; developer servers use :3000/:6379/homigo_db and are not targeted`);

/**
 * Cleanup only: run one guarded server until nothing in the outbox is left undelivered, then stop it
 * while it is idle so nothing is stranded in PROCESSING. No checks are recorded as composite evidence.
 */
if (selected.has("drainonly")) {
  await startServer("drain", { EVENTS_OUTBOX_LOCK_TIMEOUT_MS: "10000", EVENTS_OUTBOX_BATCH_SIZE: "200" });
  const t0 = Date.now();
  let left = -1;
  while (Date.now() - t0 < 900_000) {
    const r = (await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM event_outbox WHERE status IN ('PENDING','PROCESSING')`)) as Array<{ n: number }>;
    left = r[0]?.n ?? -1;
    if (left === 0) break;
    await sleep(5000);
  }
  await sleep(6000);
  const eg = egressCheck();
  stopServer();
  let googleResponses = 0;
  for (const lp of serverLogPaths) googleResponses += ((await Bun.file(lp).text().catch(() => "")).match(/Billing has not been enabled/g) ?? []).length;
  console.log(`DRAIN: undelivered left ${left} after ${Math.round((Date.now() - t0) / 1000)}s; external sockets ${JSON.stringify(eg.external)}; Google responses in logs ${googleResponses}`);
  const o0 = obs as Obs | null;
  if (o0) await o0.quit().catch(() => {});
  await prisma.$disconnect();
  process.exit(left === 0 ? 0 : 1);
}

let code7l = 0;
try {
  const swept = await sweep7l();
  if (swept) console.log(`  swept ${swept} booking(s) from earlier 7L runs`);
  await startServer(`${P}-main`);
  await ensureBase();
  const pc = await positiveControls();
  if (!pc) {
    R(`${P}.gate`, "composites refused: a positive control failed", "FAIL", "see the G checks above");
  } else {
    if (selected.has("c4probe")) await c4probe();
    if (selected.has("c4probe2")) await c4probe2();
    for (const [name, fn] of [["C1", c1], ["C2", c2], ["C3", c3], ["C4", c4], ["C5", c5], ["C6", c6], ["C7", c7], ["C8", c8], ["C9", c9], ["C10", c10]] as const) {
      if (!want(name) && !selected.has("all")) continue;
      try {
        if (!server) await startServer(`${P}-${name}`);
        await fn();
      } catch (e) {
        R(`${P}.${name}.crash`, `${name} aborted`, "FAIL", (e as Error).stack?.slice(0, 600) ?? String(e));
        if (!server) await startServer(`${P}-${name}-recover`).catch(() => undefined);
      }
    }
  }
} finally {
  stopServer();
  const restored = restoreRedisIfNeeded();
  if (restored !== "already running") console.log(`  [restore] isolated Redis ${restored}`);
  const swept = await sweep7l();
  console.log(`\n── ${P} POST-RUN ──  swept ${swept} 7L booking(s)`);
  R(`${P}.Z1`, "no 7L listener left", listenerPidOn(PORT) === null && listenerPidOn(PROBE_PORT) === null ? "PASS" : "FAIL", `:${PORT} ${listenerPidOn(PORT)} :${PROBE_PORT} ${listenerPidOn(PROBE_PORT)}`);
  R(`${P}.Z0`, "no machine suspend during the run", clockJumps === 0 ? "PASS" : "FAIL", `clock jumps ${clockJumps}`);
  const lf = await ledger();
  R(`${P}.Z2`, "whole ledger after cleanup", ledgerViolations(lf).length === 0 ? "PASS" : "FAIL", ledgerViolations(lf).join(", ") || "clean");
  const fails = checks.filter((c) => c.status === "FAIL");
  console.log(`\n══ 7L ${P} RESULT ═══  PASS=${checks.filter((c) => c.status === "PASS").length} FAIL=${fails.length} NOT_PROVEN=${checks.filter((c) => c.status === "NOT_PROVEN").length} INFO=${checks.filter((c) => c.status === "INFO").length}`);
  for (const x of fails) console.log(`  FAIL ${x.id} ${x.title}\n       ${x.detail.slice(0, 600)}`);
  code7l = fails.length ? 1 : 0;
  const o = obs as Obs | null;
  if (o) await o.quit().catch(() => {});
  await prisma.$disconnect();
}
process.exit(code7l);
