import { Elysia, t } from "elysia";
import { roomManager, type WSConnection, generateConnectionId } from "../lib/websocket";
import { heartbeatManager } from "../lib/heartbeat";
import { trackingService } from "../services/tracking.service";
import prisma from "../lib/prisma";
import { authenticateWsConnection } from "../lib/ws-connection-auth";
import { validateWsChannelAccess } from "../lib/ws-channel-access";
import { getWsState, setWsState, markWsClosed, closedDuringOpen } from "./ws-state";

export const trackingWs = new Elysia().ws("/ws/tracking/:bookingId", {
  params: t.Object({ bookingId: t.String() }),
  query: t.Object({ token: t.Optional(t.String()), nonce: t.Optional(t.String()) }),
  open: async (ws) => {
    const bookingId = ws.data.params.bookingId;
    const auth = await authenticateWsConnection(ws, `/ws/tracking/${bookingId}`);
    if (!auth) {
      ws.close(4401, "Unauthorized");
      return;
    }

    const allowed = await validateWsChannelAccess({
      channel: "tracking",
      userId: auth.userId,
      userRole: auth.userRole,
      bookingId,
    });
    if (!allowed) {
      ws.close(4403, "Forbidden");
      return;
    }

    // Resolved once here, not once per location frame: pings arrive every few seconds per active
    // partner and most are discarded by the server-side throttle — a per-ping lookup was the
    // single most frequent query in the system for zero information.
    const providerId =
      auth.userType === "vendor"
        ? (await prisma.provider.findUnique({ where: { userId: auth.userId }, select: { id: true } }))?.id
        : undefined;

    const connectionId = generateConnectionId();
    const connection: WSConnection = {
      userId: auth.userId,
      userType: auth.userType,
      connectionId,
      jti: auth.jti,
      tokenExp: auth.exp,
      close: (code: number, reason: string) => {
        try {
          ws.close(code, reason);
        } catch {
          /* already closed */
        }
      },
      connectedAt: new Date(),
      lastPing: new Date(),
      rooms: new Set(),
      send: (message: string) => {
        try {
          ws.send(message);
        } catch {
          /* disconnected */
        }
      },
    };

    // The client may have left while the awaits above were pending; registering now would create a
    // connection, room membership and heartbeat for a socket that is already closed. See ws-state.ts.
    if (closedDuringOpen(ws)) return;

    roomManager.addToRoom(`tracking:${bookingId}`, connection);
    heartbeatManager.startHeartbeat(connectionId, ws);

    setWsState(ws, {
      userId: auth.userId,
      userType: auth.userType,
      connectionId,
      connection,
      bookingId,
      providerId,
    });
  },
  async message(ws, message) {
    if (typeof message !== "object" || message === null) return;
    const m = message as { type?: string; latitude?: number; longitude?: number; accuracy?: number; mocked?: boolean | null };
    if (m.type !== "location_update") return;

    const state = getWsState(ws);
    if (!state) return;

    if (!state.providerId || m.latitude == null || m.longitude == null) return;

    await trackingService.updateLocation(state.providerId, {
      bookingId: ws.data.params.bookingId,
      latitude: m.latitude,
      longitude: m.longitude,
      accuracy: m.accuracy,
      // The device's own word on the fix; anything but a boolean is "unknown".
      mocked: typeof m.mocked === "boolean" ? m.mocked : null,
    });
  },
  close(ws) {
    markWsClosed(ws);
    const state = getWsState(ws);
    if (state?.connectionId) heartbeatManager.stopHeartbeat(state.connectionId);
    if (state?.connection) roomManager.removeAllRooms(state.connection);
  },
});
