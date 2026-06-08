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
