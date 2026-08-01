import { Elysia, t } from "elysia";
import { roomManager, MessageType, WSConnection, generateConnectionId } from "@/lib/websocket";
import { heartbeatManager } from "@/lib/heartbeat";
import { earningsLiveService } from "@/services/earnings-live.service";
import { authenticateWsConnection } from "@/lib/ws-connection-auth";
import { validateWsChannelAccess } from "@/lib/ws-channel-access";
import { getWsState, setWsState } from "./ws-state";

export const earningsWs = new Elysia({ prefix: "/ws" }).ws("/earnings/:providerId", {
  params: t.Object({ providerId: t.String() }),
  query: t.Object({ token: t.Optional(t.String()), nonce: t.Optional(t.String()) }),

  open: async (ws) => {
    const auth = await authenticateWsConnection(ws, `/ws/earnings/${ws.data.params.providerId}`);
    if (!auth) {
      ws.close(4401, "Unauthorized");
      return;
    }

    const providerId = ws.data.params.providerId;
    const allowed = await validateWsChannelAccess({
      channel: "earnings",
      userId: auth.userId,
      userRole: auth.userRole,
      channelUserId: providerId,
    });
    if (!allowed) {
      ws.close(4003, "Unauthorized: Cannot access other users earnings");
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
        } catch (error) {
          console.error(`Failed to send to ${connectionId}:`, error);
        }
      },
    };

    roomManager.addToRoom(`earnings:${providerId}`, connection);
    heartbeatManager.startHeartbeat(connectionId, ws);

    setWsState(ws, {
      userId: auth.userId,
      userType: auth.userType,
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
      // Elysia auto-parses JSON ws frames → `data` is usually already an object.
      const message =
        typeof data === "string"
          ? JSON.parse(data)
          : Buffer.isBuffer(data)
            ? JSON.parse(data.toString())
            : data;
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

    if (state?.connection) {
      roomManager.removeAllRooms(state.connection);
    }

    console.log(`[WS] Earnings disconnected: ${providerId}`);
  },
});
