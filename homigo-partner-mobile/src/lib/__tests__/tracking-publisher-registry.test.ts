import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTrackingPublisherRegistry, type TrackingDeps, type TrackingSocket } from "../tracking-publisher-registry.ts";

/**
 * X-76 (emulator 2026-09-29): one live job opened TWO `/ws/tracking` sockets and two GPS watchers —
 * the job screen and the (always mounted) Requests tab each ran their own publisher. The registry
 * owns exactly one publisher per (session, booking); screens only hold a lease on it.
 */

type FakeSocket = Omit<TrackingSocket, "isOpen"> & { isOpen: boolean; url: string; sent: string[]; closed: boolean; open(): void };

function harness(opts: { permission?: "granted" | "denied"; watchRejects?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  const watchers: { removed: boolean; cb: (lat: number, lng: number) => void }[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const calls = { request: 0, check: 0, fixes: [] as [number, number][] };
  let clock = 1_000_000;
  let permission = opts.permission ?? "granted";
  let watchRejects = opts.watchRejects ?? false;
  const deps: TrackingDeps = {
    wsBase: () => "ws://api.test",
    requestPermission: async () => { calls.request += 1; return permission; },
    checkPermission: async () => { calls.check += 1; return permission; },
    openSocket: (url) => {
      const s: FakeSocket = {
        url, sent: [] as string[], closed: false, isOpen: false, onopen: null, onclose: null, onerror: null,
        send(msg) { this.sent.push(msg); },
        close() { this.closed = true; this.isOpen = false; this.onclose?.(); },
        open() { this.isOpen = true; this.onopen?.(); },
      };
      sockets.push(s);
      return s;
    },
    watchPosition: async (_intervalMs, cb) => {
      if (watchRejects) throw new Error("Location request failed due to unsatisfied device settings");
      const w = { removed: false, cb };
      watchers.push(w);
      return { remove: () => { w.removed = true; } };
    },
    onFix: (lat, lng) => { calls.fixes.push([lat, lng]); },
    now: () => clock,
    setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimer: (h) => { (h as { cleared: boolean }).cleared = true; },
  };
  const registry = createTrackingPublisherRegistry(deps);
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    registry, sockets, watchers, timers, calls, settle,
    tick: (ms: number) => { clock += ms; },
    fireTimers: () => { for (const t of timers.splice(0)) if (!t.cleared) t.fn(); },
    setPermission: (p: "granted" | "denied") => { permission = p; },
    setWatchRejects: (v: boolean) => { watchRejects = v; },
    liveSockets: () => sockets.filter((s) => !s.closed),
    liveWatchers: () => watchers.filter((w) => !w.removed),
  };
}

test("two screens on the same live booking share ONE socket and ONE GPS watcher", async () => {
  const h = harness();
  const a = h.registry.acquire({ bookingId: "b1", token: "t1" });
  const b = h.registry.acquire({ bookingId: "b1", token: "t1" });
  await h.settle();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.watchers.length, 1);
  assert.equal(h.calls.check, 1, "one permission check, not one per screen");
  assert.equal(h.calls.request, 0, "already granted: no prompt at all (a prompt pauses the app, X-75)");
  assert.match(h.sockets[0].url, /^ws:\/\/api\.test\/ws\/tracking\/b1\?token=t1$/);
  a(); b();
});

test("releasing one screen keeps the publisher; releasing the last stops it", async () => {
  const h = harness();
  const a = h.registry.acquire({ bookingId: "b1", token: "t1" });
  const b = h.registry.acquire({ bookingId: "b1", token: "t1" });
  await h.settle();
  a();
  assert.equal(h.liveSockets().length, 1);
  assert.equal(h.liveWatchers().length, 1);
  b();
  assert.equal(h.liveSockets().length, 0);
  assert.equal(h.liveWatchers().length, 0);
  assert.equal(h.registry.size(), 0);
});

test("a release while permission is pending leaves nothing running", async () => {
  const h = harness();
  const a = h.registry.acquire({ bookingId: "b1", token: "t1" });
  a(); // unmounted before the permission answer arrived
  await h.settle();
  assert.equal(h.liveSockets().length, 0);
  assert.equal(h.liveWatchers().length, 0);
});

test("rapid navigation (acquire / release / acquire) ends with exactly one publisher", async () => {
  const h = harness();
  const a = h.registry.acquire({ bookingId: "b1", token: "t1" });
  a();
  const b = h.registry.acquire({ bookingId: "b1", token: "t1" });
  const c = h.registry.acquire({ bookingId: "b1", token: "t1" });
  await h.settle();
  await h.settle();
  assert.equal(h.liveSockets().length, 1);
  assert.equal(h.liveWatchers().length, 1);
  b(); c();
  assert.equal(h.liveSockets().length, 0);
});

test("two different bookings, or two sessions, never share a publisher", async () => {
  const h = harness();
  const a = h.registry.acquire({ bookingId: "b1", token: "t1" });
  const b = h.registry.acquire({ bookingId: "b2", token: "t1" });
  const c = h.registry.acquire({ bookingId: "b1", token: "t2" });
  await h.settle();
  assert.equal(h.liveSockets().length, 3);
  a(); b(); c();
});

