import { EVENT_TYPES } from "../catalog/event-types";
import type { HomigoEvent } from "../core/homigo-event";
import { partnerReferralService } from "../../services/partner-referral.service";

export const PARTNER_REFERRAL_CONSUMER_NAME = "partner-referral-lifecycle";

const HANDLED = new Set<string>([
  EVENT_TYPES.PARTNER_APPLICATION_STARTED,
  EVENT_TYPES.PARTNER_KYC_VERIFIED,
  EVENT_TYPES.PARTNER_TRAINING_COMPLETED,
  EVENT_TYPES.PARTNER_ACTIVATED,
  EVENT_TYPES.PARTNER_LIFECYCLE_CHANGED,
  EVENT_TYPES.BOOKING_COMPLETED,
  EVENT_TYPES.PARTNER_RISK_UPDATED,
]);

function providerIdOf(event: HomigoEvent): string | null {
  const data = event.data as Record<string, unknown>;
  if (typeof data.providerId === "string" && data.providerId.length > 0) return data.providerId;
  if (event.homigo.aggregateType === "partner" || event.homigo.aggregateType === "provider") {
    return event.homigo.aggregateId || null;
  }
  return null;
}

export async function partnerReferralConsumer(event: HomigoEvent): Promise<void> {
  if (!HANDLED.has(event.type)) return;
  const providerId = providerIdOf(event);
  if (!providerId) return;

  if (event.type === EVENT_TYPES.PARTNER_APPLICATION_STARTED) {
    const userId = typeof (event.data as { userId?: string }).userId === "string"
      ? (event.data as { userId: string }).userId
      : "";
    if (userId) await partnerReferralService.bindProvider(providerId, userId);
    return;
  }
  if (event.type === EVENT_TYPES.PARTNER_KYC_VERIFIED) {
    await partnerReferralService.onVerified(providerId);
    return;
  }
  if (event.type === EVENT_TYPES.PARTNER_TRAINING_COMPLETED) {
    await partnerReferralService.onTraining(providerId);
    return;
  }
  if (event.type === EVENT_TYPES.PARTNER_ACTIVATED || event.type === EVENT_TYPES.PARTNER_LIFECYCLE_CHANGED) {
    const next = (event.data as { newState?: string }).newState;
    if (event.type === EVENT_TYPES.PARTNER_ACTIVATED || next === "ACTIVE") {
      await partnerReferralService.onLifecycleActive(providerId);
    }
    return;
  }
  if (event.type === EVENT_TYPES.BOOKING_COMPLETED) {
    const bookingId = typeof (event.data as { bookingId?: string }).bookingId === "string"
      ? (event.data as { bookingId: string }).bookingId
      : event.homigo.aggregateId;
    if (bookingId) await partnerReferralService.onJobCompleted(providerId, bookingId);
    return;
  }
  if (event.type === EVENT_TYPES.PARTNER_RISK_UPDATED) {
    await partnerReferralService.onRiskUpdated(providerId);
  }
}
