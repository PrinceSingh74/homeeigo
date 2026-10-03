/**
 * Phase 10 §10 — the customer-confirmation axis of a completed booking, and the frozen warranty row.
 *
 * booking_completions holds one row per booking, written in the completion transaction:
 * PENDING_CUSTOMER → CONFIRMED (customer) | AUTO_CONFIRMED (scheduler, when the window closed) |
 * ISSUE_REPORTED (the cases workstream calls markIssueReported with its case id). Resolved rows are
 * immutable (trigger); every change is audited by trigger into booking_completion_audit.
 *
 * Booking status stays the canonical FSM's COMPLETED — this axis never moves it.
 *
 * booking_warranties is written from the booking's OWN frozen `warranty.v1` snapshot: at completion
 * for startEvent COMPLETION, at confirmation / auto-confirmation for startEvent CONFIRMATION.
 */
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { getEventContext } from "../events/core/event-context";
import { setBookingAuditContext } from "../lib/booking-audit-context";
import { publishBookingRequirementBackground } from "../lib/booking-realtime";
import { eventPlatformConfig } from "../events/core/config";
import { emitInTransaction } from "../events/core/event-publisher";
import { buildBookingCompletionConfirmedEvent } from "../events/catalog/booking-completion.events";
import { warrantyFromLegacyBookingSnapshot, warrantyWindow as warrantyPolicyWindow, type WarrantyStartEvent } from "../lib/service-warranty";
import { BOOKING_COMPLETION_TEMPLATES } from "../notifications/templates/definitions";
import { render } from "../notifications/templates/registry";
import { notificationService } from "./notification.service";
import { customerVerdictView } from "../lib/quality-verdict";
import { tablePresent, verdictHistory } from "./booking-quality.service";

type Db = Prisma.TransactionClient | typeof prisma;

export const completionTablesPresent = (db: Db = prisma) => tablePresent("booking_completions", db);
export const warrantyTablePresent = (db: Db = prisma) => tablePresent("booking_warranties", db);

/**
 * Platform default confirmation window: 48 hours. This is NOT an invented number — it is the window
 * the published legal text already promises customers ("Quality disputes must be raised within 48
 * hours of service completion", apps/web/src/lib/legal/legal-data.ts). A service may freeze its own
 * `quality.confirmationWindowHours` (1–720) into the booking snapshot.
 */
export const DEFAULT_CONFIRMATION_WINDOW_HOURS = 48;

export function confirmationWindowHours(snapshot: unknown): number {
  const q = snapshot && typeof snapshot === "object" ? (snapshot as { quality?: { confirmationWindowHours?: unknown } | null }).quality : null;
  const h = q && typeof q === "object" ? q.confirmationWindowHours : undefined;
  return typeof h === "number" && Number.isInteger(h) && h >= 1 && h <= 720 ? h : DEFAULT_CONFIRMATION_WINDOW_HOURS;
}

export const COMPLETION_ERRORS = {
  NOT_FOUND: "NOT_FOUND",
  COMPLETION_NOT_FOUND: "COMPLETION_NOT_FOUND",
  COMPLETION_ALREADY_RESOLVED: "COMPLETION_ALREADY_RESOLVED",
  COMPLETION_UNAVAILABLE: "COMPLETION_UNAVAILABLE",
} as const;

export type CompletionState = "PENDING_CUSTOMER" | "CONFIRMED" | "AUTO_CONFIRMED" | "ISSUE_REPORTED";

type RawCompletion = {
  booking_id: string; state: CompletionState; verdict_id: bigint | null; requested_at: Date; confirm_by: Date; resolved_at: Date | null;
  resolved_by_type: string | null; resolved_by_id: string | null; case_id: string | null; version: number; updated_at: Date;
};
const CCOLS = Prisma.sql`booking_id, state, verdict_id, requested_at, confirm_by, resolved_at, resolved_by_type, resolved_by_id, case_id, version, updated_at`;

