/**
 * Phase 10 §6 — requirement gates. Pure module (no I/O).
 *
 * Phase 06 resolves WHAT a booking requires (lib/service-requirements.ts) and freezes it into the
 * booking's `requirements.v1` snapshot. This module answers the next question — whether execution
 * may proceed — from that snapshot plus the booking's own requirement STATE rows
 * (booking_requirement_states). It never reads the service's current configuration, so a later
 * catalogue edit cannot change what a live booking is gated on (§6.28).
 *
 * Enforcement points, from the Phase 06 enforcement vocabulary:
 *
 *   REQUIRED_BEFORE_BOOKING  → BEFORE_BOOKING   satisfied by the customer's attestation at booking
 *                                               (enforced in bookingService.create; recorded here)
 *   REQUIRED_BEFORE_ARRIVAL  → BEFORE_ARRIVAL   what must be in place when the professional arrives
 *   REQUIRED_AT_START        → AT_START         what must be in place when work starts
 *
 * Both BEFORE_ARRIVAL and AT_START bind at the START transition. Arrival itself is a fact on the
 * row (ADR-018, §5): the partner is physically there whether or not the customer left the water on,
 * and the no-show policy needs that fact recorded. So arrival is EVALUATED (the partner and customer
 * are told what is blocking) and START is REFUSED. INFORMATIONAL and WARNING items have no state.
 */

export const ENFORCEMENT_POINTS = ["BEFORE_BOOKING", "BEFORE_ARRIVAL", "AT_START"] as const;
export type EnforcementPoint = (typeof ENFORCEMENT_POINTS)[number];

const POINT_OF: Record<string, EnforcementPoint> = {
  REQUIRED_BEFORE_BOOKING: "BEFORE_BOOKING",
  REQUIRED_BEFORE_ARRIVAL: "BEFORE_ARRIVAL",
  REQUIRED_AT_START: "AT_START",
};

/** The enforcement point a Phase 06 enforcement value binds to; null for copy-only values. */
export function enforcementPointOf(enforcement: string): EnforcementPoint | null {
  return POINT_OF[enforcement] ?? null;
}

export const REQUIREMENT_STATES = ["UNRESOLVED", "SATISFIED", "FAILED"] as const;
export type RequirementState = (typeof REQUIREMENT_STATES)[number];
/** Stored state plus the one derived state (evidence bound to an appointment that moved). */
export type EffectiveRequirementState = RequirementState | "EXPIRED";

export type RequirementActorRole = "CUSTOMER" | "PARTNER" | "ADMIN" | "SYSTEM";
export type RequirementEvidenceKind = "CUSTOMER_ATTESTATION" | "PARTNER_CHECK";

/** One row of booking_requirement_states, camel-cased. */
export type RequirementStateRow = {
  bookingId: string;
  code: string;
  itemCode: string;
  kind: string;
  enforcement: string;
  verification: string;
  responsibility: string;
  optional: boolean;
  serviceVersion: number;
  state: RequirementState;
  resolvedByRole: RequirementActorRole | null;
  resolvedById: string | null;
  evidenceKind: RequirementEvidenceKind | null;
  evidenceRef: string | null;
  evidenceLat: number | null;
  evidenceLng: number | null;
  note: string | null;
  validForScheduledAt: Date | null;
  resolvedAt: Date | null;
  version: number;
  updatedAt: Date;
};

/** The item facts a state row is materialised from — read from the booking snapshot only. */
export type GatedSnapshotItem = {
  code: string;
  itemCode: string;
  kind: string;
  name: string;
  customerLabel: string | null;
  enforcement: string;
  enforcementPoint: EnforcementPoint;
  verification: string;
  responsibility: string;
  optional: boolean;
  attested: boolean;
};

type SnapshotItemShape = {
  code?: unknown; itemCode?: unknown; kind?: unknown; name?: unknown; customerLabel?: unknown;
  enforcement?: unknown; verification?: unknown; responsibility?: unknown; optional?: unknown; attested?: unknown;
};

/**
 * The gated items of a booking's `requirements.v1` snapshot. null when the booking predates Phase 06
 * (no snapshot): such a booking has nothing to gate on, and inventing requirements for it would be
 * exactly the fabrication the brief forbids.
 */
