/**
 * Phase 10 §10 — the one service that derives, records and overrides a booking's quality verdict.
 *
 * Verdicts live in booking_quality_verdicts (append-only, trigger-enforced). Every evaluation is a new
 * row with the next per-booking sequence; an admin override is a new row that names the verdict it
 * supersedes and carries a reason. Nothing is ever edited.
 *
 * The derivation reads durable facts only (src/lib/quality-verdict.ts): frozen quality policy, job
 * evidence rows, execution-step rows (steps of the frozen plan that were never materialised count as
 * PENDING), active safety holds and open safety incidents. An admin override to a blocking verdict on
 * an IN_PROGRESS booking stays in force (reason ADMIN_OVERRIDE) until an admin supersedes it.
 *
 * Without the table (migration not applied) every entry point degrades to "not deployed" and the
 * completion path behaves exactly as before.
 */
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { getEventContext } from "../events/core/event-context";
import { setBookingAuditContext } from "../lib/booking-audit-context";
import { publishBookingRequirementBackground } from "../lib/booking-realtime";
import { resolveQualityEvidence, hasAuthoritativeMedia } from "../lib/quality-evidence";
import { qualityFromSnapshot } from "../lib/service-runtime-policy";
import { warrantyFromLegacyBookingSnapshot } from "../lib/service-warranty";
import { evaluateExecutionGate, executionStepsFromSnapshot, type StepRow, type StepState } from "../lib/service-execution";
import { evaluateSafetyGate, OPEN_INCIDENT_STATES, type SafetyHoldRow } from "../lib/service-safety";
import {
  customerVerdictView,
  deriveQualityVerdict,
  isQualityVerdict,
  QUALITY_POLICY_VERSION,
  verdictAllowsCompletion,
  worstVerdict,
  type DerivedVerdict,
  type QualityReasonCode,
  type QualityVerdict,
} from "../lib/quality-verdict";

type Db = Prisma.TransactionClient | typeof prisma;

const presence = new Map<string, { present: boolean; at: number }>();
/** Cached `to_regclass` probe (a missing table is re-checked every 60 s; a present one is final). */
export async function tablePresent(name: string, db: Db = prisma): Promise<boolean> {
  const k = presence.get(name);
  if (k && (k.present || Date.now() - k.at < 60_000)) return k.present;
  const [row] = await db.$queryRaw<{ present: boolean }[]>`SELECT to_regclass(${name}) IS NOT NULL AS present`;
  presence.set(name, { present: row?.present === true, at: Date.now() });
  return row?.present === true;
}

export const qualityVerdictTablesPresent = (db: Db = prisma) => tablePresent("booking_quality_verdicts", db);

export const QUALITY_ERRORS = {
  NOT_FOUND: "NOT_FOUND",
  INVALID_STATUS: "INVALID_STATUS",
  INVALID_VERDICT: "INVALID_VERDICT",
  REASON_REQUIRED: "REASON_REQUIRED",
  NOTHING_TO_SUPERSEDE: "NOTHING_TO_SUPERSEDE",
  QUALITY_UNAVAILABLE: "QUALITY_UNAVAILABLE",
} as const;

/** Who asked for the evaluation. Derived verdicts are PARTNER (partner completion) or SYSTEM (anything else, incl. admin mark-complete). */
export type VerdictActor = { type: "PARTNER" | "SYSTEM"; id: string | null };

type RawVerdict = {
  id: bigint; booking_id: string; sequence: number; verdict: QualityVerdict; reason_codes: string[]; evidence: unknown;
  actor_type: string; actor_id: string | null; reason: string | null; policy_version: string; service_config_version: number | null;
  booking_status: string; supersedes_id: bigint | null; request_id: string | null; trace_id: string | null; created_at: Date;
};

export type VerdictRecord = {
  id: number; sequence: number; verdict: QualityVerdict; reasonCodes: string[]; evidence: unknown; actorType: string; actorId: string | null;
  reason: string | null; policyVersion: string; serviceConfigVersion: number | null; bookingStatus: string; supersedesId: number | null;
  requestId: string | null; traceId: string | null; createdAt: Date;
};