function completionJson(c: RawCompletion) {
  return {
    state: c.state, verdictId: c.verdict_id == null ? null : Number(c.verdict_id), requestedAt: c.requested_at.toISOString(),
    confirmBy: c.confirm_by.toISOString(), resolvedAt: c.resolved_at?.toISOString() ?? null, resolvedByType: c.resolved_by_type,
    resolvedById: c.resolved_by_id, caseId: c.case_id, version: c.version,
  };
}

async function readCompletion(db: Db, bookingId: string, lock = false): Promise<RawCompletion | null> {
  const [row] = lock
    ? await db.$queryRaw<RawCompletion[]>`SELECT ${CCOLS} FROM booking_completions WHERE booking_id = ${bookingId} FOR UPDATE`
    : await db.$queryRaw<RawCompletion[]>`SELECT ${CCOLS} FROM booking_completions WHERE booking_id = ${bookingId}`;
  return row ?? null;
}

type RawWarranty = { booking_id: string; state: string; policy: unknown; starts_at: Date; expires_at: Date; void_reason: string | null };
async function readWarranty(db: Db, bookingId: string): Promise<RawWarranty | null> {
  if (!(await warrantyTablePresent(db))) return null;
  const [row] = await db.$queryRaw<RawWarranty[]>`SELECT booking_id, state, policy, starts_at, expires_at, void_reason FROM booking_warranties WHERE booking_id = ${bookingId}`;
  return row ?? null;
}

function renderCompletionMessage(kind: "confirm_request" | "auto_confirmed", language: string, values: { bookingNumber: string; windowHours: string }) {
  const type = kind === "confirm_request" ? "booking.completion_confirm_request" : "booking.completion_auto_confirmed";
  const defs = BOOKING_COMPLETION_TEMPLATES.filter((d) => d.notificationType === type);
  const def = defs.find((d) => d.language === language) ?? defs.find((d) => d.language === "en")!;
  const r = render({ ...def, variables: { ...def.variables } }, values);
  return { title: r.title ?? "", body: r.body };
}

class BookingCompletionService {
  enabled(db: Db = prisma) {
    return completionTablesPresent(db);
  }

  /**
   * Inside the completion transaction, right after the booking became COMPLETED: open the
   * confirmation window. Idempotent (one row per booking). Returns null when not deployed.
   */
  async recordRequested(tx: Prisma.TransactionClient, input: { bookingId: string; verdictId: number | null; completedAt: Date; snapshot: unknown }) {
    if (!(await completionTablesPresent(tx))) return null;
    const hours = confirmationWindowHours(input.snapshot);
    const confirmBy = new Date(input.completedAt.getTime() + hours * 3_600_000);
    await tx.$executeRaw`
      INSERT INTO booking_completions (booking_id, state, verdict_id, requested_at, confirm_by)
      VALUES (${input.bookingId}, 'PENDING_CUSTOMER', ${input.verdictId}, ${input.completedAt}, ${confirmBy})
      ON CONFLICT (booking_id) DO NOTHING`;
    return { confirmBy, windowHours: hours };
  }

  /**
   * Write booking_warranties from the booking's frozen snapshot when `event` is the policy's start
   * event. Never reads the catalogue. Idempotent. Returns whether a row was written.
   */
  async startWarranty(tx: Prisma.TransactionClient, input: { bookingId: string; snapshot: unknown; event: WarrantyStartEvent; at: Date }): Promise<boolean> {
    if (!(await warrantyTablePresent(tx))) return false;
    const policy = warrantyFromLegacyBookingSnapshot(input.snapshot);
    if (!policy || !policy.enabled || policy.startEvent !== input.event) return false;
    const w = warrantyPolicyWindow(policy, input.at);
    if (!w) return false;
    const v = input.snapshot && typeof input.snapshot === "object" ? (input.snapshot as { version?: unknown }).version : null;
    const n = await tx.$executeRaw`
      INSERT INTO booking_warranties (booking_id, state, policy, policy_version, service_config_version, starts_at, expires_at)
      VALUES (${input.bookingId}, 'ACTIVE', ${JSON.stringify(policy)}::jsonb, ${policy.schema}, ${typeof v === "number" ? v : null}, ${w.startsAt}, ${w.expiresAt})
      ON CONFLICT (booking_id) DO NOTHING`;
    if (n > 0) incCounter("booking_warranty_started_total", { startEvent: input.event });
    return n > 0;
  }

