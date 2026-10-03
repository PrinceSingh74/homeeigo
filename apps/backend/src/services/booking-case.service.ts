/**
 * Phase 10 §11 — complaint / warranty-claim cases, and the rework / revisit / refund they lead to.
 *
 * One service owns the case lifecycle:
 *   open      a customer reports an issue with a COMPLETED booking inside its complaint window. The
 *             frozen warranty (booking_warranties row, else the booking's own snapshot) decides
 *             whether it is a WARRANTY_CLAIM or a COMPLAINT and what it may lead to. One open case per
 *             booking (open_key unique while open) — a second report returns the same case.
 *   transition / resolve   admin decisions, CAS on the case version, an explicit transition map.
 *   REFUND    through the existing refund path with a CASE-scoped idempotency key, capped by what is
 *             still refundable — a case can never be compensated twice.
 *   REWORK / INSPECTION    a follow-up booking (REWORK / REVISIT) linked to the parent and the case,
 *             created once per case (bookings.case_id unique), executed under the parent's frozen plan.
 *
 * The original booking is never mutated (status, snapshot, amounts). Support tickets are untouched —
 * a case may carry a ticket id in its evidence notes. New tables are raw SQL behind a to_regclass
 * probe: on a database without the migration this degrades to CASES_UNAVAILABLE.
 */
import { Prisma } from "@prisma/client";
import crypto from "crypto";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { getEventContext } from "../events/core/event-context";
import { setBookingAuditContext } from "../lib/booking-audit-context";
import { nextBookingNumber } from "../lib/booking-number";
import { rupeesToPaise } from "../lib/money-paise";
import { eventPlatformConfig } from "../events/core/config";
import { emitInTransaction } from "../events/core/event-publisher";
import { buildBookingCreatedEvent } from "../events/catalog/booking.events";
import { buildBookingCaseOpenedEvent, buildBookingCaseResolvedEvent } from "../events/catalog/booking-case.events";
import {
  CASE_CATEGORIES,
  evaluateWarrantyEligibility,
  warrantyFromLegacyBookingSnapshot,
  type CaseCategory,
  type WarrantyEligibility,
  type WarrantyRowState,
  type WarrantySnapshot,
} from "../lib/service-warranty";
import {
  actionAllowed,
  canTransition,
  CASE_TRIAGE_SLA_HOURS,
  caseTypeFor,
  evidenceShapeError,
  evidenceVisibleTo,
  followUpFeeDecision,
  followUpKindFor,
  isProof,
  isTerminalCaseState,
  RESOLVABLE_FROM,
  reworkPolicyFrom,
  reworkWindowOpen,
  terminalStateFor,
  type Audience,
  type EvidenceInput,
  type ResolveAction,
} from "../lib/booking-case-policy";
import { bookingRefundService } from "./booking-refund.service";
import { bookingValidationService } from "./booking-validation.service";
import { partnerOperationsService } from "./partner-operations.service";
import { bookingExecutionService } from "./booking-execution.service";
import { bookingRequirementService } from "./booking-requirement.service";
import { bookingPriorityService } from "./booking-priority.service";
import { assignmentEngine } from "./assignment-engine.service";
import { bookingCompletionService } from "./booking-completion.service";

type Db = Prisma.TransactionClient | typeof prisma;

let known: { present: boolean; at: number } | null = null;
async function tablesPresent(db: Db = prisma): Promise<boolean> {
  if (known && (known.present || Date.now() - known.at < 60_000)) return known.present;
  const [row] = await db.$queryRaw<{ present: boolean }[]>`SELECT to_regclass('booking_cases') IS NOT NULL AS present`;
  known = { present: row?.present === true, at: Date.now() };
  return known.present;
}

export const CASE_ERRORS = {
  NOT_FOUND: "NOT_FOUND",
  CASE_NOT_FOUND: "CASE_NOT_FOUND",
  CASES_UNAVAILABLE: "CASES_UNAVAILABLE",
  BOOKING_NOT_COMPLETED: "BOOKING_NOT_COMPLETED",
  COMPLAINT_WINDOW_CLOSED: "COMPLAINT_WINDOW_CLOSED",
  COMPLAINT_WINDOW_NOT_CONFIGURED: "COMPLAINT_WINDOW_NOT_CONFIGURED",
  INVALID_CATEGORY: "INVALID_CATEGORY",
  EVIDENCE_INVALID: "EVIDENCE_INVALID",
  EVIDENCE_LIMIT: "EVIDENCE_LIMIT",
  CASE_CLOSED: "CASE_CLOSED",
  CASE_VERSION_CONFLICT: "CASE_VERSION_CONFLICT",
  CASE_TRANSITION_FORBIDDEN: "CASE_TRANSITION_FORBIDDEN",
  CASE_NOT_TRIAGED: "CASE_NOT_TRIAGED",
  ACTION_NOT_ALLOWED: "ACTION_NOT_ALLOWED",
  REASON_REQUIRED: "REASON_REQUIRED",
  SCHEDULE_INVALID: "SCHEDULE_INVALID",
  SLOT_UNAVAILABLE: "SLOT_UNAVAILABLE",
  REWORK_FEE_NOT_CONFIGURED: "REWORK_FEE_NOT_CONFIGURED",
  OWNER_APPROVAL_REQUIRED: "OWNER_APPROVAL_REQUIRED",
  REWORK_WINDOW_CLOSED: "REWORK_WINDOW_CLOSED",
  REFUND_AMOUNT_INVALID: "REFUND_AMOUNT_INVALID",
  REFUND_EXCEEDS_REFUNDABLE: "REFUND_EXCEEDS_REFUNDABLE",
  NO_REFUNDABLE_PAYMENT: "NO_REFUNDABLE_PAYMENT",
  REFUND_IN_PROGRESS: "REFUND_IN_PROGRESS",
  REFUND_FAILED: "REFUND_FAILED",
  CASE_ALREADY_REFUNDED: "CASE_ALREADY_REFUNDED",
} as const;
export type CaseError = (typeof CASE_ERRORS)[keyof typeof CASE_ERRORS];
type Fail = { ok: false; error: CaseError; data?: Record<string, unknown> };
const fail = (error: CaseError, data?: Record<string, unknown>): Fail => ({ ok: false, error, data });

const MAX_EVIDENCE_PER_CASE = 20;
/** A REFUND attempt younger than this is assumed to still be running; an older one may be re-driven (same key). */
const REFUND_REDRIVE_AFTER_MS = 2 * 60_000;

