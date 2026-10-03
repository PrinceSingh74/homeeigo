import { registerWorkflow, syncWorkflowDefinitions } from "../workflow-registry";
import { registerAllConditions } from "../../conditions/condition-registry";
import { bootstrapTemplates } from "../../../notifications/templates/definitions";
import { markBootDegraded } from "../../../lib/boot-health";
import { registerPartnerAcquisitionWorkflows } from "./partner-acquisition-workflows";
import { registerMorningIntelligenceWorkflow } from "./morning-intelligence-workflow";
import { registerSurgeAlertWorkflow } from "./surge-alert-workflow";
import { registerSection09Workflows } from "./section-09-workflows";
import { registerDispatchStallWorkflow } from "./dispatch-stall-workflow";
import { EVENT_TYPES } from "../../../events/catalog/event-types";

/**
 * Every workflow definition, registered at boot.
 *
 * 6A ships one workflow and it deliberately has no side effects. Its job is to prove the engine —
 * that an instance starts once per trigger, waits durably through the existing scheduler, advances
 * under a claim only one worker can win, and terminates. Workflows that actually contact people
 * arrive in 6G, once conditions (6B), notification routing (6E'), cadence (6C) and shadow mode
 * (6D) exist to make that safe.
 *
 * Nothing is activated here. Activation is a deliberate act — see `activateWorkflow` — because an
 * ACTIVE version is immutable from that moment on.
 */

/** Engine self-test: start → wait 1 minute → stop. Touches nothing outside the workflow tables. */
export const ENGINE_SELFTEST_WORKFLOW = "engine_selftest";

/** Phase 6G-C. Registered in SHADOW; only a certification record can change that. */
export const PAYMENT_RECOVERY_WORKFLOW = "payment_recovery";

/** Phase 6G-D. The legacy review-request job, expressed as a workflow. Registered in SHADOW. */
export const REVIEW_REQUEST_WORKFLOW = "review_request";

export const CHECKOUT_RECOVERY_WORKFLOW = "checkout_recovery";

/** Phase 7, Step 7A. Post-service check-in, independent of the review request. Registered in SHADOW. */
export const FOLLOW_UP_WORKFLOW = "follow_up";

