import type { UserRole } from "@prisma/client";
import { canAccessBookingWs } from "./ws-booking-access";

export type WsChannelKind = "notifications" | "earnings" | "booking" | "tracking" | "admin-ops";

export function mapUserRoleToWsType(role: UserRole): "customer" | "vendor" | "admin" {
  if (role === "ADMIN") return "admin";
  if (role === "VENDOR") return "vendor";
  return "customer";
}

/**
 * Role-scoped WebSocket channel access (Phase 6).
 * Returns false when the authenticated user may not subscribe to the channel.
 */
export async function validateWsChannelAccess(input: {
  channel: WsChannelKind;
  userId: string;
  userRole: UserRole;
  channelUserId?: string;
  bookingId?: string;
}): Promise<boolean> {
  const wsType = mapUserRoleToWsType(input.userRole);

  switch (input.channel) {
    case "notifications":
      return input.channelUserId === input.userId;

    case "admin-ops":
      // Admin operations command-center feed (ops-map alerts). Admin-only.
      return wsType === "admin";

    case "earnings":
      return wsType === "vendor" && input.channelUserId === input.userId;

    case "booking":
    case "tracking":
      if (!input.bookingId) return false;
      return canAccessBookingWs(input.userId, input.bookingId, wsType);

    default:
      return false;
  }
}
