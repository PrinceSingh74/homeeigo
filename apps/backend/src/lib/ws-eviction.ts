import prisma from "./prisma";
import { roomManager, WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED } from "./websocket";
import { logger } from "./logger";

/**
 * Authorization revocation for live sockets.
 *
 * Every WebSocket room grant is decided once, at `open()`. These helpers are the other half of
 * that decision: the state transitions that make a grant stale call them so the socket is closed
 * (or dropped from the room) instead of receiving frames until the client feels like leaving.
 *
 * All helpers are fire-and-forget safe: eviction is best-effort transport hygiene and must never
 * fail the business transaction that triggered it.
 */

export function bookingRoomsFor(bookingId: string): string[] {
  return [`booking:${bookingId}`, `tracking:${bookingId}`];
}

/** The user no longer has a role on this booking (reassigned away, offer withdrawn). */
export function evictUserFromBooking(bookingId: string, userId: string, reason: string): void {
  try {
    roomManager.evictUser({ userId, roomIds: bookingRoomsFor(bookingId), code: WS_CLOSE_FORBIDDEN, reason });
  } catch (err) {
    logger.error("ws_evict_failed", { bookingId, userId, reason, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Same as {@link evictUserFromBooking} but resolves the partner's user id first. */
export async function evictProviderFromBooking(bookingId: string, providerId: string, reason: string): Promise<void> {
  try {
    const provider = await prisma.provider.findUnique({ where: { id: providerId }, select: { userId: true } });
    if (provider?.userId) evictUserFromBooking(bookingId, provider.userId, reason);
  } catch (err) {
    logger.error("ws_evict_failed", { bookingId, providerId, reason, error: err instanceof Error ? err.message : String(err) });
  }
}

/** The user may no longer hold any live socket (suspended, banned, role changed). Clients must not reconnect. */
export function evictUserEverywhere(userId: string, reason: string): void {
  try {
    roomManager.evictUser({ userId, code: WS_CLOSE_FORBIDDEN, reason });
  } catch (err) {
    logger.error("ws_evict_failed", { userId, reason, error: err instanceof Error ? err.message : String(err) });
  }
}

/** The credential behind the socket was revoked. Clients refresh and reconnect. */
export function evictRevokedSessions(userId: string, reason: string, jti?: string): void {
  try {
    roomManager.evictUser({ userId, jti, code: WS_CLOSE_UNAUTHORIZED, reason });
  } catch (err) {
    logger.error("ws_evict_failed", { userId, reason, error: err instanceof Error ? err.message : String(err) });
  }
}
