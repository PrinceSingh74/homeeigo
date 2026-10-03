/**
 * SECTION 7K — in-process resource probe. HARNESS CODE, never imported by the application.
 *
 * Loaded into the soak server with `bun --preload`, so it runs before any application module and can
 * observe what `/metrics` does not expose: live JS timers by call site, event-loop lag, CPU time, the
 * module-private registries that hold per-connection and per-client state, and heap object counts.
 * Production code is not modified to make any of this visible — a soak section that changes the
 * system to observe it would be measuring a different system.
 *
 * It refuses to activate unless the process is pointed at isolated infrastructure, and it fails
 * loudly: a probe that silently returns zeroes reads exactly like a healthy, leak-free server.
 */

const PROBE_PORT = Number(process.env.SEVEN_K_PROBE_PORT ?? 0);
const dbUrl = process.env.DATABASE_URL ?? "";
const redisUrl = process.env.REDIS_URL ?? "";

if (!PROBE_PORT) {
  throw new Error("7K PROBE: SEVEN_K_PROBE_PORT is not set — refusing to run a probe with nowhere to report.");
}
if (!/\/homigo_test(\?|$)/.test(dbUrl)) {
  throw new Error(`7K PROBE: DATABASE_URL is not homigo_test — refusing to instrument a non-isolated process.`);
}
if (!/:6380(\/|$)/.test(redisUrl)) {
  throw new Error(`7K PROBE: REDIS_URL is not the isolated :6380 instance — refusing to instrument.`);
}

// ── egress: the soak server talks to nothing outside this machine ─────────────────────────────────

/**
 * The first 7K boots found the server holding 33 TLS connections to 34.160.81.0 — the REAL Sentry
 * ingest for this project — within eight seconds of starting idle. `SENTRY_DSN` is not in
 * `runtimeEnvPreserve`, so `.env` (loaded with override:true) restores it whatever the process
 * environment says, and every non-production environment traces at 100%. A soak run would have sent a
 * transaction per request to production monitoring.
 *
 * Egress is therefore refused at the network boundary, the way a firewall would: every application
 * code path still runs, the Sentry SDK included, and only the outbound request fails. Each refused
 * destination is counted, and the harness separately checks the OS socket table for any external
 * connection, so a client that bypasses `fetch` cannot slip through unseen.
 */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const egressRefused = new Map<string, number>();
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  let host = "unparseable";
  try {
    host = new URL(href).hostname;
  } catch {
    /* fall through with the placeholder */
  }
  if (!LOOPBACK.has(host)) {
    egressRefused.set(host, (egressRefused.get(host) ?? 0) + 1);
    throw new TypeError(`7K isolation: outbound request to ${host} refused by the soak harness`);
  }
  return origFetch(input as never, init);
}) as typeof fetch;

// ── egress at the node networking layer ──────────────────────────────────────────────────────────

/**
 * `fetch` is not the only way out. The Twilio SDK (OTP / SMS) goes through axios and node's http
 * stack, and SMTP clients open raw TLS sockets; a fetch-only guard lets both through. Sections 7I and
 * 7J logged "[OTP] Twilio send failed" — the request reached Twilio's API and was rejected only because
 * the trial account refuses unverified numbers.
 *
 * The node-level client entry points are wrapped the same way: loopback is allowed, anything else is
 * refused before a socket exists. A self-test below proves the wrap actually covers node:https rather
 * than assuming it does.
 */
