import { Elysia, t } from "elysia";
import { JWTService } from "../services/jwt.service";
import { roomManager, MessageType, type WSConnection, generateConnectionId } from "../lib/websocket";
import { heartbeatManager } from "../lib/heartbeat";
import { trackingService } from "../services/tracking.service";
import prisma from "../lib/prisma";
import { canAccessBookingWs } from "../lib/ws-booking-access";
import { getWsState, setWsState } from "./ws-state";

const jwt = new JWTService();

export const trackingWs = new Elysia().ws("/ws/tracking/:bookingId", {
  params: t.Object({ bookingId: t.String() }),
  query: t.Object({ token: t.Optional(t.String()) }),
  open: async (ws) => {
    const authHeader =
      typeof ws.data.headers?.authorization === "string" ? ws.data.headers.authorization : "";
    const headerToken = authHeader.replace(/^Bearer\s+/i, "");
    const token = ws.data.query.token ?? headerToken ?? "";
    const payload = token ? jwt.verifyAccessToken(token) : null;
    if (!payload?.userId) {
      ws.close(4401, "Unauthorized");
      return;
    }

    const bookingId = ws.data.params.bookingId;
    const allowed = await canAccessBookingWs(payload.userId, bookingId, payload.userType);
    if (!allowed) {
      ws.close(4403, "Forbidden");
      return;
    }

    const connectionId = generateConnectionId();
    const connection: WSConnection = {
      userId: payload.userId,
      userType: payload.userType || "customer",
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
      userId: payload.userId,
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