const toRecord = (r: RawVerdict): VerdictRecord => ({
  id: Number(r.id), sequence: r.sequence, verdict: r.verdict, reasonCodes: r.reason_codes ?? [], evidence: r.evidence, actorType: r.actor_type,
  actorId: r.actor_id, reason: r.reason, policyVersion: r.policy_version, serviceConfigVersion: r.service_config_version, bookingStatus: r.booking_status,
  supersedesId: r.supersedes_id == null ? null : Number(r.supersedes_id), requestId: r.request_id, traceId: r.trace_id, createdAt: r.created_at,
});

const VCOLS = Prisma.sql`id, booking_id, sequence, verdict, reason_codes, evidence, actor_type, actor_id, reason, policy_version, service_config_version,
  booking_status, supersedes_id, request_id, trace_id, created_at`;

export async function verdictHistory(db: Db, bookingId: string): Promise<VerdictRecord[]> {
  if (!(await qualityVerdictTablesPresent(db))) return [];
  const rows = await db.$queryRaw<RawVerdict[]>`SELECT ${VCOLS} FROM booking_quality_verdicts WHERE booking_id = ${bookingId} ORDER BY sequence`;
  return rows.map(toRecord);
}

export async function latestVerdict(db: Db, bookingId: string): Promise<VerdictRecord | null> {
  if (!(await qualityVerdictTablesPresent(db))) return null;
  const [row] = await db.$queryRaw<RawVerdict[]>`SELECT ${VCOLS} FROM booking_quality_verdicts WHERE booking_id = ${bookingId} ORDER BY sequence DESC LIMIT 1`;
  return row ? toRecord(row) : null;
}

type BookingFacts = { id: string; userId: string; providerId: string | null; status: string; serviceConfigSnapshot: unknown; provider: { userId: string } | null };

async function loadBooking(db: Db, bookingId: string): Promise<BookingFacts | null> {
  return (await db.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, userId: true, providerId: true, status: true, serviceConfigSnapshot: true, provider: { select: { userId: true } } },
  })) as BookingFacts | null;
}

