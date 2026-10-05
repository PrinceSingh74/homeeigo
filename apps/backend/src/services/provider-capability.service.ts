/**
 * Phase 11 — provider capability management (the write / admin side).
 *
 * Tables: migration 20260924223000_provider_capabilities (NOT in the Prisma model — raw SQL only).
 * Every reader and writer is guarded by one cached `to_regclass` probe, so a backend running
 * against a database without the migration answers "not deployed" instead of crashing.
 *
 * Rules enforced here (the database CHECKs are the second line):
 *   - A partner only ever DECLARES (status DECLARED / REQUESTED, source SELF). Status, verifier,
 *     source and data_origin are never taken from a request body: inserts name every column and
 *     take values from the server (data_origin = the provider user's `dataOrigin`).
 *   - A VERIFIED (or REVOKED) row's facts are locked for the partner (CAPABILITY_LOCKED): they
 *     declare a new row, the admin verifies it.
 *   - Every admin transition runs `setBookingAuditContext(tx, {actorType: "admin", actorId, reason})`
 *     first, so the capability audit trigger records who and why.
 *   - A service capability can only be requested for a real partner-operational service; a
 *     business-owned service only by a provider with an authorising membership. Membership is only
 *     ever what an admin recorded — never inferred from an email domain or a business name.
 *   - Nothing is seeded: the skills catalogue is whatever an admin created.
 */
import { Prisma, type DataOrigin } from "@prisma/client";
import { randomUUID } from "node:crypto";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { setBookingAuditContext } from "../lib/booking-audit-context";
import { isPartnerOperationalService } from "../lib/service-domain";
import { alreadyPerformsService, grandfatherLegacyOffers, grantServiceCategoryTokens, withdrawServiceCategoryTokens } from "./partner-service-skills.service";

/**
 * The service-capability transactions grandfather every legacy offer of the provider in one
 * statement (one row + one audit row per matching active service). On a large catalogue that
 * outlives Prisma's default 5 s interactive window, so these two transactions get an explicit one.
 */
const CAPABILITY_TX = { timeout: 30_000, maxWait: 10_000 } as const;
import {
  CAPABILITY_CODE,
  LANGUAGE_CODE,
  LANGUAGE_PROFICIENCIES,
  SKILL_LEVELS,
  certificationValidity,
  equipmentUsable,
  insuranceValidity,
  membershipAuthorizes,
  type BusinessMembershipRow,
  type CapabilityStatus,
  type LanguageProficiency,
  type SkillLevel,
} from "../lib/provider-capability";

type Db = Prisma.TransactionClient | typeof prisma;

// ── deployment probe ────────────────────────────────────────────────────────────────────────────

let known: { present: boolean; at: number } | null = null;
/** True once the Phase 11 migration is on this database. The audit table is created last-but-one. */
export async function capabilityTablesPresent(db: Db = prisma): Promise<boolean> {
  if (known && (known.present || Date.now() - known.at < 60_000)) return known.present;
  const [row] = await db.$queryRaw<{ present: boolean }[]>`SELECT (to_regclass('provider_service_capabilities') IS NOT NULL AND to_regclass('provider_capability_audit') IS NOT NULL) AS present`;
  known = { present: row?.present === true, at: Date.now() };
  return known.present;
}

// ── errors ──────────────────────────────────────────────────────────────────────────────────────

export const CAPABILITY_ERRORS = {
  NOT_DEPLOYED: "NOT_DEPLOYED",
  NOT_FOUND: "NOT_FOUND",
  PROVIDER_NOT_FOUND: "PROVIDER_NOT_FOUND",
  INVALID_KIND: "INVALID_KIND",
  INVALID_CODE: "INVALID_CODE",
  INVALID_INPUT: "INVALID_INPUT",
  SKILL_NOT_FOUND: "SKILL_NOT_FOUND",
  SKILL_INACTIVE: "SKILL_INACTIVE",
  DOCUMENT_NOT_FOUND: "DOCUMENT_NOT_FOUND",
  CAPABILITY_LOCKED: "CAPABILITY_LOCKED",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  CAPABILITY_EXPIRED: "CAPABILITY_EXPIRED",
  REASON_REQUIRED: "REASON_REQUIRED",
  ACTION_NOT_APPLICABLE: "ACTION_NOT_APPLICABLE",
  SERVICE_NOT_FOUND: "SERVICE_NOT_FOUND",
  SERVICE_NOT_OPERATIONAL: "SERVICE_NOT_OPERATIONAL",
  BUSINESS_NOT_AUTHORIZED: "BUSINESS_NOT_AUTHORIZED",
  BUSINESS_NOT_FOUND: "BUSINESS_NOT_FOUND",
  BUSINESS_NOT_ACTIVE: "BUSINESS_NOT_ACTIVE",
  DUPLICATE: "DUPLICATE",
  ALREADY_OFFERED: "ALREADY_OFFERED",
} as const;
export type CapabilityError = (typeof CAPABILITY_ERRORS)[keyof typeof CAPABILITY_ERRORS];

/** HTTP status for every error code. Routes answer 500 for anything not in this table. */
export const CAPABILITY_ERROR_STATUS: Record<CapabilityError, number> = {
  NOT_DEPLOYED: 503,
  NOT_FOUND: 404,
  PROVIDER_NOT_FOUND: 404,
  INVALID_KIND: 400,
  INVALID_CODE: 400,
  INVALID_INPUT: 400,
  SKILL_NOT_FOUND: 404,
  SKILL_INACTIVE: 409,
  DOCUMENT_NOT_FOUND: 404,
  CAPABILITY_LOCKED: 409,
  INVALID_TRANSITION: 409,
  CAPABILITY_EXPIRED: 409,
  REASON_REQUIRED: 400,
  ACTION_NOT_APPLICABLE: 400,
  SERVICE_NOT_FOUND: 404,
  SERVICE_NOT_OPERATIONAL: 409,
  BUSINESS_NOT_AUTHORIZED: 409,
  BUSINESS_NOT_FOUND: 404,
  BUSINESS_NOT_ACTIVE: 409,
  DUPLICATE: 409,
  ALREADY_OFFERED: 409,
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: CapabilityError; blocking?: string[]; detail?: string };
const fail = (error: CapabilityError, extra: { blocking?: string[]; detail?: string } = {}): { ok: false; error: CapabilityError; blocking?: string[]; detail?: string } => ({ ok: false, error, ...extra });

// ── kinds ───────────────────────────────────────────────────────────────────────────────────────

export const CAPABILITY_KINDS = ["skills", "certifications", "equipment", "insurance", "languages"] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

/** Closed map: identifiers interpolated with Prisma.raw come ONLY from here, never from input. */
const TABLE: Record<CapabilityKind, string> = {
  skills: "provider_skills",
  certifications: "provider_certifications",
  equipment: "provider_equipment",
  insurance: "provider_insurance",
  languages: "provider_languages",
};
export function isCapabilityKind(k: string): k is CapabilityKind {
  return (CAPABILITY_KINDS as readonly string[]).includes(k);
}

const NEAR_EXPIRY_MS = 30 * 24 * 3_600_000;
const REASON_MIN = 3;

function cleanReason(r: string | null | undefined): string | null {
  const s = (r ?? "").trim();
  return s.length >= REASON_MIN ? s.slice(0, 500) : null;
}
function cleanText(v: string | null | undefined, max = 200): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}
function parseDate(v: string | null | undefined): Date | null | "INVALID" {
  if (v == null || v === "") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "INVALID" : d;
}
const num = (v: bigint | number | null | undefined) => (v == null ? null : Number(v));

type Actor = { actorType: "admin" | "partner"; actorId: string };

async function audit(tx: Prisma.TransactionClient, actor: Actor, reason: string | null) {
  await setBookingAuditContext(tx, { actorType: actor.actorType, actorId: actor.actorId, reason });
}

async function providerOrigin(db: Db, providerId: string): Promise<{ exists: boolean; origin: DataOrigin | null }> {
  const p = await db.provider.findUnique({ where: { id: providerId }, select: { id: true, user: { select: { dataOrigin: true } } } });
  if (!p) return { exists: false, origin: null };
  return { exists: true, origin: (p.user?.dataOrigin ?? null) as DataOrigin | null };
}

async function documentBelongs(db: Db, providerId: string, documentId: string): Promise<boolean> {
  const d = await db.providerDocument.findFirst({ where: { id: documentId, providerId }, select: { id: true } });
  return d !== null;
}

