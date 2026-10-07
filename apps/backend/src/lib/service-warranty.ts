/**
 * Phase 10 §11 — warranty as a versioned policy frozen per booking. Pure module (no I/O).
 *
 * The service's `warranty` block (or, for services configured before the block existed, the legacy
 * `quality.warrantyDays`) is frozen into the booking snapshot as `warranty.v1` at booking time and
 * copied into `booking_warranties` at completion. Every later decision — is this complaint inside the
 * window, does the policy cover this kind of issue, does it want proof, does it offer rework first —
 * reads the frozen row, never the catalogue, so a policy edit can never change what a customer was
 * promised on a booking already made.
 *
 * Nothing here invents a guarantee: an unconfigured service has `enabled: false` and no window.
 */

// A cycle with service-domain (it imports this module too). Safe: neither side calls the other while loading.
import { declaredNotApplicable } from "./service-domain";

export const CASE_CATEGORIES = ["QUALITY", "INCOMPLETE", "DAMAGE", "BEHAVIOUR", "NO_SHOW", "BILLING", "OTHER"] as const;
export type CaseCategory = (typeof CASE_CATEGORIES)[number];

export const WARRANTY_START_EVENTS = ["COMPLETION", "CONFIRMATION"] as const;
export type WarrantyStartEvent = (typeof WARRANTY_START_EVENTS)[number];

export type WarrantySnapshot = {
  schema: "warranty.v1";
  enabled: boolean;
  durationDays: number;
  startEvent: WarrantyStartEvent;
  eligibleIssueTypes: CaseCategory[];
  exclusions: string[];
  proofRequired: boolean;
  /** The published promise: a free rework is offered before any refund is considered. */
  reworkFirst: boolean;
  refundAllowed: boolean;
  /** Days after completion during which a complaint (warranty or not) may be raised. 0 = no window. */
  complaintWindowDays: number;
  /** Customer-facing texts, shown verbatim. Absent on bookings frozen before they existed. */
  damagePolicy?: string | null;
  guarantee?: string | null;
};

type WarrantyCfg = {
  warranty?: {
    damagePolicy?: string;
    guarantee?: string;
    enabled?: boolean;
    durationDays?: number;
    startEvent?: WarrantyStartEvent;
    eligibleIssueTypes?: CaseCategory[];
    exclusions?: string[];
    proofRequired?: boolean;
    reworkFirst?: boolean;
    refundAllowed?: boolean;
  };
  quality?: { warrantyDays?: number; complaintWindowDays?: number; notApplicable?: boolean };
  /** Read only through `declaredNotApplicable`: the switch above counts only with its reason. */
  notApplicableReasons?: { quality?: string };
} | null;

/** Default issue types a legacy `warrantyDays` covers: workmanship and incompleteness, nothing else. */
const LEGACY_ELIGIBLE: CaseCategory[] = ["QUALITY", "INCOMPLETE"];

/**
 * What the booking freezes. The typed `warranty` block wins; a legacy `quality.warrantyDays > 0`
 * alone yields an enabled warranty with the narrow legacy coverage above. `complaintWindowDays` is
 * independent of the warranty: a customer may report an issue inside that window even on a service
 * with no warranty at all.
 */
export function buildWarrantySnapshot(cfg: WarrantyCfg): WarrantySnapshot {
  const w = cfg?.warranty;
  // The publish gate's question, not the bare flag: a switch with no reason takes no cover away.
  const qualityOff = declaredNotApplicable(cfg, "quality") !== null;
  const legacyDays = cfg?.quality && !qualityOff ? (cfg.quality.warrantyDays ?? 0) : 0;
  const complaintWindowDays = cfg?.quality && !qualityOff ? (cfg.quality.complaintWindowDays ?? 0) : 0;
  if (w) {
    const enabled = w.enabled === true && (w.durationDays ?? 0) > 0;
    return {
      schema: "warranty.v1",
      enabled,
      durationDays: enabled ? (w.durationDays as number) : 0,
      startEvent: w.startEvent ?? "COMPLETION",
      eligibleIssueTypes: [...(w.eligibleIssueTypes ?? LEGACY_ELIGIBLE)],
      exclusions: [...(w.exclusions ?? [])],
      proofRequired: w.proofRequired === true,
      reworkFirst: w.reworkFirst !== false,
      refundAllowed: w.refundAllowed !== false,
      complaintWindowDays,
      damagePolicy: w.damagePolicy ?? null,
      guarantee: w.guarantee ?? null,
    };
  }
  return {
    schema: "warranty.v1",
    enabled: legacyDays > 0,
    durationDays: legacyDays > 0 ? legacyDays : 0,
    startEvent: "COMPLETION",
    eligibleIssueTypes: [...LEGACY_ELIGIBLE],
    exclusions: [],
    proofRequired: false,
    reworkFirst: true,
    refundAllowed: true,
    complaintWindowDays,
  };
}

