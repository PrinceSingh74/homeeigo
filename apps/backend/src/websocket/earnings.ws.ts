import { Elysia, t } from "elysia";
import { JWTService } from "@/services/jwt.service";
import { roomManager, MessageType, WSConnection, generateConnectionId } from "@/lib/websocket";
import { heartbeatManager } from "@/lib/heartbeat";
import { earningsLiveService } from "@/services/earnings-live.service";
import { getWsState, setWsState } from "./ws-state";

const jwt = new JWTService();

export const earningsWs = new Elysia({ prefix: "/ws" }).ws("/earnings/:providerId", {
  params: t.Object({ providerId: t.String() }),
  query: t.Object({ token: t.Optional(t.String()) }),

  open: async (ws) => {
    const authHeader =
      typeof ws.data.headers?.authorization === "string"
        ? ws.data.headers.authorization
        : "";
    const headerToken = authHeader.replace(/^Bearer\s+/i, "");
    const token = ws.data.query.token ?? headerToken ?? "";
    const payload = token ? jwt.verifyAccessToken(token) : null;

    if (!payload?.userId) {
      ws.close(4401, "Unauthorized");
      return;
    }

    const providerId = ws.data.params.providerId;

    if (payload.userId !== providerId) {
      ws.close(4003, "Unauthorized: Cannot access other users earnings");
      return;
    }

    const connectionId = generateConnectionId();

    const connection: WSConnection = {
      userId: payload.userId,
      userType: payload.userType || "vendor",
      connectionId,
      connectedAt: new Date(),
      lastPing: new Date(),
      rooms: new Set(),
      send: (message: string) => {
        try {
          ws.send(message);
        } catch (error) {
          console.error(`Failed to send to ${connectionId}:`, error);
        }
      },
    };

    roomManager.addToRoom(`earnings:${providerId}`, connection);
    heartbeatManager.startHeartbeat(connectionId, ws);

    setWsState(ws, {
      userId: payload.userId,
      userType: payload.userType || "vendor",
      connectionId,
      providerId,
      connection,
    });

    ws.send(
      JSON.stringify({
        type: MessageType.SUBSCRIBE,
        data: {
          message: "Connected to earnings",
          providerId,
          connectionId,
        },
        timestamp: new Date(),
      })
    );

    try {
      const earningsData = await earningsLiveService.getEarningsData(providerId);
      ws.send(
        JSON.stringify({
          type: MessageType.EARNINGS_UPDATE,
          data: earningsData,
          timestamp: new Date(),
        })
      );
    } catch (error) {
      console.error("Error fetching earnings:", error);
    }
  },

  message: async (ws, data: any) => {
    try {
      const message = JSON.parse(
        typeof data === "string" ? data : data.toString()
      );
      const providerId = ws.data.params.providerId;
      const state = getWsState(ws) as any;

      if (message.type === "get_breakdown") {
        const days = message.data?.days || 7;
        const breakdown = await earningsLiveService.getEarningsBreakdown(
          providerId,
          days
        );

        ws.send(
          JSON.stringify({
            type: "earnings_breakdown",
            data: breakdown,
            timestamp: new Date(),
          })
        );
      }

      if (message.type === "get_top_days") {
        const limit = message.data?.limit ?? 10;
        const lookbackDays = message.data?.lookbackDays ?? 90;
        const topDays = await earningsLiveService.getTopEarningDays(
          providerId,
          limit,
          lookbackDays
        );

        ws.send(
          JSON.stringify({
            type: "earnings_top_days",
            data: topDays,
            timestamp: new Date(),
          })
        );
      }

      if (message.type === "get_monthly_trend") {
        const months = message.data?.months || 6;
        const trend = await earningsLiveService.getMonthlyEarningsTrend(
          providerId,
          months
        );

        ws.send(
          JSON.stringify({
            type: "earnings_monthly_trend",
            data: trend,
            timestamp: new Date(),
          })
        );
      }

      if (message.type === "refresh_earnings") {
        const earningsData = await earningsLiveService.getEarningsData(
          providerId
        );
        ws.send(
          JSON.stringify({
            type: MessageType.EARNINGS_UPDATE,
            data: earningsData,
            timestamp: new Date(),
          })
        );
      }

      if (message.type === MessageType.PING) {
        ws.send(
          JSON.stringify({
            type: MessageType.PONG,
            timestamp: new Date(),
          })
        );
        heartbeatManager.handlePong(state?.connectionId);
      }
    } catch (error) {
      console.error("Earnings message error:", error);
      ws.send(
        JSON.stringify({
          type: MessageType.ERROR,
          data: { message: "Operation failed" },
          timestamp: new Date(),
        })
      );
    }
  },

  close: (ws) => {
    const providerId = ws.data.params.providerId;
    const state = getWsState(ws);

    if (state?.connectionId) {
      heartbeatManager.stopHeartbeat(state.connectionId);
    }

    // Remove the exact connection object (identity) → also prunes room/user
    // sets and the connectionMap entry inside removeFromRoom.
    if (state?.connection) {
      roomManager.removeAllRooms(state.connection);
    }

    console.log(`[WS] Earnings disconnected: ${providerId}`);
  },
});