function hostOf(arg: unknown): string | null {
  try {
    if (typeof arg === "string") return new URL(arg).hostname;
    if (arg instanceof URL) return arg.hostname;
    if (arg && typeof arg === "object") {
      const o = arg as { hostname?: string; host?: string };
      return (o.hostname ?? o.host ?? "localhost").replace(/:\d+$/, "");
    }
  } catch {
    return "unparseable";
  }
  return null;
}
function refuseIfExternal(kind: string, host: string | null): void {
  const h = (host ?? "localhost").replace(/^\[|\]$/g, "");
  if (!LOOPBACK.has(h) && h !== "::1") {
    egressRefused.set(`${kind}:${h}`, (egressRefused.get(`${kind}:${h}`) ?? 0) + 1);
    throw new Error(`7K/7L isolation: ${kind} connection to ${h} refused by the harness`);
  }
}
{
  // The CommonJS-shaped default objects: ESM namespaces are read-only, and these are what
  // `require("https")` / `import https from "https"` — axios, the Twilio SDK, SMTP clients — resolve to.
  const http = (await import("node:http")).default;
  const https = (await import("node:https")).default;
  const net = (await import("node:net")).default;
  const tls = (await import("node:tls")).default;
  for (const [name, mod] of [["http", http], ["https", https]] as const) {
    const m = mod as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const fn of ["request", "get"]) {
      const orig = m[fn]!.bind(mod);
      m[fn] = (...a: unknown[]) => {
        refuseIfExternal(name, hostOf(a[0]));
        return orig(...a);
      };
    }
  }
  const n = net as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const fn of ["connect", "createConnection"]) {
    const orig = n[fn]!.bind(net);
    n[fn] = (...a: unknown[]) => {
      const first = a[0];
      refuseIfExternal("net", typeof first === "object" && first ? ((first as { host?: string }).host ?? "localhost") : typeof a[1] === "string" ? (a[1] as string) : "localhost");
      return orig(...a);
    };
  }
  const t = tls as unknown as Record<string, (...a: unknown[]) => unknown>;
  const origTls = t.connect!.bind(tls);
  t.connect = (...a: unknown[]) => {
    const first = a[0];
    refuseIfExternal("tls", typeof first === "object" && first ? ((first as { host?: string; servername?: string }).host ?? "localhost") : typeof a[1] === "string" ? (a[1] as string) : "localhost");
    return origTls(...a);
  };
}

let egressSelfTest = "pending";
/**
 * The client stacks the application's external integrations actually use, each pointed at a harmless
 * host. Every one must be refused or fail to connect; "CONNECTED" means that stack bypasses isolation.
 */
const egressStackTests: Record<string, string> = {};
async function stackTest(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    const r = await Promise.race([fn(), new Promise((res) => globalThis.setTimeout(() => res("timeout"), 8000))]);
    egressStackTests[name] = r === "timeout" ? "timeout (no connection within 8s)" : `CONNECTED — ${String(r).slice(0, 60)}`;
  } catch (e) {
    egressStackTests[name] = `refused: ${(e as Error).message.slice(0, 90)}`;
  }
}
{
  const https = (await import("node:https")).default;
  egressSelfTest = await new Promise<string>((resolve) => {
    try {
      const req = https.request("https://example.com/", (r) => resolve(`CONNECTED status=${r.statusCode} — node:https BYPASSES the guard`));
      req.on("error", (e) => resolve(`refused: ${e.message}`));
      req.end();
      globalThis.setTimeout(() => resolve("timeout"), 8000);
    } catch (e) {
      resolve(`refused: ${(e as Error).message}`);
    }
  });
}

void (async () => {
  await stackTest("gaxios (google-auth / BigQuery path)", async () => {
    const g = (await import("gaxios")) as unknown as { request: (o: object) => Promise<{ status: number }> };
    const r = await g.request({ url: "https://example.com/", retry: false });
    return r.status;
  });
  await stackTest("teeny-request (BigQuery)", async () => {
    const tr = (await import("teeny-request")) as unknown as { teenyRequest: (o: object, cb: (e: unknown, r: { statusCode: number }) => void) => void };
    return await new Promise((res, rej) => tr.teenyRequest({ uri: "https://example.com/" }, (e, r) => (e ? rej(e) : res(r.statusCode))));
  });
  await stackTest("axios (Twilio path)", async () => {
    const ax = (await import("axios")).default;
    const r = await ax.get("https://example.com/", { timeout: 6000 });
    return r.status;
  });
  await stackTest("node-fetch", async () => {
    const nf = (await import("node-fetch")).default as unknown as (u: string) => Promise<{ status: number }>;
    const r = await nf("https://example.com/");
    return r.status;
  });
})();

// ── timers ────────────────────────────────────────────────────────────────────────────────────────

