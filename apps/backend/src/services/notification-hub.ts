import crypto from "crypto";
import { roomManager, MessageType, type WSMessage } from "../lib/websocket";

export type WsEnvelope = {
  eventId: string;
  timestamp: string;
  type: string;
  entityId?: string;
} & Record<string, unknown>;

export function createWsEnvelope(
  type: string,
  payload: Record<string, unknown>,
  entityId?: string,
): WsEnvelope {
  return {
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    entityId,
    ...payload,
  };
}

function toWsMessage(envelope: WsEnvelope): WSMessage {
  return {
    type: envelope.type || MessageType.NOTIFICATION,
    data: envelope,
    timestamp: new Date(),
  };
}

/** @deprecated Use roomManager directly — kept for backward compatibility. */
export function subscribeUserNotifications(_userId: string, _ws: { send: (data: string) => void }) {
  return () => undefined;
}

/** @deprecated Use roomManager directly — kept for backward compatibility. */
export function subscribeBookingTracking(_bookingId: string, _ws: { send: (data: string) => void }) {
  return () => undefined;
}

export function pushToUser(userId: string, payload: Record<string, unknown>) {
  const envelope = payload as WsEnvelope;
  roomManager.sendToUser(userId, toWsMessage(envelope));
}

export function pushToBookingTracking(bookingId: string, payload: Record<string, unknown>) {
  const envelope = payload as WsEnvelope;
  roomManager.broadcast(`tracking:${bookingId}`, toWsMessage(envelope));
}
