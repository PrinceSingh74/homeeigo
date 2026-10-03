/**
 * SECTION 7G — realtime/WebSocket harness.
 *
 * The single rule this file exists to enforce: **delivery is what a CLIENT received**, never what the
 * server believed it sent. That distinction is not academic here. Every route wraps its `ws.send()`
 * in a try/catch that swallows the error, so `RoomManager.localBroadcast` increments its success
 * counter even for a socket that is gone — a server-side "delivered: 40" can legitimately mean forty
 * writes into the void. Every count in this section therefore comes from a real client object that
 * parsed a real frame.
 *
 * Isolation reuses the 7F machinery, which is already proven both ways: the local barrier fires on
 * import (before any process can be spawned) and the SERVER is asked which database it is attached to
 * rather than being trusted.
 */
import {
  type Check,
  type ServerHandle,
  type Status,
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
import { assertChaosTargetIsolated, assertServerTargetIsolated, describeDatabaseTarget, describeRedisTarget } from "../../src/lib/chaos-isolation";

export { clearPort, killTree, listenerPidOn, machineState, makeRecorder, probeHealth, stopServer, telemetry };
export type { Check, ServerHandle, Status };

/**
 * The Redis barrier fires on IMPORT, alongside the database barrier inherited from `7f-lib`.
 *
 * It first lived inside `assertRealtimeIsolation()`, which scenarios call AFTER starting their
 * server. Pointed at the live Redis, the guard did refuse — but a backend had already booted,
 * subscribed to `ws:fanout` on the developer's real Redis, and had the opportunity to publish
 * envelopes onto the channel real instances read. That is the same mistake 7F made with the database
 * and the same lesson: a guard that runs after the process exists is a report, not a guard.
 *
 * Realtime makes this sharper than HTTP did. Fan-out is a PUBLISH, so a mis-targeted realtime server
 * does not merely read the wrong data — it writes onto a channel other people's servers are
 * listening to.
 */
function assertIsolatedRedisAtImport(): void {
  const redis = describeRedisTarget();
  if (!redis || redis.port !== "6380") {
    throw new Error(
      `CHAOS SAFETY: 7G refused — REDIS_URL is ${redis?.redacted ?? "missing"}, not the isolated instance on 6380. ` +
        "Realtime fan-out PUBLISHES to Redis, so a non-isolated target would push test envelopes onto the channel real instances subscribe to.",
    );
  }
}
assertIsolatedRedisAtImport();

/** 7G owns its own port so nothing else — including the long-lived :3100 backend — is on the socket. */
export const WS_PORT = Number(process.env.SEVEN_G_PORT ?? 3300);
export const HTTP_BASE = `http://127.0.0.1:${WS_PORT}`;
export const WS_BASE = `ws://127.0.0.1:${WS_PORT}`;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `startServer` with both barriers re-asserted immediately before the spawn. The child inherits
 * DATABASE_URL and REDIS_URL, so this is the last point at which a wrong target costs nothing.
 */
export async function startRealtimeServer(opts: Parameters<typeof startServer>[0]): Promise<ServerHandle> {
  assertChaosTargetIsolated("7G server start");
  assertIsolatedRedisAtImport();
  return startServer(opts);
}

/**
 * Refuses the live database and the live Redis, and refuses a server that is not on the database it
 * claims. Redis is asserted explicitly here because realtime fan-out genuinely publishes to it —
 * pointing that at :6379 would put test envelopes on the channel the developer's own servers read.
 */
export async function assertRealtimeIsolation(scenario: string): Promise<{
  db: ReturnType<typeof describeDatabaseTarget>;
  redis: ReturnType<typeof describeRedisTarget>;
}> {
  assertChaosTargetIsolated(scenario);
  const redis = describeRedisTarget();
  if (!redis || redis.port !== "6380") {
    throw new Error(
      `7G SETUP: "${scenario}" refused — REDIS_URL is ${redis?.redacted ?? "missing"}. ` +
        "Realtime fan-out PUBLISHES to Redis, so a non-isolated target would push test envelopes onto the channel real instances subscribe to.",
    );
  }
  await assertServerTargetIsolated(HTTP_BASE, scenario);
  const health = await probeHealth(WS_PORT);
  if (!health.ready) {
    throw new Error(`7G SETUP: "${scenario}" refused — :${WS_PORT} not semantically ready (status=${health.status} database=${health.database})`);
  }
  return { db: describeDatabaseTarget(), redis };
}

/**
 * Connects THIS process's Redis client and refuses to continue without it.
 *
 * The harness acts as a second instance: it publishes fan-out envelopes that the server receives as a
 * peer. `redisClient` does not connect on import — the server does it at boot, a script must do it
 * itself — and every publish from an unconnected client is a silent no-op. The first 7G run measured
 * exactly that: zero frames delivered, which reads as a broken fan-out and was a harness that never
 * opened its socket. 7F learned this once already; this is the same lesson applied to the publisher
 * side rather than the lock side.
 */
export async function connectHarnessRedis(timeoutMs = 45_000): Promise<void> {
  const { redisClient } = await import("../../src/lib/redis");
  await redisClient.connect().catch(() => {});

  /**
   * Polls `healthCheck()` rather than reading `isAvailable` once.
   *
   * After a freeze the client marks itself unavailable on the 5s command deadline (7C) and only
   * clears that on its periodic PING, which runs every 30s. A single immediate read therefore says
   * "Redis is down" for up to half a minute after it came back — which is how a scenario that ran
   * after a freeze measured 0 deliveries and then the next scenario refused to start at all. An
   * explicit health check forces the recheck instead of waiting for the interval.
   */
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (redisClient.isAvailable) return;
    if (await redisClient.healthCheck().catch(() => false)) return;
    await sleep(2000);
  }
  throw new Error(
    `7G SETUP: the harness's own Redis client did not become available within ${timeoutMs}ms. ` +
      "Every cross-instance publish would be a silent no-op and every delivery count would be zero for a reason " +
      "that has nothing to do with the product.",
  );
}