const orig = {
  setInterval: globalThis.setInterval.bind(globalThis),
  clearInterval: globalThis.clearInterval.bind(globalThis),
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
};

const liveIntervals = new Map<unknown, string>();
const liveTimeouts = new Map<unknown, string>();
let intervalsCreated = 0;
let timeoutsCreated = 0;

/**
 * A timer is keyed by its numeric id where the runtime provides one, because callers may clear with
 * either the object or its primitive. Keying on the object alone would miss `clearTimeout(+t)` and
 * report a leak that is really a bookkeeping gap in the probe.
 */
function keyOf(h: unknown): unknown {
  if (typeof h === "number") return h;
  const n = Number(h as never);
  return Number.isFinite(n) ? n : h;
}

function callSite(): string {
  const lines = (new Error().stack ?? "").split("\n").slice(2);
  for (const line of lines) {
    if (line.includes("7k-probe")) continue;
    const m = line.match(/(src[\\/][^:)]+):(\d+)/);
    if (m) return `${m[1]!.replace(/\\/g, "/")}:${m[2]}`;
    const n = line.match(/node_modules[\\/](.+?)[\\/]/);
    if (n) return `node_modules/${n[1]}`;
  }
  return "other";
}

globalThis.setInterval = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
  const h = orig.setInterval(fn, ms, ...args);
  liveIntervals.set(keyOf(h), callSite());
  intervalsCreated += 1;
  return h;
}) as typeof setInterval;

globalThis.clearInterval = ((h: unknown) => {
  if (h !== undefined && h !== null) liveIntervals.delete(keyOf(h));
  return orig.clearInterval(h as never);
}) as typeof clearInterval;

globalThis.setTimeout = ((fn: unknown, ms?: number, ...args: unknown[]) => {
  if (typeof fn !== "function") return orig.setTimeout(fn as never, ms, ...args);
  let key: unknown = null;
  const wrapped = (...a: unknown[]) => {
    liveTimeouts.delete(key);
    return (fn as (...x: unknown[]) => unknown)(...a);
  };
  const h = orig.setTimeout(wrapped, ms, ...args);
  key = keyOf(h);
  liveTimeouts.set(key, callSite());
  timeoutsCreated += 1;
  return h;
}) as typeof setTimeout;

globalThis.clearTimeout = ((h: unknown) => {
  if (h !== undefined && h !== null) liveTimeouts.delete(keyOf(h));
  return orig.clearTimeout(h as never);
}) as typeof clearTimeout;

function groupBySite(m: Map<unknown, string>, top = 25): Record<string, number> {
  const g = new Map<string, number>();
  for (const s of m.values()) g.set(s, (g.get(s) ?? 0) + 1);
  return Object.fromEntries([...g.entries()].sort((a, b) => b[1] - a[1]).slice(0, top));
}

// ── event-loop lag ────────────────────────────────────────────────────────────────────────────────

/**
 * A 50ms self-rescheduling tick on the ORIGINAL setTimeout, so the sampler neither appears in the
 * timer census nor depends on the patched path. Lag is how late each tick fires.
 */
const LAG_TICK_MS = 50;
let lagWindow: number[] = [];
let lagMaxEver = 0;
let lagSamplesEver = 0;
function lagTick(expected: number): void {
  const t = orig.setTimeout(() => {
    const now = performance.now();
    const lag = Math.max(0, now - expected);
    lagWindow.push(lag);
    if (lagWindow.length > 20_000) lagWindow = lagWindow.slice(-10_000);
    lagMaxEver = Math.max(lagMaxEver, lag);
    lagSamplesEver += 1;
    lagTick(now + LAG_TICK_MS);
  }, LAG_TICK_MS);
  (t as { unref?: () => void }).unref?.();
}
lagTick(performance.now() + LAG_TICK_MS);

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

// ── module-private registries, identified by value shape ──────────────────────────────────────────

/**
 * The registries most likely to grow are module-private `const x = new Map()` values with no export.
 * `Map.prototype.set` is observed until each is recognised by the SHAPE of what it stores, and a
 * WeakRef to it is kept. Nothing about the Map's behaviour changes; the probe only learns its identity
 * so it can read `.size`. A sample key is kept so the identification itself can be audited.
 */
