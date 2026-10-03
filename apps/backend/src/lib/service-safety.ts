/**
 * Phase 10 §9 — safety as a hard gate. Pure module (no I/O).
 *
 * The service's `safety` configuration is frozen into the booking (`safety.v1`) so that what the
 * partner can report as a prohibited condition, and what the customer was warned about, is the list
 * that applied at booking time. Nothing here invents a hazard, a chemical rule, an age limit or
 * medical advice: an unconfigured service has an empty snapshot and nothing to report against.
 *
 * Precedence (P10.5): CRITICAL SAFETY > PROHIBITED CONDITION > MANDATORY PRECONDITION >
 * OPERATIONAL REQUIREMENT > OPTIONAL GUIDANCE. In code: an open safety incident or an active hold
 * is evaluated BEFORE the §6 requirement gate and the §8 execution gate, and neither can be
 * overridden by the partner, the customer or a request body.
 */

export type SafetySnapshot = {
  schema: "safety.v1";
  prohibitedConditions: string[];
  warnings: string[];
  customerRequirements: string[];
  providerRequirements: string[];
  information: string | null;
  medicalDisclaimer: string | null;
  emergencyProtocol: string | null;
};

type SafetyCfg = {
  safety?: {
    information?: string;
    warnings?: string[];
    prohibitedConditions?: string[];
    customerRequirements?: string[];
    providerRequirements?: string[];
    medicalDisclaimer?: string;
    emergencyProtocol?: string;
  };
  safetyNotes?: string[];
} | null;

/** What the booking freezes. `safetyNotes` (legacy free text) are carried as warnings. */
export function buildSafetySnapshot(cfg: SafetyCfg): SafetySnapshot {
  const s = cfg?.safety;
  return {
    schema: "safety.v1",
    prohibitedConditions: [...(s?.prohibitedConditions ?? [])],
    warnings: [...(s?.warnings ?? []), ...(cfg?.safetyNotes ?? [])],
    customerRequirements: [...(s?.customerRequirements ?? [])],
    providerRequirements: [...(s?.providerRequirements ?? [])],
    information: s?.information ?? null,
    medicalDisclaimer: s?.medicalDisclaimer ?? null,
    emergencyProtocol: s?.emergencyProtocol ?? null,
  };
}

export function safetyFromSnapshot(bookingSnapshot: unknown): SafetySnapshot | null {
  const rec = bookingSnapshot && typeof bookingSnapshot === "object" ? (bookingSnapshot as { safety?: unknown }).safety : null;
  if (!rec || typeof rec !== "object") return null;
  const r = rec as Partial<SafetySnapshot>;
  return r.schema === "safety.v1" ? (r as SafetySnapshot) : null;
}

/** Customer projection: warnings, what they must do, the disclaimer and emergency protocol. Never provider requirements. */
export function customerSafetyView(s: SafetySnapshot | null) {
  if (!s) return null;
  return { warnings: s.warnings, customerRequirements: s.customerRequirements, information: s.information, medicalDisclaimer: s.medicalDisclaimer, emergencyProtocol: s.emergencyProtocol };
}

export const OPEN_INCIDENT_STATES = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"] as const;

export type SafetyHoldRow = { id: number; condition: string; source: string; state: "ACTIVE" | "RELEASED"; incidentId: string | null };
export type OpenIncident = { id: string; type: string; status: string };

export type SafetyGate = {
  ok: boolean;
  blocking: Array<{ kind: "SAFETY_HOLD"; holdId: number; condition: string } | { kind: "SAFETY_INCIDENT"; incidentId: string; type: string }>;
};

/** The gate: any ACTIVE hold or any open incident on the booking stops execution. */
export function evaluateSafetyGate(holds: SafetyHoldRow[], incidents: OpenIncident[]): SafetyGate {
  const blocking: SafetyGate["blocking"] = [];
  for (const h of holds) if (h.state === "ACTIVE") blocking.push({ kind: "SAFETY_HOLD", holdId: h.id, condition: h.condition });
  for (const i of incidents) if ((OPEN_INCIDENT_STATES as readonly string[]).includes(i.status)) blocking.push({ kind: "SAFETY_INCIDENT", incidentId: i.id, type: i.type });
  return { ok: blocking.length === 0, blocking };
}

/** A partner may only raise a condition the booking's frozen safety list names (exact, trimmed). */
export function matchProhibitedCondition(snapshot: SafetySnapshot | null, requested: string): string | null {
  const want = requested.trim().toLowerCase();
  return snapshot?.prohibitedConditions.find((c) => c.trim().toLowerCase() === want) ?? null;
}

export const SAFETY_HOLD_ACTIVE = "SAFETY_HOLD_ACTIVE";

export class SafetyGateError extends Error {
  readonly code = SAFETY_HOLD_ACTIVE;
  constructor(readonly gate: SafetyGate) {
    super(SAFETY_HOLD_ACTIVE);
    this.name = "SafetyGateError";
  }
}

export function safetyGateMessage(gate: SafetyGate): string {
  if (gate.ok) return "No safety hold";
  const holds = gate.blocking.filter((b) => b.kind === "SAFETY_HOLD").map((b) => (b as { condition: string }).condition);
  const incidents = gate.blocking.filter((b) => b.kind === "SAFETY_INCIDENT").length;
  const parts: string[] = [];
  if (holds.length) parts.push(`prohibited condition reported: ${holds.join(", ")}`);
  if (incidents) parts.push(`${incidents} open safety incident${incidents === 1 ? "" : "s"}`);
  return `Work is on safety hold — ${parts.join("; ")}. Our safety team must clear it first.`;
}
