import { EVENT_TYPES } from "../../../events/catalog/event-types";
import { registerWorkflow } from "../workflow-registry";

/**
 * Morning Intelligence (Partner Intelligence, Item 6) — the workflow.
 *
 * ── Registered and inert ───────────────────────────────────────────────────────
 *
 * This is a real definition in the real registry, and it will never start, because nothing publishes
 * `PARTNER_MORNING_INTELLIGENCE_DUE`. That is the intended shipped state: the schedule it would run
 * on is a business decision nobody has made (see `morning-schedule.config.ts`), and the honest way
 * to hold that open is a complete, reviewable workflow that has no clock rather than a clock pointed
 * at a guessed hour.
 *
 * ── Why SHADOW is not a formality here ─────────────────────────────────────────
 *
 * `executionMode: "SHADOW"` with `certificationStatus: "DRAFT"` is enforced by the registry itself:
 * declaring LIVE without a CERTIFIED status throws at registration. So there is no configuration of
 * this file that sends a partner a message today. Certification requires a resolvable ADMIN approver
 * and evidence from a real observation — and the real observation cannot happen until the schedule
 * exists, which is recorded as BLOCKED_BY_BUSINESS_SCHEDULE rather than worked around.
 *
 * ── Shape ──────────────────────────────────────────────────────────────────────
 *
 * CONDITION → NOTIFICATION → STOP, with no WAIT.
 *
 * A WAIT would be the natural place to hold the brief until "the morning", and its absence is the
 * point: the trigger event *is* the morning, so a delay inside the workflow would be a second,
 * competing schedule. If the brief should be held — for quiet hours, say — the notification step
 * already defers through governance, which is the mechanism that exists for it.
 *
 * The CONDITION re-asks dispatch eligibility at execution time rather than trusting whoever emitted
 * the trigger. A partner suspended between the clock firing and the step running must not be
 * briefed, and the only way to guarantee that is to check at the point of acting.
 */

export const MORNING_INTELLIGENCE_WORKFLOW = "morning_intelligence";
export const MORNING_INTELLIGENCE_WORKFLOW_VERSION = 1;

export function registerMorningIntelligenceWorkflow(): void {
  registerWorkflow({
    workflowId: MORNING_INTELLIGENCE_WORKFLOW,
    version: MORNING_INTELLIGENCE_WORKFLOW_VERSION,
    name: "Partner morning intelligence",
    trigger: EVENT_TYPES.PARTNER_MORNING_INTELLIGENCE_DUE,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    /**
     * LOW because the workflow's only effect is one informational message.
     *
     * It moves no money and changes no account state, so it contains none of the HIGH_RISK action
     * substrings the registry refuses for LOW and MEDIUM definitions. Declaring a class at all is
     * what opts this into the 6G certification gate; it is not permission to act.
     */
    riskClass: "LOW",
    steps: [
      {
        id: "eligible",
        type: "CONDITION",
        conditionId: "provider.morning_eligible",
      },
      {
        id: "brief",
        type: "NOTIFICATION",
        notificationType: "partner.morning_intelligence",
        recipient: "SUBJECT_PARTNER",
        variables: ["partnerName", "topZoneName", "windowLabel", "nudgeCount"],
        /**
         * Eligibility is asked again immediately before sending, and again after any quiet-hours
         * deferral.
         *
         * A brief deferred from a partner's quiet window may not go out hours later to someone who
         * has since been paused or restricted. This is the same question as the CONDITION step, and
         * it is asked twice on purpose: the first ask decides whether to do the work, the second
         * decides whether the world has changed since.
         */
        recheckConditionId: "provider.morning_eligible",
      },
      { id: "done", type: "STOP", reasonCode: "MORNING_BRIEF_COMPLETE" },
    ],
    /**
     * A brief is worthless once its day is over.
     *
     * 18 hours is shorter than the 24-48h used by onboarding workflows, and deliberately so: an
     * instance that somehow survived past the partner's evening would be describing a day that has
     * already happened. Expiring is the correct outcome, not a failure to recover from.
     */
    maxAgeMs: 18 * 3_600_000,
    maxSteps: 6,
    metadata: {
      domain: "partner_intelligence",
      owner: "partner_experience",
      phase: "item-06",
      scheduleStatus: "UNSET",
    },
  });
}
