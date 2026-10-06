/**
 * Phase 10 §9 — the one service that raises, releases and enforces safety holds on a booking.
 *
 * Holds live in booking_safety_holds; incidents stay in the EXISTING partner_safety_incidents queue
 * (admin safety queue, assign/acknowledge/resolve) — a prohibited condition raised here also opens an
 * incident there, so escalation has one home. The gate reads both.
 */
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { partnerHoldView } from "../lib/privacy-policy.engine";
import { incCounter } from "../lib/metrics";
import { getEventContext } from "../events/core/event-context";
import { setBookingAuditContext } from "../lib/booking-audit-context";
import { publishBookingRequirementBackground } from "../lib/booking-realtime";
import {
  customerSafetyView,
  evaluateSafetyGate,
  matchProhibitedCondition,
  OPEN_INCIDENT_STATES,
  SafetyGateError,
  safetyFromSnapshot,
  safetyGateMessage,
  type OpenIncident,
  type SafetyGate,
  type SafetyHoldRow,
} from "../lib/service-safety";
import { partnerSafetyService } from "./partner-safety.service";

type Db = Prisma.TransactionClient | typeof prisma;

let known: { present: boolean; at: number } | null = null;
async function tablesPresent(db: Db = prisma): Promise<boolean> {
  if (known && (known.present || Date.now() - known.at < 60_000)) return known.present;
  const [row] = await db.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('booking_safety_holds') IS NOT NULL AS present`;
  known = { present: row?.present === true, at: Date.now() };
  return known.present;
}

type RawHold = { id: bigint; condition: string; source: string; state: "ACTIVE" | "RELEASED"; incident_id: string | null; note: string | null; raised_by_role: string; raised_at: Date; released_at: Date | null; release_reason: string | null };

async function holdsFor(db: Db, bookingId: string, lock = false): Promise<Array<SafetyHoldRow & { raw: RawHold }>> {
  const rows = lock
    ? await db.$queryRaw<RawHold[]>`SELECT id, condition, source, state, incident_id, note, raised_by_role, raised_at, released_at, release_reason FROM booking_safety_holds WHERE booking_id = ${bookingId} ORDER BY id FOR UPDATE`
    : await db.$queryRaw<RawHold[]>`SELECT id, condition, source, state, incident_id, note, raised_by_role, raised_at, released_at, release_reason FROM booking_safety_holds WHERE booking_id = ${bookingId} ORDER BY id`;
  return rows.map((r) => ({ id: Number(r.id), condition: r.condition, source: r.source, state: r.state, incidentId: r.incident_id, raw: r }));
}

async function openIncidents(db: Db, bookingId: string): Promise<OpenIncident[]> {
  const rows = await db.partnerSafetyIncident.findMany({
    where: { bookingId, status: { in: [...OPEN_INCIDENT_STATES] } },
    select: { id: true, type: true, status: true },
  });
  return rows.map((r) => ({ id: r.id, type: String(r.type), status: String(r.status) }));
}

export const SAFETY_ERRORS = {
  NOT_FOUND: "NOT_FOUND",
  CONDITION_NOT_CONFIGURED: "CONDITION_NOT_CONFIGURED",
  HOLD_NOT_FOUND: "HOLD_NOT_FOUND",
  HOLD_NOT_ACTIVE: "HOLD_NOT_ACTIVE",
  REASON_REQUIRED: "REASON_REQUIRED",
  CONDITION_REQUIRED: "CONDITION_REQUIRED",
  INVALID_STATUS: "INVALID_STATUS",
  SAFETY_UNAVAILABLE: "SAFETY_UNAVAILABLE",
} as const;

const WORKABLE = new Set(["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"]);
/** Safety operations may hold any booking that can still be worked, including one not yet accepted. */
const HOLDABLE = new Set(["PENDING", ...WORKABLE]);

class BookingSafetyService {
  /**
   * The gate, for START / step START+COMPLETE / COMPLETE. Holds are locked so a release landing
   * concurrently is ordered before or after. Open incidents are read from the existing queue.
   * Without the table (migration not applied) holds are not deployed, but open incidents still gate.
   */
  async assertSafe(tx: Prisma.TransactionClient, bookingId: string, point: "START" | "STEP" | "COMPLETE"): Promise<SafetyGate> {
    const holds = (await tablesPresent(tx)) ? await holdsFor(tx, bookingId, true) : [];
    const gate = evaluateSafetyGate(holds, await openIncidents(tx, bookingId));
    incCounter("safety_gate_evaluation_total", { point, result: gate.ok ? "ok" : "blocked" });
    if (!gate.ok) {
      const ctx = getEventContext();
      logger.warn("execution_blocked_by_safety", { bookingId, point, requestId: ctx.requestId, traceId: ctx.traceId, blocking: gate.blocking });
      throw new SafetyGateError(gate);
    }
    return gate;
  }

  /**
   * Read-only summary of the same gate for `/actions` and the pre-PIN check on `/start` — no lock, no
   * counter, no log; `assertSafe` inside the start/complete transaction stays the authority.
   */
  async currentGate(bookingId: string): Promise<SafetyGate> {
    const holds = (await tablesPresent()) ? await holdsFor(prisma, bookingId) : [];
    return evaluateSafetyGate(holds, await openIncidents(prisma, bookingId));
  }

  async gateSummary(bookingId: string): Promise<{ ok: boolean; blocking: number; message: string }> {
    const gate = await this.currentGate(bookingId);
    return { ok: gate.ok, blocking: gate.blocking.length, message: safetyGateMessage(gate) };
  }

  async viewFor(bookingId: string, audience: { role: "CUSTOMER"; userId: string } | { role: "PARTNER"; providerId: string } | { role: "ADMIN" }) {
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { userId: true, providerId: true, serviceConfigSnapshot: true, status: true } });
    if (!b) return { error: "NOT_FOUND" as const };
    if (audience.role === "CUSTOMER" && b.userId !== audience.userId) return { error: "NOT_FOUND" as const };
    if (audience.role === "PARTNER" && b.providerId !== audience.providerId) return { error: "NOT_FOUND" as const };
    const snap = safetyFromSnapshot(b.serviceConfigSnapshot);
    const holds = (await tablesPresent()) ? await holdsFor(prisma, bookingId) : [];
    const incidents = await openIncidents(prisma, bookingId);
    const gate = evaluateSafetyGate(holds, incidents);
    const base = { gate: { ok: gate.ok, message: safetyGateMessage(gate) }, holdsEnforced: await tablesPresent() };
    if (audience.role === "CUSTOMER") {
      // The customer is told work is on hold and why in plain words; not the partner's note or incident internals.
      return { ...base, safety: customerSafetyView(snap), holds: holds.filter((h) => h.state === "ACTIVE").map((h) => ({ condition: h.condition })) };
    }
    return {
      ...base,
      safety: snap,
      canReport: audience.role === "PARTNER" && WORKABLE.has(b.status) ? snap?.prohibitedConditions ?? [] : [],
      // A partner sees its own note on a hold it raised; an admin-placed hold's note is safety operations'
      // internal reason (X-55) and stays with admins.
      // A partner does not read the admin's release reason or the incident id (partnerHoldView).
      holds: holds
        .map((h) => ({ id: h.id, condition: h.condition, source: h.source, state: h.state, incidentId: h.incidentId, note: audience.role === "ADMIN" || h.raw.raised_by_role === "PARTNER" ? h.raw.note : null, raisedByRole: h.raw.raised_by_role, raisedAt: h.raw.raised_at.toISOString(), releasedAt: h.raw.released_at?.toISOString() ?? null, releaseReason: h.raw.release_reason }))
        .map((h) => (audience.role === "PARTNER" ? partnerHoldView(h) : h)),
      incidents: audience.role === "ADMIN" ? incidents : incidents.length,
    };
  }

  /**
   * The assigned partner reports that a configured prohibited condition is present. Opens an incident
   * in the existing queue (escalation) and an ACTIVE hold (the block). Idempotent per condition.
   */
  async raiseProhibitedCondition(input: { bookingId: string; providerId: string; userId: string; condition: string; note?: string | null }) {
    if (!(await tablesPresent())) return { ok: false as const, error: SAFETY_ERRORS.SAFETY_UNAVAILABLE };
    const b = await prisma.booking.findFirst({ where: { id: input.bookingId, providerId: input.providerId }, select: { id: true, userId: true, status: true, serviceConfigSnapshot: true, provider: { select: { userId: true } } } });
    if (!b) return { ok: false as const, error: SAFETY_ERRORS.NOT_FOUND };
    if (!WORKABLE.has(b.status)) return { ok: false as const, error: SAFETY_ERRORS.INVALID_STATUS };
    const condition = matchProhibitedCondition(safetyFromSnapshot(b.serviceConfigSnapshot), input.condition);
    if (!condition) return { ok: false as const, error: SAFETY_ERRORS.CONDITION_NOT_CONFIGURED };
    const existing = (await holdsFor(prisma, b.id)).find((h) => h.state === "ACTIVE" && h.condition === condition);
    if (existing) return { ok: true as const, holdId: existing.id, incidentId: existing.incidentId, changed: false };
    // Escalation first, in the existing safety queue.
    const incident = await partnerSafetyService.reportIssue({
      providerId: input.providerId, userId: input.userId, type: "LOCATION_DANGER", bookingId: b.id,
      notes: `Prohibited condition: ${condition}${input.note ? ` — ${input.note.slice(0, 300)}` : ""}`,
    });
    const holdId = await prisma.$transaction(async (tx) => {
      await setBookingAuditContext(tx, { actorType: "partner", actorId: input.userId, reason: `prohibited condition: ${condition}` });
      const rows = await tx.$queryRaw<{ id: bigint }[]>`
        INSERT INTO booking_safety_holds (booking_id, source, condition, note, raised_by_role, raised_by_id, incident_id)
        VALUES (${b.id}, 'PROHIBITED_CONDITION', ${condition}, ${input.note ?? null}, 'PARTNER', ${input.userId}, ${incident.id})
        ON CONFLICT (booking_id, condition) WHERE state = 'ACTIVE' DO NOTHING
        RETURNING id`;
      return rows[0] ? Number(rows[0].id) : null;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    const final = holdId ?? (await holdsFor(prisma, b.id)).find((h) => h.state === "ACTIVE" && h.condition === condition)?.id ?? null;
    incCounter("safety_hold_raised_total", { source: "PROHIBITED_CONDITION", changed: holdId ? "true" : "false" });
    logger.warn("safety_hold_raised", { bookingId: b.id, condition, incidentId: incident.id, holdId: final });
    publishBookingRequirementBackground({ bookingId: b.id, userId: b.userId, providerUserId: b.provider?.userId ?? null, event: "execution.blocked", code: "safety", state: "SAFETY_HOLD", gate: { ok: false, blocking: [{ code: "safety", label: condition, enforcementPoint: "SAFETY", reason: "SAFETY_HOLD_ACTIVE" }] } });
    return { ok: true as const, holdId: final, incidentId: incident.id, changed: holdId != null };
  }

  /**
   * X-60: tell the booking's parties the START gate changed, with the gate as it now stands (a release
   * can leave it closed — the linked incident still blocks). Clients refetch; the frame is a signal.
   */
  async publishGateChange(bookingId: string, state: "SAFETY_HOLD" | "SAFETY_HOLD_RELEASED" | "SAFETY_INCIDENT_RESOLVED"): Promise<SafetyGate> {
    const gate = await this.currentGate(bookingId);
    publishBookingRequirementBackground({
      bookingId,
      event: gate.ok ? "execution.unblocked" : "execution.blocked",
      code: "safety",
      state,
      gate: { ok: gate.ok, blocking: gate.blocking.map((b) => ({ code: "safety", label: b.kind === "SAFETY_HOLD" ? b.condition : b.type, enforcementPoint: "SAFETY", reason: "SAFETY_HOLD_ACTIVE" })) },
    });
    return gate;
  }

  /**
   * X-55: safety operations put a booking on hold themselves (a customer call, a police report …).
   * Source ADMIN, no incident is opened — the admin IS the safety queue here; the hold row and its
   * trigger audit are the record. Idempotent per condition, like a partner-raised hold.
   */
  async adminPlace(input: { bookingId: string; adminId: string; condition: string; reason: string }) {
    if (!(await tablesPresent())) return { ok: false as const, error: SAFETY_ERRORS.SAFETY_UNAVAILABLE };
    const condition = input.condition.trim().replace(/\s+/g, " ");
    const reason = input.reason.trim();
    if (condition.length < 3) return { ok: false as const, error: SAFETY_ERRORS.CONDITION_REQUIRED };
    if (reason.length < 3) return { ok: false as const, error: SAFETY_ERRORS.REASON_REQUIRED };
    const b = await prisma.booking.findUnique({ where: { id: input.bookingId }, select: { id: true, status: true } });
    if (!b) return { ok: false as const, error: SAFETY_ERRORS.NOT_FOUND };
    if (!HOLDABLE.has(b.status)) return { ok: false as const, error: SAFETY_ERRORS.INVALID_STATUS };
    const holdId = await prisma.$transaction(async (tx) => {
      await setBookingAuditContext(tx, { actorType: "admin", actorId: input.adminId, reason: `safety hold placed: ${reason.slice(0, 300)}` });
      const rows = await tx.$queryRaw<{ id: bigint }[]>`
        INSERT INTO booking_safety_holds (booking_id, source, condition, note, raised_by_role, raised_by_id)
        VALUES (${b.id}, 'ADMIN', ${condition.slice(0, 200)}, ${reason.slice(0, 300)}, 'ADMIN', ${input.adminId})
        ON CONFLICT (booking_id, condition) WHERE state = 'ACTIVE' DO NOTHING
        RETURNING id`;
      return rows[0] ? Number(rows[0].id) : null;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    const final = holdId ?? (await holdsFor(prisma, b.id)).find((h) => h.state === "ACTIVE" && h.condition === condition.slice(0, 200))?.id ?? null;
    incCounter("safety_hold_raised_total", { source: "ADMIN", changed: holdId ? "true" : "false" });
    logger.warn("safety_hold_raised", { bookingId: b.id, source: "ADMIN", holdId: final });
    const gate = holdId ? await this.publishGateChange(b.id, "SAFETY_HOLD") : await this.currentGate(b.id);
    return { ok: true as const, holdId: final, changed: holdId != null, gate: { ok: gate.ok, message: safetyGateMessage(gate) } };
  }

  /** Safety operations release a hold, with a reason. The incident is resolved separately in its own queue. */
  async adminRelease(input: { bookingId: string; holdId: number; adminId: string; reason: string }) {
    if (!(await tablesPresent())) return { ok: false as const, error: SAFETY_ERRORS.SAFETY_UNAVAILABLE };
    const reason = input.reason.trim();
    if (reason.length < 3) return { ok: false as const, error: SAFETY_ERRORS.REASON_REQUIRED };
    const r = await prisma.$transaction(async (tx) => {
      const holds = await holdsFor(tx, input.bookingId, true);
      const h = holds.find((x) => x.id === input.holdId);
      if (!h) return { ok: false as const, error: SAFETY_ERRORS.HOLD_NOT_FOUND };
      if (h.state !== "ACTIVE") return { ok: false as const, error: SAFETY_ERRORS.HOLD_NOT_ACTIVE };
      await setBookingAuditContext(tx, { actorType: "admin", actorId: input.adminId, reason: `safety hold released: ${reason.slice(0, 300)}` });
      await tx.$executeRaw`UPDATE booking_safety_holds SET state = 'RELEASED', released_by_id = ${input.adminId}, released_at = now(), release_reason = ${reason}, version = version + 1 WHERE id = ${input.holdId} AND state = 'ACTIVE'`;
      return { ok: true as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    if (!r.ok) return r;
    incCounter("safety_hold_released_total");
    // X-55/X-60: the admin is told whether START is now open (a linked incident still blocks it), and
    // the partner's job screen is told to refetch instead of staying disabled until it is reopened.
    const gate = await this.publishGateChange(input.bookingId, "SAFETY_HOLD_RELEASED");
    return { ok: true as const, gate: { ok: gate.ok, message: safetyGateMessage(gate) } };
  }

  async auditFor(bookingId: string) {
    if (!(await tablesPresent())) return [];
    return prisma.$queryRaw<Array<{ id: bigint; hold_id: bigint; condition: string; action: string; from_state: string | null; to_state: string; actor_type: string | null; actor_id: string | null; reason: string | null; request_id: string | null; trace_id: string | null; incident_id: string | null; changed_at: Date }>>`
      SELECT id, hold_id, condition, action, from_state, to_state, actor_type, actor_id, reason, request_id, trace_id, incident_id, changed_at FROM booking_safety_audit WHERE booking_id = ${bookingId} ORDER BY id`
      .then((rows) => rows.map((r) => ({ ...r, id: Number(r.id), hold_id: Number(r.hold_id) })));
  }
}

export const bookingSafetyService = new BookingSafetyService();
export { SafetyGateError, safetyGateMessage };
