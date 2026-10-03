/**
 * Phase 10 §6 — requirement gates: the one service that reads, transitions and enforces a booking's
 * requirement state.
 *
 * Chain: service version → effective requirements (Phase 06 resolver) → booking snapshot →
 * booking_requirement_states → enforcement point → gate (lib/requirement-gates) → START refused /
 * arrival evaluated → audit (trigger) + realtime (lib/booking-realtime) + notifications.
 *
 * It never reads the service's current configuration. It never accepts a client's opinion of
 * satisfaction: a partner records the OUTCOME of an on-site check (with GPS proximity, like arrival),
 * a customer can attest an attestation item or send a failed check back for re-checking, an admin can
 * only force a re-check. Nobody can mark another party's requirement satisfied.
 */
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter, observeHist } from "../lib/metrics";
import { getEventContext } from "../events/core/event-context";
import { setBookingAuditContext } from "../lib/booking-audit-context";
import { publishBookingRequirementBackground } from "../lib/booking-realtime";
import { assertJobProximity } from "../lib/job-proximity";
import {
  canTransitionRequirement,
  effectiveState,
  evaluateRequirementGate,
  gatedItemsFromSnapshot,
  gateMessage,
  RequirementGateError,
  REQUIREMENT_GATE_BLOCKED,
  type BlockingRequirement,
  type EffectiveRequirementState,
  type GateResult,
  type GateTarget,
  type GatedSnapshotItem,
  type RequirementActor,
  type RequirementState,
  type RequirementStateRow,
} from "../lib/requirement-gates";
import {
  getRequirementState,
  listRequirementAudit,
  listRequirementStates,
  materializeRequirementStates,
  requirementStateTablesPresent,
  setRequirementAuditContext,
  transitionRequirementState,
  type Db,
  type RequirementAuditRow,
} from "../lib/booking-requirement-store";
import { notificationService } from "./notification.service";

/** Statuses in which a requirement can still be worked on. Terminal bookings are read-only. */
const WORKABLE = new Set(["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"]);

export const REQUIREMENT_ERRORS = {
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
  INVALID_STATUS: "INVALID_STATUS",
  REQUIREMENT_NOT_FOUND: "REQUIREMENT_NOT_FOUND",
  REQUIREMENT_TRANSITION_FORBIDDEN: "REQUIREMENT_TRANSITION_FORBIDDEN",
  REQUIREMENT_STATE_CONFLICT: "REQUIREMENT_STATE_CONFLICT",
  REQUIREMENT_GATE_UNAVAILABLE: "REQUIREMENT_GATE_UNAVAILABLE",
} as const;

type BookingCtx = {
  id: string;
  userId: string;
  providerId: string | null;
  status: string;
  scheduledDate: Date;
  serviceConfigSnapshot: unknown;
  serviceConfigVersion: number | null;
  address: { latitude: number | null; longitude: number | null } | null;
  provider: { userId: string } | null;
};

export type RequirementItemView = {
  code: string;
  label: string;
  kind: string;
  enforcementPoint: "BEFORE_BOOKING" | "BEFORE_ARRIVAL" | "AT_START";
  responsibility: string;
  verification: string;
  optional: boolean;
  state: EffectiveRequirementState;
  resolvedAt: string | null;
  resolvedByRole: string | null;
  note: string | null;
  /** What THIS audience may do with it. */
  actions: Array<"CHECK" | "READY" | "ATTEST" | "RECHECK">;
  /** Present only when the item currently blocks execution. */
  blocking: Pick<BlockingRequirement, "reason" | "remediation"> | null;
};

export type BookingRequirementsView = {
  /** false when the migration is not on this database — the gate is not deployed, not "passing". */
  enforced: boolean;
  serviceVersion: number | null;
  items: RequirementItemView[];
  gate: { arrival: GateResult; start: GateResult };
  audit?: RequirementAuditRow[];
};

class BookingRequirementService {
  /* ---------------------------------------------------------------- */
  /* Loading                                                           */
  /* ---------------------------------------------------------------- */

