/**
 * Phase 10 §6 — data access for booking_requirement_states / booking_requirement_audit.
 *
 * Raw SQL on purpose. The tables are new (migration 20260924150000) and the running `--watch`
 * backends hold the Prisma engine, so a regenerated client cannot be produced safely in this
 * checkout; more importantly, a database that has not run the migration must keep serving every
 * other booking operation. The store probes `to_regclass` exactly as lib/service-catalog-store does:
 * absent tables mean the gate is NOT DEPLOYED (reported loudly, never silently), present tables mean
 * it is enforced. The 60 s recheck picks the migration up without a restart.
 */
import { Prisma } from "@prisma/client";
import prisma from "./prisma";
import type {
  GatedSnapshotItem,
  RequirementActorRole,
  RequirementEvidenceKind,
  RequirementState,
  RequirementStateRow,
} from "./requirement-gates";

export type Db = Prisma.TransactionClient | typeof prisma;

let tablesKnown: { present: boolean; at: number } | null = null;
export async function requirementStateTablesPresent(db: Db = prisma): Promise<boolean> {
  if (tablesKnown && (tablesKnown.present || Date.now() - tablesKnown.at < 60_000)) return tablesKnown.present;
  const [row] = await db.$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass('booking_requirement_states') IS NOT NULL AND to_regclass('booking_requirement_audit') IS NOT NULL AS present
  `;
  tablesKnown = { present: row?.present === true, at: Date.now() };
  return tablesKnown.present;
}
/** Test seam only. */
export function _resetRequirementTablesProbe(): void {
  tablesKnown = null;
}

type RawRow = {
  booking_id: string; code: string; item_code: string; kind: string; enforcement: string; verification: string;
  responsibility: string; optional: boolean; service_version: number; state: RequirementState;
  resolved_by_role: RequirementActorRole | null; resolved_by_id: string | null; evidence_kind: RequirementEvidenceKind | null;
  evidence_ref: string | null; evidence_lat: number | null; evidence_lng: number | null; note: string | null;
  valid_for_scheduled_at: Date | null; resolved_at: Date | null; version: number; updated_at: Date;
};

const toRow = (r: RawRow): RequirementStateRow => ({
  bookingId: r.booking_id, code: r.code, itemCode: r.item_code, kind: r.kind, enforcement: r.enforcement,
  verification: r.verification, responsibility: r.responsibility, optional: r.optional, serviceVersion: r.service_version,
  state: r.state, resolvedByRole: r.resolved_by_role, resolvedById: r.resolved_by_id, evidenceKind: r.evidence_kind,
  evidenceRef: r.evidence_ref, evidenceLat: r.evidence_lat, evidenceLng: r.evidence_lng, note: r.note,
  validForScheduledAt: r.valid_for_scheduled_at, resolvedAt: r.resolved_at, version: r.version, updatedAt: r.updated_at,
});

const COLUMNS = Prisma.sql`booking_id, code, item_code, kind, enforcement, verification, responsibility, optional, service_version, state,
  resolved_by_role, resolved_by_id, evidence_kind, evidence_ref, evidence_lat, evidence_lng, note, valid_for_scheduled_at, resolved_at, version, updated_at`;

/**
 * Transaction-local settings the audit trigger reads in addition to the booking audit context.
 * `set_config(…, true)` — never leaks past the transaction.
 */
export async function setRequirementAuditContext(db: Db, input: { action: string; idempotencyKey?: string | null }): Promise<void> {
  await db.$queryRaw`SELECT set_config('homigo.requirement_action', ${input.action}, true), set_config('homigo.idempotency_key', ${input.idempotencyKey ?? ""}, true)`;
}

/**
 * One row per gated snapshot item, idempotent (ON CONFLICT DO NOTHING on (booking_id, code)).
 * A REQUIRED_BEFORE_BOOKING item the customer attested at booking is born SATISFIED with that
 * evidence — bookingService.create already refused the booking without it.
 */
export async function materializeRequirementStates(
  db: Db,
  input: { bookingId: string; serviceVersion: number; items: GatedSnapshotItem[]; customerId: string },
): Promise<number> {
  let inserted = 0;
  for (const it of input.items) {
    const attested = it.enforcementPoint === "BEFORE_BOOKING" && it.attested;
    const res = await db.$executeRaw`
      INSERT INTO booking_requirement_states (
        booking_id, code, item_code, kind, enforcement, verification, responsibility, optional, service_version,
        state, resolved_by_role, resolved_by_id, evidence_kind, evidence_ref, resolved_at
      ) VALUES (
        ${input.bookingId}, ${it.code}, ${it.itemCode}, ${it.kind}, ${it.enforcement}, ${it.verification}, ${it.responsibility}, ${it.optional}, ${input.serviceVersion},
        ${attested ? "SATISFIED" : "UNRESOLVED"},
        ${attested ? "CUSTOMER" : null}, ${attested ? input.customerId : null},
        ${attested ? "CUSTOMER_ATTESTATION" : null}, ${attested ? `attestation:${input.bookingId}` : null},
        ${attested ? new Date() : null}
      )
      ON CONFLICT (booking_id, code) DO NOTHING`;
    inserted += res;
  }
  return inserted;
}

/** All state rows of a booking. `lock` takes FOR UPDATE — the START transaction uses it (§6.15). */
export async function listRequirementStates(db: Db, bookingId: string, opts: { lock?: boolean } = {}): Promise<RequirementStateRow[]> {
  const rows = opts.lock
    ? await db.$queryRaw<RawRow[]>`SELECT ${COLUMNS} FROM booking_requirement_states WHERE booking_id = ${bookingId} ORDER BY code FOR UPDATE`
    : await db.$queryRaw<RawRow[]>`SELECT ${COLUMNS} FROM booking_requirement_states WHERE booking_id = ${bookingId} ORDER BY code`;
  return rows.map(toRow);
}

export async function getRequirementState(db: Db, bookingId: string, code: string, opts: { lock?: boolean } = {}): Promise<RequirementStateRow | null> {
  const rows = opts.lock
    ? await db.$queryRaw<RawRow[]>`SELECT ${COLUMNS} FROM booking_requirement_states WHERE booking_id = ${bookingId} AND code = ${code} FOR UPDATE`
    : await db.$queryRaw<RawRow[]>`SELECT ${COLUMNS} FROM booking_requirement_states WHERE booking_id = ${bookingId} AND code = ${code}`;
  return rows[0] ? toRow(rows[0]) : null;
}

export type RequirementTransitionWrite = {
  bookingId: string;
  code: string;
  /** Compare-and-set: the version the caller read. A concurrent writer makes this miss. */
  expectedVersion: number;
  to: RequirementState;
  resolvedByRole: RequirementActorRole | null;
  resolvedById: string | null;
  evidenceKind: RequirementEvidenceKind | null;
  evidenceRef: string | null;
  evidenceLat?: number | null;
  evidenceLng?: number | null;
  note?: string | null;
  validForScheduledAt: Date | null;
};

/**
 * The one write. Conditional on the version the caller read, so two concurrent transitions resolve
 * to exactly one winner (§6.15); the loser gets null and must re-read. Every successful write bumps
 * `version`, which is what the audit trigger keys on.
 */
export async function transitionRequirementState(db: Db, w: RequirementTransitionWrite): Promise<RequirementStateRow | null> {
  const unresolved = w.to === "UNRESOLVED";
  const rows = await db.$queryRaw<RawRow[]>`
    UPDATE booking_requirement_states SET
      state = ${w.to},
      resolved_by_role = ${unresolved ? null : w.resolvedByRole},
      resolved_by_id = ${unresolved ? null : w.resolvedById},
      evidence_kind = ${unresolved ? null : w.evidenceKind},
      evidence_ref = ${unresolved ? null : w.evidenceRef},
      evidence_lat = ${unresolved ? null : (w.evidenceLat ?? null)},
      evidence_lng = ${unresolved ? null : (w.evidenceLng ?? null)},
      note = ${w.note ?? null},
      valid_for_scheduled_at = ${unresolved ? null : w.validForScheduledAt},
      resolved_at = ${unresolved ? null : new Date()},
      version = version + 1
    WHERE booking_id = ${w.bookingId} AND code = ${w.code} AND version = ${w.expectedVersion}
    RETURNING ${COLUMNS}`;
  return rows[0] ? toRow(rows[0]) : null;
}

export type RequirementAuditRow = {
  id: number; bookingId: string; code: string; serviceVersion: number | null; action: string; fromState: string | null; toState: string;
  actorType: string | null; actorId: string | null; reason: string | null; requestId: string | null; traceId: string | null;
  evidenceKind: string | null; evidenceRef: string | null; idempotencyKey: string | null; changedAt: Date;
};

export async function listRequirementAudit(db: Db, bookingId: string): Promise<RequirementAuditRow[]> {
  const rows = await db.$queryRaw<Array<{
    id: bigint; booking_id: string; code: string; service_version: number | null; action: string; from_state: string | null; to_state: string;
    actor_type: string | null; actor_id: string | null; reason: string | null; request_id: string | null; trace_id: string | null;
    evidence_kind: string | null; evidence_ref: string | null; idempotency_key: string | null; changed_at: Date;
  }>>`SELECT id, booking_id, code, service_version, action, from_state, to_state, actor_type, actor_id, reason, request_id, trace_id,
        evidence_kind, evidence_ref, idempotency_key, changed_at
      FROM booking_requirement_audit WHERE booking_id = ${bookingId} ORDER BY id`;
  return rows.map((r) => ({
    id: Number(r.id), bookingId: r.booking_id, code: r.code, serviceVersion: r.service_version, action: r.action, fromState: r.from_state,
    toState: r.to_state, actorType: r.actor_type, actorId: r.actor_id, reason: r.reason, requestId: r.request_id, traceId: r.trace_id,
    evidenceKind: r.evidence_kind, evidenceRef: r.evidence_ref, idempotencyKey: r.idempotency_key, changedAt: r.changed_at,
  }));
}
