/**
 * Partner service skills after signup.
 *
 * A partner picks services once, at registration. Later skills are a request:
 * the partner asks, an admin approves, and only then does the service id + slug
 * land on `provider.serviceCategories` and an ACTIVE capability row.
 *
 * The first request also records ACTIVE/LEGACY rows for every service the signup
 * list already covers. Dispatch ignores the signup list as soon as any capability
 * row exists, so skipping that step would silently stop their current work.
 */
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { classifyServiceSkill, withServiceTokens, withoutServiceTokens, type ServiceCapabilityStatus, type ServiceSkillLane } from "../lib/partner-service-skills";
import { providerOffersService, resolvePartnerRegistrationSlugs, type ServiceMatchTokens } from "../lib/service-match";

type Db = Prisma.TransactionClient | typeof prisma;

type CatalogRow = { id: string; name: string; slug: string; category: string };

export type ServiceSkillCard = {
  serviceId: string;
  name: string;
  slug: string;
  category: string;
  lane: ServiceSkillLane;
  capabilityId: number | null;
  source: string | null;
  requestedAt: string | null;
  requestNote: string | null;
};

export type ServiceSkillBoard = {
  approvalWorkflow: boolean;
  performing: ServiceSkillCard[];
  pending: ServiceSkillCard[];
  suspended: ServiceSkillCard[];
  revoked: ServiceSkillCard[];
  available: ServiceSkillCard[];
};

const catalogSelect = { id: true, name: true, slug: true, category: true } as const;

async function loadCatalog(db: Db): Promise<CatalogRow[]> {
  return db.service.findMany({
    where: { isActive: true },
    select: catalogSelect,
    orderBy: { name: "asc" },
  });
}

function tokensFor(service: CatalogRow, idsByCategory: Map<string, string[]>): ServiceMatchTokens {
  return {
    serviceId: service.id,
    category: service.category,
    serviceSlug: service.slug,
    categoryServiceIds: idsByCategory.get(service.category) ?? [service.id],
    partnerRegistrationSlugs: resolvePartnerRegistrationSlugs(service.category, service.slug),
  };
}

function indexCatalog(rows: CatalogRow[]) {
  const idsByCategory = new Map<string, string[]>();
  for (const row of rows) {
    const list = idsByCategory.get(row.category) ?? [];
    list.push(row.id);
    idsByCategory.set(row.category, list);
  }
  return idsByCategory;
}

type CapabilityHit = { id: number; serviceId: string; status: ServiceCapabilityStatus; source: string; requestedAt: Date; requestNote: string | null };

async function loadCapabilityHits(db: Db, providerId: string): Promise<CapabilityHit[]> {
  const rows = await db.$queryRaw<Array<{ id: bigint; service_id: string; status: ServiceCapabilityStatus; source: string; created_at: Date; suspended_reason: string | null }>>`
    SELECT id, service_id, status, source, created_at, suspended_reason
    FROM provider_service_capabilities
    WHERE provider_id = ${providerId}`;
  return rows.map((row) => ({
    id: Number(row.id),
    serviceId: row.service_id,
    status: row.status,
    source: row.source,
    requestedAt: row.created_at,
    requestNote: row.status === "REQUESTED" ? row.suspended_reason : null,
  }));
}

/**
 * Writes ACTIVE/LEGACY rows for signup skills that have no typed row yet.
 * `exceptServiceId` stays untouched so a new request can remain REQUESTED.
 */
export async function grandfatherLegacyOffers(
  db: Db,
  input: { providerId: string; actorUserId: string; origin: string | null; now: Date; exceptServiceId?: string | null },
): Promise<number> {
  const provider = await db.provider.findUnique({
    where: { id: input.providerId },
    select: { serviceCategories: true },
  });
  if (!provider) return 0;
  const catalog = await loadCatalog(db);
  const idsByCategory = indexCatalog(catalog);
  const existing = await db.$queryRaw<Array<{ service_id: string }>>`
    SELECT service_id FROM provider_service_capabilities WHERE provider_id = ${input.providerId}`;
  const have = new Set(existing.map((row) => row.service_id));
  let written = 0;
  for (const service of catalog) {
    if (service.id === input.exceptServiceId) continue;
    if (have.has(service.id)) continue;
    if (!providerOffersService(provider.serviceCategories, tokensFor(service, idsByCategory))) continue;
    await db.$executeRaw`
      INSERT INTO provider_service_capabilities
        (provider_id, service_id, status, source, verified_by, verified_at, suspended_reason, data_origin)
      VALUES (
        ${input.providerId}, ${service.id}, 'ACTIVE', 'LEGACY', ${input.actorUserId}, ${input.now}, NULL, ${input.origin}::"DataOrigin"
      )
      ON CONFLICT (provider_id, service_id) DO NOTHING`;
    written += 1;
  }
  return written;
}

