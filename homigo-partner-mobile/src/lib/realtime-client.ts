import { create } from "zustand";
import { getApiBaseUrl } from "@/lib/api-config";
import {
  createEventDeduper,
  parseRealtimeFrame,
  reconnectDelayMs,
  WS_CLOSE_FORBIDDEN,
  WS_CLOSE_UNAUTHORIZED,
  type RealtimeFrame,
} from "@/lib/realtime-events";
import { refreshAccessTokenOnce } from "@/services/partner-api";

/**
 * The partner's `/ws/notifications?token=…` socket — ONE per app (module singleton).
 *
 * Mirrors apps/partner-web/src/hooks/use-realtime-channel.ts:
 *  - exponential backoff reconnect, capped at 30 s (with jitter);
 *  - close 4401 → refresh the access token (shared single-flight refresh) and reconnect with the
 *    new token; 4403 → stop, never retry that credential;
 *  - paused while the app is backgrounded (the OS suspends JS anyway; a half-dead socket would
 *    only delay the reconnect) and resumed on foreground;
 *  - liveness: the server PINGs every 30 s; if nothing arrives for 75 s the socket is presumed dead
 *    (NAT timeout, captive Wi-Fi) and is recycled.
 *
 * Push notifications remain the delivery path while the app is in the background — this socket
 * never claims to be connected when it is not; `useRealtimeStatus().connected` is the truth that
 * polling fallbacks key off.
 */

export type RealtimeStatus = {
  connected: boolean;
  /** Socket closed by the server with 4403 — not retried until the credential changes. */
  forbidden: boolean;
  paused: boolean;
  lastEventAt: number | null;
};

export const useRealtimeStatus = create<RealtimeStatus>(() => ({
  connected: false,
  forbidden: false,
  paused: false,
  lastEventAt: null,
}));

type Listener = (frame: RealtimeFrame) => void;

const LIVENESS_TIMEOUT_MS = 75_000;
const CLIENT_PING_MS = 25_000;

const listeners = new Set<Listener>();
const deduper = createEventDeduper(300);

let socket: WebSocket | null = null;
let token: string | null = null;
let generation = 0;
let attempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let lastFrameAt = 0;
let paused = false;
let forbidden = false;
/** Consecutive 4401 closes without a successful open — breaks refresh→4401→refresh loops. */
let unauthorizedStreak = 0;

function wsUrl(accessToken: string): string {
  const base = getApiBaseUrl().replace(/^http/, "ws");
  return `${base}/ws/notifications?token=${encodeURIComponent(accessToken)}`;
}

function clearTimers() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
}

function closeSocket() {
  generation += 1; // orphan the old socket's handlers before closing it
  const s = socket;
  socket = null;
  if (s) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  useRealtimeStatus.setState({ connected: false });
}

function scheduleReconnect() {
  if (!token || paused || forbidden) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = reconnectDelayMs(attempt);
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    open();
  }, delay);
}

function open() {
  if (!token || paused || forbidden) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  clearTimers();
  generation += 1;
  const gen = generation;
  let ws: WebSocket;
  try {
    ws = new WebSocket(wsUrl(token));
  } catch {
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.onopen = () => {
    if (gen !== generation) return;
    attempt = 0;
    unauthorizedStreak = 0;
    lastFrameAt = Date.now();
    useRealtimeStatus.setState({ connected: true, forbidden: false });
    pingTimer = setInterval(() => {
      if (gen !== generation || !socket) return;
      if (Date.now() - lastFrameAt > LIVENESS_TIMEOUT_MS) {
        // Silent socket: recycle it. onclose (code 1000/1006) schedules the reconnect.
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        socket.send(JSON.stringify({ type: "PING" }));
      } catch {
        /* onclose will follow */
      }
    }, CLIENT_PING_MS);
    // Anything that changed while we were disconnected was not pushed to us — resync once.
    emitSynthetic("resync");
  };

  ws.onmessage = (event: { data?: unknown }) => {
    if (gen !== generation) return;
    lastFrameAt = Date.now();
    const frame = parseRealtimeFrame(typeof event.data === "string" ? event.data : String(event.data ?? ""));
    if (!frame) return;
    if (!deduper.admit(frame.dedupeKey)) return;
    useRealtimeStatus.setState({ lastEventAt: lastFrameAt });
    for (const fn of listeners) {
      try {
        fn(frame);
      } catch {
        /* a bad listener must not kill the socket */
      }
    }
  };

  ws.onerror = () => {
    // RN fires onerror then onclose; closing here guarantees onclose runs exactly once.
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  };

  ws.onclose = (event: { code?: number }) => {
    if (gen !== generation) return;
    socket = null;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = null;
    useRealtimeStatus.setState({ connected: false });

    if (event.code === WS_CLOSE_FORBIDDEN) {
      forbidden = true;
      useRealtimeStatus.setState({ forbidden: true });
      return;
    }
    if (event.code === WS_CLOSE_UNAUTHORIZED) {
      const tokenAtClose = token;
      unauthorizedStreak += 1;
      void refreshAccessTokenOnce().then((outcome) => {
        // A newer connect() (new token from the store) or a disconnect already took over.
        if (token !== tokenAtClose) return;
        if (outcome.kind === "refreshed") {
          token = outcome.accessToken;
          // First 4401: reconnect at once with the fresh token. A repeat means the fresh token is
          // refused too — fall back to capped backoff instead of a tight refresh loop.
          if (unauthorizedStreak <= 1) open();
          else scheduleReconnect();
        } else if (outcome.kind === "unavailable") {
          scheduleReconnect();
        }
        // rejected → the auth store tears the session down and calls disconnectPartnerRealtime().
      });
      return;
    }
    scheduleReconnect();
  };
}

function emitSynthetic(kind: string) {
  const frame: RealtimeFrame = {
    dedupeKey: null,
    kind,
    bookingId: null,
    targets: new Set(["bookings", "dashboard", "operations", "wallet", "notifications"]),
  };
  for (const fn of listeners) {
    try {
      fn(frame);
    } catch {
      /* ignore */
    }
  }
}

/** Connect (or reconnect with a new token). Same token + live socket = no-op. */
export function connectPartnerRealtime(accessToken: string) {
  if (accessToken !== token) {
    // A new credential clears a previous 4403 — it is a different grant.
    forbidden = false;
    useRealtimeStatus.setState({ forbidden: false });
    token = accessToken;
    closeSocket();
    clearTimers();
    attempt = 0;
    // unauthorizedStreak is NOT reset here: a token change is usually the refresh that a 4401
    // triggered, and resetting would re-arm an immediate refresh→4401 loop. It resets on a
    // successful open and on disconnect.
  }
  if (unauthorizedStreak > 1) scheduleReconnect();
  else open();
}

/** Sign-out / session rejected: close and forget the credential. */
export function disconnectPartnerRealtime() {
  token = null;
  clearTimers();
  closeSocket();
  deduper.clear();
  attempt = 0;
  unauthorizedStreak = 0;
  forbidden = false;
  useRealtimeStatus.setState({ connected: false, forbidden: false, lastEventAt: null });
}

/** App backgrounded: drop the socket (push notifications cover the background). */
export function pausePartnerRealtime() {
  if (paused) return;
  paused = true;
  clearTimers();
  closeSocket();
  useRealtimeStatus.setState({ paused: true });
}

/** App foregrounded: reconnect immediately (no backoff — this is a user-visible moment). */
export function resumePartnerRealtime() {
  if (!paused) return;
  paused = false;
  attempt = 0;
  useRealtimeStatus.setState({ paused: false });
  open();
}

export function subscribePartnerRealtime(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
