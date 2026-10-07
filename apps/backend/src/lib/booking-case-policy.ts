/**
 * Phase 10 §11 — complaint / warranty-claim case policy. Pure module (no I/O).
 *
 * The case lifecycle, which decisions each state admits, which action the frozen warranty lets a
 * case lead to, and what each audience may see. The service (booking-case.service.ts) does the I/O;
 * the database refuses edits to closed cases and to the event / evidence history.
 */
import type { WarrantyEligibility } from "./service-warranty";
import { isServerStoredEvidence } from "./job-evidence-media";

export const CASE_STATES = ["CASE_CREATED", "TRIAGE", "ELIGIBILITY", "INVESTIGATION", "ACTION", "RESOLVED", "REJECTED", "ESCALATED"] as const;
export type CaseState = (typeof CASE_STATES)[number];
export const CASE_TYPES = ["COMPLAINT", "WARRANTY_CLAIM", "REWORK"] as const;
export type CaseType = (typeof CASE_TYPES)[number];
export const TERMINAL_CASE_STATES: readonly CaseState[] = ["RESOLVED", "REJECTED"];

/**
 * Admin transitions between OPEN states. RESOLVED / REJECTED are reached only through `resolve`,
 * which records the decision (action, money, follow-up) — never by a bare state change.
 */
export const CASE_TRANSITIONS: Readonly<Record<CaseState, readonly CaseState[]>> = {
  CASE_CREATED: ["TRIAGE", "ESCALATED"],
  TRIAGE: ["ELIGIBILITY", "INVESTIGATION", "ESCALATED"],
  ELIGIBILITY: ["INVESTIGATION", "ACTION", "ESCALATED"],
  INVESTIGATION: ["ELIGIBILITY", "ACTION", "ESCALATED"],
  ACTION: ["INVESTIGATION", "ESCALATED"],
  ESCALATED: ["TRIAGE", "ELIGIBILITY", "INVESTIGATION", "ACTION"],
  RESOLVED: [],
  REJECTED: [],
};

/** A case must have been triaged before anyone decides it. */
export const RESOLVABLE_FROM: readonly CaseState[] = ["TRIAGE", "ELIGIBILITY", "INVESTIGATION", "ACTION", "ESCALATED"];

export function isTerminalCaseState(s: string): boolean {
  return (TERMINAL_CASE_STATES as readonly string[]).includes(s);
}

export function canTransition(from: string, to: string): boolean {
  const next = CASE_TRANSITIONS[from as CaseState];
  return Array.isArray(next) && (next as readonly string[]).includes(to);
}

/**
 * Platform default, OPERATIONAL (not a legal or contractual promise): a new case is triaged within
 * 24 hours. `sla_due_at` = created_at + this; a case still CASE_CREATED after it is "SLA breached"
 * in the admin queue. Change it here if operations sets a different target.
 */
export const CASE_TRIAGE_SLA_HOURS = 24;

export const RESOLVE_ACTIONS = ["REWORK", "REFUND", "INSPECTION", "REJECT", "NONE"] as const;
export type ResolveAction = (typeof RESOLVE_ACTIONS)[number];

/** The warranty decides the case type: a claim only when the frozen warranty covers this issue now. */
export function caseTypeFor(e: Pick<WarrantyEligibility, "warrantyCovers">): CaseType {
  return e.warrantyCovers ? "WARRANTY_CLAIM" : "COMPLAINT";
}

/**
 * What a case may lead to. The warranty's `allowedActions` plus NONE (close with no remedy — moves
 * no money and creates nothing). Anything else needs an explicit, recorded admin override.
 */
export function actionAllowed(e: Pick<WarrantyEligibility, "allowedActions">, action: ResolveAction): boolean {
  if (action === "NONE") return true;
  return (e.allowedActions as readonly string[]).includes(action);
}

export function terminalStateFor(action: ResolveAction): CaseState {
  return action === "REJECT" ? "REJECTED" : "RESOLVED";
}

/** REWORK repairs a quality fault; INSPECTION sends someone to look (a warranty / inspection visit). */
export function followUpKindFor(action: ResolveAction): "REWORK" | "REVISIT" | null {
  if (action === "REWORK") return "REWORK";
  if (action === "INSPECTION") return "REVISIT";
  return null;
}

/**
 * What a partner is told about a follow-up visit, from the booking's own frozen snapshot (written by
 * the case service as `followUp`). Without it a rework job reached the partner app as an ordinary ₹0
 * job with no hint that it repairs an earlier visit. Ids stay server-side; numbers only.
 */
export function partnerFollowUpFromSnapshot(snapshot: unknown):
  | { kind: "REWORK" | "REVISIT"; parentBookingNumber: string | null; caseNumber: string | null }
  | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const f = (snapshot as Record<string, unknown>).followUp;
  if (!f || typeof f !== "object" || Array.isArray(f)) return null;
  const r = f as Record<string, unknown>;
  if (r.kind !== "REWORK" && r.kind !== "REVISIT") return null;
  return {
    kind: r.kind,
    parentBookingNumber: typeof r.parentBookingNumber === "string" ? r.parentBookingNumber : null,
    caseNumber: typeof r.caseNumber === "string" ? r.caseNumber : null,
  };
}

export type ReworkPolicy = { fee?: "WAIVED" | "QUOTED"; sameProviderPreferred?: boolean; windowDays?: number };

