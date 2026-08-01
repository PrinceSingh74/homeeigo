import { Elysia, t } from "elysia";
import { roomManager, MessageType, type WSConnection, generateConnectionId } from "../lib/websocket";
import { heartbeatManager } from "../lib/heartbeat";
import { authenticateWsConnection } from "../lib/ws-connection-auth";
import { validateWsChannelAccess } from "../lib/ws-channel-access";
import { getWsState, setWsState } from "./ws-state";
import { ADMIN_OPS_ROOM } from "../lib/admin-alert-broadcast";

/**
 * Admin operations command-center channel. Admin-only. Joins the existing `admin:ops`
 * room that `ops-map.service` already broadcasts to (PROVIDER_ONLINE/OFFLINE, BOOKING_UPDATE,
 * ALERT) — no new room, no new alert engine. The Alert Center page subscribes here for live
 * push instead of polling.
 */
export const adminOpsWs = new Elysia().ws("/ws/admin-ops", {
  query: t.Object({ token: t.Optional(t.String()), nonce: t.Optional(t.String()) }),
  async open(ws) {
    const auth = await authenticateWsConnection(ws, "/ws/admin-ops");
    if (!auth) {
      ws.close(4401, "Unauthorized");
      return;
    }

    const allowed = await validateWsChannelAccess({
      channel: "admin-ops",
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

    roomManager.addToRoom(ADMIN_OPS_ROOM, connection);
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
        data: { message: "Connected to admin ops feed", connectionId, room: ADMIN_OPS_ROOM },
        timestamp: new Date(),
      }),
    );
  },
  message(ws, data: unknown) {
    try {
      // Elysia auto-parses JSON ws frames → `data` is usually already an object.
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
