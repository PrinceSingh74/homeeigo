import type { WSConnection } from "../lib/websocket";

type WsState = {
  userId: string;
  userType?: "customer" | "vendor" | "admin";
  connectionId?: string;
  providerId?: string;
  bookingId?: string;
  /** The exact RoomManager connection object, so close() can remove by identity. */
  connection?: WSConnection;
  unsubscribe?: () => void;
};

const wsState = new WeakMap<object, WsState>();

/**
 * Resolve a STABLE per-connection key.
 *
 * Elysia may hand a fresh `ws` wrapper to each lifecycle handler (open vs
 * message vs close), so keying on `ws` itself caused `getWsState` to miss in
 * `close` — leaving connections un-removed (the real WS leak root cause).
 * Bun attaches a single `data` object to a socket for its whole lifetime, so
 * we key on `ws.data` (falling back to `ws` if unavailable).
 */
function stateKey(ws: object): object {
  const data = (ws as { data?: unknown }).data;
  return data && typeof data === "object" ? (data as object) : ws;
}

export function setWsState(ws: object, state: WsState) {
  wsState.set(stateKey(ws), state);
}

export function getWsState(ws: object): WsState | undefined {
  return wsState.get(stateKey(ws));
}

/**
 * Sockets whose `close` has already run.
 *
 * Elysia completes the upgrade and only then invokes the async `open` handler, which awaits
 * authentication and channel authorisation before it registers anything. A client that disconnects
 * inside that window has its `close` run FIRST — finding no state, so cleaning nothing — after which
 * `open` resumes and registers a socket that is already gone: a room membership, a connectionMap
 * entry and a heartbeat interval that never stops, because Bun's `send` on a closed socket does not
 * throw. Measured in Section 7K: 60 of 60 connections closed on arrival left 60 zombies on each of
 * two routes, unchanged past a full heartbeat period.
 *
 * `close` records the socket here, and every `open` checks it after its last await and before it
 * registers, which JavaScript makes atomic because nothing between the check and the registration
 * yields.
 */
const closedSockets = new WeakSet<object>();

export function markWsClosed(ws: object): void {
  closedSockets.add(stateKey(ws));
}

export function closedDuringOpen(ws: object): boolean {
  return closedSockets.has(stateKey(ws));
}