/** Forces the client's own recheck so a post-freeze scenario does not measure a stale flag. */
export async function awaitHarnessRedisRecovery(timeoutMs = 45_000): Promise<number | null> {
  const { redisClient } = await import("../../src/lib/redis");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await redisClient.healthCheck().catch(() => false)) return Date.now() - started;
    await sleep(1000);
  }
  return null;
}

export async function disconnectHarnessRedis(): Promise<void> {
  const { redisClient } = await import("../../src/lib/redis");
  await Promise.race([redisClient.disconnect().catch(() => {}), sleep(2000)]);
}

// ── a real client that counts what it actually received ───────────────────────────────────────────

export type Received = { type: string; at: number; raw: string };

/**
 * One WebSocket client. Nothing here is inferred: `opened` is set from the open event, `closeCode`
 * from the close event, and `received` grows only when a frame is parsed. A client that never
 * completed its handshake reports `opened: false` and contributes zero to every delivery count,
 * which is what stops a "connected" client that is really a pending TCP socket from inflating a
 * fan-out result.
 */
export class WsClient {
  readonly label: string;
  readonly url: string;
  opened = false;
  closed = false;
  closeCode: number | null = null;
  closeReason = "";
  openedAt: number | null = null;
  connectMs: number | null = null;
  error: string | null = null;
  received: Received[] = [];
  private socket: WebSocket | null = null;
  private openResolve: ((v: boolean) => void) | null = null;

  constructor(label: string, url: string) {
    this.label = label;
    this.url = url;
  }

  /** Resolves true only on a real `open` event; false on close-before-open or error. */
  connect(timeoutMs = 15_000): Promise<boolean> {
    const started = Date.now();
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (v: boolean) => {
        if (settled) return;
        settled = true;
        resolve(v);
      };
      this.openResolve = settle;

      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        settle(false);
        return;
      }
      this.socket = ws;

      const guard = setTimeout(() => {
        this.error = this.error ?? `handshake timed out after ${timeoutMs}ms`;
        settle(false);
      }, timeoutMs);

