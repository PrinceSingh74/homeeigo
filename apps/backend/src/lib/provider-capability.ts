/**
 * Phase 11 — typed provider capability. Pure module (no I/O).
 *
 * Row shapes for the capability tables (migration 20260924223000_provider_capabilities), the
 * validity arithmetic every reader must share, and the one function that turns a service's
 * capability requirements plus a provider's rows into machine-readable rejections.
 *
 * Rules that hold everywhere:
 *   - Validity is arithmetic on columns (status, expires_at, revoked_at), never a claim from a
 *     profile string. A DECLARED row is a request, not a capability.
 *   - Expired or revoked is never eligible. Unverified is not eligible where verification is
 *     required (the default for certifications and insurance; skills may accept DECLARED when the
 *     service says so).
 *   - Provenance rides on every row. A fixture row satisfies nothing for a production booking.
 *   - Nothing is inferred: no language from a name, no skill from a category word, no insurance
 *     from a document title.
 */
import type { DataOrigin } from "@prisma/client";

export const CAPABILITY_STATUSES = ["DECLARED", "VERIFIED", "REJECTED", "REVOKED"] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const SERVICE_CAPABILITY_STATUSES = ["REQUESTED", "ACTIVE", "SUSPENDED", "REVOKED"] as const;
export type ServiceCapabilityStatus = (typeof SERVICE_CAPABILITY_STATUSES)[number];

export const SKILL_LEVELS = ["BASIC", "SKILLED", "EXPERT"] as const;
export type SkillLevel = (typeof SKILL_LEVELS)[number];

export const EQUIPMENT_REQUIREMENTS = ["REQUIRED", "OPTIONAL", "NOT_REQUIRED", "CUSTOMER_PROVIDED"] as const;
export type EquipmentRequirement = (typeof EQUIPMENT_REQUIREMENTS)[number];

export const LANGUAGE_PROFICIENCIES = ["BASIC", "CONVERSATIONAL", "FLUENT", "NATIVE"] as const;
export type LanguageProficiency = (typeof LANGUAGE_PROFICIENCIES)[number];

/** `^[a-z0-9]+(-[a-z0-9]+)*$` — the same shape the database CHECKs enforce. */
export const CAPABILITY_CODE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const LANGUAGE_CODE = /^[a-z]{2}$/;

export type ProviderSkillRow = { id: number; providerId: string; skillCode: string; level: SkillLevel | null; status: CapabilityStatus; source: string; expiresAt: Date | null; dataOrigin: DataOrigin | null };
export type ProviderCertificationRow = { id: number; providerId: string; certificationType: string; status: CapabilityStatus; issuedAt: Date | null; expiresAt: Date | null; revokedAt: Date | null; dataOrigin: DataOrigin | null };
export type ProviderEquipmentRow = { id: number; providerId: string; equipmentType: string; status: CapabilityStatus; operational: "OPERATIONAL" | "OUT_OF_SERVICE"; inspectionDueAt: Date | null; dataOrigin: DataOrigin | null };
export type ProviderInsuranceRow = { id: number; providerId: string; insuranceType: string; status: CapabilityStatus; effectiveFrom: Date | null; expiresAt: Date; revokedAt: Date | null; dataOrigin: DataOrigin | null };
export type ProviderLanguageRow = { id: number; providerId: string; languageCode: string; proficiency: LanguageProficiency; active: boolean; dataOrigin: DataOrigin | null };
export type ProviderServiceCapabilityRow = { id: number; providerId: string; serviceId: string; status: ServiceCapabilityStatus; source: string; dataOrigin: DataOrigin | null };
export type BusinessMembershipRow = { id: number; businessId: string; providerId: string; role: string; active: boolean; effectiveFrom: Date; effectiveTo: Date | null; businessStatus: "ACTIVE" | "SUSPENDED" | "CLOSED" };