  private async loadBooking(db: Db, bookingId: string): Promise<BookingCtx | null> {
    const b = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true, userId: true, providerId: true, status: true, scheduledDate: true,
        serviceConfigSnapshot: true, serviceConfigVersion: true,
        address: { select: { latitude: true, longitude: true } },
        provider: { select: { userId: true } },
      },
    });
    return b as BookingCtx | null;
  }

  private snapshotItems(b: BookingCtx): { serviceVersion: number; items: GatedSnapshotItem[] } {
    return gatedItemsFromSnapshot(b.serviceConfigSnapshot) ?? { serviceVersion: b.serviceConfigVersion ?? 0, items: [] };
  }

  private labels(items: GatedSnapshotItem[]): Record<string, string> {
    return Object.fromEntries(items.map((i) => [i.code, i.customerLabel ?? i.name]));
  }

  /**
   * Rows for every gated snapshot item, created if missing. Bookings created before §6 gain rows on
   * first evaluation from THEIR snapshot (what they were told), never from today's catalogue.
   */
  async ensureMaterialized(db: Db, b: BookingCtx): Promise<RequirementStateRow[]> {
    const snap = this.snapshotItems(b);
    const existing = await listRequirementStates(db, b.id);
    // One read on the hot path; the inserts run only for a booking that predates §6 (§6.26).
    if (existing.length >= snap.items.length) return existing;
    const inserted = await materializeRequirementStates(db, { bookingId: b.id, serviceVersion: snap.serviceVersion, items: snap.items, customerId: b.userId });
    if (inserted) incCounter("requirement_state_materialized_total", { lazy: "true" });
    return listRequirementStates(db, b.id);
  }

  /** Called inside bookingService.create's transaction: the rows are born with the booking. */
  async materializeForNewBooking(tx: Prisma.TransactionClient, input: { bookingId: string; customerId: string; snapshot: unknown }): Promise<void> {
    if (!(await requirementStateTablesPresent(tx))) return;
    const snap = gatedItemsFromSnapshot(input.snapshot);
    if (!snap || !snap.items.length) return;
    await setRequirementAuditContext(tx, { action: "MATERIALIZED" });
    const n = await materializeRequirementStates(tx, { bookingId: input.bookingId, serviceVersion: snap.serviceVersion, items: snap.items, customerId: input.customerId });
    incCounter("requirement_state_materialized_total", { lazy: "false" });
    logger.info("requirement_states_materialized", { bookingId: input.bookingId, count: n, serviceVersion: snap.serviceVersion });
  }

  /* ---------------------------------------------------------------- */
  /* Evaluation                                                        */
  /* ---------------------------------------------------------------- */

  private evaluate(target: GateTarget, b: BookingCtx, rows: RequirementStateRow[]): GateResult {
    const t0 = performance.now();
    const gate = evaluateRequirementGate({ target, rows, scheduledDate: b.scheduledDate, labels: this.labels(this.snapshotItems(b).items) });
    observeHist("requirement_evaluation_seconds", (performance.now() - t0) / 1000, { target });
    incCounter("requirement_evaluation_total", { target, result: gate.ok ? "ok" : "blocked" });
    return gate;
  }

  /**
   * START gate, inside the START transaction. Locks the booking's state rows so a concurrent check
   * or re-check serialises against the start (§6.15). Throws RequirementGateError when blocked.
   *
   * When the migration is not on this database the gate is NOT deployed: that is reported (ERROR log
   * + counter, once per minute per process via the probe) and start proceeds as before §6. Blocking
   * every start on a database that lacks the table would be an outage caused by a deployment gap,
   * and pretending the gate passed would be a lie; "not enforced, and said so" is the honest state.
   */
  async assertStartAllowed(tx: Prisma.TransactionClient, bookingId: string): Promise<GateResult | null> {
    if (!(await requirementStateTablesPresent(tx))) {
      incCounter("requirement_gate_unavailable_total", { target: "START" });
      // warn, not error: the persisted log keeps ERROR rows, and this fires on every start until the
      // migration lands — the counter is the alarm, the line is the explanation.
      logger.warn("requirement_gate_unavailable", { bookingId, target: "START", reason: "booking_requirement_states missing — migration 20260924150000 not applied" });
      return null;
    }
    const b = await this.loadBooking(tx, bookingId);
    if (!b) return null;
    await this.ensureMaterialized(tx, b);
    const rows = await listRequirementStates(tx, bookingId, { lock: true });
    const gate = this.evaluate("START", b, rows);
    if (!gate.ok) {
      const ctx = getEventContext();
      incCounter("start_blocked_by_requirement_total");
      logger.warn("start_blocked_by_requirement", {
        category: "APPLICATION", bookingId, requestId: ctx.requestId, traceId: ctx.traceId,
        blocking: gate.blocking.map((x) => ({ code: x.code, point: x.enforcementPoint, state: x.state, reason: x.reason })),
      });
      throw new RequirementGateError(gate);
    }
    return gate;
  }

  /**
   * Evaluated when arrival is recorded (never blocks the fact — see lib/requirement-gates). Tells
   * both parties what is blocking START, once, through the one publisher.
   */
  async evaluateAtArrival(bookingId: string): Promise<GateResult | null> {
    if (!(await requirementStateTablesPresent())) {
      incCounter("requirement_gate_unavailable_total", { target: "ARRIVAL" });
      return null;
    }
    const b = await this.loadBooking(prisma, bookingId);
    if (!b) return null;
    const rows = await this.ensureMaterialized(prisma, b);
    const arrival = this.evaluate("ARRIVAL", b, rows);
    const start = this.evaluate("START", b, rows);
    if (!start.ok) {
      incCounter("arrival_blocked_by_requirement_total");
      const ctx = getEventContext();
      logger.info("arrival_blocked_by_requirement", { bookingId, requestId: ctx.requestId, traceId: ctx.traceId, blocking: start.blocking.map((x) => x.code) });
      publishBookingRequirementBackground({ bookingId, userId: b.userId, providerUserId: b.provider?.userId ?? null, event: "execution.blocked", gate: start });
    }
    return arrival;
  }

  /* ---------------------------------------------------------------- */
  /* Views                                                             */
  /* ---------------------------------------------------------------- */

  async viewFor(bookingId: string, audience: { role: "CUSTOMER"; userId: string } | { role: "PARTNER"; providerId: string } | { role: "ADMIN" }): Promise<BookingRequirementsView | { error: "NOT_FOUND" }> {
    const b = await this.loadBooking(prisma, bookingId);
    if (!b) return { error: "NOT_FOUND" };
    if (audience.role === "CUSTOMER" && b.userId !== audience.userId) return { error: "NOT_FOUND" };
    if (audience.role === "PARTNER" && b.providerId !== audience.providerId) return { error: "NOT_FOUND" };
    const snap = this.snapshotItems(b);
    if (!(await requirementStateTablesPresent())) {
      const empty: GateResult = { target: "START", ok: true, evaluated: 0, blocking: [] };
      return { enforced: false, serviceVersion: snap.serviceVersion || null, items: [], gate: { arrival: { ...empty, target: "ARRIVAL" }, start: empty } };
    }
    const rows = await this.ensureMaterialized(prisma, b);
    const arrival = this.evaluate("ARRIVAL", b, rows);
    const start = this.evaluate("START", b, rows);
    const blockingByCode = new Map(start.blocking.map((x) => [x.code, x]));
    const labels = this.labels(snap.items);
    const items: RequirementItemView[] = rows.map((r) => {
      const state = effectiveState(r, b.scheduledDate);
      const actions: RequirementItemView["actions"] = [];
      if (WORKABLE.has(b.status)) {
        if (audience.role === "PARTNER" && r.verification === "PARTNER_CHECK") actions.push("CHECK");
        if (audience.role === "CUSTOMER" && r.verification === "PARTNER_CHECK" && state === "FAILED") actions.push("READY");
        if (audience.role === "CUSTOMER" && r.verification === "CUSTOMER_ATTESTATION" && state !== "SATISFIED") actions.push("ATTEST");
        if (audience.role === "ADMIN" && state !== "UNRESOLVED") actions.push("RECHECK");
      }
      const blk = blockingByCode.get(r.code);
      return {
        code: r.code,
        label: labels[r.code] ?? r.code,
        kind: r.kind,
        enforcementPoint: (r.enforcement === "REQUIRED_AT_START" ? "AT_START" : r.enforcement === "REQUIRED_BEFORE_ARRIVAL" ? "BEFORE_ARRIVAL" : "BEFORE_BOOKING"),
        responsibility: r.responsibility,
        verification: r.verification,
        optional: r.optional,
        state,
        resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
        resolvedByRole: r.resolvedByRole,
        // Partner notes are the partner's words about the customer's home; the customer sees the label and the state, not the note.
        note: audience.role === "CUSTOMER" ? null : r.note,
        actions,
        blocking: blk ? { reason: blk.reason, remediation: blk.remediation } : null,
      };
    });
    const view: BookingRequirementsView = { enforced: true, serviceVersion: snap.serviceVersion || null, items, gate: { arrival, start } };
    if (audience.role === "ADMIN") view.audit = await listRequirementAudit(prisma, bookingId);
    return view;
  }

  /* ---------------------------------------------------------------- */
  /* Transitions                                                       */
  /* ---------------------------------------------------------------- */

  private async transition(input: {
    bookingId: string;
    code: string;
    actor: RequirementActor & { userId: string; providerId?: string | null };
    to: RequirementState;
    action: string;
    reason: string;
    evidence: { kind: "CUSTOMER_ATTESTATION" | "PARTNER_CHECK" | null; ref: string | null; lat?: number | null; lng?: number | null };
    note?: string | null;
    idempotencyKey?: string | null;
  }): Promise<{ ok: true; row: RequirementStateRow; changed: boolean; booking: BookingCtx } | { ok: false; error: string; gate?: GateResult }> {
    if (!(await requirementStateTablesPresent())) return { ok: false, error: REQUIREMENT_ERRORS.REQUIREMENT_GATE_UNAVAILABLE };
    const t0 = performance.now();
    const result = await prisma.$transaction(async (tx) => {
      const b = await this.loadBooking(tx, input.bookingId);
      if (!b) return { ok: false as const, error: REQUIREMENT_ERRORS.NOT_FOUND };
      // Ownership before anything else — an outsider learns nothing, not even that the booking exists.
      if (input.actor.role === "CUSTOMER" && b.userId !== input.actor.userId) return { ok: false as const, error: REQUIREMENT_ERRORS.NOT_FOUND };
      if (input.actor.role === "PARTNER" && (!input.actor.providerId || b.providerId !== input.actor.providerId)) return { ok: false as const, error: REQUIREMENT_ERRORS.NOT_FOUND };
      if (!WORKABLE.has(b.status)) return { ok: false as const, error: REQUIREMENT_ERRORS.INVALID_STATUS };
      await this.ensureMaterialized(tx, b);
      const row = await getRequirementState(tx, b.id, input.code, { lock: true });
      if (!row) return { ok: false as const, error: REQUIREMENT_ERRORS.REQUIREMENT_NOT_FOUND };
      const allowed = canTransitionRequirement({ row, actor: input.actor, to: input.to });
      if (!allowed.ok) return { ok: false as const, error: allowed.error };
      // Idempotent: the same actor recording the same outcome again changes nothing and audits nothing.
      const same =
        row.state === input.to &&
        (input.to === "UNRESOLVED" || (row.resolvedById === input.actor.userId && row.evidenceKind === input.evidence.kind)) &&
        (input.to === "UNRESOLVED" || !row.validForScheduledAt || row.validForScheduledAt.getTime() === b.scheduledDate.getTime());
      if (same) return { ok: true as const, row, changed: false, booking: b };
      await setBookingAuditContext(tx, {
        actorType: input.actor.role === "PARTNER" ? "partner" : input.actor.role === "ADMIN" ? "admin" : "customer",
        actorId: input.actor.userId,
        reason: input.reason,
      });
      await setRequirementAuditContext(tx, { action: input.action, idempotencyKey: input.idempotencyKey ?? null });
      const written = await transitionRequirementState(tx, {
        bookingId: b.id,
        code: input.code,
        expectedVersion: row.version,
        to: input.to,
        resolvedByRole: input.actor.role,
        resolvedById: input.actor.userId,
        evidenceKind: input.evidence.kind,
        evidenceRef: input.evidence.ref,
        evidenceLat: input.evidence.lat ?? null,
        evidenceLng: input.evidence.lng ?? null,
        note: input.note ?? null,
        // A partner check is evidence about THIS appointment; attestations are not appointment-bound.
        validForScheduledAt: input.evidence.kind === "PARTNER_CHECK" ? b.scheduledDate : null,
      });
      if (!written) return { ok: false as const, error: REQUIREMENT_ERRORS.REQUIREMENT_STATE_CONFLICT };
      return { ok: true as const, row: written, changed: true, booking: b };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    observeHist("requirement_mutation_seconds", (performance.now() - t0) / 1000, { action: input.action });
    return result;
  }

  private async afterTransition(b: BookingCtx, row: RequirementStateRow, action: string): Promise<GateResult> {
    const rows = await listRequirementStates(prisma, b.id);
    const gate = this.evaluate("START", b, rows);
    const ctx = getEventContext();
    const label = this.labels(this.snapshotItems(b).items)[row.code] ?? row.code;
    incCounter(row.state === "SATISFIED" ? "requirement_satisfied_total" : row.state === "FAILED" ? "requirement_block_total" : "requirement_recheck_total", { action });
    logger.info("requirement_state_changed", {
      category: "APPLICATION", bookingId: b.id, requirementId: row.code, action, toState: row.state,
      enforcement: row.enforcement, requestId: ctx.requestId, traceId: ctx.traceId, startGate: gate.ok ? "ok" : "blocked",
    });
    // Publish only after the authoritative mutation committed (§6.18).
    publishBookingRequirementBackground({
      bookingId: b.id, userId: b.userId, providerUserId: b.provider?.userId ?? null,
      event: row.state === "SATISFIED" ? "requirement.satisfied" : row.state === "FAILED" ? "requirement.blocked" : "requirement.updated",
      code: row.code, state: row.state, gate,
    });
    if (row.state === "FAILED" && (row.kind === "CUSTOMER_PRECONDITION" || row.responsibility === "CUSTOMER")) {
      await this.notify(b.userId, "booking_requirement_missing", `${b.id}:${row.code}`, "Something is needed before work can start",
        `Your professional could not find: ${label}. Please arrange it, then tell us it is ready so they can check again.`);
    }
    if (row.state === "UNRESOLVED" && action !== "MATERIALIZED" && b.provider?.userId) {
      await this.notify(b.provider.userId, "booking_requirement_recheck", `${b.id}:${row.code}:${row.version}`, "Please check again",
        `${label} is reported ready — check it on site and record the outcome.`);
    }
    return gate;
  }

  /** One notification per (user, type, reference): the partial unique index is the arbiter. */
  private async notify(userId: string, type: string, referenceId: string, title: string, message: string): Promise<void> {
    try {
      await notificationService.createForUser({ userId, type, title, message, referenceId, referenceType: "booking_requirement" });
      incCounter("requirement_notification_total", { type, outcome: "sent" });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        incCounter("requirement_notification_total", { type, outcome: "deduplicated" });
        return;
      }
      incCounter("requirement_notification_total", { type, outcome: "failed" });
      logger.warn("requirement_notification_failed", { userId, type, referenceId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /**
   * The assigned partner records an on-site check. Proximity is enforced exactly as arrival is:
   * a check made from across town is not a check.
   */
  async partnerCheck(input: { bookingId: string; providerId: string; userId: string; code: string; outcome: "SATISFIED" | "FAILED"; note?: string | null; latitude: number | null; longitude: number | null; idempotencyKey?: string | null }) {
    const b = await this.loadBooking(prisma, input.bookingId);
    if (!b || b.providerId !== input.providerId) return { ok: false as const, error: REQUIREMENT_ERRORS.NOT_FOUND };
    const proximity = assertJobProximity({ latitude: input.latitude, longitude: input.longitude, jobLatitude: b.address?.latitude, jobLongitude: b.address?.longitude, enforceRadius: true });
    if (!proximity.ok) {
      incCounter("partner_check_refused_total", { reason: proximity.error });
      return { ok: false as const, error: proximity.error };
    }
    const ctx = getEventContext();
    const r = await this.transition({
      bookingId: input.bookingId, code: input.code,
      actor: { role: "PARTNER", isAssignedPartner: true, userId: input.userId, providerId: input.providerId },
      to: input.outcome, action: "PARTNER_CHECK",
      reason: input.outcome === "SATISFIED" ? "partner verified on site" : `partner found missing on site${input.note ? `: ${input.note.slice(0, 200)}` : ""}`,
      evidence: { kind: "PARTNER_CHECK", ref: `partner-check:${ctx.requestId ?? "no-request"}`, lat: input.latitude, lng: input.longitude },
      note: input.note ?? null, idempotencyKey: input.idempotencyKey ?? null,
    });
    if (!r.ok) return r;
    incCounter("partner_check_required_total", { outcome: input.outcome, changed: r.changed ? "true" : "false" });
    const gate = r.changed ? await this.afterTransition(r.booking, r.row, "PARTNER_CHECK") : this.evaluate("START", r.booking, await listRequirementStates(prisma, r.booking.id));
    return { ok: true as const, row: r.row, changed: r.changed, gate };
  }

  /** The customer: attest an attestation item, or send a FAILED partner check back for re-checking. */
  async customerAction(input: { bookingId: string; userId: string; code: string; action: "READY" | "ATTEST"; note?: string | null; idempotencyKey?: string | null }) {
    const ctx = getEventContext();
    const r = await this.transition({
      bookingId: input.bookingId, code: input.code,
      actor: { role: "CUSTOMER", isOwner: true, userId: input.userId },
      to: input.action === "ATTEST" ? "SATISFIED" : "UNRESOLVED",
      action: input.action === "ATTEST" ? "CUSTOMER_ATTESTATION" : "CUSTOMER_READY",
      reason: input.action === "ATTEST" ? "customer attested" : `customer reports it is ready for re-check${input.note ? `: ${input.note.slice(0, 200)}` : ""}`,
      evidence: input.action === "ATTEST" ? { kind: "CUSTOMER_ATTESTATION", ref: `attestation:${ctx.requestId ?? "no-request"}` } : { kind: null, ref: null },
      note: input.note ?? null, idempotencyKey: input.idempotencyKey ?? null,
    });
    if (!r.ok) return r;
    const gate = r.changed ? await this.afterTransition(r.booking, r.row, input.action === "ATTEST" ? "CUSTOMER_ATTESTATION" : "CUSTOMER_READY") : this.evaluate("START", r.booking, await listRequirementStates(prisma, r.booking.id));
    return { ok: true as const, row: r.row, changed: r.changed, gate };
  }

  /** Admin: force a re-check with a reason. Never "mark satisfied" — evidence is not an admin's to invent. */
  async adminRecheck(input: { bookingId: string; adminId: string; code: string; reason: string; idempotencyKey?: string | null }) {
    const r = await this.transition({
      bookingId: input.bookingId, code: input.code,
      actor: { role: "ADMIN", userId: input.adminId },
      to: "UNRESOLVED", action: "ADMIN_RECHECK", reason: `admin requested re-check: ${input.reason.slice(0, 300)}`,
      evidence: { kind: null, ref: null }, idempotencyKey: input.idempotencyKey ?? null,
    });
    if (!r.ok) return r;
    const gate = r.changed ? await this.afterTransition(r.booking, r.row, "ADMIN_RECHECK") : this.evaluate("START", r.booking, await listRequirementStates(prisma, r.booking.id));
    return { ok: true as const, row: r.row, changed: r.changed, gate };
  }

  /**
   * Cross-domain (§6 audit): a partner check is evidence given by the partner who stood on site.
   * When support moves the job to another partner, that evidence no longer belongs to the person
   * who will do the work — every PARTNER_CHECK goes back to UNRESOLVED (attestations the customer
   * gave at booking are unaffected). Recorded as PARTNER_REASSIGNED with the admin's reason.
   */
  async resetPartnerChecksAfterReassignment(input: { bookingId: string; adminId: string; reason: string }): Promise<number> {
    if (!(await requirementStateTablesPresent())) return 0;
    const b = await this.loadBooking(prisma, input.bookingId);
    if (!b) return 0;
    let reset = 0;
    await prisma.$transaction(async (tx) => {
      await setBookingAuditContext(tx, { actorType: "admin", actorId: input.adminId, reason: `partner reassigned: ${input.reason.slice(0, 300)}` });
      await setRequirementAuditContext(tx, { action: "PARTNER_REASSIGNED" });
      const rows = await listRequirementStates(tx, b.id, { lock: true });
      for (const row of rows) {
        if (row.verification !== "PARTNER_CHECK" || row.state === "UNRESOLVED") continue;
        const written = await transitionRequirementState(tx, {
          bookingId: b.id, code: row.code, expectedVersion: row.version, to: "UNRESOLVED",
          resolvedByRole: null, resolvedById: null, evidenceKind: null, evidenceRef: null, validForScheduledAt: null,
        });
        if (written) reset += 1;
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    if (reset) {
      incCounter("requirement_recheck_total", { action: "PARTNER_REASSIGNED" });
      const rows = await listRequirementStates(prisma, b.id);
      const gate = this.evaluate("START", b, rows);
      logger.info("requirement_states_reset_on_reassignment", { bookingId: b.id, reset });
      publishBookingRequirementBackground({ bookingId: b.id, userId: b.userId, providerUserId: undefined, event: "requirement.updated", gate });
    }
    return reset;
  }

  /** For `/:id/actions`: the START gate as the job-action policy needs it. null = not deployed. */
  async startGateSummary(bookingId: string): Promise<{ ok: boolean; blocking: number; message: string } | null> {
    if (!(await requirementStateTablesPresent())) return null;
    const b = await this.loadBooking(prisma, bookingId);
    if (!b) return null;
    const rows = await this.ensureMaterialized(prisma, b);
    const gate = this.evaluate("START", b, rows);
    return { ok: gate.ok, blocking: gate.blocking.length, message: gateMessage(gate) };
  }
}

export const bookingRequirementService = new BookingRequirementService();
export { REQUIREMENT_GATE_BLOCKED, RequirementGateError, gateMessage };