      ws.addEventListener("open", () => {
        this.opened = true;
        this.openedAt = Date.now();
        this.connectMs = Date.now() - started;
        clearTimeout(guard);
        settle(true);
      });
      ws.addEventListener("message", (ev: MessageEvent) => {
        const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
        let type = "<unparsed>";
        try {
          type = String((JSON.parse(raw) as { type?: unknown }).type ?? "<no-type>");
        } catch {
          /* keep <unparsed> — a frame that cannot be parsed is still a frame that arrived */
        }
        this.received.push({ type, at: Date.now(), raw });
      });
      ws.addEventListener("close", (ev: CloseEvent) => {
        this.closed = true;
        this.closeCode = ev.code;
        this.closeReason = ev.reason ?? "";
        clearTimeout(guard);
        settle(false);
      });
      ws.addEventListener("error", () => {
        this.error = this.error ?? "socket error";
        // Do not settle here: a rejected upgrade fires error THEN close, and the close carries the
        // code that says WHY it was rejected (4401 vs 4403), which is the evidence that matters.
      });
    });
  }

  send(obj: unknown): boolean {
    try {
      this.socket?.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  countOf(type: string): number {
    return this.received.filter((r) => r.type === type).length;
  }

  /** Frames of a given type, in the order this client received them. */
  payloadsOf(type: string): Array<Record<string, unknown>> {
    return this.received
      .filter((r) => r.type === type)
      .map((r) => {
        try {
          return (JSON.parse(r.raw) as { data?: Record<string, unknown> }).data ?? {};
        } catch {
          return {};
        }
      });
  }

  close(): void {
    try {
      this.socket?.close(1000, "harness done");
    } catch {
      /* already gone */
    }
  }

  /** Hard TCP teardown, so the server observes a broken socket rather than a clean close. */
  terminate(): void {
    try {
      // Bun exposes the underlying terminate on its WebSocket implementation.
      (this.socket as unknown as { terminate?: () => void })?.terminate?.();
    } catch {
      /* fall through */
    }
    try {
      this.socket?.close();
    } catch {
      /* already gone */
    }
  }
}

/** Opens N clients concurrently and reports precisely how many genuinely completed a handshake. */
export async function openMany(
  label: string,
  urlFor: (i: number) => string,
  count: number,
  timeoutMs = 20_000,
): Promise<{ clients: WsClient[]; opened: number; refused: number; closeCodes: Record<string, number>; connectMs: number[] }> {
  const clients = Array.from({ length: count }, (_, i) => new WsClient(`${label}-${i}`, urlFor(i)));
  const results = await Promise.all(clients.map((c) => c.connect(timeoutMs)));
  const closeCodes: Record<string, number> = {};
  for (const c of clients) {
    if (!c.opened && c.closeCode !== null) {
      const k = String(c.closeCode);
      closeCodes[k] = (closeCodes[k] ?? 0) + 1;
    }
  }
  return {
    clients,
    opened: results.filter(Boolean).length,
    refused: results.filter((r) => !r).length,
    closeCodes,
    connectMs: clients.filter((c) => c.connectMs !== null).map((c) => c.connectMs!),
  };
}

export function closeAll(clients: WsClient[]): void {
  for (const c of clients) c.close();
}

/** Waits until a predicate holds or the deadline passes; returns how long it took, or null. */
export async function waitFor(predicate: () => boolean, timeoutMs: number, stepMs = 100): Promise<number | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return Date.now() - started;
    await sleep(stepMs);
  }
  return predicate() ? Date.now() - started : null;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return Math.round(s[i]!);
}

// ── server-side realtime state, read over HTTP ────────────────────────────────────────────────────

export type WsStats = { totalRooms: number; totalConnections: number; rooms: Array<{ id: string; connections: number }> };

/**
 * The server's own view of its registry (`GET /api/v1/ws/stats`, admin-only).
 *
 * Used ONLY to answer "did the server release its state", never to answer "was the message
 * delivered" — those are different questions and conflating them is exactly what this section is
 * meant to avoid.
 */
export async function wsStats(adminToken: string): Promise<WsStats> {
  const res = await fetch(`${HTTP_BASE}/api/v1/ws/stats`, {
    headers: { authorization: `Bearer ${adminToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ws stats: HTTP ${res.status} — registry state is unreadable, so leak checks would be vacuous`);
  const body = (await res.json()) as { data?: WsStats };
  if (!body.data) throw new Error("ws stats: response carried no data");
  return body.data;
}