export type ProviderCapabilityRows = {
  skills: ProviderSkillRow[];
  certifications: ProviderCertificationRow[];
  equipment: ProviderEquipmentRow[];
  insurance: ProviderInsuranceRow[];
  languages: ProviderLanguageRow[];
  services: ProviderServiceCapabilityRow[];
  memberships: BusinessMembershipRow[];
};

export const EMPTY_CAPABILITY_ROWS: ProviderCapabilityRows = Object.freeze({
  skills: [], certifications: [], equipment: [], insurance: [], languages: [], services: [], memberships: [],
}) as ProviderCapabilityRows;

/** The service side: what the catalogue's `providerRequirements` block asks for (typed part). */
export type CapabilityRequirements = {
  requiredSkills: Array<{ code: string; minLevel?: SkillLevel | null; verifiedOnly?: boolean }>;
  requiredCertifications: Array<{ type: string; verificationRequired?: boolean }>;
  requiredEquipment: Array<{ type: string; requirement: EquipmentRequirement }>;
  requiredInsurance: Array<{ type: string }>;
  languages: Array<{ code: string; minProficiency?: LanguageProficiency | null }>;
};

export const NO_CAPABILITY_REQUIREMENTS: CapabilityRequirements = Object.freeze({
  requiredSkills: [], requiredCertifications: [], requiredEquipment: [], requiredInsurance: [], languages: [],
}) as CapabilityRequirements;

/**
 * Reads the typed requirement lists out of a catalogue config. The legacy `requiredSkills: string[]`
 * (skill codes as strings) is carried as `{code}` entries so services configured before the typed
 * fields existed keep their meaning; nothing else is inferred from legacy free text.
 */
export function capabilityRequirementsFromConfig(cfg: unknown): CapabilityRequirements {
  const pr = cfg && typeof cfg === "object" ? (cfg as { providerRequirements?: Record<string, unknown> | null }).providerRequirements : null;
  if (!pr || typeof pr !== "object") return NO_CAPABILITY_REQUIREMENTS;
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const legacySkills = arr<unknown>(pr.requiredSkills).flatMap((s) => (typeof s === "string" && CAPABILITY_CODE.test(s) ? [{ code: s }] : []));
  const typedSkills = arr<{ code: string; minLevel?: SkillLevel | null; verifiedOnly?: boolean }>(pr.skills).filter((s) => s && typeof s.code === "string");
  return {
    requiredSkills: typedSkills.length ? typedSkills : legacySkills,
    requiredCertifications: arr<{ type: string; verificationRequired?: boolean }>(pr.requiredCertifications).filter((c) => c && typeof c.type === "string"),
    requiredEquipment: arr<{ type: string; requirement: EquipmentRequirement }>(pr.requiredEquipment).filter((e) => e && typeof e.type === "string"),
    requiredInsurance: arr<{ type: string }>(pr.requiredInsurance).filter((i) => i && typeof i.type === "string"),
    languages: arr<{ code: string; minProficiency?: LanguageProficiency | null }>(pr.languages).filter((l) => l && typeof l.code === "string"),
  };
}

// ── validity arithmetic ─────────────────────────────────────────────────────────────────────────

export function certificationValidity(row: ProviderCertificationRow, now: Date): "VALID" | "EXPIRED" | "REVOKED" | "UNVERIFIED" | "REJECTED" {
  if (row.status === "REVOKED" || row.revokedAt) return "REVOKED";
  if (row.status === "REJECTED") return "REJECTED";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  if (row.status !== "VERIFIED") return "UNVERIFIED";
  return "VALID";
}

