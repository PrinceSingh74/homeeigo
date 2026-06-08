import { roomManager, MessageType, WSMessage } from "@/lib/websocket";

export function broadcastLocationUpdate(bookingId: string, data: any): void {
  const message: WSMessage = {
    type: MessageType.LOCATION_UPDATE,
    data,
    timestamp: new Date(),
  };
  roomManager.broadcast(`tracking:${bookingId}`, message);
}

export function sendNotificationToUser(userId: string, notification: {
  title: string;
  body: string;
  type: string;
  data?: any;
}): void {
  const message: WSMessage = {
    type: MessageType.NOTIFICATION,
    data: notification,
    timestamp: new Date(),
  };
  roomManager.sendToUser(userId, message);
}

export function broadcastBookingStatusChange(
  bookingId: string,
  status: string,
  data: any = {}
): void {
  const message: WSMessage = {
    type: MessageType.BOOKING_STATUS,
    data: {
      bookingId,
      status,
      ...data,
      timestamp: new Date(),
    },
    timestamp: new Date(),
  };
  roomManager.broadcast(`booking:${bookingId}`, message);
}

export function sendEarningsUpdate(providerId: string, earnings: any): void {
  const message: WSMessage = {
    type: MessageType.EARNINGS_UPDATE,
    data: earnings,
    timestamp: new Date(),
  };
  roomManager.sendToUser(providerId, message);
}

export function getConnectionStats() {
  return roomManager.getStats();
}
