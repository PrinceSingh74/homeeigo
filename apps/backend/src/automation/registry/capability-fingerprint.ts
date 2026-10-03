import crypto from "crypto";
import type { WorkflowDefinitionInput, WorkflowStep } from "../types";

/**
 * What the engine could actually execute for a workflow, at the moment it was certified.
 *
 * ── Why a certification needs this ──────────────────────────────────────────
 *
 * A certification names an automation and a version, and until now that was the whole of its
 * scope. But a workflow's behaviour is decided by two things: what the definition declares, and
 * what the engine is willing to run. The partner acquisition incident made the gap concrete — nine
 * workflows carry ESCALATION steps that the engine answers with `NOT_IMPLEMENTED`, so 119
 * escalations went nowhere. Implement ESCALATION tomorrow and those same instances, on the same
 * version, under the same certification, would suddenly act. Nobody would have signed for that, and
 * nothing in the system would have noticed.
 *
 * A fingerprint closes it by recording the second half of the scope. If the engine's answer for any
 * step type this workflow uses changes, the fingerprint changes, the stored one no longer matches,
 * and the certification is stale rather than quietly broader than intended.
 *
 * ── What goes into it ───────────────────────────────────────────────────────
 *
 * Only the step types the workflow actually declares, paired with whether the engine executes them.
 * A workflow of WAITs and NOTIFICATIONs is unaffected by ESCALATION becoming implemented, and
 * invalidating its certification for an unrelated change would train people to re-certify without
 * reading. Scope the claim to what could actually change this workflow's behaviour.
 *
 * Deterministic by construction: sorted, no timestamps, no ids, no environment. The same definition
 * on the same engine yields the same fingerprint in every process, which is what makes a mismatch
 * mean something.
 */

/**
 * Step types the engine executes for real today.
 *
 * ACTION and ESCALATION are declared in the type system and terminate at `NOT_IMPLEMENTED` in the
 * step executor — see the ACTION/ESCALATION branch there. This table is the fact the fingerprint
 * records; moving an entry to `true` is exactly the change that must invalidate prior certifications.
 */
const ENGINE_EXECUTES: Record<string, boolean> = {
  WAIT: true,
  STOP: true,
  CONDITION: true,
  NOTIFICATION: true,
  ACTION: false,
  ESCALATION: false,
};

/** Whether the engine will really run this step type, rather than record it as unimplemented. */
export function engineExecutes(stepType: string): boolean {
  return ENGINE_EXECUTES[stepType] ?? false;
}

/**
 * The capability claim for one workflow definition.
 *
 * Returns the readable form as well as the hash, because a fingerprint nobody can read is a
 * fingerprint nobody will trust when it fails a deploy at 2am.
 */
export function capabilityClaim(steps: readonly WorkflowStep[]): string {
  const types = [...new Set(steps.map((s) => s.type))].sort();
  return types.map((t) => `${t}=${engineExecutes(t) ? "exec" : "noop"}`).join(";");
}

/** Stable hash of the capability claim. Same definition, same engine, same value — always. */
export function capabilityFingerprint(steps: readonly WorkflowStep[]): string {
  return crypto.createHash("sha256").update(capabilityClaim(steps)).digest("hex").slice(0, 32);
}

/** Convenience for callers holding a whole definition. */
export function fingerprintFor(def: Pick<WorkflowDefinitionInput, "steps">): string {
  return capabilityFingerprint(def.steps);
}