type CaseRow = {
  id: string;
  case_number: string;
  booking_id: string;
  customer_id: string;
  provider_id: string | null;
  type: string;
  category: string;
  state: string;
  description: string | null;
  eligibility: Record<string, unknown> | null;
  resolution: Record<string, unknown> | null;
  warranty_snapshot: WarrantySnapshot | null;
  service_config_version: number | null;
  sla_due_at: Date | null;
  owner_admin_id: string | null;
  open_key: string | null;
  data_origin: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
};
type EventRow = { id: bigint; action: string; from_state: string | null; to_state: string; actor_type: string; actor_id: string | null; reason: string | null; details: unknown; request_id: string | null; trace_id: string | null; created_at: Date };
type EvidenceRow = { id: bigint; kind: string; job_evidence_id: string | null; media_storage_key: string | null; media_url: string | null; note: string | null; actor_type: string; actor_id: string | null; created_at: Date };
type WarrantyRow = { state: WarrantyRowState; starts_at: Date; expires_at: Date; policy: WarrantySnapshot | null };

const openKeyFor = (bookingId: string) => `case:${bookingId}`;
const caseRefundKey = (caseId: string) => `case-refund:${caseId}`;
const caseWalletRefundKey = (caseId: string) => `wallet-case-refund:${caseId}`;

function newCaseNumber(): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `CASE-${ymd}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

async function loadCase(db: Db, caseId: string, lock = false): Promise<CaseRow | null> {
  const rows = lock
    ? await db.$queryRaw<CaseRow[]>`SELECT * FROM booking_cases WHERE id = ${caseId} FOR UPDATE`
    : await db.$queryRaw<CaseRow[]>`SELECT * FROM booking_cases WHERE id = ${caseId}`;
  return rows[0] ?? null;
}

async function warrantyRow(db: Db, bookingId: string): Promise<WarrantyRow | null> {
  const rows = await db.$queryRaw<WarrantyRow[]>`SELECT state, starts_at, expires_at, policy FROM booking_warranties WHERE booking_id = ${bookingId}`;
  return rows[0] ?? null;
}

async function insertEvent(tx: Prisma.TransactionClient, e: { caseId: string; action: string; from: string | null; to: string; actorType: "CUSTOMER" | "PARTNER" | "ADMIN" | "SYSTEM"; actorId: string | null; reason?: string | null; details?: Record<string, unknown> | null }) {
  const ctx = getEventContext();
  await tx.$executeRaw`
    INSERT INTO booking_case_events (case_id, action, from_state, to_state, actor_type, actor_id, reason, details, request_id, trace_id)
    VALUES (${e.caseId}, ${e.action}, ${e.from}, ${e.to}, ${e.actorType}, ${e.actorId}, ${e.reason?.slice(0, 1000) ?? null},
            ${e.details ? JSON.stringify(e.details) : null}::jsonb, ${ctx.requestId ?? null}, ${ctx.traceId ?? null})`;
}

async function insertEvidence(tx: Prisma.TransactionClient, caseId: string, items: EvidenceInput[], actorType: "CUSTOMER" | "PARTNER" | "ADMIN", actorId: string) {
  for (const e of items) {
    const jobEvidenceId = e.kind === "JOB_EVIDENCE" ? e.jobEvidenceId : null;
    const key = e.kind === "CUSTOMER_MEDIA" ? e.mediaStorageKey?.trim() || null : null;
    const url = e.kind === "CUSTOMER_MEDIA" ? e.mediaUrl?.trim() || null : null;
    const note = e.kind === "NOTE" ? e.note.trim().slice(0, 2000) : null;
    await tx.$executeRaw`
      INSERT INTO booking_case_evidence (case_id, kind, job_evidence_id, media_storage_key, media_url, note, actor_type, actor_id)
      VALUES (${caseId}, ${e.kind}, ${jobEvidenceId}, ${key}, ${url}, ${note}, ${actorType}, ${actorId})`;
  }
}

/** Every JOB_EVIDENCE reference must be evidence of THIS booking; shapes are checked first. */
async function validateEvidence(bookingId: string, items: EvidenceInput[]): Promise<CaseError | null> {
  for (const e of items) if (evidenceShapeError(e)) return CASE_ERRORS.EVIDENCE_INVALID;
  const ids = items.filter((e): e is Extract<EvidenceInput, { kind: "JOB_EVIDENCE" }> => e.kind === "JOB_EVIDENCE").map((e) => e.jobEvidenceId);
  if (ids.length) {
    const found = await prisma.jobEvidence.count({ where: { id: { in: ids }, bookingId } });
    if (found !== new Set(ids).size) return CASE_ERRORS.EVIDENCE_INVALID;
  }
  return null;
}

/**
 * The completion axis (booking_completions) is owned by the completion service: PENDING_CUSTOMER →
 * ISSUE_REPORTED pointing at this case; a completion already confirmed / auto-confirmed stays as it is.
 */
async function markCompletionIssueReported(tx: Prisma.TransactionClient, bookingId: string, caseId: string, customerId: string): Promise<void> {
  await bookingCompletionService.markIssueReported(tx, bookingId, caseId, { type: "CUSTOMER", id: customerId });
}

/** The warranty policy that binds this booking: the row completion froze, else the booking's own snapshot. */
function policyFor(snapshot: unknown, row: WarrantyRow | null): WarrantySnapshot | null {
  return (row?.policy as WarrantySnapshot | null) ?? warrantyFromLegacyBookingSnapshot(snapshot);
}

async function proofCount(db: Db, caseId: string): Promise<number> {
  const rows = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM booking_case_evidence WHERE case_id = ${caseId} AND kind IN ('JOB_EVIDENCE', 'CUSTOMER_MEDIA')`;
  return Number(rows[0]?.n ?? 0);
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

class BookingCaseService {
  async available(): Promise<boolean> {
    return tablesPresent();
  }