/** Postgres unique violation raised from a raw statement. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  return e?.code === "P2002" || e?.meta?.code === "23505" || /23505|unique constraint/i.test(e?.message ?? "");
}

// ── raw row shapes ──────────────────────────────────────────────────────────────────────────────

type RawRow = Record<string, unknown> & { id: bigint; provider_id: string; status?: CapabilityStatus; data_origin: DataOrigin | null };

function camel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
    out[key] = typeof v === "bigint" ? Number(v) : v;
  }
  return out;
}

async function lockRow(tx: Prisma.TransactionClient, kind: CapabilityKind, providerId: string, rowId: number): Promise<RawRow | null> {
  const rows = await tx.$queryRaw<RawRow[]>(Prisma.sql`SELECT * FROM ${Prisma.raw(TABLE[kind])} WHERE id = ${rowId} AND provider_id = ${providerId} FOR UPDATE`);
  return rows[0] ?? null;
}

// ── declare input shapes (partner) ──────────────────────────────────────────────────────────────

export type DeclareInput = {
  skills: { skillCode: string; level?: string | null };
  certifications: { certificationType: string; issuer?: string | null; referenceNumber?: string | null; issuedAt?: string | null; expiresAt?: string | null; documentId?: string | null };
  equipment: { equipmentType: string; ownership?: string | null; operational?: string | null; note?: string | null };
  insurance: { insuranceType: string; insurer?: string | null; policyReference?: string | null; effectiveFrom?: string | null; expiresAt: string; documentId?: string | null };
  languages: { languageCode: string; proficiency?: string | null };
};

const OWNERSHIP = ["OWNED", "RENTED", "EMPLOYER"] as const;
const OPERATIONAL = ["OPERATIONAL", "OUT_OF_SERVICE"] as const;

class ProviderCapabilityService {
  // ── skills catalogue (admin) ──────────────────────────────────────────────────────────────────

  async listSkills(opts: { activeOnly?: boolean } = {}): Promise<Result<{ skills: unknown[] }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const rows = opts.activeOnly
      ? await prisma.$queryRaw<Record<string, unknown>[]>`SELECT code, category, name, active, created_at, updated_at FROM skills WHERE active ORDER BY category, name`
      : await prisma.$queryRaw<Record<string, unknown>[]>`SELECT code, category, name, active, created_at, updated_at FROM skills ORDER BY category, name`;
    return { ok: true, data: { skills: rows.map(camel) } };
  }

  async createSkill(input: { code: string; category: string; name: string }): Promise<Result<{ skill: unknown }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const code = input.code.trim();
    if (!CAPABILITY_CODE.test(code)) return fail("INVALID_CODE");
    const category = cleanText(input.category, 60);
    const name = cleanText(input.name, 120);
    if (!category || !name) return fail("INVALID_INPUT", { detail: "category and name are required" });
    try {
      const rows = await prisma.$queryRaw<Record<string, unknown>[]>`INSERT INTO skills (code, category, name) VALUES (${code}, ${category}, ${name}) RETURNING code, category, name, active, created_at, updated_at`;
      incCounter("provider_capability_admin_action_total", { kind: "skill_catalogue", action: "create" });
      return { ok: true, data: { skill: camel(rows[0]!) } };
    } catch (err) {
      if (isUniqueViolation(err)) return fail("DUPLICATE");
      throw err;
    }
  }

  async updateSkill(code: string, input: { category?: string; name?: string; active?: boolean }): Promise<Result<{ skill: unknown }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const category = input.category === undefined ? null : cleanText(input.category, 60);
    const name = input.name === undefined ? null : cleanText(input.name, 120);
    if ((input.category !== undefined && !category) || (input.name !== undefined && !name)) return fail("INVALID_INPUT");
    const active = input.active === undefined ? null : input.active;
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      UPDATE skills SET category = COALESCE(${category}, category), name = COALESCE(${name}, name),
        active = COALESCE(${active}::boolean, active), updated_at = now()
      WHERE code = ${code} RETURNING code, category, name, active, created_at, updated_at`;
    if (!rows[0]) return fail("SKILL_NOT_FOUND");
    incCounter("provider_capability_admin_action_total", { kind: "skill_catalogue", action: "update" });
    return { ok: true, data: { skill: camel(rows[0]) } };
  }

  // ── partner declare ───────────────────────────────────────────────────────────────────────────

  /**
   * The partner's only write. Every column is named; status/source/verifier/origin come from the
   * server. Keyed kinds (skills, equipment, languages: one row per provider+code) re-declare in
   * place only while the row is still a claim — a VERIFIED or REVOKED row is CAPABILITY_LOCKED.
   */
  async declare<K extends CapabilityKind>(providerId: string, actorUserId: string, kind: K, input: DeclareInput[K]): Promise<Result<{ row: unknown; changed: boolean }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const prov = await providerOrigin(prisma, providerId);
    if (!prov.exists) return fail("PROVIDER_NOT_FOUND");
    const actor: Actor = { actorType: "partner", actorId: actorUserId };
    const origin = prov.origin;
    const r = await prisma.$transaction(async (tx): Promise<Result<{ row: unknown; changed: boolean }>> => {
      await audit(tx, actor, `partner declared ${kind}`);
      switch (kind) {
        case "skills": return this.declareSkill(tx, providerId, origin, input as DeclareInput["skills"]);
        case "certifications": return this.declareCertification(tx, providerId, origin, input as DeclareInput["certifications"]);
        case "equipment": return this.declareEquipment(tx, providerId, origin, input as DeclareInput["equipment"]);
        case "insurance": return this.declareInsurance(tx, providerId, origin, input as DeclareInput["insurance"]);
        case "languages": return this.declareLanguage(tx, providerId, origin, input as DeclareInput["languages"]);
        default: return fail("INVALID_KIND");
      }
    });
    if (r.ok && r.data.changed) {
      incCounter("provider_capability_declared_total", { kind });
      logger.info("provider_capability_declared", { providerId, kind });
    }
    return r;
  }

  private async declareSkill(tx: Prisma.TransactionClient, providerId: string, origin: DataOrigin | null, input: DeclareInput["skills"]): Promise<Result<{ row: unknown; changed: boolean }>> {
    const code = (input.skillCode ?? "").trim();
    if (!CAPABILITY_CODE.test(code)) return fail("INVALID_CODE");
    const level = input.level == null ? null : input.level;
    if (level !== null && !(SKILL_LEVELS as readonly string[]).includes(level)) return fail("INVALID_INPUT", { detail: "level" });
    const [skill] = await tx.$queryRaw<{ active: boolean }[]>`SELECT active FROM skills WHERE code = ${code}`;
    if (!skill) return fail("SKILL_NOT_FOUND");
    if (!skill.active) return fail("SKILL_INACTIVE");
    const [existing] = await tx.$queryRaw<RawRow[]>`SELECT * FROM provider_skills WHERE provider_id = ${providerId} AND skill_code = ${code} FOR UPDATE`;
    if (existing) {
      if (existing.status === "VERIFIED" || existing.status === "REVOKED") {
        if (existing.status === "VERIFIED" && (existing.level ?? null) === level) return { ok: true, data: { row: camel(existing), changed: false } };
        return fail("CAPABILITY_LOCKED");
      }
      if (existing.status === "DECLARED" && (existing.level ?? null) === level) return { ok: true, data: { row: camel(existing), changed: false } };
      const [row] = await tx.$queryRaw<RawRow[]>`UPDATE provider_skills SET level = ${level}, status = 'DECLARED', source = 'SELF', verified_by = NULL, verified_at = NULL WHERE id = ${existing.id} RETURNING *`;
      return { ok: true, data: { row: camel(row!), changed: true } };
    }
    const [row] = await tx.$queryRaw<RawRow[]>`
      INSERT INTO provider_skills (provider_id, skill_code, level, status, source, verified_by, verified_at, data_origin)
      VALUES (${providerId}, ${code}, ${level}, 'DECLARED', 'SELF', NULL, NULL, ${origin}::"DataOrigin") RETURNING *`;
    return { ok: true, data: { row: camel(row!), changed: true } };
  }

  private async declareCertification(tx: Prisma.TransactionClient, providerId: string, origin: DataOrigin | null, input: DeclareInput["certifications"]): Promise<Result<{ row: unknown; changed: boolean }>> {
    const type = (input.certificationType ?? "").trim();
    if (!CAPABILITY_CODE.test(type)) return fail("INVALID_CODE");
    const issuedAt = parseDate(input.issuedAt);
    const expiresAt = parseDate(input.expiresAt);
    if (issuedAt === "INVALID" || expiresAt === "INVALID") return fail("INVALID_INPUT", { detail: "date" });
    if (issuedAt && expiresAt && expiresAt.getTime() <= issuedAt.getTime()) return fail("INVALID_INPUT", { detail: "expiresAt must be after issuedAt" });
    const documentId = cleanText(input.documentId, 64);
    if (documentId && !(await documentBelongs(tx, providerId, documentId))) return fail("DOCUMENT_NOT_FOUND");
    const [row] = await tx.$queryRaw<RawRow[]>`
      INSERT INTO provider_certifications (provider_id, certification_type, issuer, reference_number, issued_at, expires_at, status, verification_source, document_id, verified_by, verified_at, revoked_at, revoked_reason, data_origin)
      VALUES (${providerId}, ${type}, ${cleanText(input.issuer, 120)}, ${cleanText(input.referenceNumber, 120)}, ${issuedAt}, ${expiresAt}, 'DECLARED', NULL, ${documentId}, NULL, NULL, NULL, NULL, ${origin}::"DataOrigin") RETURNING *`;
    return { ok: true, data: { row: camel(row!), changed: true } };
  }

  private async declareEquipment(tx: Prisma.TransactionClient, providerId: string, origin: DataOrigin | null, input: DeclareInput["equipment"]): Promise<Result<{ row: unknown; changed: boolean }>> {
    const type = (input.equipmentType ?? "").trim();
    if (!CAPABILITY_CODE.test(type)) return fail("INVALID_CODE");
    const ownership = input.ownership ?? "OWNED";
    const operational = input.operational ?? "OPERATIONAL";
    if (!(OWNERSHIP as readonly string[]).includes(ownership) || !(OPERATIONAL as readonly string[]).includes(operational)) return fail("INVALID_INPUT");
    const note = cleanText(input.note, 300);
    const [existing] = await tx.$queryRaw<RawRow[]>`SELECT * FROM provider_equipment WHERE provider_id = ${providerId} AND equipment_type = ${type} FOR UPDATE`;
    if (existing) {
      if (existing.status === "VERIFIED" || existing.status === "REVOKED") {
        // The one partner-reported fact on a verified item: it broke / was repaired. Ownership
        // and the note are what was verified, so changing them needs a new verification.
        if (existing.status === "REVOKED" || existing.ownership !== ownership || (input.note !== undefined && (existing.note ?? null) !== note)) return fail("CAPABILITY_LOCKED");
        if (existing.operational === operational) return { ok: true, data: { row: camel(existing), changed: false } };
        const [row] = await tx.$queryRaw<RawRow[]>`UPDATE provider_equipment SET operational = ${operational} WHERE id = ${existing.id} RETURNING *`;
        return { ok: true, data: { row: camel(row!), changed: true } };
      }
      const [row] = await tx.$queryRaw<RawRow[]>`UPDATE provider_equipment SET ownership = ${ownership}, operational = ${operational}, note = ${note}, status = 'DECLARED', verified_by = NULL, verified_at = NULL WHERE id = ${existing.id} RETURNING *`;
      return { ok: true, data: { row: camel(row!), changed: true } };
    }
    const [row] = await tx.$queryRaw<RawRow[]>`
      INSERT INTO provider_equipment (provider_id, equipment_type, ownership, operational, status, verified_by, verified_at, inspection_due_at, note, data_origin)
      VALUES (${providerId}, ${type}, ${ownership}, ${operational}, 'DECLARED', NULL, NULL, NULL, ${note}, ${origin}::"DataOrigin") RETURNING *`;
    return { ok: true, data: { row: camel(row!), changed: true } };
  }

  private async declareInsurance(tx: Prisma.TransactionClient, providerId: string, origin: DataOrigin | null, input: DeclareInput["insurance"]): Promise<Result<{ row: unknown; changed: boolean }>> {
    const type = (input.insuranceType ?? "").trim();
    if (!CAPABILITY_CODE.test(type)) return fail("INVALID_CODE");
    const effectiveFrom = parseDate(input.effectiveFrom);
    const expiresAt = parseDate(input.expiresAt);
    if (effectiveFrom === "INVALID" || expiresAt === "INVALID" || expiresAt === null) return fail("INVALID_INPUT", { detail: "expiresAt is required" });
    if (effectiveFrom && expiresAt.getTime() <= effectiveFrom.getTime()) return fail("INVALID_INPUT", { detail: "expiresAt must be after effectiveFrom" });
    const documentId = cleanText(input.documentId, 64);
    if (documentId && !(await documentBelongs(tx, providerId, documentId))) return fail("DOCUMENT_NOT_FOUND");
    const [row] = await tx.$queryRaw<RawRow[]>`
      INSERT INTO provider_insurance (provider_id, insurance_type, insurer, policy_reference, effective_from, expires_at, status, document_id, verified_by, verified_at, revoked_at, revoked_reason, data_origin)
      VALUES (${providerId}, ${type}, ${cleanText(input.insurer, 120)}, ${cleanText(input.policyReference, 120)}, ${effectiveFrom}, ${expiresAt}, 'DECLARED', ${documentId}, NULL, NULL, NULL, NULL, ${origin}::"DataOrigin") RETURNING *`;
    return { ok: true, data: { row: camel(row!), changed: true } };
  }

  private async declareLanguage(tx: Prisma.TransactionClient, providerId: string, origin: DataOrigin | null, input: DeclareInput["languages"]): Promise<Result<{ row: unknown; changed: boolean }>> {
    const code = (input.languageCode ?? "").trim();
    if (!LANGUAGE_CODE.test(code)) return fail("INVALID_CODE");
    const proficiency = input.proficiency ?? "CONVERSATIONAL";
    if (!(LANGUAGE_PROFICIENCIES as readonly string[]).includes(proficiency)) return fail("INVALID_INPUT", { detail: "proficiency" });
    const [existing] = await tx.$queryRaw<RawRow[]>`SELECT * FROM provider_languages WHERE provider_id = ${providerId} AND language_code = ${code} FOR UPDATE`;
    if (existing) {
      // An admin-set (or admin-deactivated) language is the admin's record, not the partner's.
      if (existing.source === "ADMIN") {
        if (existing.active && existing.proficiency === proficiency) return { ok: true, data: { row: camel(existing), changed: false } };
        return fail("CAPABILITY_LOCKED");
      }
      if (existing.active && existing.proficiency === proficiency) return { ok: true, data: { row: camel(existing), changed: false } };
      const [row] = await tx.$queryRaw<RawRow[]>`UPDATE provider_languages SET proficiency = ${proficiency}, active = true WHERE id = ${existing.id} RETURNING *`;
      return { ok: true, data: { row: camel(row!), changed: true } };
    }
    const [row] = await tx.$queryRaw<RawRow[]>`
      INSERT INTO provider_languages (provider_id, language_code, proficiency, source, active, data_origin)
      VALUES (${providerId}, ${code}, ${proficiency}, 'SELF', true, ${origin}::"DataOrigin") RETURNING *`;
    return { ok: true, data: { row: camel(row!), changed: true } };
  }

  /**
   * Partner edit of a certification / insurance row's facts. Allowed only while the row is a claim
   * (DECLARED, or REJECTED — which goes back to DECLARED for re-review). A VERIFIED or REVOKED row
   * is CAPABILITY_LOCKED: declare a new row instead.
   */
  async partnerEdit(providerId: string, actorUserId: string, kind: CapabilityKind, rowId: number, input: {
    issuer?: string | null; referenceNumber?: string | null; issuedAt?: string | null; expiresAt?: string | null;
    insurer?: string | null; policyReference?: string | null; effectiveFrom?: string | null; documentId?: string | null;
  }): Promise<Result<{ row: unknown }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    if (kind !== "certifications" && kind !== "insurance") return fail("ACTION_NOT_APPLICABLE", { detail: "re-declare keyed capabilities instead" });
    return prisma.$transaction(async (tx): Promise<Result<{ row: unknown }>> => {
      await audit(tx, { actorType: "partner", actorId: actorUserId }, `partner edited ${kind}`);
      const row = await lockRow(tx, kind, providerId, rowId);
      if (!row) return fail("NOT_FOUND");
      if (row.status === "VERIFIED" || row.status === "REVOKED") return fail("CAPABILITY_LOCKED");
      const documentId = input.documentId === undefined ? (row.document_id as string | null) : cleanText(input.documentId, 64);
      if (input.documentId && documentId && !(await documentBelongs(tx, providerId, documentId))) return fail("DOCUMENT_NOT_FOUND");
      if (kind === "certifications") {
        const issuedAt = input.issuedAt === undefined ? (row.issued_at as Date | null) : parseDate(input.issuedAt);
        const expiresAt = input.expiresAt === undefined ? (row.expires_at as Date | null) : parseDate(input.expiresAt);
        if (issuedAt === "INVALID" || expiresAt === "INVALID") return fail("INVALID_INPUT", { detail: "date" });
        if (issuedAt && expiresAt && expiresAt.getTime() <= issuedAt.getTime()) return fail("INVALID_INPUT", { detail: "expiresAt must be after issuedAt" });
        const issuer = input.issuer === undefined ? (row.issuer as string | null) : cleanText(input.issuer, 120);
        const ref = input.referenceNumber === undefined ? (row.reference_number as string | null) : cleanText(input.referenceNumber, 120);
        const [out] = await tx.$queryRaw<RawRow[]>`UPDATE provider_certifications SET issuer = ${issuer}, reference_number = ${ref}, issued_at = ${issuedAt}, expires_at = ${expiresAt}, document_id = ${documentId}, status = 'DECLARED' WHERE id = ${row.id} RETURNING *`;
        return { ok: true, data: { row: camel(out!) } };
      }
      const effectiveFrom = input.effectiveFrom === undefined ? (row.effective_from as Date | null) : parseDate(input.effectiveFrom);
      const expiresAt = input.expiresAt === undefined ? (row.expires_at as Date) : parseDate(input.expiresAt);
      if (effectiveFrom === "INVALID" || expiresAt === "INVALID" || expiresAt === null) return fail("INVALID_INPUT", { detail: "date" });
      if (effectiveFrom && expiresAt.getTime() <= effectiveFrom.getTime()) return fail("INVALID_INPUT", { detail: "expiresAt must be after effectiveFrom" });
      const insurer = input.insurer === undefined ? (row.insurer as string | null) : cleanText(input.insurer, 120);
      const ref = input.policyReference === undefined ? (row.policy_reference as string | null) : cleanText(input.policyReference, 120);
      const [out] = await tx.$queryRaw<RawRow[]>`UPDATE provider_insurance SET insurer = ${insurer}, policy_reference = ${ref}, effective_from = ${effectiveFrom}, expires_at = ${expiresAt}, document_id = ${documentId}, status = 'DECLARED' WHERE id = ${row.id} RETURNING *`;
      return { ok: true, data: { row: camel(out!) } };
    });
  }

  /** A partner withdraws their own claim. Only DECLARED rows (REQUESTED for services, SELF for languages). */
  async partnerDelete(providerId: string, actorUserId: string, kind: CapabilityKind | "services", rowId: number): Promise<Result<{ deleted: true }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    return prisma.$transaction(async (tx): Promise<Result<{ deleted: true }>> => {
      await audit(tx, { actorType: "partner", actorId: actorUserId }, `partner withdrew ${kind}`);
      if (kind === "services") {
        const [row] = await tx.$queryRaw<{ id: bigint; status: string }[]>`SELECT id, status FROM provider_service_capabilities WHERE id = ${rowId} AND provider_id = ${providerId} FOR UPDATE`;
        if (!row) return fail("NOT_FOUND");
        if (row.status !== "REQUESTED") return fail("CAPABILITY_LOCKED");
        await tx.$executeRaw`DELETE FROM provider_service_capabilities WHERE id = ${row.id}`;
        return { ok: true, data: { deleted: true } };
      }
      const row = await lockRow(tx, kind, providerId, rowId);
      if (!row) return fail("NOT_FOUND");
      // A claim that was never accepted (still DECLARED, or REJECTED) is the partner's to withdraw; the
      // audit trigger keeps the rejected row's before-image. VERIFIED and REVOKED rows are decisions.
      const withdrawable = kind === "languages" ? row.source === "SELF" : row.status === "DECLARED" || row.status === "REJECTED";
      if (!withdrawable) return fail("CAPABILITY_LOCKED");
      await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw(TABLE[kind])} WHERE id = ${row.id}`);
      return { ok: true, data: { deleted: true } };
    });
  }

  // ── admin transitions ─────────────────────────────────────────────────────────────────────────

  /**
   * verify: DECLARED | REJECTED → VERIFIED (never an expired row).
   * reject: DECLARED → REJECTED (reason ≥3).
   * revoke: DECLARED | VERIFIED → REVOKED (reason ≥3). Verifier columns are cleared (the CHECK
   *   ties them to VERIFIED); the before-image is in the audit row.
   * Languages have no verification lifecycle: revoke deactivates (source ADMIN, active=false).
   */
  async adminTransition(input: {
    providerId: string; kind: CapabilityKind; rowId: number; action: "verify" | "reject" | "revoke";
    adminUserId: string; reason?: string | null; expiresAt?: string | null; now?: Date;
  }): Promise<Result<{ row: unknown }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const now = input.now ?? new Date();
    const reason = cleanReason(input.reason);
    if ((input.action === "reject" || input.action === "revoke") && !reason) return fail("REASON_REQUIRED");
    const expiresOverride = parseDate(input.expiresAt);
    if (expiresOverride === "INVALID") return fail("INVALID_INPUT", { detail: "expiresAt" });
    const { kind, action } = input;
    const r = await prisma.$transaction(async (tx): Promise<Result<{ row: unknown }>> => {
      await audit(tx, { actorType: "admin", actorId: input.adminUserId }, reason ?? `admin ${action} ${kind}`);
      const row = await lockRow(tx, kind, input.providerId, input.rowId);
      if (!row) return fail("NOT_FOUND");
      const table = Prisma.raw(TABLE[kind]);

      if (kind === "languages") {
        if (action !== "revoke") return fail("ACTION_NOT_APPLICABLE", { detail: "languages have no verification lifecycle" });
        const [out] = await tx.$queryRaw<RawRow[]>`UPDATE provider_languages SET active = false, source = 'ADMIN' WHERE id = ${row.id} RETURNING *`;
        return { ok: true, data: { row: camel(out!) } };
      }

      const status = row.status as CapabilityStatus;
      if (action === "verify") {
        if (status !== "DECLARED" && status !== "REJECTED") return fail("INVALID_TRANSITION", { detail: `${status} → VERIFIED` });
        const hasExpiry = kind === "skills" || kind === "certifications" || kind === "insurance";
        if (expiresOverride && !hasExpiry) return fail("ACTION_NOT_APPLICABLE", { detail: "expiresAt" });
        const effectiveExpiry = (expiresOverride ?? (hasExpiry ? (row.expires_at as Date | null) : null)) as Date | null;
        if (effectiveExpiry && effectiveExpiry.getTime() <= now.getTime()) return fail("CAPABILITY_EXPIRED");
        if (kind === "certifications" && expiresOverride && row.issued_at && expiresOverride.getTime() <= (row.issued_at as Date).getTime()) return fail("INVALID_INPUT", { detail: "expiresAt must be after issuedAt" });
        if (kind === "insurance" && expiresOverride && row.effective_from && expiresOverride.getTime() <= (row.effective_from as Date).getTime()) return fail("INVALID_INPUT", { detail: "expiresAt must be after effectiveFrom" });
        let out: RawRow[];
        if (kind === "certifications") {
          out = await tx.$queryRaw<RawRow[]>`UPDATE provider_certifications SET status = 'VERIFIED', verified_by = ${input.adminUserId}, verified_at = ${now}, verification_source = 'ADMIN', expires_at = COALESCE(${expiresOverride}, expires_at) WHERE id = ${row.id} RETURNING *`;
        } else if (kind === "insurance") {
          out = await tx.$queryRaw<RawRow[]>`UPDATE provider_insurance SET status = 'VERIFIED', verified_by = ${input.adminUserId}, verified_at = ${now}, expires_at = COALESCE(${expiresOverride}, expires_at) WHERE id = ${row.id} RETURNING *`;
        } else if (kind === "skills") {
          out = await tx.$queryRaw<RawRow[]>`UPDATE provider_skills SET status = 'VERIFIED', verified_by = ${input.adminUserId}, verified_at = ${now}, expires_at = COALESCE(${expiresOverride}, expires_at) WHERE id = ${row.id} RETURNING *`;
        } else {
          out = await tx.$queryRaw<RawRow[]>`UPDATE provider_equipment SET status = 'VERIFIED', verified_by = ${input.adminUserId}, verified_at = ${now} WHERE id = ${row.id} RETURNING *`;
        }
        return { ok: true, data: { row: camel(out[0]!) } };
      }

      if (action === "reject") {
        if (status !== "DECLARED") return fail("INVALID_TRANSITION", { detail: `${status} → REJECTED (use revoke for a verified row)` });
        const [out] = await tx.$queryRaw<RawRow[]>(Prisma.sql`UPDATE ${table} SET status = 'REJECTED', verified_by = NULL, verified_at = NULL WHERE id = ${row.id} RETURNING *`);
        return { ok: true, data: { row: camel(out!) } };
      }

      // revoke
      if (status !== "DECLARED" && status !== "VERIFIED") return fail("INVALID_TRANSITION", { detail: `${status} → REVOKED` });
      const out = kind === "certifications" || kind === "insurance"
        ? await tx.$queryRaw<RawRow[]>(Prisma.sql`UPDATE ${table} SET status = 'REVOKED', verified_by = NULL, verified_at = NULL, revoked_at = ${now}, revoked_reason = ${reason} WHERE id = ${row.id} RETURNING *`)
        : await tx.$queryRaw<RawRow[]>(Prisma.sql`UPDATE ${table} SET status = 'REVOKED', verified_by = NULL, verified_at = NULL WHERE id = ${row.id} RETURNING *`);
      return { ok: true, data: { row: camel(out[0]!) } };
    });
    if (r.ok) {
      incCounter("provider_capability_admin_action_total", { kind, action });
      logger.info("provider_capability_admin_action", { providerId: input.providerId, kind, action, rowId: input.rowId });
    }
    return r;
  }

  /**
   * Admin correction of dates / level / proficiency (reason ≥3). Status is never set here — the
   * lifecycle moves only through adminTransition.
   */
  async adminPatch(input: {
    providerId: string; kind: CapabilityKind; rowId: number; adminUserId: string; reason?: string | null;
    expiresAt?: string | null; issuedAt?: string | null; effectiveFrom?: string | null; inspectionDueAt?: string | null;
    level?: string | null; proficiency?: string | null; operational?: string | null;
  }): Promise<Result<{ row: unknown }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const reason = cleanReason(input.reason);
    if (!reason) return fail("REASON_REQUIRED");
    const { kind } = input;
    const d = (v: string | null | undefined) => (v === undefined ? undefined : parseDate(v));
    const expiresAt = d(input.expiresAt), issuedAt = d(input.issuedAt), effectiveFrom = d(input.effectiveFrom), inspectionDueAt = d(input.inspectionDueAt);
    if ([expiresAt, issuedAt, effectiveFrom, inspectionDueAt].includes("INVALID")) return fail("INVALID_INPUT", { detail: "date" });
    const allowed: Record<CapabilityKind, string[]> = {
      skills: ["expiresAt", "level"],
      certifications: ["expiresAt", "issuedAt"],
      equipment: ["inspectionDueAt", "operational"],
      insurance: ["expiresAt", "effectiveFrom"],
      languages: ["proficiency"],
    };
    const given = (["expiresAt", "issuedAt", "effectiveFrom", "inspectionDueAt", "level", "proficiency", "operational"] as const).filter((k) => input[k] !== undefined);
    if (given.length === 0) return fail("INVALID_INPUT", { detail: "nothing to change" });
    const bad = given.filter((k) => !allowed[kind].includes(k));
    if (bad.length) return fail("ACTION_NOT_APPLICABLE", { detail: bad.join(",") });
    if (input.level !== undefined && input.level !== null && !(SKILL_LEVELS as readonly string[]).includes(input.level)) return fail("INVALID_INPUT", { detail: "level" });
    if (input.proficiency !== undefined && !(LANGUAGE_PROFICIENCIES as readonly string[]).includes(input.proficiency ?? "")) return fail("INVALID_INPUT", { detail: "proficiency" });
    if (input.operational !== undefined && !(OPERATIONAL as readonly string[]).includes(input.operational ?? "")) return fail("INVALID_INPUT", { detail: "operational" });
    if (kind === "insurance" && expiresAt === null) return fail("INVALID_INPUT", { detail: "insurance requires expiresAt" });

    const r = await prisma.$transaction(async (tx): Promise<Result<{ row: unknown }>> => {
      await audit(tx, { actorType: "admin", actorId: input.adminUserId }, reason);
      const row = await lockRow(tx, kind, input.providerId, input.rowId);
      if (!row) return fail("NOT_FOUND");
      const keep = <T,>(v: T | undefined, cur: unknown) => (v === undefined ? (cur as T) : v);
      let out: RawRow[];
      switch (kind) {
        case "skills":
          out = await tx.$queryRaw<RawRow[]>`UPDATE provider_skills SET expires_at = ${keep(expiresAt as Date | null | undefined, row.expires_at)}, level = ${keep(input.level as SkillLevel | null | undefined, row.level)} WHERE id = ${row.id} RETURNING *`;
          break;
        case "certifications": {
          const iss = keep(issuedAt as Date | null | undefined, row.issued_at) as Date | null;
          const exp = keep(expiresAt as Date | null | undefined, row.expires_at) as Date | null;
          if (iss && exp && exp.getTime() <= iss.getTime()) return fail("INVALID_INPUT", { detail: "expiresAt must be after issuedAt" });
          out = await tx.$queryRaw<RawRow[]>`UPDATE provider_certifications SET issued_at = ${iss}, expires_at = ${exp} WHERE id = ${row.id} RETURNING *`;
          break;
        }
        case "insurance": {
          const eff = keep(effectiveFrom as Date | null | undefined, row.effective_from) as Date | null;
          const exp = keep(expiresAt as Date | undefined, row.expires_at) as Date;
          if (eff && exp.getTime() <= eff.getTime()) return fail("INVALID_INPUT", { detail: "expiresAt must be after effectiveFrom" });
          out = await tx.$queryRaw<RawRow[]>`UPDATE provider_insurance SET effective_from = ${eff}, expires_at = ${exp} WHERE id = ${row.id} RETURNING *`;
          break;
        }
        case "equipment":
          out = await tx.$queryRaw<RawRow[]>`UPDATE provider_equipment SET inspection_due_at = ${keep(inspectionDueAt as Date | null | undefined, row.inspection_due_at)}, operational = ${keep(input.operational ?? undefined, row.operational)} WHERE id = ${row.id} RETURNING *`;
          break;
        case "languages":
          out = await tx.$queryRaw<RawRow[]>`UPDATE provider_languages SET proficiency = ${keep(input.proficiency as LanguageProficiency | undefined, row.proficiency)}, source = 'ADMIN' WHERE id = ${row.id} RETURNING *`;
          break;
      }
      return { ok: true, data: { row: camel(out[0]!) } };
    });
    if (r.ok) incCounter("provider_capability_admin_action_total", { kind, action: "patch" });
    return r;
  }

  // ── provider ↔ service capability ─────────────────────────────────────────────────────────────

  private async loadService(db: Db, serviceId: string) {
    const svc = await db.service.findUnique({
      where: { id: serviceId },
      select: { id: true, isActive: true, isBookable: true, lifecycleStatus: true, configStatus: true, dataOrigin: true },
    });
    if (!svc) return null;
    const [b] = await db.$queryRaw<{ business_id: string | null }[]>`SELECT business_id FROM services WHERE id = ${serviceId}`;
    return { ...svc, businessId: b?.business_id ?? null };
  }

  private async membershipsFor(db: Db, providerId: string): Promise<BusinessMembershipRow[]> {
    const rows = await db.$queryRaw<{ id: bigint; business_id: string; provider_id: string; role: string; active: boolean; effective_from: Date; effective_to: Date | null; business_status: "ACTIVE" | "SUSPENDED" | "CLOSED" }[]>`
      SELECT bp.id, bp.business_id, bp.provider_id, bp.role, bp.active, bp.effective_from, bp.effective_to, b.status AS business_status
      FROM business_providers bp JOIN businesses b ON b.id = bp.business_id WHERE bp.provider_id = ${providerId} ORDER BY bp.id`;
    return rows.map((r) => ({ id: Number(r.id), businessId: r.business_id, providerId: r.provider_id, role: r.role, active: r.active, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, businessStatus: r.business_status }));
  }

  /** Why this provider may not hold a capability for this service right now (empty = eligible). */
  private async serviceEligibility(db: Db, providerId: string, serviceId: string, now: Date): Promise<{ missing: true } | { missing: false; blocking: string[]; businessId: string | null }> {
    const svc = await this.loadService(db, serviceId);
    if (!svc) return { missing: true };
    const blocking: string[] = [];
    if (!isPartnerOperationalService(svc)) blocking.push("SERVICE_NOT_OPERATIONAL");
    if (svc.businessId) {
      const ms = await this.membershipsFor(db, providerId);
      if (!ms.some((m) => membershipAuthorizes(m, svc.businessId!, now))) blocking.push("BUSINESS_NOT_AUTHORIZED");
    }
    return { missing: false, blocking, businessId: svc.businessId };
  }

  /**
   * Partner asks to perform one more catalogue service. Always REQUESTED/SELF — never ACTIVE.
   * Signup skills are copied to ACTIVE/LEGACY rows in the same transaction so current jobs
   * keep matching. A service they already perform is refused (ALREADY_OFFERED).
   * `note` is the partner's reason; it sits on the REQUESTED row until an admin decides.
   */
  async requestService(providerId: string, actorUserId: string, serviceId: string, now = new Date(), note?: string | null): Promise<Result<{ row: unknown; changed: boolean }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const prov = await providerOrigin(prisma, providerId);
    if (!prov.exists) return fail("PROVIDER_NOT_FOUND");
    const elig = await this.serviceEligibility(prisma, providerId, serviceId, now);
    if (elig.missing) return fail("SERVICE_NOT_FOUND");
    if (elig.blocking.length) return fail(elig.blocking[0] as CapabilityError, { blocking: elig.blocking });
    const requestNote = cleanText(note, 300);
    const r = await prisma.$transaction(async (tx): Promise<Result<{ row: unknown; changed: boolean }>> => {
      await audit(tx, { actorType: "partner", actorId: actorUserId }, requestNote ? `partner requested service capability: ${requestNote}` : "partner requested service capability");
      const [existing] = await tx.$queryRaw<RawRow[]>`SELECT * FROM provider_service_capabilities WHERE provider_id = ${providerId} AND service_id = ${serviceId} FOR UPDATE`;
      if (existing) {
        if (String(existing.status) === "REQUESTED" || String(existing.status) === "ACTIVE") return { ok: true, data: { row: camel(existing), changed: false } };
        return fail("CAPABILITY_LOCKED", { detail: `capability is ${String(existing.status)}` });
      }
      if (await alreadyPerformsService(tx, providerId, serviceId)) return fail("ALREADY_OFFERED", { detail: "This partner already performs this service" });
      await grandfatherLegacyOffers(tx, { providerId, actorUserId, origin: prov.origin, now, exceptServiceId: serviceId });
      const [row] = await tx.$queryRaw<RawRow[]>`
        INSERT INTO provider_service_capabilities (provider_id, service_id, status, source, verified_by, verified_at, suspended_reason, data_origin)
        VALUES (${providerId}, ${serviceId}, 'REQUESTED', 'SELF', NULL, NULL, ${requestNote}, ${prov.origin}::"DataOrigin") RETURNING *`;
      return { ok: true, data: { row: camel(row!), changed: true } };
    }, CAPABILITY_TX);
    if (r.ok && r.data.changed) incCounter("provider_capability_declared_total", { kind: "services" });
    return r;
  }

  /**
   * approve: REQUESTED | SUSPENDED | REVOKED (or no row: an admin grant, source ADMIN) → ACTIVE.
   *   Also writes the service id and slug onto serviceCategories so legacy dispatch can offer it.
   * suspend: REQUESTED | ACTIVE → SUSPENDED (reason ≥3), and those tokens are removed.
   * revoke: anything but REVOKED → REVOKED (reason ≥3), and those tokens are removed.
   */
  async adminServiceTransition(input: { providerId: string; serviceId: string; action: "approve" | "suspend" | "revoke"; adminUserId: string; reason?: string | null; now?: Date }): Promise<Result<{ row: unknown }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const now = input.now ?? new Date();
    const reason = cleanReason(input.reason);
    if (input.action !== "approve" && !reason) return fail("REASON_REQUIRED");
    const prov = await providerOrigin(prisma, input.providerId);
    if (!prov.exists) return fail("PROVIDER_NOT_FOUND");
    const r = await prisma.$transaction(async (tx): Promise<Result<{ row: unknown }>> => {
      await audit(tx, { actorType: "admin", actorId: input.adminUserId }, reason ?? `admin ${input.action} service capability`);
      if (input.action === "approve" || input.action === "suspend") {
        await grandfatherLegacyOffers(tx, { providerId: input.providerId, actorUserId: input.adminUserId, origin: prov.origin, now });
      }
      const [existing] = await tx.$queryRaw<RawRow[]>`SELECT * FROM provider_service_capabilities WHERE provider_id = ${input.providerId} AND service_id = ${input.serviceId} FOR UPDATE`;
      if (input.action === "approve") {
        const elig = await this.serviceEligibility(tx, input.providerId, input.serviceId, now);
        if (elig.missing) return fail("SERVICE_NOT_FOUND");
        if (elig.blocking.length) return fail(elig.blocking[0] as CapabilityError, { blocking: elig.blocking });
        if (!existing) {
          const [row] = await tx.$queryRaw<RawRow[]>`
            INSERT INTO provider_service_capabilities (provider_id, service_id, status, source, verified_by, verified_at, suspended_reason, data_origin)
            VALUES (${input.providerId}, ${input.serviceId}, 'ACTIVE', 'ADMIN', ${input.adminUserId}, ${now}, NULL, ${prov.origin}::"DataOrigin") RETURNING *`;
          await grantServiceCategoryTokens(tx, input.providerId, input.serviceId);
          return { ok: true, data: { row: camel(row!) } };
        }
        const status = String(existing.status);
        if (status !== "REQUESTED" && status !== "SUSPENDED" && status !== "REVOKED" && status !== "ACTIVE") {
          return fail("INVALID_TRANSITION", { detail: `${status} → ACTIVE` });
        }
        const [row] = status === "ACTIVE"
          ? [existing]
          : await tx.$queryRaw<RawRow[]>`UPDATE provider_service_capabilities SET status = 'ACTIVE', verified_by = ${input.adminUserId}, verified_at = ${now}, suspended_reason = NULL WHERE id = ${existing.id} RETURNING *`;
        await grantServiceCategoryTokens(tx, input.providerId, input.serviceId);
        return { ok: true, data: { row: camel(row!) } };
      }
      if (!existing) return fail("NOT_FOUND");
      if (input.action === "suspend") {
        if (String(existing.status) !== "REQUESTED" && String(existing.status) !== "ACTIVE") return fail("INVALID_TRANSITION", { detail: `${String(existing.status)} → SUSPENDED` });
        const [row] = await tx.$queryRaw<RawRow[]>`UPDATE provider_service_capabilities SET status = 'SUSPENDED', suspended_reason = ${reason} WHERE id = ${existing.id} RETURNING *`;
        await withdrawServiceCategoryTokens(tx, input.providerId, input.serviceId);
        return { ok: true, data: { row: camel(row!) } };
      }
      if (String(existing.status) === "REVOKED") return fail("INVALID_TRANSITION", { detail: "already REVOKED" });
      const [row] = await tx.$queryRaw<RawRow[]>`UPDATE provider_service_capabilities SET status = 'REVOKED', suspended_reason = ${reason} WHERE id = ${existing.id} RETURNING *`;
      await withdrawServiceCategoryTokens(tx, input.providerId, input.serviceId);
      return { ok: true, data: { row: camel(row!) } };
    }, CAPABILITY_TX);
    if (r.ok) incCounter("provider_capability_admin_action_total", { kind: "services", action: input.action });
    return r;
  }

  // ── businesses + membership (admin only) ──────────────────────────────────────────────────────

  async listBusinesses(): Promise<Result<{ businesses: unknown[] }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT b.*, (SELECT count(*)::int FROM business_providers bp WHERE bp.business_id = b.id AND bp.active) AS active_members,
             (SELECT count(*)::int FROM services s WHERE s.business_id = b.id) AS services
      FROM businesses b ORDER BY b.created_at DESC LIMIT 500`;
    return { ok: true, data: { businesses: rows.map(camel) } };
  }

  async getBusiness(id: string): Promise<Result<{ business: unknown; members: unknown[]; services: unknown[] }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const [b] = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM businesses WHERE id = ${id}`;
    if (!b) return fail("BUSINESS_NOT_FOUND");
    const members = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT * FROM business_providers WHERE business_id = ${id} ORDER BY id`;
    const services = await prisma.$queryRaw<Record<string, unknown>[]>`SELECT id, name, slug FROM services WHERE business_id = ${id} ORDER BY name`;
    return { ok: true, data: { business: camel(b), members: members.map(camel), services: services.map(camel) } };
  }

  async createBusiness(input: { name: string; legalName?: string | null; registrationNumber?: string | null; status?: string | null; adminUserId: string; reason?: string | null }): Promise<Result<{ business: unknown }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const name = cleanText(input.name, 160);
    if (!name) return fail("INVALID_INPUT", { detail: "name" });
    const status = input.status ?? "ACTIVE";
    if (!["ACTIVE", "SUSPENDED", "CLOSED"].includes(status)) return fail("INVALID_INPUT", { detail: "status" });
    const adminUser = await prisma.user.findUnique({ where: { id: input.adminUserId }, select: { dataOrigin: true } });
    const origin = (adminUser?.dataOrigin ?? null) as DataOrigin | null;
    const id = `biz_${randomUUID()}`;
    try {
      const b = await prisma.$transaction(async (tx) => {
        await audit(tx, { actorType: "admin", actorId: input.adminUserId }, cleanReason(input.reason) ?? "admin created business");
        const [row] = await tx.$queryRaw<Record<string, unknown>[]>`
          INSERT INTO businesses (id, name, legal_name, registration_number, status, data_origin, created_by)
          VALUES (${id}, ${name}, ${cleanText(input.legalName, 200)}, ${cleanText(input.registrationNumber, 80)}, ${status}, ${origin}::"DataOrigin", ${input.adminUserId}) RETURNING *`;
        return row!;
      });
      incCounter("provider_capability_admin_action_total", { kind: "business", action: "create" });
      return { ok: true, data: { business: camel(b) } };
    } catch (err) {
      if (isUniqueViolation(err)) return fail("DUPLICATE", { detail: "registrationNumber" });
      throw err;
    }
  }

  async updateBusiness(id: string, input: { name?: string; legalName?: string | null; registrationNumber?: string | null; status?: string; adminUserId: string; reason?: string | null }): Promise<Result<{ business: unknown }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    if (input.status !== undefined && !["ACTIVE", "SUSPENDED", "CLOSED"].includes(input.status)) return fail("INVALID_INPUT", { detail: "status" });
    if (input.name !== undefined && !cleanText(input.name, 160)) return fail("INVALID_INPUT", { detail: "name" });
    const reason = cleanReason(input.reason);
    if (input.status !== undefined && input.status !== "ACTIVE" && !reason) return fail("REASON_REQUIRED");
    try {
      const r = await prisma.$transaction(async (tx): Promise<Result<{ business: unknown }>> => {
        await audit(tx, { actorType: "admin", actorId: input.adminUserId }, reason ?? "admin updated business");
        const [cur] = await tx.$queryRaw<Record<string, unknown>[]>`SELECT * FROM businesses WHERE id = ${id} FOR UPDATE`;
        if (!cur) return fail("BUSINESS_NOT_FOUND");
        const name = input.name === undefined ? cur.name : cleanText(input.name, 160);
        const legal = input.legalName === undefined ? cur.legal_name : cleanText(input.legalName, 200);
        const reg = input.registrationNumber === undefined ? cur.registration_number : cleanText(input.registrationNumber, 80);
        const status = input.status ?? cur.status;
        const [row] = await tx.$queryRaw<Record<string, unknown>[]>`UPDATE businesses SET name = ${name as string}, legal_name = ${legal as string | null}, registration_number = ${reg as string | null}, status = ${status as string} WHERE id = ${id} RETURNING *`;
        return { ok: true, data: { business: camel(row!) } };
      });
      if (r.ok) incCounter("provider_capability_admin_action_total", { kind: "business", action: "update" });
      return r;
    } catch (err) {
      if (isUniqueViolation(err)) return fail("DUPLICATE", { detail: "registrationNumber" });
      throw err;
    }
  }

  /** Admin records (or re-activates / edits) a membership. The only way a membership exists. */
  async addMember(input: { businessId: string; providerId: string; role?: string | null; effectiveFrom?: string | null; effectiveTo?: string | null; adminUserId: string; reason?: string | null; now?: Date }): Promise<Result<{ membership: unknown }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const now = input.now ?? new Date();
    const role = input.role ?? "MEMBER";
    if (!["OWNER", "MANAGER", "MEMBER"].includes(role)) return fail("INVALID_INPUT", { detail: "role" });
    const from = parseDate(input.effectiveFrom);
    const to = parseDate(input.effectiveTo);
    if (from === "INVALID" || to === "INVALID") return fail("INVALID_INPUT", { detail: "date" });
    const effFrom = from ?? now;
    if (to && to.getTime() <= effFrom.getTime()) return fail("INVALID_INPUT", { detail: "effectiveTo must be after effectiveFrom" });
    const prov = await providerOrigin(prisma, input.providerId);
    if (!prov.exists) return fail("PROVIDER_NOT_FOUND");
    const r = await prisma.$transaction(async (tx): Promise<Result<{ membership: unknown }>> => {
      await audit(tx, { actorType: "admin", actorId: input.adminUserId }, cleanReason(input.reason) ?? "admin added business member");
      const [b] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM businesses WHERE id = ${input.businessId} FOR SHARE`;
      if (!b) return fail("BUSINESS_NOT_FOUND");
      if (b.status !== "ACTIVE") return fail("BUSINESS_NOT_ACTIVE");
      const [row] = await tx.$queryRaw<Record<string, unknown>[]>`
        INSERT INTO business_providers (business_id, provider_id, role, active, effective_from, effective_to, verified_by, verified_at, data_origin)
        VALUES (${input.businessId}, ${input.providerId}, ${role}, true, ${effFrom}, ${to}, ${input.adminUserId}, ${now}, ${prov.origin}::"DataOrigin")
        ON CONFLICT (business_id, provider_id) DO UPDATE SET role = EXCLUDED.role, active = true, effective_from = EXCLUDED.effective_from,
          effective_to = EXCLUDED.effective_to, verified_by = EXCLUDED.verified_by, verified_at = EXCLUDED.verified_at
        RETURNING *`;
      return { ok: true, data: { membership: camel(row!) } };
    });
    if (r.ok) incCounter("provider_capability_admin_action_total", { kind: "membership", action: "add" });
    return r;
  }

  /** Soft removal: the membership row stays (history), inactive and closed at `now`. */
  async removeMember(input: { businessId: string; providerId: string; adminUserId: string; reason?: string | null; now?: Date }): Promise<Result<{ membership: unknown }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const reason = cleanReason(input.reason);
    if (!reason) return fail("REASON_REQUIRED");
    const now = input.now ?? new Date();
    const r = await prisma.$transaction(async (tx): Promise<Result<{ membership: unknown }>> => {
      await audit(tx, { actorType: "admin", actorId: input.adminUserId }, reason);
      const [m] = await tx.$queryRaw<{ id: bigint; effective_from: Date; effective_to: Date | null; active: boolean }[]>`SELECT id, effective_from, effective_to, active FROM business_providers WHERE business_id = ${input.businessId} AND provider_id = ${input.providerId} FOR UPDATE`;
      if (!m) return fail("NOT_FOUND");
      // Close the period at now when that is a valid period end; a membership that has not started
      // yet (or already ended) keeps its dates and is simply deactivated.
      const closeAt = m.effective_from.getTime() < now.getTime() && (!m.effective_to || m.effective_to.getTime() > now.getTime()) ? now : m.effective_to;
      const [row] = await tx.$queryRaw<Record<string, unknown>[]>`UPDATE business_providers SET active = false, effective_to = ${closeAt} WHERE id = ${m.id} RETURNING *`;
      return { ok: true, data: { membership: camel(row!) } };
    });
    if (r.ok) incCounter("provider_capability_admin_action_total", { kind: "membership", action: "remove" });
    return r;
  }

  /**
   * Set / unset `services.business_id`. `services` carries no capability trigger, so the change is
   * appended to provider_capability_audit explicitly (table_name 'services') in the same transaction.
   */
  async setServiceBusiness(input: { serviceId: string; businessId: string | null; adminUserId: string; reason?: string | null }): Promise<Result<{ serviceId: string; businessId: string | null; changed: boolean }>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const reason = cleanReason(input.reason);
    if (!reason) return fail("REASON_REQUIRED");
    const r = await prisma.$transaction(async (tx): Promise<Result<{ serviceId: string; businessId: string | null; changed: boolean }>> => {
      await audit(tx, { actorType: "admin", actorId: input.adminUserId }, reason);
      const [svc] = await tx.$queryRaw<{ id: string; business_id: string | null }[]>`SELECT id, business_id FROM services WHERE id = ${input.serviceId} FOR UPDATE`;
      if (!svc) return fail("SERVICE_NOT_FOUND");
      if (input.businessId) {
        const [b] = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM businesses WHERE id = ${input.businessId}`;
        if (!b) return fail("BUSINESS_NOT_FOUND");
        if (b.status !== "ACTIVE") return fail("BUSINESS_NOT_ACTIVE");
      }
      if ((svc.business_id ?? null) === (input.businessId ?? null)) return { ok: true, data: { serviceId: svc.id, businessId: svc.business_id, changed: false } };
      await tx.$executeRaw`UPDATE services SET business_id = ${input.businessId} WHERE id = ${svc.id}`;
      await tx.$executeRaw`
        INSERT INTO provider_capability_audit (table_name, row_id, provider_id, action, before, after, actor_type, actor_id, reason, request_id, trace_id)
        VALUES ('services', ${svc.id}, NULL, 'UPDATE', ${JSON.stringify({ business_id: svc.business_id })}::jsonb, ${JSON.stringify({ business_id: input.businessId })}::jsonb,
          NULLIF(current_setting('homigo.actor_type', true), ''), NULLIF(current_setting('homigo.actor_id', true), ''), NULLIF(current_setting('homigo.reason', true), ''),
          NULLIF(current_setting('homigo.request_id', true), ''), NULLIF(current_setting('homigo.trace_id', true), ''))`;
      return { ok: true, data: { serviceId: svc.id, businessId: input.businessId, changed: true } };
    });
    if (r.ok && r.data.changed) incCounter("provider_capability_admin_action_total", { kind: "service_business", action: input.businessId ? "set" : "unset" });
    return r;
  }

  // ── read model ────────────────────────────────────────────────────────────────────────────────

  /**
   * Every capability row with computed validity and a near-expiry flag (≤30 days ahead). Shared by
   * the admin console and the partner app. `view: "partner"` hides the verifier's user id.
   */
  async getProviderCapabilityProfile(providerId: string, now: Date = new Date(), view: "admin" | "partner" = "admin"): Promise<Result<CapabilityProfile>> {
    if (!(await capabilityTablesPresent())) return fail("NOT_DEPLOYED");
    const prov = await providerOrigin(prisma, providerId);
    if (!prov.exists) return fail("PROVIDER_NOT_FOUND");
    const [skills, certs, equipment, insurance, languages, services, memberships] = await Promise.all([
      prisma.$queryRaw<RawRow[]>`SELECT ps.*, s.name AS skill_name, s.category AS skill_category, s.active AS skill_active FROM provider_skills ps JOIN skills s ON s.code = ps.skill_code WHERE ps.provider_id = ${providerId} ORDER BY ps.id`,
      prisma.$queryRaw<RawRow[]>`SELECT * FROM provider_certifications WHERE provider_id = ${providerId} ORDER BY id`,
      prisma.$queryRaw<RawRow[]>`SELECT * FROM provider_equipment WHERE provider_id = ${providerId} ORDER BY id`,
      prisma.$queryRaw<RawRow[]>`SELECT * FROM provider_insurance WHERE provider_id = ${providerId} ORDER BY id`,
      prisma.$queryRaw<RawRow[]>`SELECT * FROM provider_languages WHERE provider_id = ${providerId} ORDER BY id`,
      prisma.$queryRaw<RawRow[]>`SELECT psc.*, s.name AS service_name, s.business_id AS service_business_id FROM provider_service_capabilities psc JOIN services s ON s.id = psc.service_id WHERE psc.provider_id = ${providerId} ORDER BY psc.id`,
      this.membershipsFor(prisma, providerId),
    ]);
    const nearExpiry = (d: Date | null | undefined) => !!d && d.getTime() > now.getTime() && d.getTime() - now.getTime() <= NEAR_EXPIRY_MS;
    const strip = (o: Record<string, unknown>) => {
      if (view === "partner") delete o.verifiedBy;
      return o;
    };
    const out: CapabilityProfile = {
      providerId,
      dataOrigin: prov.origin,
      generatedAt: now.toISOString(),
      skills: skills.map((r) => {
        const expiresAt = r.expires_at as Date | null;
        const validity = r.status === "REVOKED" ? "REVOKED" : r.status === "REJECTED" ? "REJECTED" : expiresAt && expiresAt.getTime() <= now.getTime() ? "EXPIRED" : r.status !== "VERIFIED" ? "UNVERIFIED" : "VALID";
        return strip({ ...camel(r), validity, nearExpiry: nearExpiry(expiresAt) });
      }),
      certifications: certs.map((r) => {
        const validity = certificationValidity({ id: num(r.id)!, providerId, certificationType: String(r.certification_type), status: r.status!, issuedAt: r.issued_at as Date | null, expiresAt: r.expires_at as Date | null, revokedAt: r.revoked_at as Date | null, dataOrigin: r.data_origin }, now);
        return strip({ ...camel(r), validity, nearExpiry: validity === "VALID" || validity === "UNVERIFIED" ? nearExpiry(r.expires_at as Date | null) : false });
      }),
      equipment: equipment.map((r) => {
        const row = { id: num(r.id)!, providerId, equipmentType: String(r.equipment_type), status: r.status!, operational: r.operational as "OPERATIONAL" | "OUT_OF_SERVICE", inspectionDueAt: r.inspection_due_at as Date | null, dataOrigin: r.data_origin };
        const validity = equipmentUsable(row, now) ? "VALID"
          : row.status === "REVOKED" ? "REVOKED" : row.status === "REJECTED" ? "REJECTED" : row.status !== "VERIFIED" ? "UNVERIFIED"
          : row.operational !== "OPERATIONAL" ? "OUT_OF_SERVICE" : "INSPECTION_OVERDUE";
        return strip({ ...camel(r), validity, nearExpiry: nearExpiry(row.inspectionDueAt) });
      }),
      insurance: insurance.map((r) => {
        const validity = insuranceValidity({ id: num(r.id)!, providerId, insuranceType: String(r.insurance_type), status: r.status!, effectiveFrom: r.effective_from as Date | null, expiresAt: r.expires_at as Date, revokedAt: r.revoked_at as Date | null, dataOrigin: r.data_origin }, now);
        return strip({ ...camel(r), validity, nearExpiry: validity === "VALID" || validity === "UNVERIFIED" || validity === "NOT_YET_EFFECTIVE" ? nearExpiry(r.expires_at as Date) : false });
      }),
      languages: languages.map((r) => ({ ...camel(r), validity: r.active ? "ACTIVE" : "INACTIVE" })),
      services: services.map((r) => strip({ ...camel(r), validity: r.status })),
      memberships: memberships.map((m) => ({ ...m, validity: m.businessStatus !== "ACTIVE" || !m.active ? "INACTIVE" : membershipAuthorizes(m, m.businessId, now) ? "AUTHORIZED" : m.effectiveFrom.getTime() > now.getTime() ? "NOT_YET_EFFECTIVE" : "ENDED" })),
      summary: { nearExpiry: 0, expired: 0, pendingReview: 0 },
    };
    const all = [...out.skills, ...out.certifications, ...out.equipment, ...out.insurance] as Array<{ validity: string; nearExpiry: boolean; status?: string }>;
    out.summary = {
      nearExpiry: all.filter((r) => r.nearExpiry).length,
      expired: all.filter((r) => r.validity === "EXPIRED" || r.validity === "INSPECTION_OVERDUE").length,
      pendingReview: all.filter((r) => r.status === "DECLARED").length + (out.services as Array<{ status?: string }>).filter((s) => s.status === "REQUESTED").length,
    };
    return { ok: true, data: out };
  }

  /** The append-only audit for one provider (plus the membership rows' business-side entries). */
  async auditFor(providerId: string, limit = 200): Promise<unknown[]> {
    if (!(await capabilityTablesPresent())) return [];
    const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT id, table_name, row_id, provider_id, action, before, after, actor_type, actor_id, reason, request_id, trace_id, changed_at
      FROM provider_capability_audit
      WHERE provider_id = ${providerId} OR (table_name = 'business_providers' AND before->>'provider_id' = ${providerId})
      ORDER BY id DESC LIMIT ${Math.max(1, Math.min(limit, 1000))}`;
    return rows.map(camel);
  }
}

export type CapabilityProfile = {
  providerId: string;
  dataOrigin: DataOrigin | null;
  generatedAt: string;
  skills: Record<string, unknown>[];
  certifications: Record<string, unknown>[];
  equipment: Record<string, unknown>[];
  insurance: Record<string, unknown>[];
  languages: Record<string, unknown>[];
  services: Record<string, unknown>[];
  memberships: Record<string, unknown>[];
  summary: { nearExpiry: number; expired: number; pendingReview: number };
};

export const providerCapabilityService = new ProviderCapabilityService();