test("background → foreground restarts once per booking (not per screen) and only CHECKS permission", async () => {
  const h = harness();
  h.registry.acquire({ bookingId: "b1", token: "t1" });
  h.registry.acquire({ bookingId: "b1", token: "t1" });
  await h.settle();
  h.registry.setForeground(false);
  h.fireTimers(); // the 4 s grace passed while backgrounded
  assert.equal(h.liveSockets().length, 0, "stopped in the background");
  assert.equal(h.liveWatchers().length, 0);
  h.registry.setForeground(true);
  h.registry.setForeground(true); // duplicate "active" events
  await h.settle();
  assert.equal(h.liveSockets().length, 1);
  assert.equal(h.liveWatchers().length, 1);
  assert.equal(h.calls.request, 0, "resume must never show the permission prompt");
  assert.equal(h.calls.check, 2, "one check at acquire, one on return");
});

test("a short background (under the grace period) keeps the same socket", async () => {
  const h = harness();
  h.registry.acquire({ bookingId: "b1", token: "t1" });
  await h.settle();
  h.registry.setForeground(false);
  h.registry.setForeground(true);
  h.fireTimers(); // the cancelled grace timer must not tear down
  await h.settle();
  assert.equal(h.sockets.length, 1);
  assert.equal(h.liveSockets().length, 1);
});

test("permission denied: no socket, no watcher, and foregrounding does not loop the prompt", async () => {
  const h = harness({ permission: "denied" });
  h.registry.acquire({ bookingId: "b1", token: "t1" });
  await h.settle();
  assert.equal(h.sockets.length, 0);
  for (let i = 0; i < 5; i++) {
    h.registry.setForeground(false);
    h.registry.setForeground(true);
    await h.settle();
  }
  assert.equal(h.calls.request, 1, "asked once");
  assert.equal(h.calls.check, 6, "one check before asking, then each return only checks");
  assert.equal(h.sockets.length, 0);
  h.setPermission("granted"); // granted in system settings meanwhile
  h.registry.setForeground(false);
  h.registry.setForeground(true);
  await h.settle();
  assert.equal(h.liveSockets().length, 1);
});

test("device location off (watch rejects): socket closed, retried on the next foreground", async () => {
  const h = harness({ watchRejects: true });
  h.registry.acquire({ bookingId: "b1", token: "t1" });
  await h.settle();
  assert.equal(h.liveSockets().length, 0);
  h.setWatchRejects(false);
  h.registry.setForeground(false);
  h.registry.setForeground(true);
  await h.settle();
  assert.equal(h.liveSockets().length, 1);
  assert.equal(h.liveWatchers().length, 1);
});

test("reconnect after the socket closes by itself: one new socket, the watcher reused", async () => {
  const h = harness();
  h.registry.acquire({ bookingId: "b1", token: "t1" });
  await h.settle();
  h.sockets[0].close(); // server closed it
  h.registry.setForeground(false);
  h.registry.setForeground(true);
  await h.settle();
  assert.equal(h.liveSockets().length, 1);
  assert.equal(h.liveWatchers().length, 1);
});

test("fixes: sent only on an open socket, throttled, identical fixes skipped, every fix remembered", async () => {
  const h = harness();
  const seen: boolean[] = [];
  h.registry.acquire({ bookingId: "b1", token: "t1", minIntervalMs: 5_000, onConnected: (c) => seen.push(c) });
  await h.settle();
  const w = h.watchers[0];
  w.cb(19.07, 72.87); // socket not open yet
  assert.equal(h.sockets[0].sent.length, 0);
  h.sockets[0].open();
  assert.deepEqual(seen, [true]);
  w.cb(19.07, 72.87);
  assert.equal(h.sockets[0].sent.length, 1);
  assert.deepEqual(JSON.parse(h.sockets[0].sent[0]), { type: "location_update", latitude: 19.07, longitude: 72.87 });
  h.tick(1_000);
  w.cb(19.08, 72.88); // within 5 s
  h.tick(5_000);
  w.cb(19.07, 72.87); // same position as the last sent
  h.tick(5_000);
  w.cb(19.09, 72.89);
  assert.equal(h.sockets[0].sent.length, 2);
  assert.ok(h.calls.fixes.length >= 3);
});

test("every consumer hears connection state, including one that joins after the socket opened", async () => {
  const h = harness();
  const a: boolean[] = [];
  const b: boolean[] = [];
  h.registry.acquire({ bookingId: "b1", token: "t1", onConnected: (c) => a.push(c) });
  await h.settle();
  h.sockets[0].open();
  h.registry.acquire({ bookingId: "b1", token: "t1", onConnected: (c) => b.push(c) });
  assert.deepEqual(a, [true]);
  assert.deepEqual(b, [true]);
  h.sockets[0].close();
  assert.deepEqual(a, [true, false]);
  assert.deepEqual(b, [true, false]);
});

test("the hook holds a lease on the registry instead of opening its own socket or watcher", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "..", "hooks", "use-partner-tracking-publisher.ts"), "utf8");
  assert.doesNotMatch(src, /new WebSocket\(/, "the hook must not open a socket itself");
  assert.doesNotMatch(src, /watchPositionAsync\(\s*\{/, "the hook must not start a watcher itself");
  assert.match(src, /\.acquire\(/);
});