export async function alreadyPerformsService(db: Db, providerId: string, serviceId: string): Promise<boolean> {
  const [provider, hits, catalog] = await Promise.all([
    db.provider.findUnique({ where: { id: providerId }, select: { serviceCategories: true } }),
    loadCapabilityHits(db, providerId),
    loadCatalog(db),
  ]);
  if (!provider) return false;
  const own = hits.find((hit) => hit.serviceId === serviceId);
  if (own?.status === "ACTIVE") return true;
  if (hits.length > 0) return false;
  const service = catalog.find((row) => row.id === serviceId);
  if (!service) return false;
  return providerOffersService(provider.serviceCategories, tokensFor(service, indexCatalog(catalog)));
}

export async function grantServiceCategoryTokens(db: Db, providerId: string, serviceId: string): Promise<void> {
  const [provider, service] = await Promise.all([
    db.provider.findUnique({ where: { id: providerId }, select: { serviceCategories: true } }),
    db.service.findUnique({ where: { id: serviceId }, select: { id: true, slug: true } }),
  ]);
  if (!provider || !service) return;
  const next = withServiceTokens(provider.serviceCategories, service.id, service.slug);
  if (next.length === provider.serviceCategories.length && next.every((token, i) => token === provider.serviceCategories[i])) return;
  await db.provider.update({ where: { id: providerId }, data: { serviceCategories: next } });
}

export async function withdrawServiceCategoryTokens(db: Db, providerId: string, serviceId: string): Promise<void> {
  const [provider, service] = await Promise.all([
    db.provider.findUnique({ where: { id: providerId }, select: { serviceCategories: true } }),
    db.service.findUnique({ where: { id: serviceId }, select: { id: true, slug: true } }),
  ]);
  if (!provider || !service) return;
  const next = withoutServiceTokens(provider.serviceCategories, service.id, service.slug);
  if (next.length === provider.serviceCategories.length) return;
  await db.provider.update({ where: { id: providerId }, data: { serviceCategories: next } });
}

function card(service: CatalogRow, lane: ServiceSkillLane, hit: CapabilityHit | undefined): ServiceSkillCard {
  return {
    serviceId: service.id,
    name: service.name,
    slug: service.slug,
    category: service.category,
    lane,
    capabilityId: hit?.id ?? null,
    source: hit?.source ?? null,
    requestedAt: hit ? hit.requestedAt.toISOString() : null,
    requestNote: hit?.requestNote ?? null,
  };
}

export async function buildServiceSkillBoard(providerId: string, approvalWorkflow: boolean): Promise<ServiceSkillBoard | null> {
  const provider = await prisma.provider.findUnique({
    where: { id: providerId },
    select: { serviceCategories: true },
  });
  if (!provider) return null;
  const catalog = await loadCatalog(prisma);
  const idsByCategory = indexCatalog(catalog);
  const hits = approvalWorkflow ? await loadCapabilityHits(prisma, providerId) : [];
  const byService = new Map(hits.map((hit) => [hit.serviceId, hit]));
  const hasAny = hits.length > 0;
  const lanes: Record<ServiceSkillLane, ServiceSkillCard[]> = {
    performing: [],
    pending: [],
    suspended: [],
    revoked: [],
    available: [],
  };
  for (const service of catalog) {
    const hit = byService.get(service.id);
    const lane = classifyServiceSkill({
      offersViaCategories: providerOffersService(provider.serviceCategories, tokensFor(service, idsByCategory)),
      capabilityStatus: hit?.status ?? null,
      hasAnyCapabilityRow: hasAny,
    });
    lanes[lane].push(card(service, lane, hit));
  }
  return { approvalWorkflow, ...lanes };
}

export type PendingServiceSkill = {
  capabilityId: number;
  providerId: string;
  partnerName: string;
  city: string | null;
  serviceId: string;
  serviceName: string;
  serviceSlug: string;
  category: string;
  requestedAt: string;
  requestNote: string | null;
};

