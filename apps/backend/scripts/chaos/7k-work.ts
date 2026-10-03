/**
 * SECTION 7K — workload, fixtures and fault injection. HARNESS CODE.
 *
 * Kept separate from the phase logic so the same workload definition drives every pass, and so the
 * workload itself can be audited on its own: it reads, it creates and cancels UNPAID bookings, and it
 * churns WebSocket subscriptions. It never pays, tops up, transfers, refunds or redeems anything.
 */
import { spawnSync } from "node:child_process";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── deterministic randomness, so a pass can be re-run with the same shape ─────────────────────────

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

// ── window statistics ─────────────────────────────────────────────────────────────────────────────

export type OpStat = { n: number; ok: number; s4xx: number; s429: number; s5xx: number; net: number; lat: number[] };
export type Window = {
  ops: Record<string, OpStat>;
  wsOpened: number;
  wsFailed: number;
  wsCleanClose: number;
  wsAbort: number;
  cycles: number;
  delivered: number;
  missed: number;
  deliveryMs: number[];
  bookingsCreated: string[];
};

export function newWindow(): Window {
  return { ops: {}, wsOpened: 0, wsFailed: 0, wsCleanClose: 0, wsAbort: 0, cycles: 0, delivered: 0, missed: 0, deliveryMs: [], bookingsCreated: [] };
}

export function pct(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

function note(w: Window, op: string, status: number | null, ms: number): void {
  const o = (w.ops[op] ??= { n: 0, ok: 0, s4xx: 0, s429: 0, s5xx: 0, net: 0, lat: [] });
  o.n++;
  o.lat.push(ms);
  if (status === null) o.net++;
  else if (status === 429) o.s429++;
  else if (status >= 500) o.s5xx++;
  else if (status >= 400) o.s4xx++;
  else o.ok++;
}

// ── a minimal client that counts the frames it actually receives ──────────────────────────────────

export class WsProbe {
  frames: Array<{ t: number; msg: Record<string, unknown> }> = [];
  opened = false;
  closed = false;
  private sock: WebSocket;
  private ready: Promise<boolean>;
  constructor(url: string) {
    this.sock = new WebSocket(url);
    this.ready = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 8000);
      this.sock.addEventListener("open", () => {
        this.opened = true;
        clearTimeout(timer);
        resolve(true);
      });
      this.sock.addEventListener("close", () => {
        this.closed = true;
        clearTimeout(timer);
        resolve(this.opened);
      });
      this.sock.addEventListener("error", () => undefined);
    });
    this.sock.addEventListener("message", (ev) => {
      try {
        this.frames.push({ t: Date.now(), msg: JSON.parse(String(ev.data)) as Record<string, unknown> });
      } catch {
        /* non-JSON frame */
      }
    });
  }
  open(): Promise<boolean> {
    return this.ready;
  }
  /** A clean close handshake. */
  close(): void {
    try {
      this.sock.close(1000, "7k");
    } catch {
      /* already closed */
    }
  }
  /** An ungraceful drop — no close frame — which is what a phone losing signal looks like. */
  abort(): void {
    const s = this.sock as unknown as { terminate?: () => void };
    if (typeof s.terminate === "function") s.terminate();
    else this.close();
  }
}

// ── fixtures ──────────────────────────────────────────────────────────────────────────────────────

export type User = { email: string; ip: string; userId: string; token: string; tokenAt: number; addressId: string };

const PASSWORD = "Qx7!mVt4Rp9z";

function phone(i: number): string {
  return `+9197${String(70000000 + i * 7919).slice(0, 8)}`;
}

async function login(base: string, email: string, ip: string): Promise<{ userId: string; token: string } | null> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password: PASSWORD }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res) return null;
  const body = (await res.json().catch(() => ({}))) as { data?: { accessToken?: string; user?: { id?: string } } };
  if (!body.data?.accessToken || !body.data.user?.id) return null;
  return { userId: body.data.user.id, token: body.data.accessToken };
}

/**
 * Soak customers. Each has its own client address so the per-identity rate limits the production
 * limiter enforces apply per user, as they would for real traffic, instead of the whole workload being
 * one throttled client.
 */