export function registerAllWorkflows(): void {
  registerWorkflow({
    workflowId: ENGINE_SELFTEST_WORKFLOW,
    version: 1,
    name: "Automation engine self-test",
    trigger: "manual",
    /**
     * Stated rather than inherited.
     *
     * `startWorkflowInstance` reads `definition.executionMode ?? "LIVE"`, so a definition that omits
     * the field is treated as acting. This one has no notification and no action step, so the
     * distinction changes nothing it does — but it was the only workflow whose execution mode came
     * from a default, and "no workflow is accidentally LIVE" should be something the definitions
     * say, not something a reader has to reconstruct from a fallback three files away.
     */
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    steps: [
      { id: "wait", type: "WAIT", delayMs: 60_000 },
      { id: "done", type: "STOP", reasonCode: "SELFTEST_OK" },
    ],
    maxAgeMs: 3_600_000,
    maxSteps: 8,
    metadata: {
      owner: "platform",
      purpose: "6A structural verification — no external side effects",
    },
  });

  /**
   * Payment recovery — the first business automation, and it runs as a rehearsal.
   *
   * A failed payment starts a conversation, not a transaction. The workflow waits, re-reads the
   * *current* payment state, and only then considers a nudge; it never retries the payment, never
   * calls the gateway and never touches money. The most valuable thing it does is stop: at every
   * checkpoint the condition is asked again, so a customer whose payment went through five minutes
   * later is never chased for it.
   *
   * ── Why the subject is the booking ─────────────────────────────────────────
   *
   * The customer bought a service. Every recipient resolution in the platform works from a booking,
   * and `bookingPayment.*` reads that booking's own payment through a unique key, so the workflow
   * can ask about money without ever being handed a payment id it could point somewhere else.
   *
   * ── Why SHADOW ─────────────────────────────────────────────────────────────
   *
   * Because nobody has watched it run yet. It will produce evidence of what it *would* have sent,
   * and only a certification record — which code cannot write for itself — can change that.
   *
   * ── Timing ─────────────────────────────────────────────────────────────────
   *
   * 10m + 2h + 24h is 26h10m of intended waiting, and each of the two nudges can be deferred by
   * quiet hours for up to 11h. That is 48h10m in the worst case — ten minutes past a 48h budget,
   * which would have expired the instance on exactly the nights the deferral existed to handle.
   * 72h leaves real headroom. Nine steps against a budget of 12.
   */
  /**
   * ── Two versions, one behaviour ─────────────────────────────────────────────
   *
   * v2 exists for a governance reason, not a behavioural one. v1's certification predates the
   * hardened contract — it names an approver in free text, with no resolvable admin and no
   * capability fingerprint — and it cannot be replaced in place: certifications are unique per
   * (automationId, workflowVersion), and voiding the stale row does not free the slot because
   * preserving it is the entire point of voiding rather than deleting.
   *
   * The architecture's own answer to that is the one taken here: re-certifying means publishing a
   * new version. v2 carries a real human certification through the hardened path while v1's
   * historical record stays exactly where it is, readable and untouched.
   *
   * Registered from one loop rather than a copied block, so "v2 does the same thing as v1" is a
   * structural fact rather than a claim that has to be re-checked whenever the steps change.
   */
  for (const version of [1, 2] as const) registerWorkflow({
    workflowId: PAYMENT_RECOVERY_WORKFLOW,
    version,
    name: "Payment recovery",
    trigger: "homigo.payment.failed",
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "hold_10m", type: "WAIT", delayMs: 10 * 60_000 },
      { id: "check_1", type: "CONDITION", conditionId: "booking.payment_still_recoverable" },
      {
        id: "nudge_1", type: "NOTIFICATION",
        notificationType: "payment.recovery_nudge",
        recipient: "SUBJECT_CUSTOMER",
        variables: ["bookingNumber"],
        // Asked again immediately before sending: the two hours since the last check are exactly
        // when a payment is most likely to have completed by some other route.
        recheckConditionId: "booking.payment_still_recoverable",
      },
      { id: "wait_2h", type: "WAIT", delayMs: 2 * 3_600_000 },
      { id: "check_2", type: "CONDITION", conditionId: "booking.payment_still_recoverable" },
      {
        id: "nudge_2", type: "NOTIFICATION",
        notificationType: "payment.recovery_nudge",
        recipient: "SUBJECT_CUSTOMER",
        variables: ["bookingNumber"],
        recheckConditionId: "booking.payment_still_recoverable",
      },
      { id: "wait_24h", type: "WAIT", delayMs: 24 * 3_600_000 },
      { id: "check_3", type: "CONDITION", conditionId: "booking.payment_still_recoverable" },
      /**
       * Reached only when the money never arrived. Recovery stops being useful long before it stops
       * being possible, and an automation that keeps trying is one nobody can reason about.
       */
      { id: "expire", type: "STOP", reasonCode: "RECOVERY_WINDOW_EXPIRED" },
    ],
    maxAgeMs: 72 * 3_600_000,
    maxSteps: 12,
    metadata: { domain: "payments", owner: "payments", phase: "6G-C" },
  });

  /**
   * Abandoned checkout recovery.
   *
   * ── Why 30 minutes ──────────────────────────────────────────────────────────
   *
   * Long enough that a customer who simply took a phone call, checked their balance, or switched
   * to a card is not interrupted mid-payment; short enough that the intent is still fresh. It is
   * also long enough for a late webhook or a reconciliation to land, which matters because the
   * condition below asks about money, and money sometimes arrives by a slower route than the
   * gateway's response.
   *
   * ── Why the condition is re-asked at send time ──────────────────────────────
   *
   * `check_abandoned` runs on wake, and `recheckConditionId` runs again immediately before the
   * message would go out. Thirty minutes is exactly the window in which a checkout most often
   * completes, so the state at trigger time is the least trustworthy thing available. Nothing from
   * the event payload is used to decide — the workflow re-reads authoritative booking and payment
   * state both times.
   *
   * ── Timing ──────────────────────────────────────────────────────────────────
   *
   * 30m of intended waiting, plus up to 11h if quiet hours defer the send. A 24h budget leaves
   * headroom; four steps against a budget of 8.
   */
  registerWorkflow({
    workflowId: CHECKOUT_RECOVERY_WORKFLOW,
    version: 1,
    name: "Abandoned checkout recovery",
    trigger: EVENT_TYPES.CHECKOUT_STARTED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "wait_30m", type: "WAIT", delayMs: 30 * 60_000 },
      { id: "check_abandoned", type: "CONDITION", conditionId: "booking.checkout_abandoned" },
      {
        id: "nudge",
        type: "NOTIFICATION",
        notificationType: "checkout.recovery_nudge",
        recipient: "SUBJECT_CUSTOMER",
        variables: ["bookingNumber"],
        recheckConditionId: "booking.checkout_abandoned",
      },
      { id: "done", type: "STOP", reasonCode: "CHECKOUT_RECOVERY_COMPLETE" },
    ],
    maxAgeMs: 24 * 3_600_000,
    maxSteps: 8,
    metadata: { domain: "payments", owner: "growth", phase: "7-step-3" },
  });

  /**
   * The review request, moved off the legacy job and onto the engine.
   *
   * ── What this replaces ──────────────────────────────────────────────────────
   *
   * `automation-scheduler.v1` enqueued a `automation.review_request` job two hours after a booking
   * completed, and the handler re-checked the booking and the rating before calling
   * `notificationService.sendNotification` directly. That last part is the reason this migration
   * exists: calling the service directly walks straight past the notification router, so the review
   * request has never been subject to the recipient's daily cap, a workflow cooldown, quiet hours or
   * the recipient's own preferences. It could arrive at 03:00, and it could be the sixth message of
   * someone's day.
   *
   * ── What is deliberately unchanged ──────────────────────────────────────────
   *
   * Two hours, one message, no reminder, and the same two questions asked at send time rather than
   * at trigger time: is the booking still completed, and is it still unrated. The legacy contract is
   * migrated, not improved — the only intended behavioural change is that governance now applies.
   *
   * ── Timing ──────────────────────────────────────────────────────────────────
   *
   * Two hours, plus up to 11 hours if quiet hours defer the send. 24h of budget leaves headroom
   * without letting a stalled instance linger for days. Four steps against a budget of 6.
   */
  registerWorkflow({
    workflowId: REVIEW_REQUEST_WORKFLOW,
    version: 1,
    name: "Review request",
    trigger: "homigo.booking.completed",
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "wait_2h", type: "WAIT", delayMs: 2 * 3_600_000 },
      { id: "check_unrated", type: "CONDITION", conditionId: "booking.completed_and_unrated" },
      {
        id: "ask", type: "NOTIFICATION",
        notificationType: "booking.review_request",
        recipient: "SUBJECT_CUSTOMER",
        variables: ["bookingNumber"],
        /**
         * Asked again immediately before sending, exactly as the legacy handler did. A deferral
         * through quiet hours can put hours between the check and the send, and a customer who
         * rated the job in that gap must not then be asked to rate it.
         */
        recheckConditionId: "booking.completed_and_unrated",
      },
      /**
       * One message, then stop. The legacy flow sent exactly once and never followed up; adding a
       * reminder here would be a policy change wearing a migration's clothes.
       */
      { id: "done", type: "STOP", reasonCode: "REVIEW_REQUEST_SENT" },
    ],
    maxAgeMs: 24 * 3_600_000,
    maxSteps: 6,
    metadata: { domain: "bookings", owner: "growth", phase: "6G-D", replaces: "automation.review_request" },
  });

  /**
   * Post-service follow-up (Phase 7, Step 7A).
   *
   * ── Why 24 hours, and why separate from the review request ──────────────────
   *
   * `review_request` already asks at 2 hours, for a rating. This is a different question — a
   * general check-in — asked later so it does not arrive back-to-back with the review request and
   * read as the same message twice. It fires regardless of whether the booking was rated, which is
   * exactly why it uses `booking.still_completed` rather than `booking.completed_and_unrated`.
   *
   * ── Timing ────────────────────────────────────────────────────────────────
   *
   * 24h of intended waiting, plus up to a quiet-hours window if the send is deferred. 72h of budget
   * mirrors `payment_recovery`'s margin for a single-wait chain far shorter than that automation's.
   */
  registerWorkflow({
    workflowId: FOLLOW_UP_WORKFLOW,
    version: 1,
    name: "Post-service follow-up",
    trigger: EVENT_TYPES.BOOKING_COMPLETED,
    executionMode: "SHADOW",
    certificationStatus: "DRAFT",
    riskClass: "LOW",
    steps: [
      { id: "wait_24h", type: "WAIT", delayMs: 24 * 3_600_000 },
      { id: "check", type: "CONDITION", conditionId: "booking.still_completed" },
      {
        id: "checkin",
        type: "NOTIFICATION",
        notificationType: "booking.follow_up_checkin",
        recipient: "SUBJECT_CUSTOMER",
        variables: ["bookingNumber"],
        recheckConditionId: "booking.still_completed",
      },
      { id: "done", type: "STOP", reasonCode: "FOLLOW_UP_SENT" },
    ],
    maxAgeMs: 72 * 3_600_000,
    maxSteps: 6,
    metadata: { domain: "bookings", owner: "growth", phase: "7-step-7a" },
  });

  registerPartnerAcquisitionWorkflows();
  /**
   * Item 6. Registered alongside the others and started by nothing: its trigger event is never
   * published while the morning schedule is UNSET. Registering it here rather than behind a
   * condition keeps the registry the single honest list of what this platform can run.
   */
  registerMorningIntelligenceWorkflow();
  /** Item 7. Inert twice over: no producer for its trigger, and no threshold to decide with. */
  registerSurgeAlertWorkflow();
  registerSection09Workflows();
  registerDispatchStallWorkflow();
}