export async function listPendingServiceSkills(): Promise<PendingServiceSkill[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: bigint;
    provider_id: string;
    service_id: string;
    created_at: Date;
    suspended_reason: string | null;
    service_name: string;
    service_slug: string;
    category: string;
    city: string | null;
    first_name: string;
    last_name: string;
  }>>`
    SELECT psc.id, psc.provider_id, psc.service_id, psc.created_at, psc.suspended_reason,
           s.name AS service_name, s.slug AS service_slug, s.category,
           p.city, u.first_name, u.last_name
    FROM provider_service_capabilities psc
    JOIN services s ON s.id = psc.service_id
    JOIN providers p ON p.id = psc.provider_id
    JOIN users u ON u.id = p.user_id
    WHERE psc.status = 'REQUESTED'
    ORDER BY psc.created_at ASC
    LIMIT 200`;
  return rows.map((row) => ({
    capabilityId: Number(row.id),
    providerId: row.provider_id,
    partnerName: `${row.first_name} ${row.last_name}`.trim(),
    city: row.city,
    serviceId: row.service_id,
    serviceName: row.service_name,
    serviceSlug: row.service_slug,
    category: row.category,
    requestedAt: row.created_at.toISOString(),
    requestNote: row.suspended_reason,
  }));
}

export type ServiceSkillError = "NOT_DEPLOYED" | "PROVIDER_NOT_FOUND" | "SERVICE_NOT_FOUND" | "ALREADY_OFFERED" | "CAPABILITY_LOCKED" | "REASON_REQUIRED" | "NOT_FOUND" | "INVALID_TRANSITION";

export type ServiceSkillResult<T> = { ok: true; data: T } | { ok: false; error: ServiceSkillError; detail?: string };

export async function serviceSkillTablesPresent(db: Db = prisma): Promise<boolean> {
  return tablesPresent(db);
}

async function tablesPresent(db: Db): Promise<boolean> {
  const [row] = await db.$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass('provider_service_capabilities') IS NOT NULL AS present`;
  return row?.present === true;
}

async function stampActor(db: Db, actorType: "partner" | "admin", actorId: string, reason: string) {
  await db.$queryRaw`SELECT
    set_config('homigo.actor_type', ${actorType}, true),
    set_config('homigo.actor_id', ${actorId}, true),
    set_config('homigo.reason', ${reason.slice(0, 500)}, true)`;
}

/** Partner asks for one more catalogue service. Stays REQUESTED until an admin approves. */
export async function requestServiceSkill(input: {
  providerId: string;
  actorUserId: string;
  serviceId: string;
  note?: string | null;
  now?: Date;
}): Promise<ServiceSkillResult<{ changed: boolean }>> {
  if (!(await tablesPresent(prisma))) return { ok: false, error: "NOT_DEPLOYED" };
  const now = input.now ?? new Date();
  const note = (input.note ?? "").trim().slice(0, 300) || null;
  const provider = await prisma.provider.findUnique({ where: { id: input.providerId }, select: { id: true } });
  if (!provider) return { ok: false, error: "PROVIDER_NOT_FOUND" };
  const service = await prisma.service.findFirst({ where: { id: input.serviceId, isActive: true }, select: { id: true } });
  if (!service) return { ok: false, error: "SERVICE_NOT_FOUND" };
  const origin: string | null = null;
  return prisma.$transaction(async (tx) => {
    await stampActor(tx, "partner", input.actorUserId, note ? `partner requested service capability: ${note}` : "partner requested service capability");
    const [existing] = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM provider_service_capabilities WHERE provider_id = ${input.providerId} AND service_id = ${input.serviceId} FOR UPDATE`;
    if (existing) {
      if (existing.status === "REQUESTED" || existing.status === "ACTIVE") return { ok: true as const, data: { changed: false } };
      return { ok: false as const, error: "CAPABILITY_LOCKED" as const, detail: `capability is ${existing.status}` };
    }
    if (await alreadyPerformsService(tx, input.providerId, input.serviceId)) {
      return { ok: false as const, error: "ALREADY_OFFERED" as const, detail: "This partner already performs this service" };
    }
    await grandfatherLegacyOffers(tx, { providerId: input.providerId, actorUserId: input.actorUserId, origin, now, exceptServiceId: input.serviceId });
    await tx.$executeRaw`
      INSERT INTO provider_service_capabilities
        (provider_id, service_id, status, source, verified_by, verified_at, suspended_reason, data_origin)
      VALUES (${input.providerId}, ${input.serviceId}, 'REQUESTED', 'SELF', NULL, NULL, ${note}, ${origin}::"DataOrigin")`;
    return { ok: true as const, data: { changed: true } };
  });
}