export function warrantyFromSnapshot(bookingSnapshot: unknown): WarrantySnapshot | null {
  const rec = bookingSnapshot && typeof bookingSnapshot === "object" ? (bookingSnapshot as { warranty?: unknown }).warranty : null;
  if (!rec || typeof rec !== "object") return null;
  const r = rec as Partial<WarrantySnapshot>;
  return r.schema === "warranty.v1" ? (r as WarrantySnapshot) : null;
}

/**
 * Bookings made before `warranty.v1` existed carry only `quality.warrantyDays` (and, once completed,
 * the legacy `warranty: {days, until}` patch). They are read as a legacy snapshot, never rewritten.
 */
export function warrantyFromLegacyBookingSnapshot(bookingSnapshot: unknown): WarrantySnapshot | null {
  const typed = warrantyFromSnapshot(bookingSnapshot);
  if (typed) return typed;
  if (!bookingSnapshot || typeof bookingSnapshot !== "object") return null;
  const q = (bookingSnapshot as { quality?: { warrantyDays?: number; notApplicable?: boolean } | null }).quality;
  if (!q || q.notApplicable) return null;
  return buildWarrantySnapshot({ quality: { warrantyDays: q.warrantyDays ?? 0 } });
}

/** The window a completed booking's warranty runs for; null when the policy grants none. */
export function warrantyWindow(w: WarrantySnapshot | null, startsAt: Date): { startsAt: Date; expiresAt: Date } | null {
  if (!w || !w.enabled || w.durationDays <= 0) return null;
  return { startsAt, expiresAt: new Date(startsAt.getTime() + w.durationDays * 86_400_000) };
}

export type WarrantyRowState = "ACTIVE" | "EXPIRED" | "VOID";

export type WarrantyEligibilityInput = {
  policy: WarrantySnapshot | null;
  /** The booking_warranties row, if completion wrote one. */
  row: { state: WarrantyRowState; startsAt: Date; expiresAt: Date } | null;
  completedAt: Date | null;
  category: CaseCategory;
  proofPresent: boolean;
  now: Date;
};

export type WarrantyEligibility = {
  /** Inside the complaint window (a case may be opened at all). */
  complaintWindowOpen: boolean;
  /** The warranty covers this issue right now. */
  warrantyCovers: boolean;
  reasonCodes: string[];
  /** What the policy lets the case lead to. Never more than the frozen policy allows. */
  allowedActions: Array<"REWORK" | "REFUND" | "INSPECTION" | "REJECT">;
  proofRequired: boolean;
  proofMissing: boolean;
};

/**
 * Eligibility is arithmetic over the frozen policy and the row; it never consults the catalogue and
 * never widens what the policy said. A category the policy does not list is not covered; an expired
 * or void row is not covered; missing required proof is not covered until proof is attached.
 */
export function evaluateWarrantyEligibility(input: WarrantyEligibilityInput): WarrantyEligibility {
  const { policy, row, completedAt, category, proofPresent, now } = input;
  const reasonCodes: string[] = [];
  const windowDays = policy?.complaintWindowDays ?? 0;
  let complaintWindowOpen = false;
  if (!completedAt) reasonCodes.push("BOOKING_NOT_COMPLETED");
  else if (windowDays <= 0) reasonCodes.push("NO_COMPLAINT_WINDOW");
  else if (now.getTime() <= completedAt.getTime() + windowDays * 86_400_000) complaintWindowOpen = true;
  else reasonCodes.push("COMPLAINT_WINDOW_CLOSED");

  let warrantyCovers = false;
  if (!policy || !policy.enabled) reasonCodes.push("NO_WARRANTY");
  else if (!row) reasonCodes.push("WARRANTY_NOT_STARTED");
  else if (row.state === "VOID") reasonCodes.push("WARRANTY_VOID");
  else if (row.state === "EXPIRED" || now.getTime() > row.expiresAt.getTime()) reasonCodes.push("WARRANTY_EXPIRED");
  else if (now.getTime() < row.startsAt.getTime()) reasonCodes.push("WARRANTY_NOT_STARTED");
  else if (!policy.eligibleIssueTypes.includes(category)) reasonCodes.push("ISSUE_TYPE_NOT_COVERED");
  else if (policy.proofRequired && !proofPresent) reasonCodes.push("PROOF_REQUIRED");
  else warrantyCovers = true;

  const allowedActions: WarrantyEligibility["allowedActions"] = ["INSPECTION", "REJECT"];
  if (warrantyCovers) {
    if (policy!.reworkFirst) allowedActions.unshift("REWORK");
    else allowedActions.push("REWORK");
    if (policy!.refundAllowed) allowedActions.push("REFUND");
  }
  // Outside the warranty a complaint can still be inspected or rejected; money and rework need the
  // warranty (or an explicit admin decision recorded as such).
  return {
    complaintWindowOpen,
    warrantyCovers,
    reasonCodes,
    allowedActions,
    proofRequired: policy?.proofRequired === true,
    proofMissing: policy?.proofRequired === true && !proofPresent,
  };
}