export function gatedItemsFromSnapshot(bookingSnapshot: unknown): { serviceVersion: number; items: GatedSnapshotItem[] } | null {
  const rec = bookingSnapshot && typeof bookingSnapshot === "object" ? (bookingSnapshot as { requirements?: unknown }).requirements : null;
  if (!rec || typeof rec !== "object") return null;
  const r = rec as { schema?: unknown; serviceVersion?: unknown; items?: unknown };
  if (r.schema !== "requirements.v1" || !Array.isArray(r.items)) return null;
  const items: GatedSnapshotItem[] = [];
  for (const raw of r.items as SnapshotItemShape[]) {
    const enforcement = typeof raw.enforcement === "string" ? raw.enforcement : "";
    const point = enforcementPointOf(enforcement);
    if (!point || typeof raw.code !== "string") continue;
    items.push({
      code: raw.code,
      itemCode: typeof raw.itemCode === "string" ? raw.itemCode : raw.code,
      kind: typeof raw.kind === "string" ? raw.kind : "UNKNOWN",
      name: typeof raw.name === "string" ? raw.name : raw.code,
      customerLabel: typeof raw.customerLabel === "string" ? raw.customerLabel : null,
      enforcement,
      enforcementPoint: point,
      verification: typeof raw.verification === "string" ? raw.verification : "NONE",
      responsibility: typeof raw.responsibility === "string" ? raw.responsibility : "UNKNOWN",
      optional: raw.optional === true,
      attested: raw.attested === true,
    });
  }
  items.sort((a, b) => a.code.localeCompare(b.code));
  return { serviceVersion: typeof r.serviceVersion === "number" ? r.serviceVersion : 0, items };
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                          */
/* ------------------------------------------------------------------ */

export type GateTarget = "ARRIVAL" | "START";

/** Which enforcement points a transition is gated on. */
export function pointsRequiredFor(target: GateTarget): EnforcementPoint[] {
  return target === "ARRIVAL" ? ["BEFORE_ARRIVAL"] : ["BEFORE_ARRIVAL", "AT_START"];
}

export const GATE_REASONS = {
  REQUIREMENT_UNRESOLVED: "REQUIREMENT_UNRESOLVED",
  REQUIREMENT_FAILED: "REQUIREMENT_FAILED",
  REQUIREMENT_EXPIRED: "REQUIREMENT_EXPIRED",
  PARTNER_CHECK_REQUIRED: "PARTNER_CHECK_REQUIRED",
  CUSTOMER_PRECONDITION_MISSING: "CUSTOMER_PRECONDITION_MISSING",
} as const;
export type GateReason = (typeof GATE_REASONS)[keyof typeof GATE_REASONS];

export type BlockingRequirement = {
  code: string;
  /** Item name — never partner instructions, notes, or internal codes. */
  label: string;
  kind: string;
  enforcementPoint: EnforcementPoint;
  responsibility: string;
  verification: string;
  state: EffectiveRequirementState;
  reason: GateReason;
  /** Who can clear it and what they do — safe to show either party. */
  remediation: { role: "PARTNER" | "CUSTOMER"; text: string };
};

export type GateResult = {
  target: GateTarget;
  ok: boolean;
  /** Gated, non-optional rows considered at this target. */
  evaluated: number;
  blocking: BlockingRequirement[];
};

/**
 * A PARTNER_CHECK is evidence about ONE appointment. If the appointment moved after the check, the
 * evidence is stale: it is reported EXPIRED and the check has to be made again. Attestations given
 * at booking are not appointment-bound (validForScheduledAt null) and do not expire.
 */
export function effectiveState(row: Pick<RequirementStateRow, "state" | "validForScheduledAt">, scheduledDate: Date): EffectiveRequirementState {
  if (row.state === "SATISFIED" && row.validForScheduledAt && row.validForScheduledAt.getTime() !== scheduledDate.getTime()) return "EXPIRED";
  return row.state;
}

const POINT_ORDER: Record<EnforcementPoint, number> = { BEFORE_BOOKING: 0, BEFORE_ARRIVAL: 1, AT_START: 2 };

/**
 * The gate. Deterministic: same rows → same blocking list, ordered by enforcement point then code.
 * Fail-closed on state: a gated, non-optional requirement with no SATISFIED evidence blocks. It does
 * NOT fail closed on absence of requirements — a service with nothing gated is not blocked (§6.4).
 */
export function evaluateRequirementGate(input: {
  target: GateTarget;
  rows: RequirementStateRow[];
  scheduledDate: Date;
  /** code → customer-safe label, from the snapshot. Falls back to the code. */
  labels?: Record<string, string>;
}): GateResult {
  const points = new Set(pointsRequiredFor(input.target));
  const considered = input.rows
    .filter((r) => !r.optional)
    .map((r) => ({ r, point: enforcementPointOf(r.enforcement) }))
    .filter((x): x is { r: RequirementStateRow; point: EnforcementPoint } => x.point != null && points.has(x.point))
    .sort((a, b) => POINT_ORDER[a.point] - POINT_ORDER[b.point] || a.r.code.localeCompare(b.r.code));

  const blocking: BlockingRequirement[] = [];
  for (const { r, point } of considered) {
    const state = effectiveState(r, input.scheduledDate);
    if (state === "SATISFIED") continue;
    const customerPrecondition = r.kind === "CUSTOMER_PRECONDITION" || r.responsibility === "CUSTOMER";
    let reason: GateReason;
    let remediation: BlockingRequirement["remediation"];
    if (state === "EXPIRED") {
      reason = GATE_REASONS.REQUIREMENT_EXPIRED;
      remediation = { role: "PARTNER", text: "The appointment moved after this was checked — check it again on site." };
    } else if (state === "FAILED") {
      reason = customerPrecondition ? GATE_REASONS.CUSTOMER_PRECONDITION_MISSING : GATE_REASONS.REQUIREMENT_FAILED;
      remediation = customerPrecondition
        ? { role: "CUSTOMER", text: "Arrange it, then tell us it is ready so your professional can check again." }
        : { role: "PARTNER", text: "Resolve it on site and record the check again." };
    } else if (r.verification === "PARTNER_CHECK") {
      reason = GATE_REASONS.PARTNER_CHECK_REQUIRED;
      remediation = { role: "PARTNER", text: "Check it on site and record whether it is in place." };
    } else {
      reason = GATE_REASONS.REQUIREMENT_UNRESOLVED;
      remediation = customerPrecondition
        ? { role: "CUSTOMER", text: "Confirm this is in place." }
        : { role: "PARTNER", text: "Record that this is in place." };
    }
    blocking.push({
      code: r.code,
      label: input.labels?.[r.code] ?? r.code,
      kind: r.kind,
      enforcementPoint: point,
      responsibility: r.responsibility,
      verification: r.verification,
      state,
      reason,
      remediation,
    });
  }
  return { target: input.target, ok: blocking.length === 0, evaluated: considered.length, blocking };
}

/* ------------------------------------------------------------------ */
/* Transition authority                                                */
/* ------------------------------------------------------------------ */

export const REQUIREMENT_TRANSITION_ERRORS = {
  FORBIDDEN: "REQUIREMENT_TRANSITION_FORBIDDEN",
  NOT_GATED: "REQUIREMENT_NOT_GATED",
} as const;

export type RequirementActor =
  | { role: "PARTNER"; isAssignedPartner: boolean }
  | { role: "CUSTOMER"; isOwner: boolean }
  | { role: "ADMIN" };

export type RequirementTransitionRequest = {
  row: Pick<RequirementStateRow, "state" | "verification" | "responsibility" | "enforcement">;
  actor: RequirementActor;
  to: RequirementState;
};

/**
 * Who may move a requirement where. The responsibility model in one place (§6.7):
 *
 *   PARTNER   the ASSIGNED partner records the outcome of a PARTNER_CHECK: SATISFIED or FAILED,
 *             from any state (a re-check replaces earlier evidence). Never a customer attestation.
 *   CUSTOMER  the OWNER attests a CUSTOMER_ATTESTATION item (→ SATISFIED); for a PARTNER_CHECK item
 *             the customer can only send a FAILED check back for re-checking (→ UNRESOLVED). A
 *             customer can never mark a partner check satisfied.
 *   ADMIN     may only send a requirement back to UNRESOLVED (force a re-check). There is no admin
 *             "mark satisfied": that would be an override of evidence, which nothing else in the
 *             platform allows either.
 */
export function canTransitionRequirement(req: RequirementTransitionRequest): { ok: true } | { ok: false; error: string } {
  const { row, actor, to } = req;
  const forbidden = { ok: false as const, error: REQUIREMENT_TRANSITION_ERRORS.FORBIDDEN };
  if (!enforcementPointOf(row.enforcement)) return { ok: false, error: REQUIREMENT_TRANSITION_ERRORS.NOT_GATED };
  switch (actor.role) {
    case "PARTNER":
      if (!actor.isAssignedPartner) return forbidden;
      if (row.verification !== "PARTNER_CHECK") return forbidden;
      return to === "SATISFIED" || to === "FAILED" ? { ok: true } : forbidden;
    case "CUSTOMER":
      if (!actor.isOwner) return forbidden;
      if (row.verification === "CUSTOMER_ATTESTATION") return to === "SATISFIED" && row.state !== "SATISFIED" ? { ok: true } : forbidden;
      if (row.verification === "PARTNER_CHECK") return to === "UNRESOLVED" && row.state === "FAILED" ? { ok: true } : forbidden;
      return forbidden;
    case "ADMIN":
      return to === "UNRESOLVED" && row.state !== "UNRESOLVED" ? { ok: true } : forbidden;
    default:
      return forbidden;
  }
}

/* ------------------------------------------------------------------ */
/* Error contract                                                      */
/* ------------------------------------------------------------------ */

export const REQUIREMENT_GATE_BLOCKED = "REQUIREMENT_GATE_BLOCKED";

/** Thrown by the START transition. `message` is the stable code so existing error mapping sees it. */
export class RequirementGateError extends Error {
  readonly code = REQUIREMENT_GATE_BLOCKED;
  constructor(readonly gate: GateResult) {
    super(REQUIREMENT_GATE_BLOCKED);
    this.name = "RequirementGateError";
  }
}

/** Human-safe sentence for a blocked gate: labels only, never codes, notes or internals. */
export function gateMessage(gate: GateResult): string {
  if (gate.ok) return "All requirements are in place";
  const labels = gate.blocking.map((b) => b.label);
  const head = gate.target === "START" ? "Before starting, resolve" : "Before arrival, resolve";
  return `${head}: ${labels.slice(0, 4).join(", ")}${labels.length > 4 ? ` and ${labels.length - 4} more` : ""}`;
}