export function reworkPolicyFrom(value: unknown): ReworkPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const out: ReworkPolicy = {};
  if (r.fee === "WAIVED" || r.fee === "QUOTED") out.fee = r.fee;
  if (typeof r.sameProviderPreferred === "boolean") out.sameProviderPreferred = r.sameProviderPreferred;
  if (typeof r.windowDays === "number" && Number.isFinite(r.windowDays) && r.windowDays >= 0) out.windowDays = r.windowDays;
  return out;
}

/**
 * The fee a follow-up visit is created with. Only WAIVED is decided here (total 0). QUOTED needs a
 * price nobody has set for a follow-up, and an absent policy is no policy: both refuse rather than
 * invent a price.
 */
export function followUpFeeDecision(policy: ReworkPolicy | null):
  | { ok: true; fee: "WAIVED"; sameProviderPreferred: boolean; windowDays: number | null }
  | { ok: false; error: "REWORK_FEE_NOT_CONFIGURED" | "OWNER_APPROVAL_REQUIRED" } {
  if (!policy?.fee) return { ok: false, error: "REWORK_FEE_NOT_CONFIGURED" };
  if (policy.fee === "QUOTED") return { ok: false, error: "OWNER_APPROVAL_REQUIRED" };
  return { ok: true, fee: "WAIVED", sameProviderPreferred: policy.sameProviderPreferred === true, windowDays: policy.windowDays && policy.windowDays > 0 ? policy.windowDays : null };
}

/** The rework window (if the policy sets one) is measured from completion to when the issue was reported. */
export function reworkWindowOpen(windowDays: number | null, completedAt: Date | null, reportedAt: Date): boolean {
  if (windowDays == null) return true;
  if (!completedAt) return false;
  return reportedAt.getTime() <= completedAt.getTime() + windowDays * 86_400_000;
}

export type EvidenceInput =
  | { kind: "JOB_EVIDENCE"; jobEvidenceId: string }
  | { kind: "CUSTOMER_MEDIA"; mediaStorageKey?: string | null; mediaUrl?: string | null }
  | { kind: "NOTE"; note: string };

/** Shape checks only; ownership of a JOB_EVIDENCE id is checked against the booking by the service. */
export function evidenceShapeError(e: EvidenceInput): string | null {
  if (e.kind === "JOB_EVIDENCE") return e.jobEvidenceId?.trim() ? null : "EVIDENCE_INVALID";
  if (e.kind === "CUSTOMER_MEDIA") {
    const key = e.mediaStorageKey?.trim();
    const url = e.mediaUrl?.trim();
    if (!key && !url) return "EVIDENCE_INVALID";
    if (url && !/^https:\/\/[^\s]+$/i.test(url)) return "EVIDENCE_INVALID";
    return null;
  }
  if (e.kind === "NOTE") return e.note?.trim() ? null : "EVIDENCE_INVALID";
  return "EVIDENCE_INVALID";
}

/**
 * The KINDS that can be proof: job evidence or the customer's own media. A note never is.
 * The kind alone decides nothing — see `caseProofCandidate` for whether a given row counts.
 */
export function isProof(kind: string): boolean {
  return kind === "JOB_EVIDENCE" || kind === "CUSTOMER_MEDIA";
}

const CASE_MEDIA_KEY = /^([A-Za-z0-9_-]+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/** Is this the key the case service writes for a photo uploaded to THIS case (`<caseId>/<uuid>.<ext>`)? */
export function isCaseMediaKey(caseId: string, key: string | null | undefined): boolean {
  const m = typeof key === "string" ? CASE_MEDIA_KEY.exec(key) : null;
  return Boolean(m && m[1] === caseId);
}

/**
 * Could this evidence row be proof? (Adversarial audit, 2026-10-07: any JOB_EVIDENCE or CUSTOMER_MEDIA
 * row counted, so a geotag-only job row or a pasted https link satisfied "proof required".)
 *
 * Proof is a photo the server stored:
 *   - JOB_EVIDENCE: the referenced row belongs to this booking and holds a server-written photo
 *     (the same rule the completion gate uses);
 *   - CUSTOMER_MEDIA: the key is the one this case's photo upload writes. A URL is the customer's
 *     claim — it is kept and shown, and never counted. So is a key that arrived from a client.
 *
 * "Candidate" because a client can type a key of the right shape: the service also confirms the
 * object exists before it counts a CUSTOMER_MEDIA row.
 */
export function caseProofCandidate(e: {
  kind: string;
  caseId: string;
  bookingId: string;
  mediaStorageKey?: string | null;
  mediaUrl?: string | null;
  jobEvidence?: { bookingId: string; providerId: string; stage: string; mediaStorageKey: string | null } | null;
}): boolean {
  if (e.kind === "JOB_EVIDENCE") {
    const j = e.jobEvidence;
    if (!j || j.bookingId !== e.bookingId) return false;
    return isServerStoredEvidence({ mediaStorageKey: j.mediaStorageKey, bookingId: e.bookingId, providerId: j.providerId, stage: String(j.stage).toUpperCase() });
  }
  if (e.kind === "CUSTOMER_MEDIA") return isCaseMediaKey(e.caseId, e.mediaStorageKey);
  return false;
}

export type Audience = "CUSTOMER" | "PARTNER" | "ADMIN";

/** Whose evidence each audience sees. Admin notes and system entries are internal. */
export function evidenceVisibleTo(audience: Audience, actorType: string): boolean {
  if (audience === "ADMIN") return true;
  if (audience === "CUSTOMER") return actorType === "CUSTOMER";
  return actorType === "CUSTOMER" || actorType === "PARTNER";
}