export async function provisionUsers(
  base: string,
  prisma: { user: { update: (a: unknown) => Promise<unknown> }; address: { findFirst: (a: unknown) => Promise<{ id: string } | null>; create: (a: unknown) => Promise<{ id: string }> } },
  count: number,
): Promise<User[]> {
  const users: User[] = [];
  for (let i = 0; i < count; i++) {
    const email = `s7k.u${i}@homigo.test`;
    const ip = `10.77.${Math.floor(i / 200)}.${(i % 200) + 10}`;
    await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email, password: PASSWORD, firstName: "Soak", lastName: `User${i}`, phoneNumber: phone(i), agreeToTerms: true }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    const l = await login(base, email, ip);
    if (!l) throw new Error(`7K FIXTURE: could not log in ${email}`);
    await prisma.user.update({ where: { id: l.userId }, data: { isEmailVerified: true } });
    const address =
      (await prisma.address.findFirst({ where: { userId: l.userId } })) ??
      (await prisma.address.create({
        data: { userId: l.userId, label: "7K", addressLine1: "7 Soak Street", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.076, longitude: 72.8777 },
      }));
    users.push({ email, ip, userId: l.userId, token: l.token, tokenAt: Date.now(), addressId: address.id });
  }
  return users;
}

async function freshToken(base: string, u: User): Promise<void> {
  if (Date.now() - u.tokenAt < 8 * 60_000) return;
  const l = await login(base, u.email, u.ip);
  if (l) {
    u.token = l.token;
    u.tokenAt = Date.now();
  }
}

// ── the workload ──────────────────────────────────────────────────────────────────────────────────

export type WorkloadCfg = {
  base: string;
  wsBase: string;
  users: User[];
  serviceId: string;
  publicVus: number;
  runTag: string;
  seed: number;
  /** ms between operations per authenticated user; with ~13 op kinds this keeps each user far below its limit. */
  authPaceMs: number;
  publicPaceMs: number;
};

export type Workload = {
  stop: () => Promise<void>;
  swap: () => Window;
  openSockets: () => number;
  live: WsProbe[];
};

let slotCounter = 0;
function slot(r: () => number): string {
  slotCounter++;
  const hours = 48 + Math.floor(r() * 26 * 24);
  const t = new Date(Date.now() + hours * 3_600_000 + (slotCounter % 60) * 60_000);
  t.setUTCMinutes(0, 0, 0);
  return t.toISOString();
}