  /* ------------------------------------------------------------------ */
  /* Customer: report an issue                                          */
  /* ------------------------------------------------------------------ */
  async openCase(input: {
    bookingId: string;
    customerId: string;
    category: string;
    description?: string | null;
    evidence?: EvidenceInput[];
    clientKey?: string | null;
  }): Promise<Fail | { ok: true; replayed: boolean; case: Awaited<ReturnType<BookingCaseService["customerView"]>> }> {
    if (!(await tablesPresent())) return fail(CASE_ERRORS.CASES_UNAVAILABLE);
    if (!(CASE_CATEGORIES as readonly string[]).includes(input.category)) return fail(CASE_ERRORS.INVALID_CATEGORY);
    const category = input.category as CaseCategory;
    const evidence = input.evidence ?? [];
    if (evidence.length > MAX_EVIDENCE_PER_CASE) return fail(CASE_ERRORS.EVIDENCE_LIMIT);

    const b = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      select: { id: true, userId: true, providerId: true, status: true, completedAt: true, serviceConfigSnapshot: true, serviceConfigVersion: true, dataOrigin: true },
    });
    if (!b || b.userId !== input.customerId) return fail(CASE_ERRORS.NOT_FOUND);
    // Live bookings have their own paths (no-show, cancel, safety); a case is about finished work.
    if (b.status !== "COMPLETED" || !b.completedAt) return fail(CASE_ERRORS.BOOKING_NOT_COMPLETED);

    const openKey = openKeyFor(b.id);
    const existing = await prisma.$queryRaw<CaseRow[]>`SELECT * FROM booking_cases WHERE open_key = ${openKey}`;
    if (existing[0]) {
      incCounter("booking_case_open_total", { outcome: "replayed" });
      return { ok: true as const, replayed: true, case: await this.customerView(existing[0]) };
    }

    const evidenceError = await validateEvidence(b.id, evidence);
    if (evidenceError) return fail(evidenceError);

    const row = await warrantyRow(prisma, b.id);
    const policy = policyFor(b.serviceConfigSnapshot, row);
    const now = new Date();
    const eligibility = evaluateWarrantyEligibility({
      policy,
      row: row ? { state: row.state, startsAt: row.starts_at, expiresAt: row.expires_at } : null,
      completedAt: b.completedAt,
      category,
      proofPresent: evidence.some((e) => isProof(e.kind)),
      now,
    });
    if (!eligibility.complaintWindowOpen) {
      incCounter("booking_case_open_total", { outcome: "window_closed" });
      const code = eligibility.reasonCodes.includes("NO_COMPLAINT_WINDOW") ? CASE_ERRORS.COMPLAINT_WINDOW_NOT_CONFIGURED : CASE_ERRORS.COMPLAINT_WINDOW_CLOSED;
      return fail(code, { reasonCodes: eligibility.reasonCodes });
    }

    const type = caseTypeFor(eligibility);
    const caseId = crypto.randomUUID();
    const caseNumber = newCaseNumber();
    const slaDueAt = new Date(now.getTime() + CASE_TRIAGE_SLA_HOURS * 3_600_000);
    const decided = { ...eligibility, decidedAt: now.toISOString(), completedAt: b.completedAt.toISOString(), warrantyState: row?.state ?? null, warrantyExpiresAt: iso(row?.expires_at) };
    const description = input.description?.trim() ? input.description.trim().slice(0, 2000) : null;

    const inserted = await prisma.$transaction(async (tx) => {
      await setBookingAuditContext(tx, { actorType: "customer", actorId: input.customerId, reason: `issue reported: ${category}` });
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO booking_cases (id, case_number, booking_id, customer_id, provider_id, type, category, state, description,
                                   eligibility, warranty_snapshot, service_config_version, sla_due_at, open_key, data_origin)
        VALUES (${caseId}, ${caseNumber}, ${b.id}, ${input.customerId}, ${b.providerId}, ${type}, ${category}, 'CASE_CREATED', ${description},
                ${JSON.stringify(decided)}::jsonb, ${policy ? JSON.stringify(policy) : null}::jsonb, ${b.serviceConfigVersion}, ${slaDueAt},
                ${openKey}, ${b.dataOrigin ?? null}::"DataOrigin")
        ON CONFLICT ("open_key") WHERE "open_key" IS NOT NULL DO NOTHING
        RETURNING id`;
      if (!rows[0]) return false;
      await insertEvent(tx, { caseId, action: "CREATED", from: null, to: "CASE_CREATED", actorType: "CUSTOMER", actorId: input.customerId, details: { type, category, warrantyCovers: eligibility.warrantyCovers, clientKey: input.clientKey ?? null } });
      if (evidence.length) await insertEvidence(tx, caseId, evidence, "CUSTOMER", input.customerId);
      await markCompletionIssueReported(tx, b.id, caseId, input.customerId);
      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
        await emitInTransaction(tx, buildBookingCaseOpenedEvent({ caseId, caseNumber, bookingId: b.id, type, category, warrantyCovers: eligibility.warrantyCovers, slaDueAt: slaDueAt.toISOString(), customerId: input.customerId }));
      }
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });

    const final = (await prisma.$queryRaw<CaseRow[]>`SELECT * FROM booking_cases WHERE open_key = ${openKey}`)[0] ?? (await loadCase(prisma, caseId));
    if (!final) return fail(CASE_ERRORS.CASES_UNAVAILABLE);
    incCounter("booking_case_open_total", { outcome: inserted ? "created" : "replayed", type });
    if (inserted) logger.info("booking_case_opened", { caseId, bookingId: b.id, type, category, warrantyCovers: eligibility.warrantyCovers });
    return { ok: true as const, replayed: !inserted, case: await this.customerView(final) };
  }

  async addEvidence(input: { bookingId: string; caseId: string; customerId: string; evidence: EvidenceInput[] }) {
    if (!(await tablesPresent())) return fail(CASE_ERRORS.CASES_UNAVAILABLE);
    const c = await loadCase(prisma, input.caseId);
    if (!c || c.booking_id !== input.bookingId || c.customer_id !== input.customerId) return fail(CASE_ERRORS.CASE_NOT_FOUND);
    if (isTerminalCaseState(c.state)) return fail(CASE_ERRORS.CASE_CLOSED);
    if (!input.evidence.length) return fail(CASE_ERRORS.EVIDENCE_INVALID);
    const evidenceError = await validateEvidence(c.booking_id, input.evidence);
    if (evidenceError) return fail(evidenceError);
    const r = await prisma.$transaction(async (tx) => {
      const locked = await loadCase(tx, c.id, true);
      if (!locked || isTerminalCaseState(locked.state)) return fail(CASE_ERRORS.CASE_CLOSED);
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM booking_case_evidence WHERE case_id = ${c.id}`;
      if (Number(n) + input.evidence.length > MAX_EVIDENCE_PER_CASE) return fail(CASE_ERRORS.EVIDENCE_LIMIT);
      await insertEvidence(tx, c.id, input.evidence, "CUSTOMER", input.customerId);
      await insertEvent(tx, { caseId: c.id, action: "EVIDENCE_ADDED", from: locked.state, to: locked.state, actorType: "CUSTOMER", actorId: input.customerId, details: { count: input.evidence.length } });
      return { ok: true as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    if (!r.ok) return r;
    incCounter("booking_case_evidence_added_total");
    return { ok: true as const, case: await this.customerView((await loadCase(prisma, c.id))!) };
  }

  /* ------------------------------------------------------------------ */
  /* Views                                                              */
  /* ------------------------------------------------------------------ */
  private async history(caseId: string) {
    const [events, evidence] = await Promise.all([
      prisma.$queryRaw<EventRow[]>`SELECT id, action, from_state, to_state, actor_type, actor_id, reason, details, request_id, trace_id, created_at FROM booking_case_events WHERE case_id = ${caseId} ORDER BY id`,
      prisma.$queryRaw<EvidenceRow[]>`SELECT id, kind, job_evidence_id, media_storage_key, media_url, note, actor_type, actor_id, created_at FROM booking_case_evidence WHERE case_id = ${caseId} ORDER BY id`,
    ]);
    return { events, evidence };
  }

  private evidenceFor(audience: Audience, rows: EvidenceRow[]) {
    return rows
      .filter((e) => evidenceVisibleTo(audience, e.actor_type))
      .map((e) => ({
        id: Number(e.id), kind: e.kind, jobEvidenceId: e.job_evidence_id, mediaUrl: e.media_url, note: e.note,
        // X-29: the raw object-storage key is an admin concern; customer and partner use the media URL.
        ...(audience === "ADMIN" ? { mediaStorageKey: e.media_storage_key, actorType: e.actor_type, actorId: e.actor_id } : {}),
        createdAt: e.created_at.toISOString(),
      }));
  }

  /** The customer sees their case, their own evidence and state changes — never admin reasons, notes or override text. */
  async customerView(c: CaseRow) {
    const { events, evidence } = await this.history(c.id);
    const el = (c.eligibility ?? {}) as Partial<WarrantyEligibility>;
    const res = (c.resolution ?? null) as Record<string, unknown> | null;
    return {
      id: c.id, caseNumber: c.case_number, bookingId: c.booking_id, type: c.type, category: c.category, state: c.state,
      description: c.description, createdAt: c.created_at.toISOString(), closedAt: iso(c.closed_at),
      eligibility: { warrantyCovers: el.warrantyCovers === true, proofRequired: el.proofRequired === true, proofMissing: el.proofMissing === true, reasonCodes: el.reasonCodes ?? [] },
      resolution: res ? { action: res.action ?? null, status: res.status ?? null, refundPaise: res.refundPaise ?? null, followUpBookingId: res.followUpBookingId ?? null } : null,
      evidence: this.evidenceFor("CUSTOMER", evidence),
      timeline: events.filter((e) => e.from_state !== e.to_state || e.action === "CREATED").map((e) => ({ state: e.to_state, at: e.created_at.toISOString() })),
    };
  }

  /** The assigned partner sees what the customer reported and the outcome; not money, admin notes or other internal detail. */
  async partnerView(c: CaseRow) {
    const { evidence } = await this.history(c.id);
    const res = (c.resolution ?? null) as Record<string, unknown> | null;
    return {
      id: c.id, caseNumber: c.case_number, bookingId: c.booking_id, type: c.type, category: c.category, state: c.state,
      description: c.description, createdAt: c.created_at.toISOString(), closedAt: iso(c.closed_at),
      resolution: res ? { action: res.action ?? null, followUpBookingId: res.followUpBookingId ?? null } : null,
      evidence: this.evidenceFor("PARTNER", evidence),
    };
  }

  async listForBooking(bookingId: string, audience: { role: "CUSTOMER"; userId: string } | { role: "PARTNER"; providerId: string }) {
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { userId: true, providerId: true } });
    if (!b) return fail(CASE_ERRORS.NOT_FOUND);
    if (audience.role === "CUSTOMER" && b.userId !== audience.userId) return fail(CASE_ERRORS.NOT_FOUND);
    if (audience.role === "PARTNER" && b.providerId !== audience.providerId) return fail(CASE_ERRORS.NOT_FOUND);
    if (!(await tablesPresent())) return { ok: true as const, available: false, cases: [] };
    const rows = await prisma.$queryRaw<CaseRow[]>`SELECT * FROM booking_cases WHERE booking_id = ${bookingId} ORDER BY created_at DESC`;
    const cases = await Promise.all(rows.map((r) => (audience.role === "CUSTOMER" ? this.customerView(r) : this.partnerView(r))));
    return { ok: true as const, available: true, cases };
  }

  async adminList(filters: { state?: string; type?: string; slaBreached?: boolean; bookingId?: string; limit?: number; offset?: number }) {
    if (!(await tablesPresent())) return { available: false, cases: [], total: 0 };
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
    const offset = Math.max(filters.offset ?? 0, 0);
    const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (filters.state) conds.push(Prisma.sql`state = ${filters.state}`);
    if (filters.type) conds.push(Prisma.sql`type = ${filters.type}`);
    if (filters.bookingId) conds.push(Prisma.sql`booking_id = ${filters.bookingId}`);
    if (filters.slaBreached) conds.push(Prisma.sql`state = 'CASE_CREATED' AND sla_due_at < now()`);
    const where = Prisma.join(conds, " AND ");
    const [rows, count] = await Promise.all([
      prisma.$queryRaw<CaseRow[]>`SELECT * FROM booking_cases WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM booking_cases WHERE ${where}`,
    ]);
    const now = Date.now();
    return {
      available: true,
      total: Number(count[0]?.n ?? 0),
      cases: rows.map((c) => ({
        id: c.id, caseNumber: c.case_number, bookingId: c.booking_id, customerId: c.customer_id, providerId: c.provider_id,
        type: c.type, category: c.category, state: c.state, version: c.version, ownerAdminId: c.owner_admin_id,
        slaDueAt: iso(c.sla_due_at), slaBreached: c.state === "CASE_CREATED" && !!c.sla_due_at && c.sla_due_at.getTime() < now,
        createdAt: c.created_at.toISOString(), closedAt: iso(c.closed_at), resolution: c.resolution,
      })),
    };
  }

  async adminDetail(caseId: string) {
    if (!(await tablesPresent())) return fail(CASE_ERRORS.CASES_UNAVAILABLE);
    const c = await loadCase(prisma, caseId);
    if (!c) return fail(CASE_ERRORS.CASE_NOT_FOUND);
    const [{ events, evidence }, booking, warranty, followUps, refunds] = await Promise.all([
      this.history(c.id),
      prisma.booking.findUnique({ where: { id: c.booking_id }, select: { id: true, bookingNumber: true, status: true, completedAt: true, totalAmount: true, providerId: true, serviceId: true } }),
      warrantyRow(prisma, c.booking_id),
      prisma.$queryRaw<{ id: string; booking_number: string; booking_kind: string; status: string; scheduled_date: Date; provider_id: string | null }[]>`
        SELECT id, booking_number, booking_kind, status, scheduled_date, provider_id FROM bookings WHERE case_id = ${c.id}`,
      prisma.$queryRaw<{ id: string; amount: number; status: string; idempotency_key: string; created_at: Date }[]>`
        SELECT id, amount, status::text AS status, idempotency_key, created_at FROM refund_requests WHERE case_id = ${c.id} ORDER BY created_at`,
    ]);
    const current = await this.eligibilityAt(c);
    return {
      ok: true as const,
      case: { ...c, sla_due_at: iso(c.sla_due_at), created_at: c.created_at.toISOString(), updated_at: c.updated_at.toISOString(), closed_at: iso(c.closed_at) },
      eligibilityNow: current,
      booking,
      warranty: warranty ? { state: warranty.state, startsAt: warranty.starts_at.toISOString(), expiresAt: warranty.expires_at.toISOString() } : null,
      followUps: followUps.map((f) => ({ ...f, scheduled_date: f.scheduled_date.toISOString() })),
      refunds: refunds.map((r) => ({ ...r, created_at: r.created_at.toISOString() })),
      events: events.map((e) => ({ ...e, id: Number(e.id), created_at: e.created_at.toISOString() })),
      evidence: this.evidenceFor("ADMIN", evidence),
    };
  }

  /**
   * Coverage as of when the customer REPORTED (a warranty that lapses while the case is being worked
   * does not take cover away), with the proof attached so far — proof added later counts.
   */
  private async eligibilityAt(c: CaseRow): Promise<WarrantyEligibility> {
    const b = await prisma.booking.findUnique({ where: { id: c.booking_id }, select: { completedAt: true, serviceConfigSnapshot: true } });
    const row = await warrantyRow(prisma, c.booking_id);
    return evaluateWarrantyEligibility({
      policy: (c.warranty_snapshot as WarrantySnapshot | null) ?? policyFor(b?.serviceConfigSnapshot, row),
      row: row ? { state: row.state === "EXPIRED" && row.expires_at.getTime() >= c.created_at.getTime() ? "ACTIVE" : row.state, startsAt: row.starts_at, expiresAt: row.expires_at } : null,
      completedAt: b?.completedAt ?? null,
      category: c.category as CaseCategory,
      proofPresent: (await proofCount(prisma, c.id)) > 0,
      now: c.created_at,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Admin decisions                                                    */
  /* ------------------------------------------------------------------ */
  async transition(caseId: string, adminId: string, input: { to: string; reason: string; expectedVersion?: number }) {
    if (!(await tablesPresent())) return fail(CASE_ERRORS.CASES_UNAVAILABLE);
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 3) return fail(CASE_ERRORS.REASON_REQUIRED);
    const r = await prisma.$transaction(async (tx): Promise<Fail | { ok: true; from: string }> => {
      const c = await loadCase(tx, caseId, true);
      if (!c) return fail(CASE_ERRORS.CASE_NOT_FOUND);
      if (isTerminalCaseState(c.state)) return fail(CASE_ERRORS.CASE_CLOSED);
      if (input.expectedVersion != null && input.expectedVersion !== c.version) return fail(CASE_ERRORS.CASE_VERSION_CONFLICT, { version: c.version });
      if (!canTransition(c.state, input.to)) return fail(CASE_ERRORS.CASE_TRANSITION_FORBIDDEN, { from: c.state, to: input.to });
      await setBookingAuditContext(tx, { actorType: "admin", actorId: adminId, reason: `case ${c.case_number}: ${c.state} → ${input.to}` });
      await tx.$executeRaw`UPDATE booking_cases SET state = ${input.to}, owner_admin_id = COALESCE(owner_admin_id, ${adminId}) WHERE id = ${c.id}`;
      await insertEvent(tx, { caseId: c.id, action: "TRANSITION", from: c.state, to: input.to, actorType: "ADMIN", actorId: adminId, reason });
      return { ok: true, from: c.state };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    if (!r.ok) return r;
    incCounter("booking_case_transition_total", { to: input.to });
    return { ok: true as const, case: await loadCase(prisma, caseId) };
  }

  async resolve(caseId: string, adminId: string, input: {
    action: ResolveAction;
    reason: string;
    refundPaise?: number;
    scheduledDate?: string;
    overrideReason?: string;
    expectedVersion?: number;
  }): Promise<Fail | { ok: true; replayed?: boolean; state: string; resolution: Record<string, unknown> }> {
    if (!(await tablesPresent())) return fail(CASE_ERRORS.CASES_UNAVAILABLE);
    const reason = input.reason?.trim() ?? "";
    if (reason.length < 3) return fail(CASE_ERRORS.REASON_REQUIRED);
    const c = await loadCase(prisma, caseId);
    if (!c) return fail(CASE_ERRORS.CASE_NOT_FOUND);

    const prior = (c.resolution ?? null) as Record<string, unknown> | null;
    if (isTerminalCaseState(c.state)) {
      // The same decision asked again is answered with what was done, never done twice.
      if (prior && prior.action === input.action) return { ok: true as const, replayed: true, state: c.state, resolution: prior };
      return fail(CASE_ERRORS.CASE_CLOSED);
    }
    const refundUnderway = prior?.action === "REFUND";
    if (!refundUnderway && !(RESOLVABLE_FROM as readonly string[]).includes(c.state)) return fail(CASE_ERRORS.CASE_NOT_TRIAGED);
    if (refundUnderway && input.action !== "REFUND") return fail(CASE_ERRORS.REFUND_IN_PROGRESS);

    const eligibility = await this.eligibilityAt(c);
    const overrideReason = input.overrideReason?.trim() || null;
    const allowed = actionAllowed(eligibility, input.action);
    if (!allowed) {
      if (!overrideReason) return fail(CASE_ERRORS.ACTION_NOT_ALLOWED, { allowedActions: [...eligibility.allowedActions, "NONE"], reasonCodes: eligibility.reasonCodes });
      if (overrideReason.length < 3) return fail(CASE_ERRORS.REASON_REQUIRED);
    }
    const override = allowed ? null : { reason: overrideReason, adminId, eligibilityReasonCodes: eligibility.reasonCodes };
    if (override) {
      incCounter("booking_case_override_total", { action: input.action });
      logger.warn("booking_case_action_override", { caseId, adminId, action: input.action, reasonCodes: eligibility.reasonCodes });
    }

    if (input.action === "REFUND") return this.refundForCase(c, adminId, { refundPaise: input.refundPaise, reason, override, expectedVersion: input.expectedVersion });
    const kind = followUpKindFor(input.action);
    if (kind) return this.createFollowUp(c, adminId, { action: input.action, kind, scheduledDate: input.scheduledDate, reason, override, expectedVersion: input.expectedVersion });
    return this.close(c.id, adminId, { action: input.action, reason, override, expectedVersion: input.expectedVersion });
  }

  /** REJECT / NONE: close the case with the decision; nothing else moves. */
  private async close(caseId: string, adminId: string, input: { action: ResolveAction; reason: string; override: Record<string, unknown> | null; expectedVersion?: number }) {
    const to = terminalStateFor(input.action);
    const resolution = { action: input.action, note: input.reason, override: input.override, decidedBy: adminId, decidedAt: new Date().toISOString() };
    const r = await prisma.$transaction(async (tx): Promise<Fail | { ok: true; state: string; resolution: Record<string, unknown> }> => {
      const c = await loadCase(tx, caseId, true);
      if (!c) return fail(CASE_ERRORS.CASE_NOT_FOUND);
      if (isTerminalCaseState(c.state)) return fail(CASE_ERRORS.CASE_CLOSED);
      if (input.expectedVersion != null && input.expectedVersion !== c.version) return fail(CASE_ERRORS.CASE_VERSION_CONFLICT, { version: c.version });
      await setBookingAuditContext(tx, { actorType: "admin", actorId: adminId, reason: `case ${c.case_number}: ${input.action}` });
      await this.writeClosed(tx, c, to, resolution);
      await insertEvent(tx, { caseId: c.id, action: input.action === "REJECT" ? "REJECTED" : "RESOLVED", from: c.state, to, actorType: "ADMIN", actorId: adminId, reason: input.reason, details: { action: input.action, override: input.override } });
      await this.emitResolved(tx, c, to, adminId, { action: input.action, refundPaise: null, followUpBookingId: null, overridden: input.override != null });
      return { ok: true, state: to, resolution };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    if (r.ok) incCounter("booking_case_resolved_total", { action: input.action });
    return r;
  }

  private async writeClosed(tx: Prisma.TransactionClient, c: CaseRow, to: string, resolution: Record<string, unknown>) {
    await tx.$executeRaw`
      UPDATE booking_cases SET state = ${to}, resolution = ${JSON.stringify(resolution)}::jsonb, open_key = NULL, closed_at = now(),
             owner_admin_id = COALESCE(owner_admin_id, ${(resolution.decidedBy as string | undefined) ?? null})
       WHERE id = ${c.id}`;
  }

  private async emitResolved(tx: Prisma.TransactionClient, c: CaseRow, state: string, adminId: string, r: { action: string; refundPaise: number | null; followUpBookingId: string | null; overridden: boolean }) {
    if (!(eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled)) return;
    await emitInTransaction(tx, buildBookingCaseResolvedEvent({ caseId: c.id, bookingId: c.booking_id, state, ...r, adminId }));
  }

  /* ------------------------------------------------------------------ */
  /* REFUND — one refund per case, through the existing refund path     */
  /* ------------------------------------------------------------------ */
  private async refundForCase(c0: CaseRow, adminId: string, input: { refundPaise?: number; reason: string; override: Record<string, unknown> | null; expectedVersion?: number }) {
    const booking = await prisma.booking.findUnique({ where: { id: c0.booking_id }, select: { userId: true } });
    if (!booking) return fail(CASE_ERRORS.NOT_FOUND);

    // Phase 1 — claim the decision on the case (locked): one REFUND per case, whatever the amount or admin.
    const claim = await prisma.$transaction(async (tx): Promise<Fail | { ok: true; refundPaise: number }> => {
      const c = await loadCase(tx, c0.id, true);
      if (!c) return fail(CASE_ERRORS.CASE_NOT_FOUND);
      if (isTerminalCaseState(c.state)) return fail(CASE_ERRORS.CASE_CLOSED);
      const prior = (c.resolution ?? null) as Record<string, unknown> | null;
      if (prior?.action === "REFUND") {
        // A refund for this case already started: never a second one. Re-drive the SAME refund (same
        // key, same amount) only once the earlier attempt is old enough to have stopped.
        const startedAt = typeof prior.attemptedAt === "string" ? Date.parse(prior.attemptedAt) : 0;
        if (Date.now() - startedAt < REFUND_REDRIVE_AFTER_MS) return fail(CASE_ERRORS.REFUND_IN_PROGRESS);
        await tx.$executeRaw`UPDATE booking_cases SET resolution = resolution || ${JSON.stringify({ attemptedAt: new Date().toISOString(), status: "PENDING" })}::jsonb WHERE id = ${c.id}`;
        return { ok: true, refundPaise: Number(prior.refundPaise) };
      }
      if (input.expectedVersion != null && input.expectedVersion !== c.version) return fail(CASE_ERRORS.CASE_VERSION_CONFLICT, { version: c.version });
      const already = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM refund_requests WHERE case_id = ${c.id}`;
      if (Number(already[0]?.n ?? 0) > 0) return fail(CASE_ERRORS.CASE_ALREADY_REFUNDED);
      const paise = input.refundPaise;
      if (paise == null || !Number.isInteger(paise) || paise <= 0) return fail(CASE_ERRORS.REFUND_AMOUNT_INVALID);
      const remaining = await bookingRefundService.refundableRemaining(c.booking_id, booking.userId);
      if (remaining == null) return fail(CASE_ERRORS.NO_REFUNDABLE_PAYMENT);
      const remainingPaise = Number(rupeesToPaise(remaining));
      if (paise > remainingPaise) return fail(CASE_ERRORS.REFUND_EXCEEDS_REFUNDABLE, { refundablePaise: remainingPaise });
      await setBookingAuditContext(tx, { actorType: "admin", actorId: adminId, reason: `case ${c.case_number}: refund` });
      const resolution = { action: "REFUND", status: "PENDING", refundPaise: paise, note: input.reason, override: input.override, decidedBy: adminId, attemptedAt: new Date().toISOString(), idempotencyKey: caseRefundKey(c.id) };
      await tx.$executeRaw`UPDATE booking_cases SET state = 'ACTION', resolution = ${JSON.stringify(resolution)}::jsonb, owner_admin_id = COALESCE(owner_admin_id, ${adminId}) WHERE id = ${c.id}`;
      await insertEvent(tx, { caseId: c.id, action: "REFUND_STARTED", from: c.state, to: "ACTION", actorType: "ADMIN", actorId: adminId, reason: input.reason, details: { refundPaise: paise, override: input.override } });
      return { ok: true, refundPaise: paise };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    if (!claim.ok) return claim;

    // Phase 2 — the existing refund path (ceiling re-checked under its own locks), case-scoped keys.
    const result = await bookingRefundService.processAdminRefund({
      bookingId: c0.booking_id,
      userId: booking.userId,
      adminId,
      amount: claim.refundPaise / 100,
      reason: `Case ${c0.case_number}: ${input.reason}`.slice(0, 500),
      keys: { idempotencyKey: caseRefundKey(c0.id), walletKey: caseWalletRefundKey(c0.id) },
    });

    // Phase 3 — record exactly what is known.
    return prisma.$transaction(async (tx): Promise<Fail | { ok: true; state: string; resolution: Record<string, unknown> }> => {
      const c = await loadCase(tx, c0.id, true);
      if (!c) return fail(CASE_ERRORS.CASE_NOT_FOUND);
      if (isTerminalCaseState(c.state)) return { ok: true, state: c.state, resolution: (c.resolution ?? {}) as Record<string, unknown> };
      await setBookingAuditContext(tx, { actorType: "admin", actorId: adminId, reason: `case ${c.case_number}: refund outcome` });
      if ("error" in result) {
        const inFlight = result.error === "REFUND_IN_PROGRESS" || result.error === "REFUND_OUTCOME_UNKNOWN";
        await tx.$executeRaw`UPDATE booking_cases SET resolution = resolution || ${JSON.stringify({ status: inFlight ? "IN_PROGRESS" : "FAILED", lastError: result.error })}::jsonb WHERE id = ${c.id}`;
        await insertEvent(tx, { caseId: c.id, action: inFlight ? "REFUND_PENDING" : "REFUND_FAILED", from: c.state, to: c.state, actorType: "SYSTEM", actorId: null, details: { error: result.error } });
        incCounter("booking_case_refund_total", { outcome: inFlight ? "in_progress" : "failed" });
        return fail(inFlight ? CASE_ERRORS.REFUND_IN_PROGRESS : CASE_ERRORS.REFUND_FAILED, { refundError: result.error });
      }
      await tx.$executeRaw`UPDATE refund_requests SET case_id = ${c.id} WHERE idempotency_key = ${result.idempotencyKey} AND case_id IS NULL`;
      const refundRequest = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM refund_requests WHERE idempotency_key = ${result.idempotencyKey}`;
      const prior = (c.resolution ?? {}) as Record<string, unknown>;
      const resolution = { ...prior, status: "COMPLETED", refundStatus: result.status, refundedPaise: Number(rupeesToPaise(result.amount)), refundRequestId: refundRequest[0]?.id ?? null, decidedAt: new Date().toISOString() };
      await this.writeClosed(tx, c, "RESOLVED", resolution);
      await insertEvent(tx, { caseId: c.id, action: "RESOLVED", from: c.state, to: "RESOLVED", actorType: "ADMIN", actorId: adminId, reason: input.reason, details: { action: "REFUND", refundPaise: resolution.refundedPaise, refundRequestId: resolution.refundRequestId } });
      await this.emitResolved(tx, c, "RESOLVED", adminId, { action: "REFUND", refundPaise: resolution.refundedPaise, followUpBookingId: null, overridden: prior.override != null });
      incCounter("booking_case_refund_total", { outcome: "completed" });
      incCounter("booking_case_resolved_total", { action: "REFUND" });
      return { ok: true, state: "RESOLVED", resolution };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
  }

  /* ------------------------------------------------------------------ */
  /* REWORK / INSPECTION — one follow-up booking per case               */
  /* ------------------------------------------------------------------ */
  private async createFollowUp(c0: CaseRow, adminId: string, input: { action: ResolveAction; kind: "REWORK" | "REVISIT"; scheduledDate?: string; reason: string; override: Record<string, unknown> | null; expectedVersion?: number }) {
    const scheduled = input.scheduledDate ? new Date(input.scheduledDate) : null;
    if (!scheduled || Number.isNaN(scheduled.getTime()) || scheduled.getTime() <= Date.now()) return fail(CASE_ERRORS.SCHEDULE_INVALID);

    const parent = await prisma.booking.findUnique({
      where: { id: c0.booking_id },
      select: {
        id: true, bookingNumber: true, userId: true, providerId: true, serviceId: true, addressId: true, completedAt: true, dataOrigin: true,
        serviceSelection: true, serviceConfigVersion: true, serviceConfigSnapshot: true, estimatedDuration: true, slotDurationMinutes: true,
        queuePriority: true, priorityScore: true,
        address: { select: { latitude: true, longitude: true, city: true } },
        service: { select: { category: true, catalogConfig: true } },
      },
    });
    if (!parent) return fail(CASE_ERRORS.NOT_FOUND);
    const snap = (parent.serviceConfigSnapshot ?? {}) as Record<string, unknown>;
    // The parent's frozen rework terms if it carries them; else the service's configured terms.
    const policy = reworkPolicyFrom(snap.rework) ?? reworkPolicyFrom((parent.service.catalogConfig as Record<string, unknown> | null)?.rework);
    const fee = followUpFeeDecision(policy);
    if (!fee.ok) return fail(fee.error);
    if (!reworkWindowOpen(fee.windowDays, parent.completedAt, c0.created_at)) return fail(CASE_ERRORS.REWORK_WINDOW_CLOSED);

    const bookingNumber = await nextBookingNumber();
    const slotDurationMinutes = parent.slotDurationMinutes ?? undefined;
    const followUpSnapshot = {
      ...snap,
      // No price was charged: the follow-up carries no priced lines, only the decision that waived them.
      pricing: { version: "follow-up.v1", currency: (snap.pricing as { currency?: string } | undefined)?.currency ?? "INR", lines: [], finalAmountPaise: 0, fee: fee.fee },
      followUp: { kind: input.kind, parentBookingId: parent.id, parentBookingNumber: parent.bookingNumber, caseId: c0.id, caseNumber: c0.case_number },
      schedule: { ...((snap.schedule as Record<string, unknown> | undefined) ?? {}), scheduledAt: scheduled.toISOString() },
    };

    type Out = Fail | { ok: true; replayed: boolean; state: string; resolution: Record<string, unknown>; bookingId: string; providerId: string | null };
    let out: Out;
    try {
      out = await prisma.$transaction(async (tx): Promise<Out> => {
        const c = await loadCase(tx, c0.id, true);
        if (!c) return fail(CASE_ERRORS.CASE_NOT_FOUND);
        const existing = await tx.$queryRaw<{ id: string; provider_id: string | null }[]>`SELECT id, provider_id FROM bookings WHERE case_id = ${c.id}`;
        if (existing[0]) return { ok: true as const, replayed: true, state: c.state, resolution: (c.resolution ?? {}) as Record<string, unknown>, bookingId: existing[0].id, providerId: existing[0].provider_id };
        if (isTerminalCaseState(c.state)) return fail(CASE_ERRORS.CASE_CLOSED);
        if (input.expectedVersion != null && input.expectedVersion !== c.version) return fail(CASE_ERRORS.CASE_VERSION_CONFLICT, { version: c.version });
        await setBookingAuditContext(tx, { actorType: "admin", actorId: adminId, reason: `case ${c.case_number}: ${input.kind.toLowerCase()} booking` });

        // Same partner first when the policy prefers it AND they are still eligible for this job now.
        let providerId: string | null = null;
        if (fee.sameProviderPreferred && parent.providerId) {
          const blocked = await partnerOperationsService.assertOfferEligible(tx, parent.providerId, {
            latitude: parent.address?.latitude ?? 0, longitude: parent.address?.longitude ?? 0, scheduledDate: scheduled,
            // Phase 11: the same partner is preferred only if still capable of the service now.
            capability: { serviceId: parent.serviceId, customerId: parent.userId },
          });
          if (!blocked) providerId = parent.providerId;
        }
        let conflict = await bookingValidationService.assertBookingConflictFree(tx, { userId: parent.userId, providerId, scheduledDate: scheduled, slotDurationMinutes });
        if (conflict && providerId) {
          providerId = null;
          conflict = await bookingValidationService.assertBookingConflictFree(tx, { userId: parent.userId, providerId: null, scheduledDate: scheduled, slotDurationMinutes });
        }
        if (conflict) return fail(CASE_ERRORS.SLOT_UNAVAILABLE, { reason: conflict.code });

        const created = await tx.booking.create({
          data: {
            bookingNumber,
            userId: parent.userId,
            dataOrigin: parent.dataOrigin,
            providerId,
            serviceId: parent.serviceId,
            addressId: parent.addressId,
            scheduledDate: scheduled,
            description: `${input.kind === "REWORK" ? "Rework" : "Revisit"} for ${parent.bookingNumber} (case ${c.case_number})`,
            baseAmount: 0,
            finalAmount: 0,
            totalAmount: 0,
            taxes: 0,
            queuePriority: parent.queuePriority,
            priorityScore: parent.priorityScore,
            serviceSelection: (parent.serviceSelection ?? undefined) as Prisma.InputJsonValue | undefined,
            serviceConfigVersion: parent.serviceConfigVersion,
            serviceConfigSnapshot: followUpSnapshot as Prisma.InputJsonValue,
            estimatedDuration: parent.estimatedDuration,
            slotDurationMinutes: parent.slotDurationMinutes,
          },
          select: { id: true, bookingNumber: true, userId: true, serviceId: true, providerId: true, status: true, finalAmount: true, finalAmountPaise: true, paymentMethod: true, scheduledDate: true },
        });
        await tx.$executeRaw`UPDATE bookings SET parent_booking_id = ${parent.id}, booking_kind = ${input.kind}, case_id = ${c.id} WHERE id = ${created.id}`;
        // The follow-up is executed and gated under the parent's frozen plan and requirements.
        await bookingExecutionService.materializeForNewBooking(tx, { bookingId: created.id, snapshot: { execution: snap.execution } });
        await bookingRequirementService.materializeForNewBooking(tx, { bookingId: created.id, customerId: parent.userId, snapshot: { requirements: snap.requirements } });

        const resolution = { action: input.action, followUpBookingId: created.id, followUpBookingNumber: created.bookingNumber, bookingKind: input.kind, fee: fee.fee, providerPreferred: providerId != null, note: input.reason, override: input.override, decidedBy: adminId, decidedAt: new Date().toISOString() };
        await this.writeClosed(tx, c, "RESOLVED", resolution);
        await insertEvent(tx, { caseId: c.id, action: "RESOLVED", from: c.state, to: "RESOLVED", actorType: "ADMIN", actorId: adminId, reason: input.reason, details: { action: input.action, followUpBookingId: created.id, bookingKind: input.kind, override: input.override } });
        await this.emitResolved(tx, c, "RESOLVED", adminId, { action: input.action, refundPaise: null, followUpBookingId: created.id, overridden: input.override != null });
        if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
          await emitInTransaction(tx, buildBookingCreatedEvent({
            bookingId: created.id, bookingNumber: created.bookingNumber, userId: created.userId, serviceId: created.serviceId,
            serviceCategory: parent.service.category, city: parent.address?.city ?? "unknown", providerId: created.providerId, status: created.status,
            finalAmount: created.finalAmount, finalAmountPaise: created.finalAmountPaise, paymentMethod: created.paymentMethod, scheduledAt: created.scheduledDate,
            actorType: "system", actorId: adminId,
          }));
        }
        return { ok: true as const, replayed: false, state: "RESOLVED", resolution, bookingId: created.id, providerId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 20_000, timeout: 30_000 });
    } catch (err) {
      // The unique index on bookings.case_id is the last word: a concurrent creation that slipped past
      // the lock (or a retry after a lost response) gets the booking that exists.
      const msg = err instanceof Error ? err.message : String(err);
      if (/bookings_case_id_key|23505|P2002/.test(msg) || (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2002" || err.code === "P2010"))) {
        const existing = await prisma.$queryRaw<{ id: string; provider_id: string | null }[]>`SELECT id, provider_id FROM bookings WHERE case_id = ${c0.id}`;
        const c = await loadCase(prisma, c0.id);
        if (existing[0] && c) {
          incCounter("booking_case_follow_up_total", { outcome: "replayed" });
          return { ok: true as const, replayed: true, state: c.state, resolution: { ...((c.resolution ?? {}) as Record<string, unknown>), followUpBookingId: existing[0].id } };
        }
      }
      if (/bookings_(user|provider)_slot_excl|23P01|exclusion/i.test(msg)) return fail(CASE_ERRORS.SLOT_UNAVAILABLE);
      throw err;
    }
    if (!out.ok) return out;
    if (!out.replayed) {
      incCounter("booking_case_follow_up_total", { outcome: "created", kind: input.kind });
      incCounter("booking_case_resolved_total", { action: input.action });
      logger.info("booking_case_follow_up_created", { caseId: c0.id, parentBookingId: parent.id, followUpBookingId: out.bookingId, kind: input.kind, providerPreferred: out.providerId != null });
      // Same after-commit steps as a normal booking: queue position, and dispatch when no partner is set.
      await bookingPriorityService.enqueue(out.bookingId, parent.queuePriority, parent.priorityScore).catch(() => undefined);
      if (!out.providerId) {
        await assignmentEngine.createJob(out.bookingId);
        assignmentEngine.dispatchBookingNowBackground(out.bookingId);
      }
    }
    return { ok: true as const, replayed: out.replayed, state: out.state, resolution: { ...out.resolution, followUpBookingId: out.bookingId } };
  }

  /* ------------------------------------------------------------------ */
  /* Sweep                                                              */
  /* ------------------------------------------------------------------ */
  /** ACTIVE warranties past expiry become EXPIRED. Eligibility already treats them as expired by date; this makes the row say so. */
  async expireWarranties(limit = 500): Promise<{ expired: number }> {
    if (!(await tablesPresent())) return { expired: 0 };
    const rows = await prisma.$queryRaw<{ booking_id: string }[]>`
      UPDATE booking_warranties SET state = 'EXPIRED', updated_at = now()
       WHERE booking_id IN (SELECT booking_id FROM booking_warranties WHERE state = 'ACTIVE' AND expires_at < now() ORDER BY expires_at LIMIT ${limit})
         AND state = 'ACTIVE'
      RETURNING booking_id`;
    if (rows.length) incCounter("booking_warranty_expired_total", {}, rows.length);
    return { expired: rows.length };
  }
}

export const bookingCaseService = new BookingCaseService();