  /** The customer confirms the completed job. Idempotent for a customer replay; a resolved row answers 409 with its state. */
  async confirm(bookingId: string, userId: string) {
    if (!(await completionTablesPresent())) return { ok: false as const, error: COMPLETION_ERRORS.COMPLETION_UNAVAILABLE };
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true, userId: true, serviceConfigSnapshot: true, provider: { select: { userId: true } } } });
    if (!b || b.userId !== userId) return { ok: false as const, error: COMPLETION_ERRORS.NOT_FOUND };
    const res = await prisma.$transaction(async (tx) => {
      await setBookingAuditContext(tx, { actorType: "customer", actorId: userId, reason: "customer confirmed completion" });
      const c = await readCompletion(tx, bookingId, true);
      if (!c) return { ok: false as const, error: COMPLETION_ERRORS.COMPLETION_NOT_FOUND };
      if (c.state === "CONFIRMED" && c.resolved_by_type === "CUSTOMER" && c.resolved_by_id === userId) {
        return { ok: true as const, changed: false, completion: c };
      }
      if (c.state !== "PENDING_CUSTOMER") return { ok: false as const, error: COMPLETION_ERRORS.COMPLETION_ALREADY_RESOLVED, completion: c };
      const now = new Date();
      const [u] = await tx.$queryRaw<RawCompletion[]>`
        UPDATE booking_completions SET state = 'CONFIRMED', resolved_at = ${now}, resolved_by_type = 'CUSTOMER', resolved_by_id = ${userId}, version = version + 1
        WHERE booking_id = ${bookingId} AND state = 'PENDING_CUSTOMER'
        RETURNING ${CCOLS}`;
      await this.startWarranty(tx, { bookingId, snapshot: b.serviceConfigSnapshot, event: "CONFIRMATION", at: now });
      if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
        await emitInTransaction(tx, buildBookingCompletionConfirmedEvent({ bookingId, state: "CONFIRMED", verdictId: u.verdict_id == null ? null : Number(u.verdict_id), confirmBy: u.confirm_by, resolvedAt: now, actorId: userId }));
      }
      return { ok: true as const, changed: true, completion: u };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    if (!res.ok) {
      return "completion" in res && res.completion ? { ok: false as const, error: res.error, completion: completionJson(res.completion) } : { ok: false as const, error: res.error };
    }
    if (res.changed) {
      incCounter("completion_confirmation_total", { state: "CONFIRMED" });
      const ctx = getEventContext();
      logger.info("completion_confirmed", { bookingId, requestId: ctx.requestId, traceId: ctx.traceId });
      publishBookingRequirementBackground({ bookingId, userId: b.userId, providerUserId: b.provider?.userId ?? null, event: "completion.confirmed", code: "completion", state: "CONFIRMED", gate: { ok: true, blocking: [] } });
    }
    return { ok: true as const, changed: res.changed, completion: completionJson(res.completion) };
  }

  /**
   * Called by the cases workstream inside ITS transaction (which has already set the audit context)
   * when the customer reports an issue. PENDING_CUSTOMER → ISSUE_REPORTED with the case id. If the
   * completion is already CONFIRMED / AUTO_CONFIRMED (or absent), the case still opens and the
   * completion stays as it is — a resolved completion is history.
   */
  async markIssueReported(
    tx: Prisma.TransactionClient,
    bookingId: string,
    caseId: string,
    actor: { type: "CUSTOMER" | "ADMIN" | "SYSTEM"; id: string | null },
  ): Promise<{ changed: boolean; state: CompletionState | null }> {
    if (!(await completionTablesPresent(tx))) return { changed: false, state: null };
    const c = await readCompletion(tx, bookingId, true);
    if (!c) return { changed: false, state: null };
    if (c.state !== "PENDING_CUSTOMER") return { changed: false, state: c.state };
    await tx.$executeRaw`
      UPDATE booking_completions SET state = 'ISSUE_REPORTED', case_id = ${caseId}, resolved_at = now(), resolved_by_type = ${actor.type}, resolved_by_id = ${actor.id}, version = version + 1
      WHERE booking_id = ${bookingId} AND state = 'PENDING_CUSTOMER'`;
    incCounter("completion_confirmation_total", { state: "ISSUE_REPORTED" });
    return { changed: true, state: "ISSUE_REPORTED" };
  }

  /**
   * The auto-confirm sweep: pending completions whose window has closed become AUTO_CONFIRMED by
   * SYSTEM. SKIP LOCKED so two sweepers (or a customer confirming at the same instant) never
   * double-resolve. One outbox event per row in the same transaction; one customer inbox message
   * per row after commit.
   */
  async autoConfirmDue(limit = 100): Promise<{ confirmed: number; bookingIds: string[] }> {
    if (!(await completionTablesPresent())) return { confirmed: 0, bookingIds: [] };
    const take = Math.max(1, Math.min(500, Math.floor(limit)));
    const done = await prisma.$transaction(async (tx) => {
      await setBookingAuditContext(tx, { actorType: "system", actorId: "completion-auto-confirm", reason: "auto-confirmed: confirmation window closed" });
      const due = await tx.$queryRaw<RawCompletion[]>`
        SELECT ${CCOLS} FROM booking_completions
        WHERE state = 'PENDING_CUSTOMER' AND confirm_by <= now()
        ORDER BY confirm_by
        LIMIT ${take}
        FOR UPDATE SKIP LOCKED`;
      const out: Array<{ bookingId: string; confirmBy: Date }> = [];
      for (const c of due) {
        const now = new Date();
        const n = await tx.$executeRaw`
          UPDATE booking_completions SET state = 'AUTO_CONFIRMED', resolved_at = ${now}, resolved_by_type = 'SYSTEM', resolved_by_id = NULL, version = version + 1
          WHERE booking_id = ${c.booking_id} AND state = 'PENDING_CUSTOMER'`;
        if (n !== 1) continue;
        const b = await tx.booking.findUnique({ where: { id: c.booking_id }, select: { serviceConfigSnapshot: true } });
        await this.startWarranty(tx, { bookingId: c.booking_id, snapshot: b?.serviceConfigSnapshot, event: "CONFIRMATION", at: now });
        if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.bookingEventsEnabled) {
          await emitInTransaction(tx, buildBookingCompletionConfirmedEvent({ bookingId: c.booking_id, state: "AUTO_CONFIRMED", verdictId: c.verdict_id == null ? null : Number(c.verdict_id), confirmBy: c.confirm_by, resolvedAt: now }));
        }
        out.push({ bookingId: c.booking_id, confirmBy: c.confirm_by });
      }
      return out;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 });

    for (const d of done) {
      incCounter("completion_confirmation_total", { state: "AUTO_CONFIRMED" });
      const b = await prisma.booking.findUnique({
        where: { id: d.bookingId },
        select: { userId: true, bookingNumber: true, serviceConfigSnapshot: true, provider: { select: { userId: true } }, user: { select: { defaultLanguage: true } } },
      });
      if (!b) continue;
      const msg = renderCompletionMessage("auto_confirmed", b.user?.defaultLanguage ?? "en", { bookingNumber: b.bookingNumber, windowHours: String(confirmationWindowHours(b.serviceConfigSnapshot)) });
      await notificationService.createForUserDetached(
        { userId: b.userId, type: "booking_completion_auto_confirmed", title: msg.title, message: msg.body, referenceId: d.bookingId, priority: "normal" },
        { bookingId: d.bookingId, stage: "completion_auto_confirm" },
      );
      publishBookingRequirementBackground({ bookingId: d.bookingId, userId: b.userId, providerUserId: b.provider?.userId ?? null, event: "completion.auto_confirmed", code: "completion", state: "AUTO_CONFIRMED", gate: { ok: true, blocking: [] } });
    }
    if (done.length) logger.info("completion_auto_confirm_sweep", { category: "APPLICATION", confirmed: done.length });
    return { confirmed: done.length, bookingIds: done.map((d) => d.bookingId) };
  }

  /** The confirm-request inbox message body for a completion that was just opened. */
  confirmRequestMessage(language: string, bookingNumber: string, windowHours: number) {
    return renderCompletionMessage("confirm_request", language, { bookingNumber, windowHours: String(windowHours) });
  }

  /** Customer / partner view: state, confirm-by, verdict summary and the warranty window. */
  async viewFor(bookingId: string, audience: { role: "CUSTOMER"; userId: string } | { role: "PARTNER"; providerId: string } | { role: "ADMIN" }) {
    const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { userId: true, providerId: true, status: true, completedAt: true } });
    if (!b) return { error: "NOT_FOUND" as const };
    if (audience.role === "CUSTOMER" && b.userId !== audience.userId) return { error: "NOT_FOUND" as const };
    if (audience.role === "PARTNER" && b.providerId !== audience.providerId) return { error: "NOT_FOUND" as const };
    const enforced = await completionTablesPresent();
    const c = enforced ? await readCompletion(prisma, bookingId) : null;
    const verdicts = await verdictHistory(prisma, bookingId);
    const latest = verdicts[verdicts.length - 1] ?? null;
    const w = await readWarranty(prisma, bookingId);
    const verdict = latest
      ? audience.role === "CUSTOMER"
        ? customerVerdictView(latest)
        : { verdict: latest.verdict, reasonCodes: latest.reasonCodes, at: latest.createdAt.toISOString() }
      : null;
    const completion = c
      ? audience.role === "CUSTOMER"
        ? { state: c.state, confirmBy: c.confirm_by.toISOString(), resolvedAt: c.resolved_at?.toISOString() ?? null, canConfirm: c.state === "PENDING_CUSTOMER" }
        : { state: c.state, confirmBy: c.confirm_by.toISOString(), resolvedAt: c.resolved_at?.toISOString() ?? null, resolvedByType: c.resolved_by_type, caseId: c.case_id }
      : null;
    return {
      enforced,
      bookingStatus: b.status,
      completedAt: b.completedAt?.toISOString() ?? null,
      completion,
      verdict,
      warranty: w ? { state: w.state, startsAt: w.starts_at.toISOString(), expiresAt: w.expires_at.toISOString() } : null,
    };
  }

  /** Admin: the completion row and its append-only audit. */
  async adminDetail(bookingId: string) {
    if (!(await completionTablesPresent())) return { completion: null, audit: [] as unknown[], warranty: null };
    const c = await readCompletion(prisma, bookingId);
    const audit = await prisma.$queryRaw<Array<{ id: bigint; action: string; from_state: string | null; to_state: string; verdict_id: bigint | null; case_id: string | null; actor_type: string | null; actor_id: string | null; reason: string | null; request_id: string | null; trace_id: string | null; changed_at: Date }>>`
      SELECT id, action, from_state, to_state, verdict_id, case_id, actor_type, actor_id, reason, request_id, trace_id, changed_at
      FROM booking_completion_audit WHERE booking_id = ${bookingId} ORDER BY id`;
    const w = await readWarranty(prisma, bookingId);
    return {
      completion: c ? completionJson(c) : null,
      audit: audit.map((a) => ({ ...a, id: Number(a.id), verdict_id: a.verdict_id == null ? null : Number(a.verdict_id), changed_at: a.changed_at.toISOString() })),
      warranty: w ? { state: w.state, policy: w.policy, startsAt: w.starts_at.toISOString(), expiresAt: w.expires_at.toISOString(), voidReason: w.void_reason } : null,
    };
  }
}

export const bookingCompletionService = new BookingCompletionService();