/** Serialises verdict sequencing (and completion) per booking. NO KEY UPDATE so FK inserts elsewhere are not blocked. */
export async function lockBookingRow(tx: Prisma.TransactionClient, bookingId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId} FOR NO KEY UPDATE`;
}

function snapshotVersion(snap: unknown): number | null {
  const v = snap && typeof snap === "object" ? (snap as { version?: unknown }).version : null;
  return typeof v === "number" ? v : null;
}

/** What the partner submitted with a completion attempt. Matched against the frozen policy, never trusted as proof. */
export type CompletionSubmission = { completedChecklist?: readonly string[]; professionalConfirmed?: boolean };

/** The facts the derivation needs, read from durable rows. */
async function gatherFacts(db: Db, b: BookingFacts, opts: CompletionSubmission) {
  const quality = qualityFromSnapshot(b.serviceConfigSnapshot);
  const evidenceRows = await db.jobEvidence.findMany({
    where: { bookingId: b.id, isCurrent: true },
    select: { id: true, stage: true, mediaUrl: true, mediaStorageKey: true },
  });
  const evidenceIds = evidenceRows.filter(hasAuthoritativeMedia).map((r) => r.id);
  const evidence = quality
    ? {
        ...resolveQualityEvidence({ checklist: quality.checklist, submitted: opts.completedChecklist, evidenceRows }),
        evidenceIds,
        professionalConfirmed: opts.professionalConfirmed === true,
      }
    : { photos: evidenceIds.length, hasBefore: false, hasAfter: false, checklistComplete: true, missingChecklistItems: [], evidenceIds };

  // Steps: the frozen plan, overlaid with stored state. A step the plan names but no row holds is PENDING.
  const plan = executionStepsFromSnapshot(b.serviceConfigSnapshot)?.steps ?? [];
  const stored = (await tablePresent("booking_execution_steps", db))
    ? await db.$queryRaw<Array<{ code: string; step_number: number; is_mandatory: boolean; skip_policy: string; evidence: string; depends_on: string[]; safety_requirement: string | null; state: StepState; version: number }>>`
        SELECT code, step_number, is_mandatory, skip_policy, evidence, depends_on, safety_requirement, state, version FROM booking_execution_steps WHERE booking_id = ${b.id} ORDER BY step_number`
    : [];
  const byCode = new Map(stored.map((s) => [s.code, s]));
  const rows: StepRow[] = plan.map((p) => {
    const s = byCode.get(p.code);
    return {
      code: p.code, stepNumber: s?.step_number ?? p.stepNumber, mandatory: s?.is_mandatory ?? p.mandatory, skipPolicy: s?.skip_policy ?? p.skipPolicy,
      evidence: s?.evidence ?? p.evidence, dependsOn: s?.depends_on ?? p.dependsOn, safetyRequirement: s?.safety_requirement ?? p.safetyRequirement,
      state: s?.state ?? "PENDING", version: s?.version ?? 0,
    };
  });
  for (const s of stored) {
    if (!plan.some((p) => p.code === s.code)) {
      rows.push({ code: s.code, stepNumber: s.step_number, mandatory: s.is_mandatory, skipPolicy: s.skip_policy, evidence: s.evidence, dependsOn: s.depends_on ?? [], safetyRequirement: s.safety_requirement, state: s.state, version: s.version });
    }
  }

  const holds: SafetyHoldRow[] = (await tablePresent("booking_safety_holds", db))
    ? (await db.$queryRaw<Array<{ id: bigint; condition: string; source: string; state: "ACTIVE" | "RELEASED"; incident_id: string | null }>>`
        SELECT id, condition, source, state, incident_id FROM booking_safety_holds WHERE booking_id = ${b.id} AND state = 'ACTIVE' ORDER BY id`)
        .map((h) => ({ id: Number(h.id), condition: h.condition, source: h.source, state: h.state, incidentId: h.incident_id }))
    : [];
  const incidents = (await db.partnerSafetyIncident.findMany({
    where: { bookingId: b.id, status: { in: [...OPEN_INCIDENT_STATES] } },
    select: { id: true, type: true, status: true },
  })).map((r) => ({ id: r.id, type: String(r.type), status: String(r.status) }));

  return {
    quality,
    evidence,
    executionSteps: rows.map((r) => ({ code: r.code, mandatory: r.mandatory, state: r.state })),
    executionGate: rows.length ? evaluateExecutionGate(rows) : null,
    safetyGate: evaluateSafetyGate(holds, incidents),
    openIncidents: incidents,
  };
}

/** An admin override to a blocking verdict on a job still in progress stays in force until an admin supersedes it. */
async function blockingOverride(db: Db, bookingId: string): Promise<VerdictRecord | null> {
  const [row] = await db.$queryRaw<RawVerdict[]>`SELECT ${VCOLS} FROM booking_quality_verdicts WHERE booking_id = ${bookingId} AND actor_type = 'ADMIN' ORDER BY sequence DESC LIMIT 1`;
  if (!row) return null;
  return verdictAllowsCompletion(row.verdict) ? null : toRecord(row);
}

export async function deriveFor(db: Db, b: BookingFacts, opts: CompletionSubmission = {}): Promise<DerivedVerdict> {
  const f = await gatherFacts(db, b, opts);
  const derived = deriveQualityVerdict({
    qualityPolicy: f.quality, evidence: f.evidence, executionSteps: f.executionSteps, executionGate: f.executionGate,
    safetyGate: f.safetyGate, openIncidents: f.openIncidents,
  });
  if (b.status === "IN_PROGRESS" && (await qualityVerdictTablesPresent(db))) {
    const override = await blockingOverride(db, b.id);
    if (override) {
      return {
        ...derived,
        verdict: worstVerdict(derived.verdict, override.verdict),
        reasonCodes: ["ADMIN_OVERRIDE", ...derived.reasonCodes.filter((c) => c !== "NO_QUALITY_POLICY")] as QualityReasonCode[],
      };
    }
  }
  return derived;
}

async function insertVerdict(
  tx: Prisma.TransactionClient,
  b: BookingFacts,
  v: { verdict: QualityVerdict; reasonCodes: string[]; evidence: unknown; actorType: "PARTNER" | "SYSTEM" | "ADMIN"; actorId: string | null; reason?: string | null; supersedesId?: number | null },
): Promise<VerdictRecord> {
  const [{ next }] = await tx.$queryRaw<{ next: number }[]>`SELECT (COALESCE(MAX(sequence), 0) + 1)::int AS next FROM booking_quality_verdicts WHERE booking_id = ${b.id}`;
  const ctx = getEventContext();
  const [row] = await tx.$queryRaw<RawVerdict[]>`
    INSERT INTO booking_quality_verdicts (booking_id, sequence, verdict, reason_codes, evidence, actor_type, actor_id, reason, policy_version,
      service_config_version, booking_status, supersedes_id, request_id, trace_id)
    VALUES (${b.id}, ${next}, ${v.verdict}, ${v.reasonCodes}::text[], ${JSON.stringify(v.evidence ?? {})}::jsonb, ${v.actorType}, ${v.actorId},
      ${v.reason ?? null}, ${QUALITY_POLICY_VERSION}, ${snapshotVersion(b.serviceConfigSnapshot)}, ${b.status}, ${v.supersedesId ?? null},
      ${ctx.requestId ?? null}, ${ctx.traceId ?? null})
    RETURNING ${VCOLS}`;
  incCounter("quality_verdict_total", { verdict: v.verdict });
  return toRecord(row);
}

function publishVerdict(b: BookingFacts, v: { verdict: QualityVerdict; reasonCodes: string[] }) {
  publishBookingRequirementBackground({
    bookingId: b.id, userId: b.userId, providerUserId: b.provider?.userId ?? null,
    event: "quality.verdict", code: "quality", state: v.verdict,
    gate: {
      ok: verdictAllowsCompletion(v.verdict),
      blocking: verdictAllowsCompletion(v.verdict) ? [] : v.reasonCodes.map((c) => ({ code: `quality:${c}`, label: c, enforcementPoint: "COMPLETION", reason: v.verdict })),
    },
  });
}

class BookingQualityService {
  enabled(db: Db = prisma) {
    return qualityVerdictTablesPresent(db);
  }

  /**
   * Inside the caller's transaction: lock the booking, derive the verdict from durable facts, append it
   * with the next sequence and return it. Returns null when verdicts are not deployed.
   */
  async evaluateAndRecord(
    tx: Prisma.TransactionClient,
    bookingId: string,
    actor: VerdictActor,
    opts: CompletionSubmission = {},
  ): Promise<VerdictRecord | null> {
    if (!(await qualityVerdictTablesPresent(tx))) return null;
    await lockBookingRow(tx, bookingId);
    const b = await loadBooking(tx, bookingId);
    if (!b) return null;
    const d = await deriveFor(tx, b, opts);
    return insertVerdict(tx, b, { verdict: d.verdict, reasonCodes: d.reasonCodes, evidence: d.evidenceRefs, actorType: actor.type, actorId: actor.id });
  }

  /**
   * A completion attempt was refused (quality pre-check, safety gate, execution gate or verdict). The
   * refusing transaction rolled back, so the verdict is recorded here in its own short transaction and
   * committed — the refusal leaves a durable record even though the booking stays IN_PROGRESS.
   */
  async recordRefusal(bookingId: string, actor: VerdictActor, opts: CompletionSubmission = {}): Promise<VerdictRecord | null> {
    if (!(await qualityVerdictTablesPresent())) return null;
    const res = await prisma.$transaction(async (tx) => {
      await setBookingAuditContext(tx, { actorType: actor.type === "PARTNER" ? "partner" : "system", actorId: actor.id, reason: "completion refused: quality verdict" });
      await lockBookingRow(tx, bookingId);
      const b = await loadBooking(tx, bookingId);
      if (!b || b.status !== "IN_PROGRESS") return null;
      const d = await deriveFor(tx, b, opts);
      const v = await insertVerdict(tx, b, { verdict: d.verdict, reasonCodes: d.reasonCodes, evidence: d.evidenceRefs, actorType: actor.type, actorId: actor.id });
      return { b, v };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    if (!res) return null;
    const ctx = getEventContext();
    logger.warn("quality_verdict_recorded_on_refusal", { bookingId, verdict: res.v.verdict, reasonCodes: res.v.reasonCodes, requestId: ctx.requestId, traceId: ctx.traceId });
    publishVerdict(res.b, res.v);
    return res.v;
  }

  /**
   * An administrator records a verdict that supersedes the latest one, with a reason (≥ 3 characters,
   * also enforced by the table). Only on a booking being worked on or already completed. On an
   * IN_PROGRESS booking a blocking override stops completion until superseded; on a COMPLETED booking
   * it is a record (the canonical status does not move).
   */
  async adminOverride(bookingId: string, adminUserId: string, input: { verdict: string; reason: string }) {
    if (!(await qualityVerdictTablesPresent())) return { ok: false as const, error: QUALITY_ERRORS.QUALITY_UNAVAILABLE };
    const reason = (input.reason ?? "").trim();
    if (reason.length < 3) return { ok: false as const, error: QUALITY_ERRORS.REASON_REQUIRED };
    if (!isQualityVerdict(input.verdict)) return { ok: false as const, error: QUALITY_ERRORS.INVALID_VERDICT };
    const verdict = input.verdict;
    const r = await prisma.$transaction(async (tx) => {
      await setBookingAuditContext(tx, { actorType: "admin", actorId: adminUserId, reason: `quality override: ${reason}` });
      await lockBookingRow(tx, bookingId);
      const b = await loadBooking(tx, bookingId);
      if (!b) return { ok: false as const, error: QUALITY_ERRORS.NOT_FOUND };
      if (b.status !== "IN_PROGRESS" && b.status !== "COMPLETED") return { ok: false as const, error: QUALITY_ERRORS.INVALID_STATUS };
      const latest = await latestVerdict(tx, b.id);
      if (!latest) return { ok: false as const, error: QUALITY_ERRORS.NOTHING_TO_SUPERSEDE };
      const v = await insertVerdict(tx, b, {
        verdict, reasonCodes: ["ADMIN_OVERRIDE"], evidence: { supersedes: { id: latest.id, verdict: latest.verdict, reasonCodes: latest.reasonCodes } },
        actorType: "ADMIN", actorId: adminUserId, reason, supersedesId: latest.id,
      });
      return { ok: true as const, b, v, previous: latest };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    if (!r.ok) return r;
    incCounter("quality_verdict_override_total", { verdict });
    const ctx = getEventContext();
    logger.warn("quality_verdict_overridden", { bookingId, verdict, supersedesId: r.previous.id, previousVerdict: r.previous.verdict, adminId: adminUserId, requestId: ctx.requestId, traceId: ctx.traceId });
    publishVerdict(r.b, r.v);
    return { ok: true as const, verdict: r.v, supersedes: { id: r.previous.id, verdict: r.previous.verdict } };
  }

  /**
   * Customer: the latest verdict in plain words (never evidence ids, step codes, partner notes or who
   * overrode it). Partner: its own booking's verdicts with reason codes and what was missing. Admin:
   * full history.
   */
  async viewFor(bookingId: string, audience: { role: "CUSTOMER"; userId: string } | { role: "PARTNER"; providerId: string } | { role: "ADMIN" }) {
    const b = await loadBooking(prisma, bookingId);
    if (!b) return { error: "NOT_FOUND" as const };
    if (audience.role === "CUSTOMER" && b.userId !== audience.userId) return { error: "NOT_FOUND" as const };
    if (audience.role === "PARTNER" && b.providerId !== audience.providerId) return { error: "NOT_FOUND" as const };
    const enforced = await qualityVerdictTablesPresent();
    const history = enforced ? await verdictHistory(prisma, bookingId) : [];
    const latest = history[history.length - 1] ?? null;
    if (audience.role === "CUSTOMER") {
      return { enforced, latest: latest ? customerVerdictView(latest) : null };
    }
    if (audience.role === "PARTNER") {
      return {
        enforced,
        latest: latest ? { verdict: latest.verdict, reasonCodes: latest.reasonCodes, at: latest.createdAt.toISOString() } : null,
        history: history.map((v) => ({
          sequence: v.sequence, verdict: v.verdict, reasonCodes: v.reasonCodes, byAdmin: v.actorType === "ADMIN", at: v.createdAt.toISOString(),
          missingChecklistItems: ((v.evidence as { missingChecklistItems?: string[] } | null)?.missingChecklistItems) ?? [],
        })),
      };
    }
    return {
      enforced,
      latest: latest ? { ...latest, createdAt: latest.createdAt.toISOString() } : null,
      history: history.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
      /**
       * The rules THIS booking froze, so whoever overrides a verdict or decides a complaint reads the
       * policy that actually bound the job — not today's catalogue. Null where the booking froze none.
       */
      policy: {
        quality: qualityFromSnapshot(b.serviceConfigSnapshot),
        warranty: warrantyFromLegacyBookingSnapshot(b.serviceConfigSnapshot),
      },
    };
  }
}

export const bookingQualityService = new BookingQualityService();