/** Admin grants, approves, suspends, or revokes one service skill. */
export async function decideServiceSkill(input: {
  providerId: string;
  serviceId: string;
  action: "approve" | "suspend" | "revoke";
  adminUserId: string;
  reason?: string | null;
  now?: Date;
}): Promise<ServiceSkillResult<{ status: string }>> {
  if (!(await tablesPresent(prisma))) return { ok: false, error: "NOT_DEPLOYED" };
  const now = input.now ?? new Date();
  const reason = (input.reason ?? "").trim();
  if (input.action !== "approve" && reason.length < 3) return { ok: false, error: "REASON_REQUIRED" };
  const provider = await prisma.provider.findUnique({ where: { id: input.providerId }, select: { id: true } });
  if (!provider) return { ok: false, error: "PROVIDER_NOT_FOUND" };
  const origin: string | null = null;
  return prisma.$transaction(async (tx) => {
    await stampActor(tx, "admin", input.adminUserId, reason || `admin ${input.action} service capability`);
    if (input.action === "approve" || input.action === "suspend") {
      await grandfatherLegacyOffers(tx, { providerId: input.providerId, actorUserId: input.adminUserId, origin, now });
    }
    const [existing] = await tx.$queryRaw<Array<{ id: bigint; status: string }>>`
      SELECT id, status FROM provider_service_capabilities WHERE provider_id = ${input.providerId} AND service_id = ${input.serviceId} FOR UPDATE`;
    if (input.action === "approve") {
      const service = await tx.service.findFirst({ where: { id: input.serviceId, isActive: true }, select: { id: true } });
      if (!service) return { ok: false as const, error: "SERVICE_NOT_FOUND" as const };
      if (!existing) {
        await tx.$executeRaw`
          INSERT INTO provider_service_capabilities
            (provider_id, service_id, status, source, verified_by, verified_at, suspended_reason, data_origin)
          VALUES (${input.providerId}, ${input.serviceId}, 'ACTIVE', 'ADMIN', ${input.adminUserId}, ${now}, NULL, ${origin}::"DataOrigin")`;
      } else if (existing.status !== "ACTIVE") {
        await tx.$executeRaw`
          UPDATE provider_service_capabilities
          SET status = 'ACTIVE', verified_by = ${input.adminUserId}, verified_at = ${now}, suspended_reason = NULL
          WHERE id = ${existing.id}`;
      }
      await grantServiceCategoryTokens(tx, input.providerId, input.serviceId);
      return { ok: true as const, data: { status: "ACTIVE" } };
    }
    if (!existing) return { ok: false as const, error: "NOT_FOUND" as const };
    if (input.action === "suspend") {
      if (existing.status !== "REQUESTED" && existing.status !== "ACTIVE") {
        return { ok: false as const, error: "INVALID_TRANSITION" as const, detail: `${existing.status} → SUSPENDED` };
      }
      await tx.$executeRaw`UPDATE provider_service_capabilities SET status = 'SUSPENDED', suspended_reason = ${reason} WHERE id = ${existing.id}`;
      await withdrawServiceCategoryTokens(tx, input.providerId, input.serviceId);
      return { ok: true as const, data: { status: "SUSPENDED" } };
    }
    if (existing.status === "REVOKED") return { ok: false as const, error: "INVALID_TRANSITION" as const, detail: "already REVOKED" };
    await tx.$executeRaw`UPDATE provider_service_capabilities SET status = 'REVOKED', suspended_reason = ${reason} WHERE id = ${existing.id}`;
    await withdrawServiceCategoryTokens(tx, input.providerId, input.serviceId);
    return { ok: true as const, data: { status: "REVOKED" } };
  });
}

export async function withdrawServiceSkillRequest(providerId: string, actorUserId: string, capabilityId: number): Promise<ServiceSkillResult<{ deleted: true }>> {
  if (!(await tablesPresent(prisma))) return { ok: false, error: "NOT_DEPLOYED" };
  return prisma.$transaction(async (tx) => {
    await stampActor(tx, "partner", actorUserId, "partner withdrew service capability request");
    const [row] = await tx.$queryRaw<Array<{ id: bigint; status: string }>>`
      SELECT id, status FROM provider_service_capabilities WHERE id = ${capabilityId} AND provider_id = ${providerId} FOR UPDATE`;
    if (!row) return { ok: false as const, error: "NOT_FOUND" as const };
    if (row.status !== "REQUESTED") return { ok: false as const, error: "CAPABILITY_LOCKED" as const };
    await tx.$executeRaw`DELETE FROM provider_service_capabilities WHERE id = ${row.id}`;
    return { ok: true as const, data: { deleted: true as const } };
  });
}
