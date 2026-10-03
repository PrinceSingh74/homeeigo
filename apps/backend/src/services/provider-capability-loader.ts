/**
 * Phase 11 — batched reader for the typed provider capability tables.
 *
 * ONE query per table for the whole candidate set (never one per provider), so matching over 500
 * candidates costs seven round trips, not 3,500. The tables come from migration
 * 20260924223000_provider_capabilities, which may be ABSENT on a database the backend hot-reloads
 * against: every table is guarded by a cached `to_regclass` probe and an absent table reads as
 * "no rows", exactly like `booking-safety.service.ts` degrades to "feature not deployed".
 *
 * Rows are returned raw (with `data_origin`); provenance visibility is decided by the pure gate
 * (`evaluateCapabilityGates`), never here, so the admin diagnostics see what the gate saw.
 */
import type { DataOrigin, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { isBusinessRow } from "../lib/analytics-scope";
import { isMarketplaceSeedAccount } from "../lib/data-provenance";
import { loadHydratedCatalog } from "../lib/service-catalog-store";
import { resolveServiceMatchTokens, serviceCategoryMatchWhere, type ServiceMatchTokens } from "../lib/service-match";
import { isFeatureEnabled } from "./feature-flag.service";
import {
  EMPTY_CAPABILITY_ROWS,
  capabilityRequirementsFromConfig,
  evaluateCapabilityGates,
  type BusinessMembershipRow,
  type CapabilityRejection,
  type CapabilityRequirements,
  type MatchingRejectionReason,
  type ProviderCapabilityRows,
} from "../lib/provider-capability";

type Db = typeof prisma | Prisma.TransactionClient;

const CAPABILITY_TABLES = [
  "provider_skills",
  "provider_certifications",
  "provider_equipment",
  "provider_insurance",
  "provider_languages",
  "provider_service_capabilities",
  "business_providers",
  "businesses",
] as const;
type CapabilityTable = (typeof CAPABILITY_TABLES)[number];

/** A present table never disappears; an absent one is re-probed every minute (the migration may land). */
let known: { present: Set<CapabilityTable>; at: number } | null = null;

async function presentTables(db: Db): Promise<Set<CapabilityTable>> {
  if (known && (known.present.size === CAPABILITY_TABLES.length || Date.now() - known.at < 60_000)) return known.present;
  const rows = await db.$queryRaw<Array<{ t: string; present: boolean }>>`
    SELECT t, to_regclass(t) IS NOT NULL AS present FROM unnest(${[...CAPABILITY_TABLES]}::text[]) AS t`;
  const present = new Set<CapabilityTable>(rows.filter((r) => r.present).map((r) => r.t as CapabilityTable));
  known = { present, at: Date.now() };
  return present;
}

let businessColumn: { present: boolean; at: number } | null = null;

/** `services.business_id` is added by the same migration; probed through information_schema, cached. */
async function serviceBusinessColumnPresent(db: Db): Promise<boolean> {
  if (businessColumn && (businessColumn.present || Date.now() - businessColumn.at < 60_000)) return businessColumn.present;
  const [row] = await db.$queryRaw<Array<{ present: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'services' AND column_name = 'business_id'
    ) AS present`;
  businessColumn = { present: row?.present === true, at: Date.now() };
  return businessColumn.present;
}

/** Test/diagnostic hook: forget the probes (a test that creates or drops tables mid-run). */
export function __resetCapabilityProbeCache(): void {
  known = null;
  businessColumn = null;
}

/** The business that owns a service, or null (platform service, or column not deployed). */
export async function serviceBusinessId(serviceId: string, db: Db = prisma): Promise<string | null> {
  if (!(await serviceBusinessColumnPresent(db))) return null;
  const [row] = await db.$queryRaw<Array<{ business_id: string | null }>>`
    SELECT business_id FROM services WHERE id = ${serviceId}`;
  return row?.business_id ?? null;
}

function emptyRows(): ProviderCapabilityRows {
  return { skills: [], certifications: [], equipment: [], insurance: [], languages: [], services: [], memberships: [] };
}

/** Counts every loader call — lets tests prove "one batch per matching call" (no N+1). */
let loaderCalls = 0;
export function __capabilityLoaderCalls(): number {
  return loaderCalls;
}

/**
 * Capability rows for every provider in `providerIds`, keyed by provider id. Providers with no
 * rows at all are present in the map with empty lists. At most one query per table.
 */
export async function loadCapabilityRows(providerIds: string[], db: Db = prisma): Promise<Map<string, ProviderCapabilityRows>> {
  loaderCalls += 1;
  const out = new Map<string, ProviderCapabilityRows>();
  const ids = [...new Set(providerIds)];
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, emptyRows());
  const present = await presentTables(db);
  if (present.size === 0) return out;
  const push = <K extends keyof ProviderCapabilityRows>(providerId: string, key: K, row: ProviderCapabilityRows[K][number]) => {
    const bucket = out.get(providerId);
    if (bucket) (bucket[key] as Array<ProviderCapabilityRows[K][number]>).push(row);
  };

  const none = Promise.resolve([] as never[]);
  const [skills, certs, equipment, insurance, languages, services, memberships] = await Promise.all([
    present.has("provider_skills")
      ? db.$queryRaw<Array<{ id: bigint; provider_id: string; skill_code: string; level: string | null; status: string; source: string; expires_at: Date | null; data_origin: DataOrigin | null }>>`
          SELECT id, provider_id, skill_code, level, status, source, expires_at, data_origin::text AS data_origin
          FROM provider_skills WHERE provider_id = ANY(${ids}) ORDER BY id`
      : none,
    present.has("provider_certifications")
      ? db.$queryRaw<Array<{ id: bigint; provider_id: string; certification_type: string; status: string; issued_at: Date | null; expires_at: Date | null; revoked_at: Date | null; data_origin: DataOrigin | null }>>`
          SELECT id, provider_id, certification_type, status, issued_at, expires_at, revoked_at, data_origin::text AS data_origin
          FROM provider_certifications WHERE provider_id = ANY(${ids}) ORDER BY id`
      : none,
    present.has("provider_equipment")
      ? db.$queryRaw<Array<{ id: bigint; provider_id: string; equipment_type: string; status: string; operational: string; inspection_due_at: Date | null; data_origin: DataOrigin | null }>>`
          SELECT id, provider_id, equipment_type, status, operational, inspection_due_at, data_origin::text AS data_origin
          FROM provider_equipment WHERE provider_id = ANY(${ids}) ORDER BY id`
      : none,
    present.has("provider_insurance")
      ? db.$queryRaw<Array<{ id: bigint; provider_id: string; insurance_type: string; status: string; effective_from: Date | null; expires_at: Date; revoked_at: Date | null; data_origin: DataOrigin | null }>>`
          SELECT id, provider_id, insurance_type, status, effective_from, expires_at, revoked_at, data_origin::text AS data_origin
          FROM provider_insurance WHERE provider_id = ANY(${ids}) ORDER BY id`
      : none,
    present.has("provider_languages")
      ? db.$queryRaw<Array<{ id: bigint; provider_id: string; language_code: string; proficiency: string; active: boolean; data_origin: DataOrigin | null }>>`
          SELECT id, provider_id, language_code, proficiency, active, data_origin::text AS data_origin
          FROM provider_languages WHERE provider_id = ANY(${ids}) ORDER BY id`
      : none,
    present.has("provider_service_capabilities")
      ? db.$queryRaw<Array<{ id: bigint; provider_id: string; service_id: string; status: string; source: string; data_origin: DataOrigin | null }>>`
          SELECT id, provider_id, service_id, status, source, data_origin::text AS data_origin
          FROM provider_service_capabilities WHERE provider_id = ANY(${ids}) ORDER BY id`
      : none,
    present.has("business_providers") && present.has("businesses")
      ? db.$queryRaw<Array<{ id: bigint; business_id: string; provider_id: string; role: string; active: boolean; effective_from: Date; effective_to: Date | null; business_status: string }>>`
          SELECT bp.id, bp.business_id, bp.provider_id, bp.role, bp.active, bp.effective_from, bp.effective_to, b.status AS business_status
          FROM business_providers bp JOIN businesses b ON b.id = bp.business_id
          WHERE bp.provider_id = ANY(${ids}) ORDER BY bp.id`
      : none,
  ]);

  for (const r of skills) push(r.provider_id, "skills", { id: Number(r.id), providerId: r.provider_id, skillCode: r.skill_code, level: r.level as never, status: r.status as never, source: r.source, expiresAt: r.expires_at, dataOrigin: r.data_origin });
  for (const r of certs) push(r.provider_id, "certifications", { id: Number(r.id), providerId: r.provider_id, certificationType: r.certification_type, status: r.status as never, issuedAt: r.issued_at, expiresAt: r.expires_at, revokedAt: r.revoked_at, dataOrigin: r.data_origin });
  for (const r of equipment) push(r.provider_id, "equipment", { id: Number(r.id), providerId: r.provider_id, equipmentType: r.equipment_type, status: r.status as never, operational: r.operational as never, inspectionDueAt: r.inspection_due_at, dataOrigin: r.data_origin });
  for (const r of insurance) push(r.provider_id, "insurance", { id: Number(r.id), providerId: r.provider_id, insuranceType: r.insurance_type, status: r.status as never, effectiveFrom: r.effective_from, expiresAt: r.expires_at, revokedAt: r.revoked_at, dataOrigin: r.data_origin });
  for (const r of languages) push(r.provider_id, "languages", { id: Number(r.id), providerId: r.provider_id, languageCode: r.language_code, proficiency: r.proficiency as never, active: r.active, dataOrigin: r.data_origin });
  for (const r of services) push(r.provider_id, "services", { id: Number(r.id), providerId: r.provider_id, serviceId: r.service_id, status: r.status as never, source: r.source, dataOrigin: r.data_origin });
  for (const r of memberships) {
    const m: BusinessMembershipRow = { id: Number(r.id), businessId: r.business_id, providerId: r.provider_id, role: r.role, active: r.active, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, businessStatus: r.business_status as never };
    push(r.provider_id, "memberships", m);
  }
  return out;
}

/** Single-provider convenience for offer/accept re-checks (same one-query-per-table cost). */
export async function loadCapabilityRowsFor(providerId: string, db: Db = prisma): Promise<ProviderCapabilityRows> {
  return (await loadCapabilityRows([providerId], db)).get(providerId) ?? EMPTY_CAPABILITY_ROWS;
}

// ── service side of the gate ────────────────────────────────────────────────────────────────────

/**
 * Feature flag that switches the provider ↔ service join from LEGACY_FALLBACK to STRICT.
 *
 * Default OFF (a missing flag row is off). Turning it ON on the live database is an OWNER DECISION:
 * as of this change no live provider has a single `provider_service_capabilities` row, so STRICT
 * would reject every provider with SERVICE_CAPABILITY_MISSING until capabilities are granted
 * (workstream D's admin APIs) — OWNER_APPROVAL_REQUIRED.
 */
export const STRICT_SERVICE_CAPABILITY_FLAG = "matching.strict_service_capability";

export type ServiceCapabilityMode = "STRICT" | "LEGACY_FALLBACK";

export type ServiceGateContext = {
  serviceId: string;
  serviceBusinessId: string | null;
  mode: ServiceCapabilityMode;
  /** Typed requirements the gate evaluates (see `requirementsForMode`). */
  requirements: CapabilityRequirements;
  /** The legacy `providerRequirements.requiredSkills` string list (matched against `service_categories`). */
  legacyRequiredSkills: string[];
  /**
   * Booking population. UNKNOWN (NULL) counts as business by the existing owner policy in
   * `analytics-scope` (historical rows predate provenance) — deliberately not changed here. An
   * anonymous caller is business, exactly like `matchingService.candidatePopulation`.
   */
  bookingIsBusiness: boolean;
};

/**
 * LEGACY_FALLBACK keeps the legacy `requiredSkills: string[]` meaning it has today: an SQL
 * `hasEvery` over `service_categories`. Re-reading those strings as typed skill codes as well would
 * reject every provider twice for one requirement (nobody has typed skill rows yet), so in legacy
 * mode only the TYPED `skills` list is a typed requirement. STRICT reads both as typed codes.
 */
export function requirementsForMode(cfg: unknown, mode: ServiceCapabilityMode): CapabilityRequirements {
  const req = capabilityRequirementsFromConfig(cfg);
  if (mode === "STRICT") return req;
  const pr = cfg && typeof cfg === "object" ? (cfg as { providerRequirements?: { skills?: unknown } | null }).providerRequirements : null;
  const hasTyped = Array.isArray(pr?.skills) && pr!.skills.length > 0;
  return hasTyped ? req : { ...req, requiredSkills: [] };
}

export async function serviceCapabilityMode(): Promise<ServiceCapabilityMode> {
  return (await isFeatureEnabled(STRICT_SERVICE_CAPABILITY_FLAG)) ? "STRICT" : "LEGACY_FALLBACK";
}

/** Everything the gate needs about the service and the booking's population. Reads via `db`. */
export async function loadServiceGateContext(
  serviceId: string,
  customerId: string | null | undefined,
  db: Db = prisma,
  opts: { mode?: ServiceCapabilityMode } = {},
): Promise<ServiceGateContext> {
  const [service, customer, businessId, mode] = await Promise.all([
    db.service.findUnique({ where: { id: serviceId }, select: { id: true, catalogConfig: true } }),
    customerId ? db.user.findUnique({ where: { id: customerId }, select: { dataOrigin: true } }) : Promise.resolve(null),
    serviceBusinessId(serviceId, db),
    opts.mode ? Promise.resolve(opts.mode) : serviceCapabilityMode(),
  ]);
  const catalog = service ? await loadHydratedCatalog({ id: serviceId, catalogConfig: service.catalogConfig }, db as never) : null;
  return {
    serviceId,
    serviceBusinessId: businessId,
    mode,
    requirements: requirementsForMode(catalog, mode),
    legacyRequiredSkills: catalog?.providerRequirements?.requiredSkills ?? [],
    bookingIsBusiness: customer ? isBusinessRow(customer.dataOrigin) : true,
  };
}

/**
 * Short-lived memo over `loadServiceGateContext` for the offer/accept re-check paths that only
 * have ids. The context is service-side and booking-invariant (requirements, business owner, flag
 * mode, customer population) — the part that MUST stay live is the provider's capability ROWS,
 * which `recheckProviderCapability` still reads per call. Without this, 50 concurrent direct-assign
 * creates on one provider each re-hydrated the catalogue and the whole suite timed out at 60s
 * (measured 2026-09-26); with it they share one resolution. A config/flag edit reaches offers
 * within TTL_MS, well inside the flag store's own propagation window.
 */
const GATE_CONTEXT_TTL_MS = 5_000;
const gateContextMemo = new Map<string, { at: number; value: Promise<ServiceGateContext>; settled?: ServiceGateContext }>();

/**
 * `tx` — pass the caller's interactive transaction when calling from inside one. Such a caller
 * must never wait on the base client: it already holds a pooled connection (and, for accept /
 * reassign, a row lock that every other pooled connection may be queued behind), so a base-client
 * load there can wait for a connection that only its own commit would free. Measured 2026-09-30:
 * concurrent accepts of a broadcast offer with this memo cold all expired and none won. Inside a
 * transaction only an already-SETTLED memo value is used; otherwise the context is read through the
 * transaction and not shared (another transaction must not await a load that can die with this one).
 */
export async function loadServiceGateContextCached(serviceId: string, customerId: string | null | undefined, tx?: Db): Promise<ServiceGateContext> {
  const key = `${serviceId}|${customerId ?? ""}`;
  const hit = gateContextMemo.get(key);
  const fresh = hit !== undefined && Date.now() - hit.at < GATE_CONTEXT_TTL_MS;
  if (tx && tx !== prisma) {
    if (fresh && hit.settled) return hit.settled;
    return loadServiceGateContext(serviceId, customerId, tx);
  }
  if (fresh) return hit.value;
  // The promise itself is memoized so concurrent callers coalesce onto one load; a rejection is
  // evicted so the next caller retries instead of caching an error for the TTL.
  const at = Date.now();
  const value = loadServiceGateContext(serviceId, customerId, prisma).then(
    (v) => {
      const cur = gateContextMemo.get(key);
      if (cur?.value === value) cur.settled = v;
      return v;
    },
    (err) => {
      gateContextMemo.delete(key);
      throw err;
    },
  );
  const entry = { at, value };
  gateContextMemo.set(key, entry);
  if (gateContextMemo.size > 500) {
    const cutoff = Date.now() - GATE_CONTEXT_TTL_MS;
    for (const [k, v] of gateContextMemo) if (v.at < cutoff) gateContextMemo.delete(k);
  }
  return entry.value;
}

/** The capability half of the gates for one provider, in the mandated order. */
export function capabilityRejections(
  rows: ProviderCapabilityRows,
  ctx: ServiceGateContext,
  legacyOffersService: boolean,
  now: Date = new Date(),
  providerOrigin?: DataOrigin | null,
  /**
   * Set only for a seed/demo partner being considered for a real customer's job after the strict
   * pool produced nobody. Their capability rows (often NULL provenance, inherited from the partner)
   * must be visible. Suite-labelled rows stay invisible.
   */
  opts?: { seedVisible?: boolean },
): CapabilityRejection[] {
  return evaluateCapabilityGates({
    requirements: ctx.requirements,
    rows,
    serviceId: ctx.serviceId,
    serviceBusinessId: ctx.serviceBusinessId,
    serviceCapability: ctx.mode,
    legacyOffersService,
    bookingIsBusiness: ctx.bookingIsBusiness,
    isBusinessOrigin: opts?.seedVisible
      ? (origin) => isBusinessRow(origin) || origin === "SYNTHETIC" || origin === "INFERRED_SYNTHETIC"
      : isBusinessRow,
    now,
    providerOrigin,
  });
}

/**
 * Offer / accept re-check: provenance + capability for one provider, under the caller's transaction.
 * Returns the FIRST failing reason (the SKIP_OFFER / accept refusal code) or null.
 *
 * `legacyOffersService` is taken as true here: the legacy String[] rule was applied when the
 * provider was matched and is not a revocable credential. What this re-check exists for is the
 * typed state that can change between match and offer/accept — an expired or revoked certificate,
 * a suspended service capability, a business membership that ended.
 */
export async function recheckProviderCapability(
  db: Db,
  providerId: string,
  ctx: ServiceGateContext,
  now: Date = new Date(),
): Promise<{ reason: MatchingRejectionReason; detail: string } | null> {
  const [owner, rows] = await Promise.all([
    db.provider.findUnique({ where: { id: providerId }, select: { user: { select: { dataOrigin: true, email: true } } } }),
    loadCapabilityRowsFor(providerId, db),
  ]);
  const origin = owner?.user.dataOrigin ?? null;
  // A seed/demo partner may accept a real customer's job. A suite fixture still cannot.
  const seedForBusinessBooking = Boolean(ctx.bookingIsBusiness && owner && isMarketplaceSeedAccount(owner.user.email));
  if (owner && isBusinessRow(origin) !== ctx.bookingIsBusiness && !seedForBusinessBooking) {
    return { reason: "PROVENANCE_INVALID", detail: ctx.bookingIsBusiness ? "non_business_provider" : "business_provider" };
  }
  const rejected = capabilityRejections(rows, ctx, true, now, origin, seedForBusinessBooking ? { seedVisible: true } : undefined);
  return rejected[0] ?? null;
}

/**
 * Phase 11 — the ONE "provider offers this service" predicate, shared by matching, the availability
 * projection and the public discovery surfaces. Two ways in:
 *   - legacy: the String[] rule (`serviceCategoryMatchWhere`) and, in LEGACY_FALLBACK, the legacy
 *     `requiredSkills` hasEvery (in STRICT those codes are typed skill requirements the gate checks);
 *   - typed: an ACTIVE provider_service_capabilities row for this service.
 * With no typed rows (every database today) the predicate is exactly the legacy one. `null` means
 * the service does not exist: no provider offers it.
 */
export async function serviceOfferWhere(
  serviceId: string,
  opts: { gate?: ServiceGateContext; matchTokens?: ServiceMatchTokens | null } = {},
  db: Db = prisma,
): Promise<Prisma.ProviderWhereInput | null> {
  const matchTokens = opts.matchTokens !== undefined ? opts.matchTokens : await resolveServiceMatchTokens(serviceId);
  if (!matchTokens) return null;
  const gate = opts.gate ?? (await loadServiceGateContext(serviceId, null, db));
  const requiredSkills = gate.legacyRequiredSkills;
  const legacyWhere: Prisma.ProviderWhereInput = {
    ...serviceCategoryMatchWhere(matchTokens),
    ...(gate.mode === "LEGACY_FALLBACK" && requiredSkills.length ? { serviceCategories: { hasEvery: requiredSkills } } : {}),
  };
  const typedIds = await providersWithActiveServiceCapability(serviceId, db);
  return typedIds.length ? { AND: [{ OR: [legacyWhere, { id: { in: typedIds } }] }] } : legacyWhere;
}

/**
 * Providers holding an ACTIVE capability row for this service — the typed entry into the candidate
 * set. Empty when the table is absent. One indexed query (`provider_service_capabilities_service_active_idx`).
 */
export async function providersWithActiveServiceCapability(serviceId: string, db: Db = prisma): Promise<string[]> {
  const present = await presentTables(db);
  if (!present.has("provider_service_capabilities")) return [];
  const rows = await db.$queryRaw<Array<{ provider_id: string }>>`
    SELECT provider_id FROM provider_service_capabilities WHERE service_id = ${serviceId} AND status = 'ACTIVE'`;
  return rows.map((r) => r.provider_id);
}
