/** A job inside this window is still a near-term offer. Further out is a scheduled appointment. */
export const SCHEDULED_OFFER_LIVE_PRESENCE_HORIZON_MS = 24 * 60 * 60 * 1000;

/**
 * Same-day and next-day jobs still need a live heartbeat.
 * An appointment further out is offered from the partner's saved base: the phone
 * does not have to be pinging at the moment the customer pays.
 */
export function offerRequiresLivePresence(scheduledDate: Date, now: Date = new Date()): boolean {
  return scheduledDate.getTime() - now.getTime() <= SCHEDULED_OFFER_LIVE_PRESENCE_HORIZON_MS;
}