export function insuranceValidity(row: ProviderInsuranceRow, now: Date): "VALID" | "EXPIRED" | "REVOKED" | "UNVERIFIED" | "NOT_YET_EFFECTIVE" | "REJECTED" {
  if (row.status === "REVOKED" || row.revokedAt) return "REVOKED";
  if (row.status === "REJECTED") return "REJECTED";
  if (row.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  if (row.effectiveFrom && row.effectiveFrom.getTime() > now.getTime()) return "NOT_YET_EFFECTIVE";
  if (row.status !== "VERIFIED") return "UNVERIFIED";
  return "VALID";
}

export function skillSatisfies(row: ProviderSkillRow, req: CapabilityRequirements["requiredSkills"][number], now: Date): boolean {
  if (row.status === "REJECTED" || row.status === "REVOKED") return false;
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return false;
  if (req.verifiedOnly && row.status !== "VERIFIED") return false;
  if (req.minLevel) {
    const order = SKILL_LEVELS.indexOf(req.minLevel);
    const have = row.level ? SKILL_LEVELS.indexOf(row.level) : -1;
    if (have < order) return false;
  }
  return true;
}

export function equipmentUsable(row: ProviderEquipmentRow, now: Date): boolean {
  if (row.status !== "VERIFIED") return false;
  if (row.operational !== "OPERATIONAL") return false;
  if (row.inspectionDueAt && row.inspectionDueAt.getTime() <= now.getTime()) return false;
  return true;
}

export function languageSatisfies(row: ProviderLanguageRow, req: CapabilityRequirements["languages"][number]): boolean {
  if (!row.active) return false;
  if (req.minProficiency) {
    return LANGUAGE_PROFICIENCIES.indexOf(row.proficiency) >= LANGUAGE_PROFICIENCIES.indexOf(req.minProficiency);
  }
  return true;
}

export function membershipAuthorizes(row: BusinessMembershipRow, businessId: string, now: Date): boolean {
  if (row.businessId !== businessId || !row.active || row.businessStatus !== "ACTIVE") return false;
  if (row.effectiveFrom.getTime() > now.getTime()) return false;
  if (row.effectiveTo && row.effectiveTo.getTime() <= now.getTime()) return false;
  return true;
}

// ── rejection reasons ───────────────────────────────────────────────────────────────────────────

export const MATCHING_REJECTION_REASONS = [
  "PROVENANCE_INVALID",
  "BUSINESS_NOT_AUTHORIZED",
  "SERVICE_CAPABILITY_MISSING",
  "SKILL_MISSING",
  "CERTIFICATION_MISSING",
  "CERTIFICATION_EXPIRED",
  "CERTIFICATION_UNVERIFIED",
  "EQUIPMENT_MISSING",
  "INSURANCE_INVALID",
  "LANGUAGE_MISMATCH",
  "PROVIDER_NOT_AVAILABLE",
  "PRESENCE_STALE",
  "LOCATION_GATE_FAILED",
  "CAPACITY_EXCEEDED",
] as const;
export type MatchingRejectionReason = (typeof MATCHING_REJECTION_REASONS)[number];

export type CapabilityRejection = { reason: MatchingRejectionReason; detail: string };

/**
 * Rows from a population that is not the booking's are invisible: a fixture certificate proves
 * nothing for a real customer's job. `bookingIsBusiness` mirrors `analytics-scope.isBusinessRow`.
 */
function rowVisible(origin: DataOrigin | null, bookingIsBusiness: boolean, isBusinessOrigin: (o: DataOrigin | null) => boolean): boolean {
  return isBusinessOrigin(origin) === bookingIsBusiness;
}

/**
 * The capability half of the matching gates, in the mandated order: service capability, skills,
 * certifications, equipment, insurance, language. Returns every rejection, not only the first, so
 * an admin diagnosing "why was nobody matched" sees the whole picture.
 *
 * `serviceCapability` says how the provider ↔ service join is enforced:
 *   - "STRICT": an ACTIVE provider_service_capabilities row is required.
 *   - "LEGACY_FALLBACK": a provider with NO rows at all for any service is judged by the caller's
 *     legacy String[] rule (`legacyOffersService`); a provider WITH rows must have an ACTIVE one.
 */
export function evaluateCapabilityGates(input: {
  requirements: CapabilityRequirements;
  rows: ProviderCapabilityRows;
  serviceId: string;
  serviceBusinessId: string | null;
  serviceCapability: "STRICT" | "LEGACY_FALLBACK";
  legacyOffersService: boolean;
  bookingIsBusiness: boolean;
  isBusinessOrigin: (o: DataOrigin | null) => boolean;
  now: Date;
  /**
   * The provider's own provenance. A row whose provenance is UNKNOWN (NULL — it predates the column)
   * belongs to its provider's population; an explicitly labelled row keeps its label.
   */
  providerOrigin?: DataOrigin | null;
}): CapabilityRejection[] {
  const { requirements, rows, now } = input;
  const vis = (o: DataOrigin | null) => rowVisible(o ?? input.providerOrigin ?? null, input.bookingIsBusiness, input.isBusinessOrigin);
  const out: CapabilityRejection[] = [];

  if (input.serviceBusinessId) {
    const ok = rows.memberships.some((m) => membershipAuthorizes(m, input.serviceBusinessId!, now));
    if (!ok) out.push({ reason: "BUSINESS_NOT_AUTHORIZED", detail: `service belongs to business ${input.serviceBusinessId}` });
  }

  const serviceRows = rows.services.filter((s) => vis(s.dataOrigin));
  const hasAnyServiceRow = rows.services.length > 0;
  const activeForService = serviceRows.some((s) => s.serviceId === input.serviceId && s.status === "ACTIVE");
  if (!activeForService) {
    const legacyOk = input.serviceCapability === "LEGACY_FALLBACK" && !hasAnyServiceRow && input.legacyOffersService;
    if (!legacyOk) out.push({ reason: "SERVICE_CAPABILITY_MISSING", detail: `no ACTIVE capability for service ${input.serviceId}` });
  }

  for (const req of requirements.requiredSkills) {
    const ok = rows.skills.some((s) => vis(s.dataOrigin) && s.skillCode === req.code && skillSatisfies(s, req, now));
    if (!ok) out.push({ reason: "SKILL_MISSING", detail: req.code });
  }

  for (const req of requirements.requiredCertifications) {
    const candidates = rows.certifications.filter((c) => vis(c.dataOrigin) && c.certificationType === req.type);
    if (candidates.length === 0) { out.push({ reason: "CERTIFICATION_MISSING", detail: req.type }); continue; }
    const states = candidates.map((c) => certificationValidity(c, now));
    if (states.includes("VALID")) continue;
    if (req.verificationRequired === false && states.includes("UNVERIFIED")) continue;
    if (states.includes("UNVERIFIED")) out.push({ reason: "CERTIFICATION_UNVERIFIED", detail: req.type });
    else out.push({ reason: "CERTIFICATION_EXPIRED", detail: `${req.type}:${states.join("|")}` });
  }

  for (const req of requirements.requiredEquipment) {
    if (req.requirement !== "REQUIRED") continue;
    const ok = rows.equipment.some((e) => vis(e.dataOrigin) && e.equipmentType === req.type && equipmentUsable(e, now));
    if (!ok) out.push({ reason: "EQUIPMENT_MISSING", detail: req.type });
  }

  for (const req of requirements.requiredInsurance) {
    const candidates = rows.insurance.filter((i) => vis(i.dataOrigin) && i.insuranceType === req.type);
    const ok = candidates.some((i) => insuranceValidity(i, now) === "VALID");
    if (!ok) out.push({ reason: "INSURANCE_INVALID", detail: `${req.type}:${candidates.map((i) => insuranceValidity(i, now)).join("|") || "MISSING"}` });
  }

  for (const req of requirements.languages) {
    const ok = rows.languages.some((l) => vis(l.dataOrigin) && l.languageCode === req.code && languageSatisfies(l, req));
    if (!ok) out.push({ reason: "LANGUAGE_MISMATCH", detail: req.code });
  }

  return out;
}