export function startWorkload(cfg: WorkloadCfg): Workload {
  let running = true;
  let win = newWindow();
  const live = new Set<WsProbe>();
  const r = rng(cfg.seed);

  const call = async (op: string, path: string, init: RequestInit & { ip: string; token?: string }): Promise<{ status: number | null; body: unknown }> => {
    const t0 = performance.now();
    const headers: Record<string, string> = { "x-forwarded-for": init.ip, ...(init.headers as Record<string, string> | undefined) };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    if (init.body) headers["content-type"] = "application/json";
    try {
      const res = await fetch(`${cfg.base}${path}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
      const body = await res.json().catch(() => null);
      note(win, op, res.status, performance.now() - t0);
      return { status: res.status, body };
    } catch {
      note(win, op, null, performance.now() - t0);
      return { status: null, body: null };
    }
  };

  const bookingCycle = async (u: User): Promise<void> => {
    const created = await call("booking.create", "/api/bookings", {
      method: "POST",
      ip: u.ip,
      token: u.token,
      body: JSON.stringify({ serviceId: cfg.serviceId, addressId: u.addressId, scheduledDate: slot(r), description: `7K ${cfg.runTag}` }),
    });
    const id = (created.body as { data?: { booking?: { id?: string }; id?: string } } | null)?.data?.booking?.id
      ?? (created.body as { data?: { id?: string } } | null)?.data?.id;
    if (!id) return;
    win.bookingsCreated.push(id);
    const ws = new WsProbe(`${cfg.wsBase}/ws/booking/${id}?token=${encodeURIComponent(u.token)}`);
    live.add(ws);
    const ok = await ws.open();
    if (ok) win.wsOpened++;
    else win.wsFailed++;
    await sleep(150);
    const cancelAt = Date.now();
    await call("booking.cancel", `/api/bookings/${id}/cancel`, { method: "POST", ip: u.ip, token: u.token, body: JSON.stringify({ reason: "7K soak cycle" }) });
    win.cycles++;
    if (ok) {
      /**
       * Only a frame that arrives AFTER the cancel and carries a cancelled status counts. The open
       * handler sends a status snapshot of its own, and 7G once passed a delivery check by counting it.
       */
      const deadline = Date.now() + 6000;
      let got: number | null = null;
      while (Date.now() < deadline) {
        const f = ws.frames.find((x) => x.t >= cancelAt && x.msg.type === "BOOKING_STATUS" && String((x.msg.data as Record<string, unknown> | undefined)?.status ?? "").includes("cancel"));
        if (f) {
          got = f.t - cancelAt;
          break;
        }
        await sleep(40);
      }
      if (got !== null) {
        win.delivered++;
        win.deliveryMs.push(got);
      } else win.missed++;
    }
    if (r() < 0.3) {
      ws.abort();
      win.wsAbort++;
    } else {
      ws.close();
      win.wsCleanClose++;
    }
    live.delete(ws);
  };

  const notificationsChurn = async (u: User): Promise<void> => {
    const ws = new WsProbe(`${cfg.wsBase}/ws/notifications?token=${encodeURIComponent(u.token)}`);
    live.add(ws);
    const ok = await ws.open();
    if (ok) win.wsOpened++;
    else win.wsFailed++;
    await sleep(400 + Math.floor(r() * 2500));
    if (r() < 0.3) {
      ws.abort();
      win.wsAbort++;
    } else {
      ws.close();
      win.wsCleanClose++;
    }
    live.delete(ws);
  };

  const AUTH_OPS: Array<[string, number, (u: User) => Promise<unknown>]> = [
    ["users.me", 3, (u) => call("users.me", "/api/users/me", { ip: u.ip, token: u.token })],
    ["wallet.balance", 2, (u) => call("wallet.balance", "/api/wallet/balance", { ip: u.ip, token: u.token })],
    ["wallet.txns", 1, (u) => call("wallet.txns", "/api/wallet/transactions", { ip: u.ip, token: u.token })],
    ["notifications", 2, (u) => call("notifications", "/api/notifications", { ip: u.ip, token: u.token })],
    ["addresses", 1, (u) => call("addresses", "/api/users/addresses", { ip: u.ip, token: u.token })],
    ["bookings.upcoming", 2, (u) => call("bookings.upcoming", "/api/bookings/upcoming", { ip: u.ip, token: u.token })],
    ["cycle", 1, bookingCycle],
    ["ws.notifications", 1, notificationsChurn],
  ];
  const totalW = AUTH_OPS.reduce((a, o) => a + o[1], 0);
  const pick = () => {
    let x = r() * totalW;
    for (const o of AUTH_OPS) {
      x -= o[1];
      if (x <= 0) return o;
    }
    return AUTH_OPS[0]!;
  };

  const loops: Promise<void>[] = [];
  for (const u of cfg.users) {
    loops.push(
      (async () => {
        await sleep(Math.floor(r() * cfg.authPaceMs));
        while (running) {
          await freshToken(cfg.base, u);
          await pick()[2](u).catch(() => undefined);
          await sleep(cfg.authPaceMs * (0.6 + r() * 0.8));
        }
      })(),
    );
  }
  let ipCursor = 0;
  for (let v = 0; v < cfg.publicVus; v++) {
    loops.push(
      (async () => {
        while (running) {
          ipCursor = (ipCursor + 1) % 400;
          const ip = `10.88.${Math.floor(ipCursor / 200)}.${(ipCursor % 200) + 10}`;
          const x = r();
          if (x < 0.5) await call("public.services", "/api/services", { ip });
          else if (x < 0.8) await call("public.featured", "/api/services/featured", { ip });
          else await call("public.health", "/health", { ip });
          await sleep(cfg.publicPaceMs * (0.6 + r() * 0.8));
        }
      })(),
    );
  }

  return {
    stop: async () => {
      running = false;
      await Promise.all(loops);
      for (const ws of live) ws.close();
    },
    swap: () => {
      const w = win;
      win = newWindow();
      return w;
    },
    openSockets: () => live.size,
    live: [...live],
  };
}

/** A fixed control burst: the same requests every time, so T0…Tn are directly comparable. */
export async function controlBurst(base: string, n = 120, concurrency = 6): Promise<{ p50: number; p95: number; p99: number; ok: number; n: number; rps: number }> {
  const lat: number[] = [];
  let ok = 0;
  let i = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < n) {
        const k = i++;
        const s = performance.now();
        const res = await fetch(`${base}/api/services`, { headers: { "x-forwarded-for": `10.99.${Math.floor(k / 200)}.${(k % 200) + 10}` }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
        lat.push(performance.now() - s);
        if (res?.ok) ok++;
        await res?.arrayBuffer().catch(() => null);
      }
    }),
  );
  const secs = (performance.now() - t0) / 1000;
  return { p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), ok, n, rps: Math.round((n / secs) * 10) / 10 };
}

// ── fault injection on the isolated Redis container ───────────────────────────────────────────────

export const REDIS_CONTAINER = "homigo-staging-redis";

function docker(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync("docker", args, { encoding: "utf8", timeout: 90_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/** Only the isolated staging container may be touched, and the name is asserted, not assumed. */
function assertIsolatedContainer(name: string): void {
  if (name !== REDIS_CONTAINER) throw new Error(`7K: refusing to touch container ${name}`);
  /**
   * Read from the container's configured bindings, not `docker port`: the latter is empty for a
   * STOPPED container, and a first version of this guard therefore refused to restart the very
   * container it had just stopped, leaving the isolated Redis down.
   */
  let ports = "";
  for (let attempt = 0; attempt < 5 && !ports.includes("HostPort"); attempt++) {
    const r = docker(["inspect", "--format", "{{json .HostConfig.PortBindings}}", name]);
    ports = r.out;
    if (!ports.includes("HostPort")) spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 800"]);
  }
  if (!ports.includes('"HostPort":"6380"')) throw new Error(`7K: container ${name} is not bound to host :6380 (docker said: ${ports || "nothing"})`);
}

export function redisPaused(): boolean {
  return docker(["inspect", "--format", "{{.State.Paused}}", REDIS_CONTAINER]).out === "true";
}

export function pauseRedis(on: boolean): boolean {
  assertIsolatedContainer(REDIS_CONTAINER);
  const r = docker([on ? "pause" : "unpause", REDIS_CONTAINER]);
  /** Positive control: the container state is read back rather than trusting the exit code. */
  return r.ok && redisPaused() === on;
}

/** Set while the harness has the isolated Redis stopped, so an abnormal exit can always restore it. */
export let redisStoppedByHarness = false;

export function stopRedis(): boolean {
  assertIsolatedContainer(REDIS_CONTAINER);
  redisStoppedByHarness = true;
  return docker(["stop", "-t", "2", REDIS_CONTAINER]).ok && docker(["inspect", "--format", "{{.State.Running}}", REDIS_CONTAINER]).out === "false";
}

export async function startRedis(): Promise<boolean> {
  assertIsolatedContainer(REDIS_CONTAINER);
  if (!docker(["start", REDIS_CONTAINER]).ok) return false;
  for (let i = 0; i < 60; i++) {
    if (docker(["inspect", "--format", "{{.State.Health.Status}}", REDIS_CONTAINER]).out === "healthy") {
      redisStoppedByHarness = false;
      return true;
    }
    await sleep(1000);
  }
  return false;
}

/** Last-resort restore, called from the harness's `finally`. Never leaves the isolated Redis down or paused. */
export function restoreRedisIfNeeded(): string {
  const running = docker(["inspect", "--format", "{{.State.Running}} {{.State.Paused}}", REDIS_CONTAINER]).out;
  if (running.startsWith("true true")) {
    docker(["unpause", REDIS_CONTAINER]);
    return "unpaused";
  }
  if (!running.startsWith("true")) {
    docker(["start", REDIS_CONTAINER]);
    redisStoppedByHarness = false;
    return "started";
  }
  return "already running";
}
