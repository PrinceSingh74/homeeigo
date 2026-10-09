/**
 * Phase 15.2 — projects committed booking / checkout facts into `analytics_events`.
 *
 * AUTHORITATIVE TRANSACTION → event_outbox → this consumer → analytics row. The analytics row is
 * written only after the business fact is already committed and published, so it can never claim
 * a booking, checkout, completion or cancellation that did not happen. Idempotent twice over: the
 * consumer receipt (one delivery per consumer per event) and the deterministic
 * `analytics_events.event_id` derived from the outbox event id.
 */
import type { HomigoEvent } from "../core/homigo-event";
import { projectFunnelDomainEvent } from "../../services/analytics-funnel.service";

export async function analyticsFunnelConsumer(event: HomigoEvent): Promise<void> {
  await projectFunnelDomainEvent(event);
}

export const ANALYTICS_FUNNEL_CONSUMER_NAME = "analytics-funnel.v1";
