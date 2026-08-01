import { Elysia, t } from "elysia";
import { roomManager, MessageType, WSConnection, generateConnectionId } from "@/lib/websocket";
import { heartbeatManager } from "@/lib/heartbeat";
import { bookingLiveService } from "@/services/booking-live.service";
import prisma from "@/lib/prisma";
import { authenticateWsConnection } from "@/lib/ws-connection-auth";
import { validateWsChannelAccess } from "@/lib/ws-channel-access";
import { getWsState, setWsState } from "./ws-state";

export const bookingWs = new Elysia({ prefix: "/ws" }).ws("/booking/:bookingId", {
  params: t.Object({ bookingId: t.String() }),
  query: t.Object({ token: t.Optional(t.String()), nonce: t.Optional(t.String()) }),

  open: async (ws) => {
    const bookingId = ws.data.params.bookingId;
    const auth = await authenticateWsConnection(ws, `/ws/booking/${bookingId}`);
    if (!auth) {
      ws.close(4401, "Unauthorized");
      return;
    }

    const allowed = await validateWsChannelAccess({
      channel: "booking",
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
        } catch (error) {
          console.error(`Failed to send to ${connectionId}:`, error);
        }
      },
    };

    roomManager.addToRoom(`booking:${bookingId}`, connection);
    heartbeatManager.startHeartbeat(connectionId, ws);

    setWsState(ws, {
      userId: auth.userId,
      userType: auth.userType,
      connectionId,
      bookingId,
      connection,
    });

    ws.send(
      JSON.stringify({
        type: MessageType.SUBSCRIBE,
        data: {
          message: "Connected to booking",
          bookingId,
          connectionId,
        },
        timestamp: new Date(),
      })
    );

    try {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        include: { provider: true, service: true, address: true },
      });

      if (booking) {
        ws.send(
          JSON.stringify({
            type: MessageType.BOOKING_STATUS,
            data: {
              bookingId,
              status: booking.status.toLowerCase(),
              providerId: booking.providerId,
              serviceId: booking.serviceId,
              scheduledDate: booking.scheduledDate,
            },
            timestamp: new Date(),
          })
        );
      }
    } catch (error) {
      console.error("Error fetching booking:", error);
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
      const bookingId = ws.data.params.bookingId;
      const userId = (getWsState(ws) as any)?.userId;
      const userType = (getWsState(ws) as any)?.userType;

      if (message.type === "accept_booking" && userType === "vendor") {
        await bookingLiveService.acceptBooking(bookingId, userId);
      }

      if (message.type === "reject_booking" && userType === "vendor") {
        await bookingLiveService.rejectBooking(
          bookingId,
          userId,
          message.data?.reason
        );
      }

      if (message.type === "cancel_booking" && userType === "customer") {
        await bookingLiveService.cancelBooking(
          bookingId,
          userId,
          message.data?.reason
        );
      }

      if (message.type === "start_service" && userType === "vendor") {
        await bookingLiveService.startService(bookingId, userId);
      }

      if (message.type === "complete_booking" && userType === "vendor") {
        await bookingLiveService.completeBooking(bookingId, userId);
      }

      if (message.type === MessageType.PING) {
        ws.send(
          JSON.stringify({
            type: MessageType.PONG,
            timestamp: new Date(),
          })
        );
        heartbeatManager.handlePong((getWsState(ws) as any)?.connectionId);
      }
    } catch (error) {
      console.error("Booking message error:", error);
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
    const state = getWsState(ws);
    const bookingId = ws.data.params.bookingId;

    if (state?.connectionId) {
      heartbeatManager.stopHeartbeat(state.connectionId);
    }

    // Remove the exact connection object (identity), which also prunes the
    // room/user sets and the connectionMap entry inside removeFromRoom.
    if (state?.connection) {
      roomManager.removeAllRooms(state.connection);
    }

    console.log(`[WS] Booking disconnected: ${bookingId} - ${state?.userId}`);
  },
});