type Tracked = { ref: WeakRef<Map<unknown, unknown>>; sampleKey: string; identifiedAt: number };
const tracked: Record<string, Tracked> = {};

const SHAPES: Array<{ name: string; test: (k: unknown, v: unknown) => boolean }> = [
  {
    name: "rateLimitFallbackStore",
    test: (k, v) =>
      typeof k === "string" && isObj(v) && hasExactly(v, ["count", "resetAt"]),
  },
  {
    name: "cacheServiceMemStore",
    test: (k, v) => typeof k === "string" && k.startsWith("cache:") && isObj(v) && hasExactly(v, ["value", "expiresAt"]),
  },
  {
    name: "idempotencyMemCache",
    test: (k, v) => typeof k === "string" && !k.startsWith("cache:") && isObj(v) && hasExactly(v, ["value", "expiresAt"]),
  },
  {
    name: "logSignatureWindows",
    test: (_k, v) => isObj(v) && "windowStart" in v && "written" in v && "suppressed" in v,
  },
];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function hasExactly(v: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(v);
  return own.length === keys.length && keys.every((k) => own.includes(k));
}

const origMapSet = Map.prototype.set;
let pendingShapes = SHAPES.length;
Map.prototype.set = function patchedSet(this: Map<unknown, unknown>, k: unknown, v: unknown) {
  if (pendingShapes > 0 && isObj(v)) {
    for (const s of SHAPES) {
      if (tracked[s.name]) continue;
      if (s.test(k, v)) {
        tracked[s.name] = { ref: new WeakRef(this), sampleKey: String(k).slice(0, 80), identifiedAt: Date.now() };
        pendingShapes -= 1;
        break;
      }
    }
  }
  return origMapSet.call(this, k, v);
} as typeof Map.prototype.set;

function registrySizes(): Record<string, { size: number | null; sampleKey: string } | "not-yet-identified"> {
  const out: Record<string, { size: number | null; sampleKey: string } | "not-yet-identified"> = {};
  for (const s of SHAPES) {
    const t = tracked[s.name];
    if (!t) {
      out[s.name] = "not-yet-identified";
      continue;
    }
    const m = t.ref.deref();
    out[s.name] = { size: m ? m.size : null, sampleKey: t.sampleKey };
  }
  return out;
}

// ── application singletons, read lazily once the app has loaded them ─────────────────────────────

const base = `${import.meta.dir}/../../src`;

async function appState(): Promise<Record<string, unknown>> {
  const hb = (await import(`${base}/lib/heartbeat.ts`)) as { heartbeatManager: Record<string, unknown> };
  const ws = (await import(`${base}/lib/websocket.ts`)) as { roomManager: Record<string, unknown> };
  const rd = (await import(`${base}/lib/redis.ts`)) as { redisClient: Record<string, unknown> };

  const hbm = hb.heartbeatManager as unknown as { intervals: Map<string, unknown>; timeouts: Map<string, unknown> };
  const rm = ws.roomManager as unknown as {
    rooms: Map<string, Set<unknown>>;
    userConnections: Map<string, Set<unknown>>;
    connectionMap: Map<string, unknown>;
    fanoutUnsub: unknown;
    instance: string;
  };
  const rc = rd.redisClient as unknown as { subscribers: unknown[]; isAvailable: boolean; healthTimer: unknown };

  let memberships = 0;
  for (const s of rm.rooms.values()) memberships += s.size;
  let userMemberships = 0;
  for (const s of rm.userConnections.values()) userMemberships += s.size;

  return {
    heartbeatIntervals: hbm.intervals.size,
    heartbeatTimeouts: hbm.timeouts.size,
    rooms: rm.rooms.size,
    roomMemberships: memberships,
    usersWithConnections: rm.userConnections.size,
    userMemberships,
    connectionMap: rm.connectionMap.size,
    fanoutSubscribed: rm.fanoutUnsub !== null && rm.fanoutUnsub !== undefined,
    wsInstance: rm.instance,
    redisSubscribers: Array.isArray(rc.subscribers) ? rc.subscribers.length : -1,
    redisAvailable: rc.isAvailable,
    redisHealthTimer: rc.healthTimer !== null && rc.healthTimer !== undefined,
  };
}

