import type { BookingStatus } from "@prisma/client";
import prisma from "./prisma";
import { roomManager, MessageType, type WSMessage } from "./websocket";
import { createWsEnvelope, pushToUser } from "../services/notification-hub";
import { incCounter } from "./metrics";
import { withoutCustomerMoney } from "./privacy-policy.engine";
import { logger } from "./logger";

/**
 * The single authoritative producer of realtime booking-status frames.
 *
 * Before this existed, `BOOKING_STATUS` reached the customer only when partner-web re-sent the
 * lifecycle action over `/ws/booking/:id` *after* its HTTP mutation had already succeeded. That made
 * a fire-and-forget client side-channel the source of truth for what the customer saw: a partner on
 * mobile (no publisher), a partner whose socket was closed, or an admin acting on the booking
 * produced no frame at all, and the customer sat on "Booked" until a focus refetch.
 *
 * Every state transition in `booking.service` / `tracking.service` / admin operations now calls this
 * once, after its transaction has committed. The frame fans out to:
 *
 *   - `booking:{id}`          — the per-booking room (`/ws/booking/:id`), for open detail views;
 *   - `user:{customerUserId}` — the customer's notifications socket, so list views converge even
 *                               when no booking room is open;
 *   - `user:{providerUserId}` — the partner's notifications socket (admin actions, WS actions);
 *   - `admin:notifications`   — every connected admin (see notifications.ws.ts), so the console's
 *                               list/detail queries invalidate without a 60 s poll.
 *
 * Fire-and-forget by design: a realtime frame must never fail or slow a booking mutation. Failures
 * are counted and logged, never swallowed silently.
 */

export const ADMIN_NOTIFICATIONS_ROOM = "admin:notifications";

/** Envelope type carried on user/admin rooms. Bridges match on this exact string. */
export const BOOKING_STATUS_EVENT = "booking.status";

export type BookingRealtimeInput = {
  bookingId: string;
  /** Prisma enum or its lowercase API form; normalised to lowercase on the wire. */
  status: BookingStatus | string;
  /** Customer user id. Looked up when omitted. */
  userId?: string | null;
  /** Partner *user* id (not provider id). Looked up when omitted. */
  providerUserId?: string | null;
  /** Any additional booking fields the client may render (acceptedAt, eta, refundAmount…). */
  extra?: Record<string, unknown>;
};

async function resolveParties(bookingId: string): Promise<{ userId: string | null; providerUserId: string | null }> {
  const row = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { userId: true, provider: { select: { userId: true } } },
  });
  return { userId: row?.userId ?? null, providerUserId: row?.provider?.userId ?? null };
}

/**
 * Publish a booking status transition. Resolves the customer / partner user ids when the caller
 * does not already have them in hand. Never throws.
 */