export async function bootstrapWorkflows(): Promise<void> {
  // Conditions first: a workflow step naming a condition that is not registered yet would fail
  // its instance, and registration order is the one thing that decides which happens.
  registerAllConditions();
  /**
   * Templates before workflows: a NOTIFICATION step whose template is not yet registered would
   * route to NO_TEMPLATE and skip silently.
   *
   * ── Why the failure is contained here ────────────────────────────────────────
   *
   * `registerTemplate` throws on a malformed template, and it must: a body naming an undeclared
   * variable would otherwise fail at send time, per recipient, forever. That validation is not
   * weakened here.
   *
   * What is changed is the blast radius. This call used to sit in the middle of the bootstrap, so
   * a single bad template threw past `registerAllWorkflows()`, past `syncWorkflowDefinitions()`,
   * out of `bootstrapWorkflows()`, and into the catch in `maintenance.ts` — which returns before
   * `startOutboxProcessor()` and `startScheduledJobProcessor()`. One typo in one notification body
   * therefore stopped every domain event and every scheduled job in the platform. It happened, and
   * it lasted three days (see the `extraVars` comment in `templates/definitions.ts`).
   *
   * Nothing in the workflow registry reads the template registry — the ordering above is about
   * send-time correctness, not a dependency — so a template failure has no business preventing
   * workflow registration or event delivery. It is recorded as its own degradation (which flips
   * `/ready` to 503) and the rest of the bootstrap continues. The cost of continuing is bounded and
   * visible: workflow NOTIFICATION steps route to NO_TEMPLATE while the fault stands. The cost of
   * not continuing is the outbox and every scheduled job going dark.
   */
  try {
    await bootstrapTemplates();
  } catch (err) {
    markBootDegraded(
      "notification_templates",
      err,
      "notification templates failed to register: workflow NOTIFICATION steps will route to NO_TEMPLATE; event delivery and scheduled jobs are unaffected",
    );
  }
  registerAllWorkflows();
  await syncWorkflowDefinitions();
  /**
   * ── Boot no longer certifies or activates anything ──────────────────────────
   *
   * `bootstrapPartnerAcquisitionLive()` used to run immediately above this, and
   * `finalizePartnerAcquisitionLive()` immediately below. Together they wrote nine
   * `AutomationCertification` rows with `certifiedBy` defaulting to `system:partner-acquisition`,
   * let `syncWorkflowDefinitions` read the rows the same boot had just written, and then activated
   * all nine for LIVE — on every backend start, with no human anywhere in the chain.
   *
   * The gate was never broken; it was satisfied from the inside. Its premise is that a definition
   * can declare itself CERTIFIED but cannot write its own certification into the table, and that
   * held only while nothing in the boot path wrote that table.
   *
   * Registration stays. Registration is a statement about what code exists; certification is a
   * statement about what a person accepted responsibility for; activation is a decision to let it
   * act. Boot may do the first and must not do the other two — `activateWorkflow` is called from a
   * deliberate, one-off arming step outside any startup path, which is how payment_recovery and
   * review_request were armed.
   *
   * Both functions have since been removed outright (the file that once carried their account,
   * `partner-acquisition-certification.ts`, was itself unreferenced and has been deleted). There is
   * no safe version of "certify these nine at boot", so leaving a shape for someone to fill back in
   * would be leaving the trap.
   */
}
