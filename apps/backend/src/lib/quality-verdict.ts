/**
 * Phase 10 §10 — the quality verdict. Pure module (no I/O, no clock, no client trust).
 *
 * A verdict is what the SERVER concludes about a job at the moment the partner asks to complete it,
 * from durable facts only: the booking's frozen quality policy, the job evidence the storage layer
 * holds (resolveQualityEvidence), the execution-step rows, and the safety gate (holds + open
 * incidents). The client's `checklistComplete` boolean is never an input — there is no parameter
 * for it. The partner's submitted checklist reaches this module only through `evidence`, where it
 * has already been matched item by item against the frozen checklist.
 *
 * Rules, most severe first (every applicable reason code is reported, the verdict is the worst):
 *
 *   1. An ACTIVE safety hold or an open safety incident            → ESCALATED
 *        codes: SAFETY_HOLD_ACTIVE, SAFETY_INCIDENT_OPEN
 *   2. Any execution step ESCALATED                                → ESCALATED
 *        code:  EXECUTION_STEP_ESCALATED
 *   3. Any execution step FAILED                                   → REWORK_REQUIRED
 *        code:  EXECUTION_STEP_FAILED
 *        (FAILED — "not reworkable" — needs a policy that says so; no such policy exists, so a failed
 *        step is always sent back for rework. FAILED is reachable only by an admin override.)
 *   4. Required proof missing (photo / before+after)               → REWORK_REQUIRED
 *        code:  QUALITY_PROOF_REQUIRED
 *      Frozen checklist item not submitted                         → REWORK_REQUIRED
 *        code:  QUALITY_CHECKLIST_REQUIRED
 *      Mandatory step not COMPLETED / execution gate blocked       → REWORK_REQUIRED
 *        code:  EXECUTION_STEP_INCOMPLETE
 *   5. Optional step SKIPPED_WITH_REASON (nothing above applies)   → PASS_WITH_EXCEPTION
 *        code:  EXECUTION_STEP_SKIPPED
 *   6. Otherwise                                                   → PASS
 *      With no quality policy AND no execution plan the verdict is PASS with code NO_QUALITY_POLICY:
 *      honest about the fact that nothing was checked, never an invented standard.
 *
 * Only PASS and PASS_WITH_EXCEPTION allow a booking to become COMPLETED.
 */
import type { QualityEvidence } from "./quality-evidence";
import type { QualitySnapshot } from "./service-runtime-policy";
import type { ExecutionGate, StepState } from "./service-execution";
import type { OpenIncident, SafetyGate } from "./service-safety";

export const QUALITY_VERDICTS = ["PASS", "PASS_WITH_EXCEPTION", "REWORK_REQUIRED", "FAILED", "ESCALATED"] as const;
export type QualityVerdict = (typeof QUALITY_VERDICTS)[number];

export const QUALITY_POLICY_VERSION = "quality.v1";
export const QUALITY_VERDICT_BLOCKED = "QUALITY_VERDICT_BLOCKED";

export const QUALITY_REASON_CODES = [
  "SAFETY_HOLD_ACTIVE",
  "SAFETY_INCIDENT_OPEN",
  "EXECUTION_STEP_ESCALATED",
  "EXECUTION_STEP_FAILED",
  "QUALITY_PROOF_REQUIRED",
  "QUALITY_CHECKLIST_REQUIRED",
  "EXECUTION_STEP_INCOMPLETE",
  "EXECUTION_STEP_SKIPPED",
  "NO_QUALITY_POLICY",
  "ADMIN_OVERRIDE",
] as const;
export type QualityReasonCode = (typeof QUALITY_REASON_CODES)[number];

/** Worst wins. FAILED ranks above ESCALATED: a final "not to standard" outranks "under review". */
const SEVERITY: Record<QualityVerdict, number> = { PASS: 0, PASS_WITH_EXCEPTION: 1, REWORK_REQUIRED: 2, ESCALATED: 3, FAILED: 4 };

