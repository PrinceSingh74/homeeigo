import { Elysia, t } from "elysia";
import { roomManager, MessageType, type WSConnection, generateConnectionId } from "../lib/websocket";
import { heartbeatManager } from "../lib/heartbeat";
import { trackingService } from "../services/tracking.service";
import prisma from "../lib/prisma";
import { authenticateWsConnection } from "../lib/ws-connection-auth";
import { validateWsChannelAccess } from "../lib/ws-channel-access";
import { getWsState, setWsState } from "./ws-state";

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

    const connectionId = generateConnectionId();
    const connection: WSConnection = {
      userId: auth.userId,
      userType: auth.userType,
      connectionId,
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

    roomManager.addToRoom(`tracking:${bookingId}`, connection);
    heartbeatManager.startHeartbeat(connectionId, ws);

    setWsState(ws, {
      userId: auth.userId,
      userType: auth.userType,
      connectionId,
      connection,
      bookingId,
    });
  },
  async message(ws, message) {
    if (typeof message !== "object" || message === null) return;
    const m = message as { type?: string; latitude?: number; longitude?: number; accuracy?: number };
    if (m.type !== "location_update") return;

    const state = getWsState(ws);
    if (!state) return;

    const provider = await prisma.provider.findUnique({ where: { userId: state.userId } });
    if (!provider || m.latitude == null || m.longitude == null) return;

    await trackingService.updateLocation(provider.id, {
      bookingId: ws.data.params.bookingId,
      latitude: m.latitude,
      longitude: m.longitude,
      accuracy: m.accuracy,
    });
  },
  close(ws) {
    const state = getWsState(ws);
    if (state?.connectionId) heartbeatManager.stopHeartbeat(state.connectionId);
    if (state?.connection) roomManager.removeAllRooms(state.connection);
  },
});
