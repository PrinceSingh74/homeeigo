import { listWorkflows } from "./workflow-registry";

/**
 * Whether a legacy imperative path has been superseded by a workflow that is actually acting.
 *
 * ── The problem this closes ─────────────────────────────────────────────────
 *
 * Several automations exist twice: once as the original imperative code that shipped first, and
 * once as the workflow that replaces it. Today only one of the two sends anything, because every
 * replacement workflow is registered SHADOW — so the duplicate is latent rather than live.
 *
 * `review_request` is the clearest case. `automation-scheduler.v1` enqueues a job two hours after a
 * booking completes and the handler calls `notificationService.sendNotification` directly, walking
 * past the router entirely. The replacing workflow does the same thing through governance. The
 * moment that workflow is certified LIVE, every completed booking produces two review requests —
 * one governed, one not — and nothing in the code prevents it. The registry comment acknowledged
 * that retiring the legacy path is "a separate, deliberate act", but nothing made that act
 * *required*, so the safety of the migration rested on someone remembering.
 *
 * ── How it is closed ────────────────────────────────────────────────────────
 *
 * A replacement workflow declares what it supersedes in `metadata.replaces`. The legacy path asks
 * this function before doing its work and stands down once its replacement is LIVE. Certifying a
 * workflow therefore retires its predecessor in the same step, and the two can never both be
 * sending.
 *
 * Deliberately reads the in-memory registry rather than the database: `startWorkflowInstance` pins
 * execution mode from exactly this definition, so guard and engine are answering from one source.
 * A workflow that is registered but has been refused by the LIVE gate never reaches LIVE here
 * either, because the gate reads the same field.
 */
export function isSupersededByLiveWorkflow(legacyPathId: string): boolean {
  return listWorkflows().some(
    (definition) =>
      definition.executionMode === "LIVE" &&
      (definition.metadata as { replaces?: unknown } | undefined)?.replaces === legacyPathId,
  );
}
