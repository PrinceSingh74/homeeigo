import { Elysia, t } from "elysia";
import { roomManager, MessageType, type WSConnection, generateConnectionId } from "../lib/websocket";
import { heartbeatManager } from "../lib/heartbeat";
import { authenticateWsConnection } from "../lib/ws-connection-auth";
import { validateWsChannelAccess } from "../lib/ws-channel-access";
import { getWsState, setWsState } from "./ws-state";

export const notificationsWs = new Elysia().ws("/ws/notifications", {
  query: t.Object({ token: t.Optional(t.String()), nonce: t.Optional(t.String()) }),
  async open(ws) {
    const auth = await authenticateWsConnection(ws, "/ws/notifications");
    if (!auth) {
      ws.close(4401, "Unauthorized");
      return;
    }

    const allowed = await validateWsChannelAccess({
      channel: "notifications",
      userId: auth.userId,
      userRole: auth.userRole,
      channelUserId: auth.userId,
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

    roomManager.addToRoom(`user:${auth.userId}`, connection);
    heartbeatManager.startHeartbeat(connectionId, ws);

    setWsState(ws, {
      userId: auth.userId,
      userType: auth.userType,
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
  message(ws, data: unknown) {
    try {
      // Elysia auto-parses JSON ws frames → `data` is usually already an object.
      // Accept string / Buffer / pre-parsed object so client PING is reliably answered.
      const message = (
        typeof data === "string"
          ? JSON.parse(data)
          : Buffer.isBuffer(data)
            ? JSON.parse(data.toString())
            : data
      ) as { type?: string };
      if (message?.type === MessageType.PING) {
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
