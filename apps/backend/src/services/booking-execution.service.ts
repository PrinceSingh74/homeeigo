/**
 * Phase 10 §7/§8 — the one service that reads, transitions and enforces a booking's execution steps.
 *
 * Steps come from the booking's own `execution.v1` snapshot, never the live catalogue. A partner can
 * start / complete / skip / fail / escalate a step only while the job is IN_PROGRESS; completion is
 * validated here (dependencies done, linked §6 safety requirement SATISFIED, evidence present in the
 * ONE proof system — job_evidence — for PHOTO / BEFORE_AFTER_PHOTOS, a note for NOTE). The client
 * never declares a step complete; it asks, and this decides.
 *
 * Completion of the booking (bookingService.complete) calls assertCompletionAllowed inside its
 * transaction: every mandatory step COMPLETED, nothing FAILED or ESCALATED.
 */
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter, observeHist } from "../lib/metrics";
import { getEventContext } from "../events/core/event-context";
import { setBookingAuditContext } from "../lib/booking-audit-context";
import { publishBookingRequirementBackground } from "../lib/booking-realtime";
import { hasAuthoritativeMedia } from "../lib/quality-evidence";
import { bookingSafetyService } from "./booking-safety.service";
import { effectiveState } from "../lib/requirement-gates";
import { listRequirementStates, requirementStateTablesPresent } from "../lib/booking-requirement-store";
import {
  canTransitionStep,
  effectiveStepState,
  evaluateExecutionGate,
  executionStepsFromSnapshot,
  ExecutionGateError,
  stepBlock,
  type EffectiveStepState,
  type ExecutionGate,
  type ResolvedStep,
  type StepAction,
  type StepRow,
  type StepState,
} from "../lib/service-execution";

type Db = Prisma.TransactionClient | typeof prisma;

export const EXECUTION_ERRORS = {
  NOT_FOUND: "NOT_FOUND",
  STEP_NOT_FOUND: "STEP_NOT_FOUND",
  BOOKING_NOT_IN_PROGRESS: "BOOKING_NOT_IN_PROGRESS",
  DEPENDENCY_INCOMPLETE: "DEPENDENCY_INCOMPLETE",
  SAFETY_REQUIREMENT_UNMET: "SAFETY_REQUIREMENT_UNMET",
  EVIDENCE_REQUIRED: "EVIDENCE_REQUIRED",
  REASON_REQUIRED: "REASON_REQUIRED",
  STEP_STATE_CONFLICT: "STEP_STATE_CONFLICT",
  EXECUTION_UNAVAILABLE: "EXECUTION_UNAVAILABLE",
} as const;

