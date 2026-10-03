import { logger } from "../lib/logger";
import { Elysia, t } from "elysia";
import { roomManager, MessageType, WSConnection, generateConnectionId } from "@/lib/websocket";
import { heartbeatManager } from "@/lib/heartbeat";
import { bookingLiveService } from "@/services/booking-live.service";
import prisma from "@/lib/prisma";
import { authenticateWsConnection } from "@/lib/ws-connection-auth";
import { validateWsChannelAccess } from "@/lib/ws-channel-access";
import { getWsState, setWsState, markWsClosed, closedDuringOpen } from "./ws-state";

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
        } catch (error) {
          console.error(`Failed to send to ${connectionId}:`, error);
        }
      },
    };

    // The client may have left while the awaits above were pending; registering now would create a
    // connection, room membership and heartbeat for a socket that is already closed. See ws-state.ts.
    if (closedDuringOpen(ws)) return;

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
      // `getWsState` already returns a typed `WsState | undefined`; the previous `as any` erased
      // that on the very values used to authorise the partner actions below — a mistyped field or
      // a wrong `userType` literal would have compiled silently.
      const state = getWsState(ws);
      const userType = state?.userType;

      /**
       * Fail closed when the socket has no identity.
       *
       * Removing the `as any` above revealed that `userId` is `string | undefined` and was being
       * passed straight into acceptBooking / rejectBooking / cancelBooking / startService /
       * completeBooking, every one of which requires a real user id — the same shape of defect as
       * the AI-tools cancel handler that passed an actor with an undefined user.
       *
       * This is not hypothetical here: the comment on `stateKey` in ws-state.ts records that
       * `getWsState` HAS missed for a live socket before, when the key was unstable. Every action
       * below mutates a booking on behalf of a specific person, so with no identity the only
       * correct outcome is to refuse.
       */
      const userId = state?.userId;
      if (!userId) {
        ws.send(
          JSON.stringify({
            type: MessageType.ERROR,
            data: { message: "Not authenticated for this connection" },
            timestamp: new Date(),
          })
        );
        return;
      }

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
        await bookingLiveService.startService(bookingId, userId, {
          otp: typeof message.data?.otp === "string" ? message.data.otp : undefined,
          latitude:
            typeof message.data?.latitude === "number" ? message.data.latitude : undefined,
          longitude:
            typeof message.data?.longitude === "number" ? message.data.longitude : undefined,
        });
      }

      if (message.type === "complete_booking" && userType === "vendor") {
        await bookingLiveService.completeBooking(bookingId, userId, {
          latitude:
            typeof message.data?.latitude === "number" ? message.data.latitude : undefined,
          longitude:
            typeof message.data?.longitude === "number" ? message.data.longitude : undefined,
          notes: typeof message.data?.notes === "string" ? message.data.notes : undefined,
        });
      }

      if (message.type === MessageType.PING) {
        ws.send(
          JSON.stringify({
            type: MessageType.PONG,
            timestamp: new Date(),
          })
        );
        // `connectionId` is optional on WsState; with no id there is no heartbeat to record.
        const connectionId = getWsState(ws)?.connectionId;
        if (connectionId) heartbeatManager.handlePong(connectionId);
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
    markWsClosed(ws);
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

    logger.debug("ws_booking_disconnected", { bookingId, userId: state?.userId ?? null });
  },
});
