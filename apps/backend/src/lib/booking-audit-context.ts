import type { Prisma } from "@prisma/client";
import { getEventContext, type EventActorType } from "../events/core/event-context";

/**
 * Stamp WHO/WHY/which request onto the current transaction for `bookings_status_history_trg`
 * (migration 20260919120000_booking_status_history). Transaction-local (`set_config(…, true)`), so
 * it can never leak onto another request's writes on the same pooled connection.
 *
 * Defaults come from the request's async context (actor bound by the auth plugin, request id by
 * the request-context plugin); callers override for system actors or to add a reason. Call it
 * first thing inside any transaction that changes a booking's status, partner or payment status.
 * A write without it is still recorded by the trigger — only these fields are empty.
 */
export async function setBookingAuditContext(
  tx: Prisma.TransactionClient,
  override: { actorType?: EventActorType; actorId?: string | null; reason?: string | null } = {},
): Promise<void> {
  const ctx = getEventContext();
  const actorType = override.actorType ?? ctx.actorType ?? "system";
  const actorId = override.actorId ?? ctx.actorId ?? "";
  const reason = (override.reason ?? "").slice(0, 500);
  const requestId = ctx.requestId ?? "";
  // §5: recorded by migration 20260924120000; on a database without that migration the setting is
  // simply never read.
  const traceId = ctx.traceId ?? "";
  await tx.$queryRaw`SELECT
    set_config('homigo.actor_type', ${actorType}, true),
    set_config('homigo.actor_id', ${actorId}, true),
    set_config('homigo.reason', ${reason}, true),
    set_config('homigo.request_id', ${requestId}, true),
    set_config('homigo.trace_id', ${traceId}, true)`;
}
