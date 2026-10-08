/**
 * One GPS publisher per (session, booking) — X-76.
 *
 * The job screen and the Requests tab (kept mounted by the tab navigator) both need the live job's
 * GPS on `/ws/tracking/:bookingId`. As a per-component hook each opened its own socket and its own
 * watcher (backend: room size 2 for one job). Here a publisher is shared and reference-counted:
 * screens `acquire` a lease and release it on unmount; the socket and watcher exist once and stop
 * with the last lease. Different bookings or different sessions (tokens) never share.
 *
 * Permission rule (X-75): the system permission prompt pauses the app even when permission is
 * already granted, so a start CHECKS first and asks only when needed, and a start caused by the app
 * returning to the foreground only ever checks — otherwise every prompt triggers the next one.
 *
 * Pure: every platform dependency is injected (see `use-partner-tracking-publisher.ts` for the real
 * wiring), so the lifecycle is testable without React Native.
 */

export type TrackingSocket = {
  readonly isOpen: boolean;
  send(message: string): void;
  close(): void;
  onopen: (() => void) | null | undefined;
  onclose: (() => void) | null | undefined;
  onerror: (() => void) | null | undefined;
};

export type TrackingDeps = {
  wsBase(): string;
  checkPermission(): Promise<string>;
  requestPermission(): Promise<string>;
  openSocket(url: string): TrackingSocket;
  watchPosition(intervalMs: number, onFix: (lat: number, lng: number, accuracy?: number, altitude?: number, mocked?: boolean) => void): Promise<{ remove(): void }>;
  onFix?(lat: number, lng: number): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
};

export type TrackingLease = {
  bookingId: string;
  token: string;
  minIntervalMs?: number;
  onConnected?: (connected: boolean) => void;
};

type Entry = {
  key: string;
  bookingId: string;
  token: string;
  minIntervalMs: number;
  listeners: Set<TrackingLease>;
  socket: TrackingSocket | null;
  watcher: { remove(): void } | null;
  starting: boolean;
  dead: boolean;
  connected: boolean;
  lastSentAt: number;
  lastFix: { lat: number; lng: number } | null;
};

/** How long a backgrounded app keeps publishing (uiautomator dumps and the permission sheet pause it briefly). */
export const BACKGROUND_GRACE_MS = 4_000;
const DEFAULT_INTERVAL_MS = 5_000;

export function createTrackingPublisherRegistry(deps: TrackingDeps) {
  const entries = new Map<string, Entry>();
  let foreground = true;
  let bgTimer: unknown = null;

  const setConnected = (e: Entry, connected: boolean) => {
    if (e.connected === connected) return;
    e.connected = connected;
    for (const l of e.listeners) l.onConnected?.(connected);
  };

  const closeSocket = (e: Entry) => {
    const s = e.socket;
    e.socket = null;
    if (s) {
      s.onopen = null;
      s.onerror = null;
      s.onclose = null;
      s.close();
    }
    setConnected(e, false);
  };

  const stopRuntime = (e: Entry) => {
    e.watcher?.remove();
    e.watcher = null;
    closeSocket(e);
  };

  const openSocket = (e: Entry) => {
    const s = deps.openSocket(`${deps.wsBase()}/ws/tracking/${encodeURIComponent(e.bookingId)}?token=${encodeURIComponent(e.token)}`);
    e.socket = s;
    s.onopen = () => { if (e.socket === s) setConnected(e, true); };
    const lost = () => {
      if (e.socket !== s) return;
      e.socket = null; // a later foreground (or the next start) reconnects
      setConnected(e, false);
    };
    s.onclose = lost;
    s.onerror = lost;
  };

  const onFix = (e: Entry, lat: number, lng: number, accuracy?: number, altitude?: number, mocked?: boolean) => {
    const sock = e.socket;
    if (!sock || !sock.isOpen) return;
    const now = deps.now();
    if (now - e.lastSentAt < e.minIntervalMs) return;
    deps.onFix?.(lat, lng);
    const last = e.lastFix;
    if (last && Math.abs(last.lat - lat) < 1e-6 && Math.abs(last.lng - lng) < 1e-6) return;
    // `mocked` is the OS's word about this fix (Android), sent only when it said something.
    sock.send(JSON.stringify({ type: "location_update", latitude: lat, longitude: lng, accuracy, altitude, ...(typeof mocked === "boolean" ? { mocked } : {}) }));
    e.lastSentAt = now;
    e.lastFix = { lat, lng };
  };

  const start = async (e: Entry, trigger: "acquire" | "resume") => {
    if (e.dead || e.starting) return;
    if (e.socket && e.watcher) return;
    e.starting = true;
    try {
      let status = await deps.checkPermission();
      if (status !== "granted" && trigger === "acquire" && !e.dead) status = await deps.requestPermission();
      // Declined: corroboration is lost, every lifecycle action still works. No retry loop — the next
      // foreground only checks, which picks up a grant made in system settings.
      if (e.dead || status !== "granted") return;
      if (!e.socket) openSocket(e);
      if (!e.watcher) {
        try {
          const w = await deps.watchPosition(e.minIntervalMs, (lat, lng, acc, alt, mocked) => onFix(e, lat, lng, acc, alt, mocked));
          if (e.dead) { w.remove(); return; }
          e.watcher = w;
        } catch {
          // Device location off ("unsatisfied device settings"): drop the socket; retry on the next foreground.
          closeSocket(e);
        }
      }
    } finally {
      e.starting = false;
      if (e.dead) stopRuntime(e);
    }
  };

  return {
    /** Hold the publisher for this booking; returns the release function (call it on unmount). */
    acquire(lease: TrackingLease): () => void {
      const key = `${lease.token}\u0000${lease.bookingId}`;
      let e = entries.get(key);
      const created = !e;
      if (!e) {
        e = {
          key, bookingId: lease.bookingId, token: lease.token,
          minIntervalMs: lease.minIntervalMs ?? DEFAULT_INTERVAL_MS,
          listeners: new Set(), socket: null, watcher: null, starting: false, dead: false,
          connected: false, lastSentAt: 0, lastFix: null,
        };
        entries.set(key, e);
      }
      const entry = e;
      entry.listeners.add(lease);
      if (entry.connected) lease.onConnected?.(true);
      if (created) void start(entry, "acquire");
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.listeners.delete(lease);
        if (entry.listeners.size > 0) return;
        entry.dead = true;
        entries.delete(entry.key);
        if (!entry.starting) stopRuntime(entry); // a start in flight stops itself when it returns
      };
    },

    /** Wire to AppState: false on background, true on active. */
    setForeground(active: boolean) {
      if (!active) {
        foreground = false;
        if (bgTimer == null) {
          bgTimer = deps.setTimer(() => {
            bgTimer = null;
            if (!foreground) for (const e of entries.values()) stopRuntime(e);
          }, BACKGROUND_GRACE_MS);
        }
        return;
      }
      foreground = true;
      if (bgTimer != null) {
        deps.clearTimer(bgTimer);
        bgTimer = null;
      }
      for (const e of entries.values()) void start(e, "resume");
    },

    size: () => entries.size,
  };
}

export type TrackingPublisherRegistry = ReturnType<typeof createTrackingPublisherRegistry>;