let tableKnown: { present: boolean; at: number } | null = null;
async function tablesPresent(db: Db = prisma): Promise<boolean> {
  if (tableKnown && (tableKnown.present || Date.now() - tableKnown.at < 60_000)) return tableKnown.present;
  const [row] = await db.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('booking_execution_steps') IS NOT NULL AS present`;
  tableKnown = { present: row?.present === true, at: Date.now() };
  return tableKnown.present;
}

type RawStep = {
  code: string; step_number: number; kind: string; is_mandatory: boolean; skip_policy: string; evidence: string; depends_on: string[];
  safety_requirement: string | null; service_version: number; state: StepState; actor_role: string | null; actor_id: string | null;
  evidence_ref: string | null; note: string | null; reason: string | null; started_at: Date | null; finished_at: Date | null; version: number;
};
const COLS = Prisma.sql`code, step_number, kind, is_mandatory, skip_policy, evidence, depends_on, safety_requirement, service_version, state,
  actor_role, actor_id, evidence_ref, note, reason, started_at, finished_at, version`;
const toRow = (r: RawStep): StepRow & { raw: RawStep } => ({
  code: r.code, stepNumber: r.step_number, mandatory: r.is_mandatory, skipPolicy: r.skip_policy, evidence: r.evidence,
  dependsOn: r.depends_on ?? [], safetyRequirement: r.safety_requirement, state: r.state, version: r.version, raw: r,
});

async function listSteps(db: Db, bookingId: string, lock = false) {
  const rows = lock
    ? await db.$queryRaw<RawStep[]>`SELECT ${COLS} FROM booking_execution_steps WHERE booking_id = ${bookingId} ORDER BY step_number FOR UPDATE`
    : await db.$queryRaw<RawStep[]>`SELECT ${COLS} FROM booking_execution_steps WHERE booking_id = ${bookingId} ORDER BY step_number`;
  return rows.map(toRow);
}

async function materialize(db: Db, bookingId: string, serviceVersion: number, steps: ResolvedStep[]): Promise<number> {
  let n = 0;
  for (const s of steps) {
    n += await db.$executeRaw`
      INSERT INTO booking_execution_steps (booking_id, code, step_number, kind, is_mandatory, skip_policy, evidence, depends_on, safety_requirement, service_version)
      VALUES (${bookingId}, ${s.code}, ${s.stepNumber}, ${s.kind}, ${s.mandatory}, ${s.skipPolicy}, ${s.evidence}, ${s.dependsOn}::text[], ${s.safetyRequirement}, ${serviceVersion})
      ON CONFLICT (booking_id, code) DO NOTHING`;
  }
  return n;
}

type BookingCtx = { id: string; userId: string; providerId: string | null; status: string; scheduledDate: Date; serviceConfigSnapshot: unknown; provider: { userId: string } | null };

async function loadBooking(db: Db, id: string): Promise<BookingCtx | null> {
  return (await db.booking.findUnique({
    where: { id },
    select: { id: true, userId: true, providerId: true, status: true, scheduledDate: true, serviceConfigSnapshot: true, provider: { select: { userId: true } } },
  })) as BookingCtx | null;
}

async function satisfiedRequirements(db: Db, b: BookingCtx): Promise<Set<string>> {
  if (!(await requirementStateTablesPresent(db))) return new Set();
  const rows = await listRequirementStates(db, b.id);
  return new Set(rows.filter((r) => effectiveState(r, b.scheduledDate) === "SATISFIED").map((r) => r.code));
}

export type ExecutionStepView = {
  code: string;
  stepNumber: number;
  title: string;
  description: string | null;
  kind: string;
  mandatory: boolean;
  skippable: boolean;
  evidence: string;
  estimatedMinutes: number | null;
  ppe: string[];
  warnings: string[];
  dependsOn: string[];
  safetyRequirement: string | null;
  state: EffectiveStepState;
  blockedBy: { reason: string; detail: string[] } | null;
  finishedAt: string | null;
  note: string | null;
  reason: string | null;
  actions: StepAction[];
};

class BookingExecutionService {
  /** Inside bookingService.create's transaction: rows are born with the booking, from its snapshot. */
  async materializeForNewBooking(tx: Prisma.TransactionClient, input: { bookingId: string; snapshot: unknown }): Promise<void> {
    const snap = executionStepsFromSnapshot(input.snapshot);
    if (!snap || !snap.steps.length) return;
    if (!(await tablesPresent(tx))) return;
    await tx.$queryRaw`SELECT set_config('homigo.execution_action', 'MATERIALIZED', true)`;
    await materialize(tx, input.bookingId, snap.serviceVersion, snap.steps);
    incCounter("execution_steps_materialized_total");
  }

  private async ensure(db: Db, b: BookingCtx) {
    const snap = executionStepsFromSnapshot(b.serviceConfigSnapshot);
    const rows = await listSteps(db, b.id);
    if (!snap || rows.length >= snap.steps.length) return { snap, rows };
    await materialize(db, b.id, snap.serviceVersion, snap.steps);
    return { snap, rows: await listSteps(db, b.id) };
  }

  /**
   * The completion gate. Called inside the COMPLETE transaction; locks the step rows so a step
   * transition landing concurrently is ordered before or after completion.
   */
  async assertCompletionAllowed(tx: Prisma.TransactionClient, bookingId: string): Promise<ExecutionGate | null> {
    if (!(await tablesPresent(tx))) {
      incCounter("execution_gate_unavailable_total");
      return null;
    }
    const b = await loadBooking(tx, bookingId);
    if (!b) return null;
    await this.ensure(tx, b);
    const rows = await listSteps(tx, bookingId, true);
    const gate = evaluateExecutionGate(rows);
    incCounter("execution_gate_evaluation_total", { result: gate.ok ? "ok" : "blocked" });
    if (!gate.ok) {
      const ctx = getEventContext();
      logger.warn("completion_blocked_by_execution", { bookingId, requestId: ctx.requestId, traceId: ctx.traceId, blocking: gate.blocking });
      throw new ExecutionGateError(gate);
    }
    return gate;
  }

  async viewFor(bookingId: string, audience: { role: "CUSTOMER"; userId: string } | { role: "PARTNER"; providerId: string } | { role: "ADMIN" }) {
    const b = await loadBooking(prisma, bookingId);
    if (!b) return { error: "NOT_FOUND" as const };
    if (audience.role === "CUSTOMER" && b.userId !== audience.userId) return { error: "NOT_FOUND" as const };
    if (audience.role === "PARTNER" && b.providerId !== audience.providerId) return { error: "NOT_FOUND" as const };
    if (!(await tablesPresent())) return { enforced: false, serviceVersion: null, steps: [] as ExecutionStepView[], gate: { ok: true, blocking: [] } as ExecutionGate };
    const { snap, rows } = await this.ensure(prisma, b);
    const byCode = new Map((snap?.steps ?? []).map((s) => [s.code, s]));
    const sat = await satisfiedRequirements(prisma, b);
    const ctx = { bookingStatus: b.status, satisfiedRequirements: sat };
    const steps: ExecutionStepView[] = rows.map((r) => {
      const def = byCode.get(r.code);
      const state = effectiveStepState(r, rows, ctx);
      const blk = r.state === "PENDING" ? stepBlock(r, rows, ctx) : null;
      const actions: StepAction[] = [];
      if (audience.role === "PARTNER" && b.status === "IN_PROGRESS") {
        for (const a of ["START", "COMPLETE", "SKIP", "FAIL", "ESCALATE"] as StepAction[]) {
          if (canTransitionStep(r, a, "PARTNER").ok && !(a === "START" && blk)) actions.push(a);
        }
      }
      if (audience.role === "ADMIN" && canTransitionStep(r, "RESET", "ADMIN").ok) actions.push("RESET");
      return {
        code: r.code, stepNumber: r.stepNumber, title: def?.title ?? r.code, description: def?.description ?? null, kind: r.raw.kind,
        mandatory: r.mandatory, skippable: !r.mandatory && r.skipPolicy === "SKIP_WITH_REASON", evidence: r.evidence,
        estimatedMinutes: def?.estimatedMinutes ?? null, ppe: def?.ppe ?? [], warnings: def?.warnings ?? [], dependsOn: r.dependsOn,
        safetyRequirement: r.safetyRequirement, state, blockedBy: blk, finishedAt: r.raw.finished_at ? r.raw.finished_at.toISOString() : null,
        // The partner's notes and reasons are operational; the customer sees titles and states only.
        note: audience.role === "CUSTOMER" ? null : r.raw.note,
        reason: audience.role === "CUSTOMER" ? null : r.raw.reason,
        actions,
      };
    });
    return { enforced: true, serviceVersion: snap?.serviceVersion ?? null, steps, gate: evaluateExecutionGate(rows) };
  }

  /**
   * One transition. Partner actions: assigned partner, booking IN_PROGRESS. RESET: admin with reason.
   * Evidence is validated here, never taken on the client's word.
   */
  async transition(input: {
    bookingId: string;
    code: string;
    action: StepAction;
    actor: { role: "PARTNER"; providerId: string; userId: string } | { role: "ADMIN"; userId: string };
    evidenceId?: string | null;
    note?: string | null;
    reason?: string | null;
    idempotencyKey?: string | null;
  }): Promise<{ ok: true; state: StepState; changed: boolean; gate: ExecutionGate } | { ok: false; error: string; detail?: string[] }> {
    if (!(await tablesPresent())) return { ok: false, error: EXECUTION_ERRORS.EXECUTION_UNAVAILABLE };
    const t0 = performance.now();
    const res = await prisma.$transaction(async (tx) => {
      const b = await loadBooking(tx, input.bookingId);
      if (!b) return { ok: false as const, error: EXECUTION_ERRORS.NOT_FOUND };
      if (input.actor.role === "PARTNER" && b.providerId !== input.actor.providerId) return { ok: false as const, error: EXECUTION_ERRORS.NOT_FOUND };
      if (input.actor.role === "PARTNER" && b.status !== "IN_PROGRESS") return { ok: false as const, error: EXECUTION_ERRORS.BOOKING_NOT_IN_PROGRESS };
      await this.ensure(tx, b);
      const rows = await listSteps(tx, b.id, true);
      const row = rows.find((r) => r.code === input.code);
      if (!row) return { ok: false as const, error: EXECUTION_ERRORS.STEP_NOT_FOUND };

      const verdict = canTransitionStep(row, input.action, input.actor.role);
      if (!verdict.ok) {
        // Idempotent replay: completing an already-completed step by the same partner is a no-op.
        const replay = (input.action === "COMPLETE" && row.state === "COMPLETED") || (input.action === "START" && row.state === "IN_PROGRESS");
        if (replay && row.raw.actor_id === input.actor.userId) return { ok: true as const, state: row.state, changed: false, rows };
        return { ok: false as const, error: verdict.error };
      }
      // §9: no step may start or finish while the booking is on safety hold.
      if (input.actor.role === "PARTNER" && (input.action === "START" || input.action === "COMPLETE")) {
        await bookingSafetyService.assertSafe(tx, b.id, "STEP");
      }
      if (input.action === "START") {
        const blk = stepBlock(row, rows, { bookingStatus: b.status, satisfiedRequirements: await satisfiedRequirements(tx, b) });
        if (blk) return { ok: false as const, error: blk.reason, detail: blk.detail };
      }
      const reason = (input.reason ?? "").trim();
      if (["SKIP", "FAIL", "ESCALATE", "RESET"].includes(input.action) && reason.length < 3) return { ok: false as const, error: EXECUTION_ERRORS.REASON_REQUIRED };

      let evidenceRef: string | null = row.raw.evidence_ref;
      if (input.action === "COMPLETE") {
        const need = row.evidence;
        if (need === "NOTE" && !(input.note ?? "").trim()) return { ok: false as const, error: EXECUTION_ERRORS.EVIDENCE_REQUIRED, detail: ["NOTE"] };
        if (need === "PHOTO" || need === "BEFORE_AFTER_PHOTOS") {
          const ev = await tx.jobEvidence.findMany({
            where: { bookingId: b.id, ...(input.evidenceId ? { id: input.evidenceId } : {}) },
            select: { id: true, stage: true, mediaUrl: true, mediaStorageKey: true },
          });
          const real = ev.filter((e) => hasAuthoritativeMedia(e));
          if (need === "PHOTO" && (!input.evidenceId || real.length === 0)) return { ok: false as const, error: EXECUTION_ERRORS.EVIDENCE_REQUIRED, detail: ["PHOTO"] };
          if (need === "BEFORE_AFTER_PHOTOS") {
            const all = input.evidenceId ? (await tx.jobEvidence.findMany({ where: { bookingId: b.id }, select: { id: true, stage: true, mediaUrl: true, mediaStorageKey: true } })).filter((e) => hasAuthoritativeMedia(e)) : real;
            const before = all.some((e) => e.stage === "ARRIVAL" || e.stage === "START");
            const after = all.some((e) => e.stage === "COMPLETION");
            if (!before || !after) return { ok: false as const, error: EXECUTION_ERRORS.EVIDENCE_REQUIRED, detail: [before ? "" : "BEFORE", after ? "" : "AFTER"].filter(Boolean) };
          }
          evidenceRef = input.evidenceId ?? real[0]?.id ?? null;
        }
      }

      await setBookingAuditContext(tx, {
        actorType: input.actor.role === "PARTNER" ? "partner" : "admin",
        actorId: input.actor.userId,
        reason: reason || `step ${input.action.toLowerCase()}`,
      });
      await tx.$queryRaw`SELECT set_config('homigo.execution_action', ${input.action}, true), set_config('homigo.idempotency_key', ${input.idempotencyKey ?? ""}, true)`;
      const to = verdict.to;
      const finished = to === "COMPLETED" || to === "SKIPPED_WITH_REASON" || to === "FAILED" || to === "ESCALATED";
      const updated = await tx.$executeRaw`
        UPDATE booking_execution_steps SET
          state = ${to},
          actor_role = ${to === "PENDING" ? null : input.actor.role},
          actor_id = ${to === "PENDING" ? null : input.actor.userId},
          evidence_ref = ${to === "PENDING" ? null : evidenceRef},
          note = ${input.action === "COMPLETE" ? (input.note ?? null) : to === "PENDING" ? null : row.raw.note},
          reason = ${reason || null},
          started_at = ${to === "IN_PROGRESS" ? new Date() : to === "PENDING" ? null : row.raw.started_at},
          finished_at = ${finished ? new Date() : null},
          version = version + 1
        WHERE booking_id = ${b.id} AND code = ${row.code} AND version = ${row.version}`;
      if (updated !== 1) return { ok: false as const, error: EXECUTION_ERRORS.STEP_STATE_CONFLICT };
      return { ok: true as const, state: to, changed: true, rows: await listSteps(tx, b.id) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    observeHist("execution_step_mutation_seconds", (performance.now() - t0) / 1000, { action: input.action });
    if (!res.ok) {
      incCounter("execution_step_refused_total", { action: input.action, reason: res.error });
      return res;
    }
    const gate = evaluateExecutionGate(res.rows);
    if (res.changed) {
      incCounter("execution_step_transition_total", { action: input.action, to: res.state });
      const b = await loadBooking(prisma, input.bookingId);
      const ctx = getEventContext();
      logger.info("execution_step_changed", { bookingId: input.bookingId, step: input.code, action: input.action, toState: res.state, requestId: ctx.requestId, traceId: ctx.traceId });
      // Same publisher and frame family as requirements; clients refetch the execution view.
      if (b) {
        publishBookingRequirementBackground({
          bookingId: b.id, userId: b.userId, providerUserId: b.provider?.userId ?? null,
          event: "requirement.updated", code: `step:${input.code}`, state: res.state,
          gate: { ok: gate.ok, blocking: gate.blocking.map((x) => ({ code: `step:${x.code}`, label: x.code, enforcementPoint: "COMPLETION", reason: x.reason })) },
        });
      }
    }
    return { ok: true, state: res.state, changed: res.changed, gate };
  }

  async auditFor(bookingId: string) {
    if (!(await tablesPresent())) return [];
    return prisma.$queryRaw<Array<{ id: bigint; code: string; action: string; from_state: string | null; to_state: string; actor_type: string | null; actor_id: string | null; reason: string | null; request_id: string | null; trace_id: string | null; evidence_ref: string | null; changed_at: Date }>>`
      SELECT id, code, action, from_state, to_state, actor_type, actor_id, reason, request_id, trace_id, evidence_ref, changed_at
      FROM booking_execution_audit WHERE booking_id = ${bookingId} ORDER BY id`.then((r) => r.map((x) => ({ ...x, id: Number(x.id) })));
  }
}

export const bookingExecutionService = new BookingExecutionService();
export { ExecutionGateError };
