import { Elysia, t } from "elysia";
import { JWTService } from "../services/jwt.service";
import { roomManager, MessageType, type WSConnection, generateConnectionId } from "../lib/websocket";
import { heartbeatManager } from "../lib/heartbeat";
import { getWsState, setWsState } from "./ws-state";

const jwt = new JWTService();

export const notificationsWs = new Elysia().ws("/ws/notifications", {
  query: t.Object({ token: t.Optional(t.String()) }),
  open(ws) {
    const authHeader =
      typeof ws.data.headers?.authorization === "string" ? ws.data.headers.authorization : "";
    const headerToken = authHeader.replace(/^Bearer\s+/i, "");
    const token = ws.data.query.token ?? headerToken ?? "";
    const payload = token ? jwt.verifyAccessToken(token) : null;
    if (!payload?.userId) {
      ws.close(4401, "Unauthorized");
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

    roomManager.addToRoom(`user:${payload.userId}`, connection);
    heartbeatManager.startHeartbeat(connectionId, ws);

    setWsState(ws, {
      userId: payload.userId,
      connectionId,
      connection,
    });

    ws.send(
      JSON.stringify({
        type: MessageType.SUBSCRIBE,
        data: { message: "Connected to notifications", connectionId },
        timestamp: new Date(),
      }),
    );
  },
  message(ws, data: string | Buffer) {
    try {
      const raw = typeof data === "string" ? data : data.toString();
      const message = JSON.parse(raw) as { type?: string };
      if (message.type === MessageType.PING) {
        ws.send(JSON.stringify({ type: MessageType.PONG, timestamp: new Date() }));
        const connId = getWsState(ws)?.connectionId;
        if (connId) heartbeatManager.handlePong(connId);
      }
    } catch {
      /* ignore */
    }
  },
  close(ws) {
    const state = getWsState(ws);
    if (state?.connectionId) heartbeatManager.stopHeartbeat(state.connectionId);
    if (state?.connection) roomManager.removeAllRooms(state.connection);
  },
});