export function worstVerdict(a: QualityVerdict, b: QualityVerdict): QualityVerdict {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

/** Only these allow COMPLETED. */
export function verdictAllowsCompletion(v: QualityVerdict): boolean {
  return v === "PASS" || v === "PASS_WITH_EXCEPTION";
}

export function isQualityVerdict(v: unknown): v is QualityVerdict {
  return typeof v === "string" && (QUALITY_VERDICTS as readonly string[]).includes(v);
}

export type VerdictStep = { code: string; mandatory: boolean; state: StepState };

export type DeriveVerdictInput = {
  /** The FROZEN quality policy from the booking snapshot (null = none configured). */
  qualityPolicy: QualitySnapshot | null;
  /** resolveQualityEvidence(...) over durable rows, plus the ids of the rows that carried media. */
  evidence: (QualityEvidence & { evidenceIds?: string[] }) | null;
  /** Every step of the booking's execution plan with its stored state (rows not yet materialised are PENDING). */
  executionSteps: VerdictStep[];
  executionGate: ExecutionGate | null;
  safetyGate: SafetyGate | null;
  openIncidents: OpenIncident[];
};

export type EvidenceRefs = {
  evidenceIds: string[];
  steps: Array<{ code: string; state: StepState; mandatory: boolean }>;
  holdIds: number[];
  incidentIds: string[];
  missingChecklistItems: string[];
};

export type DerivedVerdict = { verdict: QualityVerdict; reasonCodes: QualityReasonCode[]; evidenceRefs: EvidenceRefs };

export function deriveQualityVerdict(input: DeriveVerdictInput): DerivedVerdict {
  let verdict: QualityVerdict = "PASS";
  const codes: QualityReasonCode[] = [];
  const add = (v: QualityVerdict, c: QualityReasonCode) => {
    verdict = worstVerdict(verdict, v);
    if (!codes.includes(c)) codes.push(c);
  };

  const holdIds: number[] = [];
  const incidentIds = new Set<string>();
  for (const b of input.safetyGate?.blocking ?? []) {
    if (b.kind === "SAFETY_HOLD") {
      holdIds.push(b.holdId);
      add("ESCALATED", "SAFETY_HOLD_ACTIVE");
    } else {
      incidentIds.add(b.incidentId);
      add("ESCALATED", "SAFETY_INCIDENT_OPEN");
    }
  }
  for (const i of input.openIncidents) {
    incidentIds.add(i.id);
    add("ESCALATED", "SAFETY_INCIDENT_OPEN");
  }

  const steps = input.executionSteps;
  if (steps.some((s) => s.state === "ESCALATED")) add("ESCALATED", "EXECUTION_STEP_ESCALATED");
  if (steps.some((s) => s.state === "FAILED")) add("REWORK_REQUIRED", "EXECUTION_STEP_FAILED");
  if (steps.some((s) => s.mandatory && s.state !== "COMPLETED" && s.state !== "FAILED" && s.state !== "ESCALATED")) {
    add("REWORK_REQUIRED", "EXECUTION_STEP_INCOMPLETE");
  }
  for (const b of input.executionGate?.blocking ?? []) {
    if (b.reason === "STEP_ESCALATED") add("ESCALATED", "EXECUTION_STEP_ESCALATED");
    else if (b.reason === "STEP_FAILED") add("REWORK_REQUIRED", "EXECUTION_STEP_FAILED");
    else add("REWORK_REQUIRED", "EXECUTION_STEP_INCOMPLETE");
  }

  const q = input.qualityPolicy;
  const ev = input.evidence;
  if (q) {
    const photos = ev?.photos ?? 0;
    if (q.beforeAfterPhotos && !(ev?.hasBefore && ev?.hasAfter)) add("REWORK_REQUIRED", "QUALITY_PROOF_REQUIRED");
    if (q.proofRequired && photos < 1) add("REWORK_REQUIRED", "QUALITY_PROOF_REQUIRED");
    if (q.checklist.length > 0 && !(ev?.checklistComplete ?? false)) add("REWORK_REQUIRED", "QUALITY_CHECKLIST_REQUIRED");
  }

  if (verdict === "PASS" && steps.some((s) => !s.mandatory && s.state === "SKIPPED_WITH_REASON")) {
    add("PASS_WITH_EXCEPTION", "EXECUTION_STEP_SKIPPED");
  }
  if (verdict === "PASS" && !q && steps.length === 0) codes.push("NO_QUALITY_POLICY");

  return {
    verdict,
    reasonCodes: codes,
    evidenceRefs: {
      evidenceIds: [...(ev?.evidenceIds ?? [])],
      steps: steps.map((s) => ({ code: s.code, state: s.state, mandatory: s.mandatory })),
      holdIds,
      incidentIds: [...incidentIds],
      missingChecklistItems: q && q.checklist.length > 0 ? [...(ev?.missingChecklistItems ?? q.checklist)] : [],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Customer projection                                                 */
/* ------------------------------------------------------------------ */

const CUSTOMER_VERDICT_LABEL: Record<QualityVerdict, string> = {
  PASS: "Service completed to standard",
  PASS_WITH_EXCEPTION: "Service completed — an optional step was skipped with a reason",
  REWORK_REQUIRED: "Some of the work still needs to be finished",
  ESCALATED: "Our team is reviewing this job",
  FAILED: "This job did not meet our standard — our team will contact you",
};

/** Plain words only. Never step codes, evidence ids, partner notes or incident internals. */
const CUSTOMER_REASON_LABEL: Partial<Record<QualityReasonCode, string>> = {
  SAFETY_HOLD_ACTIVE: "Work is paused for safety",
  SAFETY_INCIDENT_OPEN: "Work is paused for safety",
  EXECUTION_STEP_ESCALATED: "A step has been sent to our team for review",
  EXECUTION_STEP_FAILED: "A step needs to be redone",
  QUALITY_PROOF_REQUIRED: "Completion photos are still pending",
  QUALITY_CHECKLIST_REQUIRED: "The service checklist is not finished yet",
  EXECUTION_STEP_INCOMPLETE: "Some required steps are not finished yet",
  EXECUTION_STEP_SKIPPED: "An optional step was skipped",
  ADMIN_OVERRIDE: "Reviewed by our team",
};

export function customerVerdictView(v: { verdict: QualityVerdict; reasonCodes: readonly string[]; createdAt: Date }) {
  const reasons = [...new Set(v.reasonCodes.map((c) => CUSTOMER_REASON_LABEL[c as QualityReasonCode]).filter((x): x is string => Boolean(x)))];
  return { verdict: v.verdict, label: CUSTOMER_VERDICT_LABEL[v.verdict], reasons, at: v.createdAt.toISOString() };
}

export class QualityVerdictError extends Error {
  readonly code = QUALITY_VERDICT_BLOCKED;
  constructor(readonly data: { verdict: QualityVerdict; reasonCodes: string[]; verdictId?: number | null }) {
    super(QUALITY_VERDICT_BLOCKED);
    this.name = "QualityVerdictError";
  }
}
