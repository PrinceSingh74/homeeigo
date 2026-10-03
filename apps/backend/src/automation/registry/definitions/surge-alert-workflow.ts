import { EVENT_TYPES } from "../../../events/catalog/event-types";
import { registerWorkflow } from "../workflow-registry";

/**
 * Surge Automation (Partner Intelligence, Item 7) — the workflow.
 *
 * ── Registered, and inert for two independent reasons ──────────────────────────
 *
 * Item 6's workflow was inert because no clock published its trigger. This one is inert for that
 * reason *and* a second: `surgeAlertPolicy` has no threshold, so even a producer that existed would
 * have nothing to decide with. `surgeAlertService.evaluate()` returns `WOULD_NOT_EVALUATE` for every
 * zone and cannot return `ALERT_WORTHY` under the shipped policy.
 *
 * ── Eligibility is borrowed, not redefined ─────────────────────────────────────
 *
 * `provider.morning_eligible` is reused exactly as Item 6 registered it. The name reads oddly on a
 * surge alert, and that is the lesser cost: it is the canonical dispatch composite, and a second
 * condition — `provider.surge_eligible` — would be a second answer to "is this a working partner"
 * that could drift from the dispatcher without any test noticing. If the two capabilities ever need
 * genuinely different eligibility, that is a business decision, and it gets a new condition then.
 *
 * ── Informational only ─────────────────────────────────────────────────────────
 *
 * CONDITION → NOTIFICATION → STOP. No ACTION step, so there is no path from this workflow to
 * pricing, payout, availability or assignment — the registry additionally refuses HIGH_RISK action
 * substrings for a LOW-risk definition, but the stronger guarantee is that the workflow contains no
 * action step at all.
 */

export const SURGE_ALERT_WORKFLOW = "surge_alert";
export const SURGE_ALERT_WORKFLOW_VERSION = 1;

export function registerSurgeAlertWorkflow(): void {
  registerWorkflow({
    workflowId: SURGE_ALERT_WORKFLOW,
    version: SURGE_ALERT_WORKFLOW_VERSION,
    name: "Partner zone surge alert",
    trigger: EVENT_TYPES.PARTNER_ZONE_SURGE_DETECTED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      {
        id: "eligible",
        type: "CONDITION",
        conditionId: "provider.morning_eligible",
      },
      {
        id: "alert",
        type: "NOTIFICATION",
        notificationType: "partner.surge_alert",
        recipient: "SUBJECT_PARTNER",
        /**
         * `zoneName` is a label and `demandEvidence` is the measured supply/active pair. There is
         * deliberately no surge multiplier variable: the template must not be able to render a
         * number a partner could read as a pay rate, and the surest way to guarantee that is for the
         * number never to reach it.
         */
        // Every partner template requires `partnerName` (templates/definitions.ts registers it on
        // all of them); it resolves from the provider subject.
        variables: ["partnerName", "zoneName", "demandEvidence", "observedAt"],
        /**
         * Re-checked before sending and after any quiet-hours deferral.
         *
         * Surge is perishable in a way an onboarding message is not — the source recomputes every
         * 120 s — so a deferred alert is far more likely than most to describe a zone that has since
         * calmed. Eligibility is what this step can re-ask through the existing engine; whether a
         * *stale surge reading* should still be sent is part of the hysteresis decision that
         * `surgeAlertPolicy` records as UNSET.
         */
        recheckConditionId: "provider.morning_eligible",
      },
      { id: "done", type: "STOP", reasonCode: "SURGE_ALERT_COMPLETE" },
    ],
    /**
     * Twelve hours — and the reason it is not two is worth recording.
     *
     * Two hours was the first value here, chosen because a surge reading describes a zone state the
     * source replaces every 120 seconds. The registry rejected it: a definition with a NOTIFICATION
     * step must be able to outlive the quiet window it may be deferred across (21:00-08:00, 660
     * minutes), or an instance created at 21:15 would be woken at 08:00 only to be discarded as too
     * old, and the alert would silently never arrive.
     *
     * So the engine's constraint wins, and it exposes a genuine tension this capability cannot
     * resolve on its own: an alert held overnight is describing pressure that ended hours ago.
     * Twelve hours satisfies the floor without pretending the extra time is useful. What *should*
     * happen to a surge alert deferred past its own signal's life — send it anyway, drop it, or
     * re-read the zone first — is a business decision, recorded as part of
     * SURGE_HYSTERESIS_POLICY_REQUIRED rather than answered here.
     *
     * Nothing turns on this today: with no producer and no threshold, no instance is ever created.
     */
    maxAgeMs: 12 * 3_600_000,
    maxSteps: 6,
    metadata: {
      domain: "partner_intelligence",
      owner: "partner_experience",
      phase: "item-07",
      policyStatus: "UNSET",
      signalIsNotPay: true,
    },
  });
}