const LISTENED = ["uncaughtException", "unhandledRejection", "SIGTERM", "SIGINT", "exit", "beforeExit", "warning"];

// ── the probe endpoint ────────────────────────────────────────────────────────────────────────────

Bun.serve({
  port: PROBE_PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/snap") {
        if (url.searchParams.get("gc") === "1") Bun.gc(true);
        const lag = [...lagWindow].sort((a, b) => a - b);
        if (url.searchParams.get("reset") === "1") lagWindow = [];
        const mem = process.memoryUsage();
        const cpu = process.cpuUsage();
        const body: Record<string, unknown> = {
          pid: process.pid,
          uptimeSec: Math.round(process.uptime()),
          wallMs: Date.now(),
          monoMs: performance.now(),
          memory: mem,
          cpuMicros: { user: cpu.user, system: cpu.system },
          timers: {
            liveIntervals: liveIntervals.size,
            liveTimeouts: liveTimeouts.size,
            intervalsCreated,
            timeoutsCreated,
            intervalsBySite: groupBySite(liveIntervals, 40),
            timeoutsBySite: groupBySite(liveTimeouts, 15),
          },
          eventLoopLagMs: {
            samples: lag.length,
            p50: pct(lag, 50),
            p99: pct(lag, 99),
            max: lag.length ? lag[lag.length - 1] : 0,
            maxEver: lagMaxEver,
            samplesEver: lagSamplesEver,
          },
          registries: registrySizes(),
          app: await appState(),
          processListeners: Object.fromEntries(LISTENED.map((e) => [e, process.listenerCount(e as never)])),
          egressRefused: Object.fromEntries(egressRefused),
          egressSelfTest,
          egressStackTests,
        };
        if (url.searchParams.get("heap") === "1") {
          const jsc = (await import("bun:jsc")) as unknown as { heapStats: () => Record<string, unknown> };
          const hs = jsc.heapStats() as {
            heapSize: number;
            heapCapacity: number;
            extraMemorySize: number;
            objectCount: number;
            objectTypeCounts: Record<string, number>;
          };
          body.heap = {
            heapSize: hs.heapSize,
            heapCapacity: hs.heapCapacity,
            extraMemorySize: hs.extraMemorySize,
            objectCount: hs.objectCount,
            topTypes: Object.fromEntries(
              Object.entries(hs.objectTypeCounts).sort((a, b) => b[1] - a[1]).slice(0, 25),
            ),
          };
        }
        return Response.json(body);
      }

      /**
       * Exercise the background-loop lifecycle functions of the LIVE process and report the interval
       * census around each step. Destructive to this process's workers by design — the harness calls
       * it only on a dedicated instance that is killed afterwards.
       */
      if (url.pathname === "/lifecycle" && req.method === "POST") {
        const outbox = (await import(`${base}/events/core/outbox-processor.ts`)) as Record<string, () => void>;
        const jobs = (await import(`${base}/events/core/job-processor.ts`)) as Record<string, () => void>;
        const maint = (await import(`${base}/lib/maintenance.ts`)) as Record<string, () => void>;
        const census = () => ({ total: liveIntervals.size, bySite: groupBySite(liveIntervals, 40) });
        const steps: Array<{ step: string; census: ReturnType<typeof census> }> = [];
        steps.push({ step: "initial", census: census() });
        outbox.startOutboxProcessor!();
        jobs.startScheduledJobProcessor!();
        maint.startMaintenance!();
        steps.push({ step: "double-start while running", census: census() });
        maint.stopMaintenance!();
        steps.push({ step: "stopMaintenance", census: census() });
        maint.startMaintenance!();
        steps.push({ step: "startMaintenance after stop", census: census() });
        maint.startMaintenance!();
        steps.push({ step: "startMaintenance again (double)", census: census() });
        return Response.json({ steps });
      }

      return new Response("not found", { status: 404 });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) }, { status: 500 });
    }
  },
});