export async function publishBookingStatus(input: BookingRealtimeInput): Promise<void> {
  const status = String(input.status).toLowerCase();
  try {
    let userId = input.userId ?? null;
    let providerUserId = input.providerUserId ?? null;
    if (input.userId === undefined || input.providerUserId === undefined) {
      const parties = await resolveParties(input.bookingId);
      if (input.userId === undefined) userId = parties.userId;
      if (input.providerUserId === undefined) providerUserId = parties.providerUserId;
    }

    const timestamp = new Date();
    const extra = input.extra ?? {};
    // X-29: the partner gets the same transition without the customer's money (refund, fee, tender).
    const partnerExtra = withoutCustomerMoney(extra);

    // Per-booking room: legacy `BOOKING_STATUS` shape consumed by use-booking-status-subscription.
    const roomData = (e: Record<string, unknown>) => ({ bookingId: input.bookingId, status, ...e, timestamp: timestamp.toISOString() });
    const roomMessage: WSMessage = { type: MessageType.BOOKING_STATUS, data: roomData(extra), timestamp };
    roomManager.broadcast(`booking:${input.bookingId}`, roomMessage, { exceptUserType: "vendor" });
    roomManager.broadcast(
      `booking:${input.bookingId}`,
      { type: MessageType.BOOKING_STATUS, data: roomData(partnerExtra), timestamp },
      { onlyUserType: "vendor" },
    );

    // User rooms + admin room: enveloped `booking.status` with referenceId so the notification
    // bridges can update list state without knowing the booking room exists.
    const envelopeFor = (e: Record<string, unknown>) =>
      createWsEnvelope(
        BOOKING_STATUS_EVENT,
        { bookingId: input.bookingId, referenceId: input.bookingId, referenceType: "booking", status, ...e },
        input.bookingId,
      );
    const envelope = envelopeFor(extra);
    if (userId) pushToUser(userId, envelope);
    if (providerUserId && providerUserId !== userId) pushToUser(providerUserId, envelopeFor(partnerExtra));
    roomManager.broadcast(ADMIN_NOTIFICATIONS_ROOM, {
      type: BOOKING_STATUS_EVENT,
      data: envelope,
      timestamp,
    });

    incCounter("booking_realtime_published_total", { status });
  } catch (err) {
    incCounter("booking_realtime_publish_failed_total", { status });
    logger.error("booking_realtime_publish_failed", {
      bookingId: input.bookingId,
      status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Convenience for call sites that must not await (post-commit side effect). */
export function publishBookingStatusBackground(input: BookingRealtimeInput): void {
  void publishBookingStatus(input);
}

/* ------------------------------------------------------------------ */
/* Phase 10 §6 — requirement / execution-gate frames                   */
/* ------------------------------------------------------------------ */

/** Envelope type carried on user/admin rooms for requirement state and gate changes. */
export const BOOKING_REQUIREMENT_EVENT = "booking.requirement";

export type BookingRequirementRealtimeInput = {
  bookingId: string;
  userId?: string | null;
  providerUserId?: string | null;
  event:
    | "requirement.updated" | "requirement.satisfied" | "requirement.blocked" | "execution.blocked" | "execution.unblocked"
    // Phase 10 §10: a quality verdict was recorded; the customer confirmation axis changed.
    | "quality.verdict" | "completion.confirmed" | "completion.auto_confirmed";
  code?: string;
  state?: string;
  /** The START gate after the change — clients render "blocked" from this, never from their own state. */
  gate: { ok: boolean; blocking: Array<{ code: string; label: string; enforcementPoint: string; reason: string }> };
};

/**
 * Same rooms, same envelope, same fan-out as booking status — this is the one publisher, extended,
 * not a second one. Consumers refetch the booking's requirement view; the frame is a signal plus a
 * summary, never the authority.
 */
export async function publishBookingRequirement(input: BookingRequirementRealtimeInput): Promise<void> {
  try {
    let userId = input.userId ?? null;
    let providerUserId = input.providerUserId ?? null;
    if (input.userId === undefined || input.providerUserId === undefined) {
      const parties = await resolveParties(input.bookingId);
      if (input.userId === undefined) userId = parties.userId;
      if (input.providerUserId === undefined) providerUserId = parties.providerUserId;
    }
    const timestamp = new Date();
    const payload = {
      bookingId: input.bookingId,
      referenceId: input.bookingId,
      referenceType: "booking",
      event: input.event,
      code: input.code ?? null,
      state: input.state ?? null,
      gate: { ok: input.gate.ok, blocking: input.gate.blocking.map((b) => ({ code: b.code, label: b.label, enforcementPoint: b.enforcementPoint, reason: b.reason })) },
      timestamp: timestamp.toISOString(),
    };
    roomManager.broadcast(`booking:${input.bookingId}`, { type: BOOKING_REQUIREMENT_EVENT, data: payload, timestamp });
    const envelope = createWsEnvelope(BOOKING_REQUIREMENT_EVENT, payload, input.bookingId);
    if (userId) pushToUser(userId, envelope);
    if (providerUserId && providerUserId !== userId) pushToUser(providerUserId, envelope);
    roomManager.broadcast(ADMIN_NOTIFICATIONS_ROOM, { type: BOOKING_REQUIREMENT_EVENT, data: envelope, timestamp });
    incCounter("booking_requirement_realtime_published_total", { event: input.event });
  } catch (err) {
    incCounter("booking_requirement_realtime_publish_failed_total", { event: input.event });
    logger.error("booking_requirement_realtime_publish_failed", { bookingId: input.bookingId, event: input.event, error: err instanceof Error ? err.message : String(err) });
  }
}

export function publishBookingRequirementBackground(input: BookingRequirementRealtimeInput): void {
  void publishBookingRequirement(input);
}
