import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { isKnownLocalEnvironment } from "../lib/deployed-environment";
import { formatServiceList } from "../lib/format";
import { parsePagination } from "../lib/pagination";
import { isValidRupeeAmount } from "../lib/pricing-policy";
import {
  catalogConfigGaps,
  effectiveAddonCatalogue,
  isSafeMediaUrl,
  parseCatalogConfig,
  publicCatalogConfig,
  resolveServiceDuration,
  resolveServiceSelection,
  quantityPriceTable,
  serviceCatalogConfigSchema,
  type SelectionInput,
  type ServiceCatalogConfig,
} from "../lib/service-catalog-config";
import { loadHydratedCatalog, syncRelationalCatalog, syncServiceExecution, syncServiceRequirements, withRequirementItems, withRequirementItemsMany } from "../lib/service-catalog-store";
import { customerRequirementsView, resolveServiceRequirements, type CustomerRequirementsView } from "../lib/service-requirements";
import { customerProfessionalView, customerVisitPromise, customerQualitySummary, startPinRequired } from "../lib/customer-visit";

/**
 * The policy in force for editing a LIVE service (rules in `liveEditPolicyFor`). The approver count
 * is read only when the answer depends on it: active admins who are SUPER_ADMIN or whose role holds
 * SETTINGS/APPROVE, the permission the approve routes require.
 */
export async function liveEditPolicy(): Promise<LiveEditPolicy> {
  const configured = process.env.SERVICE_LIVE_EDIT_POLICY;
  const knownLocal = isKnownLocalEnvironment();
  const fixed = liveEditPolicyFor({ configured, knownLocal, approverCount: 0 });
  if (fixed.source !== "auto") return fixed.policy;
  const approverCount = await prisma.adminUser.count({
    where: {
      isActive: true,
      OR: [{ role: { name: "SUPER_ADMIN" } }, { role: { permissions: { some: { resource: "SETTINGS", action: "APPROVE" } } } }],
    },
  });
  return liveEditPolicyFor({ configured, knownLocal, approverCount }).policy;
}

/** `service_config_versions.snapshot` of a DRAFT row: a proposed change to a live service. */
type PendingRevisionSnapshot = {
  kind: "PENDING_REVISION";
  patch: Record<string, unknown>;
  baseVersion: number;
  baseContentHash: string;
  contentHash: string;
  proposedBy: string | null;
  proposedAt: string;
  changeReason: string | null;
  changes: ContentChange[];
  /** Set when a different admin approved the revision for a later time. Absent while it awaits approval. */
  approval?: { actorId: string; approvedAt: string; scheduledLiveAt: string };
};

function pendingRevisionView(row: { version: number; snapshot: unknown }) {
  const snap = row.snapshot as Partial<PendingRevisionSnapshot> | null;
  if (!snap || snap.kind !== "PENDING_REVISION") return null;
  return {
    version: row.version,
    baseVersion: snap.baseVersion ?? null,
    contentHash: snap.contentHash ?? null,
    proposedBy: snap.proposedBy ?? null,
    proposedAt: snap.proposedAt ?? null,
    changeReason: snap.changeReason ?? null,
    changes: snap.changes ?? [],
    /** Approved and waiting for its time, when set. */
    approvedBy: snap.approval?.actorId ?? null,
    scheduledLiveAt: snap.approval?.scheduledLiveAt ?? null,
    /** What the editor sent, so it can reopen the proposal instead of the live values. */
    patch: snap.patch ?? {},
  };
}

/**
 * Required training modules that nobody can complete: the slug is unknown, or the module is not
 * published. One query for any number of configurations. Returned per configuration, in order, so
 * the publish gate can say which service is affected (`unavailableTrainingModules`).
 */
async function trainingModuleGaps(cfgs: Array<ServiceCatalogConfig | null>): Promise<string[][]> {
  const required = cfgs.map((c) => c?.providerRequirements?.trainingModules ?? []);
  const slugs = [...new Set(required.flat())];
  if (slugs.length === 0) return required.map(() => []);
  const published = new Set(
    (await prisma.partnerAcademyModule.findMany({ where: { slug: { in: slugs }, isPublished: true }, select: { slug: true } })).map((m) => m.slug),
  );
  return required.map((list) => list.filter((slug) => !published.has(slug)));
}

/** Catalogue facts attached for gates are not stored back into catalog JSON. */
function withoutServerFacts(cfg: ServiceCatalogConfig | null): ServiceCatalogConfig | null {
  if (!cfg) return null;
  const copy = { ...cfg } as ServiceCatalogConfig & { requirementItems?: unknown };
  delete copy.requirementItems;
  return copy;
}

/** Phase 06 customer view for the base selection; null when the configuration cannot be resolved (never a guess). */
function baseCustomerRequirements(cfg: ServiceCatalogConfig | null): CustomerRequirementsView | null {
  const r = resolveServiceRequirements(cfg, { variantId: null, addonIds: [], quantity: cfg?.quantity?.default ?? cfg?.quantity?.min ?? 1 });
  if (!r.ok) return null;
  return customerRequirementsView(r.items, Object.fromEntries((cfg?.addons ?? []).map((a) => [a.id, a.name])));
}
import {
  assertBookable,
  bookingConfigSnapshot,
  canTransition,
  configSections,
  CUSTOMER_CATALOG_WHERE,
  deriveConfigStatus,
  effectiveLifecycleTarget,
  inferCapabilityProfile,
  LIFECYCLE_TRANSITIONS,
  lifecycleFlags,
  parseLifecycle,
  parseProfile,
  PARTNER_OPERATIONAL_WHERE,
  REQUESTABLE_LIFECYCLES,
  SERVICE_LIFECYCLE,
  approvalContentHash,
  contentDiff,
  liveEditPolicyFor,
  liveEditRegressions,
  controlPlaneState,
  OFF_SALE_LIFECYCLES,
  type ContentChange,
  type LiveEditPolicy,
  evaluatePublishApproval,
  publishGateResults,
  scheduledActivationDecision,
  scheduledLiveInstant,
  validateForActivation,
  type PublishIssue,
  type ServiceLifecycleStatus,
} from "../lib/service-domain";
import { BOOKING_BUFFER_MINUTES, slotDurationFor } from "./booking-validation.service";
import { AuditLogService } from "./audit-log.service";
import { incCounter, observeHist } from "../lib/metrics";
import { cacheService } from "./cache.service";
import { partnerOnboardingOptionDefs } from "../lib/service-match";
import {
  bookingFlowForProfile,
  customerEquipmentCopy,
  customerMaterialsCopy,
  partnerEquipmentCopy,
  partnerMaterialsCopy,
  paymentCapabilities,
} from "../lib/service-runtime-policy";

// Catalog data changes rarely (no runtime mutation endpoints) and is read on
// nearly every home/category view, so a short TTL is safe and high-value.
const FEATURED_TTL = 10 * 60; // 10 minutes
const CATEGORY_TTL = 5 * 60; //  5 minutes
const LIST_TTL = 60; // 1 minute — homepage list, hottest read in the app
const L1_TTL = 10; // in-process micro-cache: avoids a Redis RTT per request under load

const CUSTOMER_VISIBLE: Prisma.ServiceWhereInput = CUSTOMER_CATALOG_WHERE;

type ServiceRating = { rating: number | null; reviewCount: number };

/**
 * Real per-service ratings aggregated from the ratings table (rating → booking →
 * serviceId). Services have no rating column, so this is the source of truth.
 * Returns null rating for services with no reviews yet (frontend shows "New").
 */
async function ratingsForServices(serviceIds: string[]): Promise<Map<string, ServiceRating>> {
  const map = new Map<string, ServiceRating>();
  if (serviceIds.length === 0) return map;

  const rows = await prisma.$queryRaw<
    Array<{ service_id: string; avg_stars: number | null; review_count: bigint }>
  >`
    SELECT b.service_id,
           ROUND(AVG(r.rating)::numeric, 1)::float AS avg_stars,
           COUNT(*)::bigint AS review_count
    FROM ratings r
    INNER JOIN bookings b ON b.id = r.booking_id
    WHERE b.service_id = ANY(${serviceIds}::text[])
    GROUP BY b.service_id
  `;

  for (const row of rows) {
    const count = Number(row.review_count);
    map.set(row.service_id, {
      rating: row.avg_stars != null ? Number(row.avg_stars) : null,
      reviewCount: count,
    });
  }
  return map;
}

/** Taxonomy relations every service read that projects taxonomy includes. */
const TAXONOMY_INCLUDE = {
  taxonomyCategory: { select: { slug: true, name: true } },
  taxonomySubcategory: { select: { slug: true, name: true } },
} as const satisfies Prisma.ServiceInclude;

type AdminServiceRecord = Prisma.ServiceGetPayload<{ include: typeof TAXONOMY_INCLUDE }>;

function taxonomyView(s: {
  taxonomyCategory?: { slug: string; name: string } | null;
  taxonomySubcategory?: { slug: string; name: string } | null;
}) {
  return {
    category: s.taxonomyCategory ? { slug: s.taxonomyCategory.slug, name: s.taxonomyCategory.name } : null,
    subcategory: s.taxonomySubcategory ? { slug: s.taxonomySubcategory.slug, name: s.taxonomySubcategory.name } : null,
  };
}

const IDENTITY_CODE_RE = /^[a-z0-9][a-z0-9-]*$/;
const INTERNAL_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ICON_TOKEN_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type AdminWriteError =
  | "INVALID_CONFIG"
  | "INVALID_IDENTITY"
  | "INVALID_MEDIA"
  | "INVALID_TAXONOMY"
  | "DUPLICATE"
  | "VERSION_CONFLICT";

type AdminCreateRequired = {
  name: string;
  description: string;
  category: string;
  basePrice: number;
  estimatedDuration: number;
};

export type AdminServiceInput = Partial<{
  subcategory: string;
  detailedDescription: string;
  minPrice: number;
  maxPrice: number;
  icon: string;
  isActive: boolean;
  isFeatured: boolean;
  premiumOnly: boolean;
  availableCities: string[];
  slug: string;
  pricingModel: string;
  thumbnail: string;
  images: string[];
  includedServices: string[];
  excludedServices: string[];
  requirements: string[];
  catalogConfig: unknown;
  capabilityProfile: string;
  displayName: string;
  shortName: string;
  serviceCode: string;
  internalServiceCode: string;
  categorySlug: string | null;
  subcategorySlug: string | null;
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  ownerTeam: string;
  operationsNotes: string;
  partnerSlotPolicy: "DURATION" | "FIXED";
}>;

class VersionConflict extends Error {}

/** Customer-safe content block for the detail page. Admin-only notes never enter it. */
function customerContent(
  s: { description: string; includedServices: string[]; excludedServices: string[]; thumbnail: string | null; images: string[] },
  cfg: ServiceCatalogConfig | null,
) {
  const c = cfg?.content;
  return {
    summary: c?.customerSummary ?? s.description,
    valueProposition: c?.valueProposition ?? null,
    highlights: c?.highlights ?? [],
    keyBenefits: c?.keyBenefits ?? [],
    included: s.includedServices,
    excluded: s.excludedServices,
    limitations: c?.limitations ?? [],
    importantNotes: c?.importantNotes ?? [],
    customerDisclosures: c?.customerDisclosures ?? [],
    media: {
      thumbnail: s.thumbnail,
      heroImage: cfg?.media?.heroImage ?? s.images[0] ?? s.thumbnail ?? null,
      heroVideo: cfg?.media?.heroVideo ?? cfg?.video ?? null,
      gallery: cfg?.media?.gallery ?? s.images,
      instructional: cfg?.media?.instructional ?? [],
      beforeAfter: cfg?.media?.beforeAfter ?? [],
      documents: cfg?.media?.documents ?? [],
    },
  };
}

export class CatalogService {
  async list(query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const cacheKey = `catalog:list:v2:${page}:${limit}:${query.category ?? ""}:${query.city ?? ""}:${
      query.minPrice ?? ""
    }:${query.maxPrice ?? ""}:${query.sortBy ?? ""}:${query.categorySlug ?? ""}:${query.subcategorySlug ?? ""}`;
    return cacheService.getOrFetch(
      cacheKey,
      LIST_TTL,
      async () => {
        const started = Date.now();
        const where: Prisma.ServiceWhereInput = { ...CUSTOMER_VISIBLE };
        if (query.category) where.category = query.category;
        if (query.minPrice != null || query.maxPrice != null) {
          where.basePrice = {};
          if (query.minPrice != null) (where.basePrice as Prisma.FloatFilter).gte = Number(query.minPrice);
          if (query.maxPrice != null) (where.basePrice as Prisma.FloatFilter).lte = Number(query.maxPrice);
        }
        if (query.city) where.availableCities = { has: query.city };
        if (query.categorySlug) where.taxonomyCategory = { slug: query.categorySlug };
        if (query.subcategorySlug) where.taxonomySubcategory = { slug: query.subcategorySlug };

        // popularity alone is not unique. Offset pages then skip and repeat rows, so a service
        // that is public never appears on any page once the catalogue is larger than one page.
        let orderBy: Prisma.ServiceOrderByWithRelationInput[] = [{ popularity: "desc" }, { id: "asc" }];
        if (query.sortBy === "price") orderBy = [{ basePrice: "asc" }, { id: "asc" }];
        if (query.sortBy === "newest") orderBy = [{ createdAt: "desc" }, { id: "asc" }];

        const [rows, total] = await Promise.all([
          prisma.service.findMany({ where, orderBy, skip, take: limit, include: TAXONOMY_INCLUDE }),
          prisma.service.count({ where }),
        ]);
        const ratings = await ratingsForServices(rows.map((r) => r.id));
        observeHist("service_catalog_lookup_latency", (Date.now() - started) / 1000);
        return {
          services: rows.map((r) => ({ ...formatServiceList(r, ratings.get(r.id)), taxonomy: taxonomyView(r) })),
          total,
          page,
          limit,
        };
      },
      L1_TTL,
    );
  }

  async byId(id: string) {
    const started = Date.now();
    const s = await prisma.service.findFirst({ where: { id, ...CUSTOMER_VISIBLE }, include: TAXONOMY_INCLUDE });
    if (!s) return null;
    const cfg = await loadHydratedCatalog(s);
    const agg = (await ratingsForServices([s.id])).get(s.id);
    const profile = parseProfile(s.capabilityProfile, s.category);
    const pay = paymentCapabilities(cfg);
    observeHist("service_catalog_lookup_latency", (Date.now() - started) / 1000);
    incCounter("service_view_total");
    return {
      id: s.id,
      name: s.displayName || s.name,
      slug: s.slug,
      description: s.description,
      detailedDescription: s.detailedDescription,
      category: s.category,
      subcategory: s.subcategory,
      basePrice: s.basePrice,
      minPrice: s.minPrice ?? s.basePrice,
      maxPrice: s.maxPrice ?? s.basePrice,
      estimatedDuration: s.estimatedDuration,
      durationRange: s.durationRange,
      icon: s.icon,
      thumbnail: s.thumbnail,
      images: s.images,
      catalogConfig: publicCatalogConfig(cfg),
      /** Selection-config version; send it back as serviceVersion to detect a stale page. */
      version: s.version,
      taxonomy: taxonomyView(s),
      content: customerContent(s, cfg),
      /** Base selection duration (default quantity, no add-ons) from the one duration calculator. */
      duration: resolveServiceDuration(s, cfg),
      /**
       * Phase 06: preparation for the BASE selection (default quantity, no variant, no add-ons), customer
       * view only. Selection-specific requirements come back with the quote / resolve-selection.
       */
      preparation: baseCustomerRequirements(cfg),
      quantityPrices: quantityPriceTable(s, cfg),
      /** Add-ons this service offers (its own catalogue, or the shared one). Server-priced. */
      addons: effectiveAddonCatalogue(cfg).map((a) => ({
        id: a.id,
        name: a.name,
        price: a.price,
        durationMin: a.durationMin ?? null,
        maxQuantity: a.quantityAllowed === false ? 1 : (a.maxQuantity ?? 1),
        compatibleVariantIds: a.compatibleVariantIds ?? [],
        requiresAddonIds: a.requiresAddonIds ?? [],
        conflictsWithAddonIds: a.conflictsWithAddonIds ?? [],
      })),
      pricingModel: s.pricingModel,
      bookable: assertBookable(s, cfg).ok,
      comingSoon: cfg?.comingSoon === true,
      indexable: assertBookable(s, cfg).ok && cfg?.seo?.noindex !== true,
      tags: s.tags,
      seoTitle: s.seoTitle,
      seoDescription: s.seoDescription,
      rating: agg?.rating ?? null,
      reviewCount: agg?.reviewCount ?? 0,
      bookingCount: s.bookingCount,
      includedServices: s.includedServices,
      excludedServices: s.excludedServices,
      requirements: s.requirements,
      availableCities: s.availableCities,
      isFeatured: s.isFeatured,
      isPopular: s.isPopular,
      premiumOnly: s.premiumOnly,
      capabilityProfile: profile,
      bookingFlow: bookingFlowForProfile(profile),
      paymentCapabilities: pay,
      materialsResponsibility: customerMaterialsCopy(cfg?.materialPolicy),
      equipmentResponsibility: customerEquipmentCopy(cfg?.equipmentPolicy),
      /**
       * Numeric proof flags and warranty days. Days follow warranty.v1, the same snapshot a booking
       * freezes — not the legacy quality.warrantyDays field. The checklist is not included.
       */
      qualitySummary: customerQualitySummary(cfg),
      /** Customer-safe visit promise. Partner steps, holds and matching never appear here. */
      visit: customerVisitPromise(cfg, { startPinRequired: startPinRequired(process.env.SERVICE_START_OTP_REQUIRED) }),
      /** What matching enforces about the professional, in plain statements. Null when nothing is enforced. */
      professional: customerProfessionalView(cfg),
    };
  }

  async byCategory(category: string, query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    return cacheService.getOrFetch(`catalog:category:v2:${category}:${page}:${limit}`, CATEGORY_TTL, async () => {
      const where = { ...CUSTOMER_VISIBLE, category };
      const [rows, total] = await Promise.all([
        prisma.service.findMany({
          where,
          skip,
          take: limit,
          orderBy: [{ popularity: "desc" }, { id: "asc" }],
        }),
        prisma.service.count({ where }),
      ]);
      return {
        services: rows.map((s) => ({
          id: s.id,
          name: s.name,
          basePrice: s.basePrice,
          category: s.category,
        })),
        category,
        total,
        page,
      };
    });
  }

  async search(body: {
    q?: string;
    category?: string;
    city?: string;
    minPrice?: number;
    maxPrice?: number;
    pricingModel?: string;
    audience?: string;
    bookingMode?: string;
  }) {
    const start = Date.now();
    const where: Prisma.ServiceWhereInput = { ...CUSTOMER_VISIBLE };
    if (body.category) where.category = body.category;
    if (body.city) where.availableCities = { has: body.city };
    if (body.pricingModel) where.pricingModel = body.pricingModel;
    if (body.minPrice != null || body.maxPrice != null) {
      where.basePrice = {};
      if (body.minPrice != null) (where.basePrice as Prisma.FloatFilter).gte = body.minPrice;
      if (body.maxPrice != null) (where.basePrice as Prisma.FloatFilter).lte = body.maxPrice;
    }
    if (body.q) {
      where.OR = [
        { name: { contains: body.q, mode: "insensitive" } },
        { description: { contains: body.q, mode: "insensitive" } },
        { tags: { has: body.q.toLowerCase() } },
      ];
    }
    const rows = await prisma.service.findMany({ where, take: 50, orderBy: { popularity: "desc" } });
    const ratings = await ratingsForServices(rows.map((s) => s.id));
    const filtered = rows.filter((s) => {
      if (!body.audience && !body.bookingMode) return true;
      const cfg = parseCatalogConfig(s.catalogConfig);
      if (body.audience && !((cfg?.audiences ?? []) as string[]).includes(body.audience)) return false;
      if (body.bookingMode) {
        const modes = [...(cfg?.bookingModes ?? []), cfg?.bookingMode].filter(Boolean) as string[];
        if (!modes.includes(body.bookingMode)) return false;
      }
      return true;
    });
    observeHist("service_catalog_lookup_latency", (Date.now() - start) / 1000);
    incCounter("service_search_total");
    return {
      services: filtered.map((s) => ({
        id: s.id,
        name: s.name,
        basePrice: s.basePrice,
        rating: ratings.get(s.id)?.rating ?? null,
        reviewCount: ratings.get(s.id)?.reviewCount ?? 0,
      })),
      total: filtered.length,
      searchTime: Date.now() - start,
    };
  }

  /** Customer taxonomy tree with live service counts. Only active categories. */
  async categories() {
    return cacheService.getOrFetch(
      "catalog:categories",
      CATEGORY_TTL,
      async () => {
        const [rows, counts, subCounts] = await Promise.all([
          prisma.serviceCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { slug: "asc" }] }),
          prisma.service.groupBy({ by: ["categoryId"], where: CUSTOMER_VISIBLE, _count: { _all: true } }),
          prisma.service.groupBy({ by: ["subcategoryId"], where: CUSTOMER_VISIBLE, _count: { _all: true } }),
        ]);
        const n = new Map(counts.map((c) => [c.categoryId, c._count._all]));
        const sn = new Map(subCounts.map((c) => [c.subcategoryId, c._count._all]));
        return {
          categories: rows
            .filter((r) => r.parentId == null)
            .map((c) => ({
              slug: c.slug,
              name: c.name,
              shortName: c.shortName,
              description: c.description,
              sortOrder: c.sortOrder,
              serviceCount: n.get(c.id) ?? 0,
              subcategories: rows
                .filter((r) => r.parentId === c.id)
                .map((sc) => ({ slug: sc.slug, name: sc.name, sortOrder: sc.sortOrder, serviceCount: sn.get(sc.id) ?? 0 })),
            })),
        };
      },
      L1_TTL,
    );
  }

  /**
   * Resolve a selection against the server catalogue without booking. Customer clients render this
   * (price lines before tax, duration, every validation issue, add-on availability) instead of
   * re-implementing the rules. Not cached: selection config must be current.
   */
  async resolveSelectionFor(id: string, input: SelectionInput & { serviceVersion?: number }) {
    const started = Date.now();
    const s = await prisma.service.findFirst({ where: { id, ...CUSTOMER_VISIBLE } });
    if (!s) return { error: "NOT_FOUND" as const };
    if (input.serviceVersion != null && input.serviceVersion !== s.version) {
      incCounter("service_selection_stale_version_total");
      return { error: "SERVICE_VERSION_CHANGED" as const, currentVersion: s.version };
    }
    const cfg = await loadHydratedCatalog(s);
    if (!assertBookable(s, cfg).ok) return { error: "SERVICE_NOT_BOOKABLE" as const };
    const r = resolveServiceSelection(s, cfg, input);
    observeHist("service_selection_resolve_latency", (Date.now() - started) / 1000);
    incCounter("service_selection_resolved_total", { ok: String(r.ok) });
    for (const i of r.ok ? [] : r.issues) incCounter("service_selection_issue_total", { code: i.code });
    return {
      serviceId: s.id,
      serviceVersion: s.version,
      ok: r.ok,
      issues: r.ok ? [] : r.issues,
      normalized: r.normalized,
      addonAvailability: r.addonAvailability,
      pricing: r.ok
        ? {
            servicePrice: r.servicePrice,
            addons: r.addons,
            addonTotal: r.addonTotal,
            subtotal: Math.round((r.servicePrice + r.addonTotal) * 100) / 100,
            note: "Before taxes, fees, discounts and any demand or weather adjustment — itemised at checkout.",
          }
        : null,
      selection: r.ok
        ? {
            variant: r.snapshot.variant,
            quantity: r.snapshot.quantity,
            unitLabel: r.snapshot.unitLabel,
            unitPrice: r.snapshot.unitPrice,
            audience: r.snapshot.audience,
          }
        : null,
      duration: r.ok ? r.duration : null,
    };
  }

  async featured() {
    return this.featuredCached();
  }

  private async featuredCached() {
    return cacheService.getOrFetch(
      "catalog:featured",
      FEATURED_TTL,
      async () => {
        const rows = await prisma.service.findMany({
          where: { ...CUSTOMER_VISIBLE, isFeatured: true },
          take: 20,
          orderBy: { popularity: "desc" },
        });
        const ratings = await ratingsForServices(rows.map((s) => s.id));
        return {
          services: rows.map((s) => ({
            id: s.id,
            name: s.name,
            basePrice: s.basePrice,
            rating: ratings.get(s.id)?.rating ?? null,
            reviewCount: ratings.get(s.id)?.reviewCount ?? 0,
            isFeatured: s.isFeatured,
            isPromoted: s.isPromoted,
          })),
          total: rows.length,
        };
      },
      L1_TTL,
    );
  }

  // ------------------------------------------------------------------ admin --
  // Admin service management. Every write is one transaction: the service row, its option rows and
  // its published version commit together or not at all. Versions increment atomically and the
  // acting admin is recorded on the row, on the version and in the audit trail.

  private async invalidateCatalogCache(): Promise<void> {
    await cacheService.invalidate("catalog:featured");
    await cacheService.invalidate("catalog:categories");
    // The customer catalogue reads ?limit=100 page 1; other list keys expire within LIST_TTL.
    await cacheService.invalidate("catalog:list:1:100:::::::");
    await cacheService.invalidate("catalog:list:1:20:::::::");
  }

  /**
   * cfgIn: the config with requirement catalogue facts attached. A bare parse has no requirementItems,
   * so the activation gate would report REQUIREMENT_ITEMS_UNRESOLVED for every service with
   * requirements (and the admin editor would disable Save) — use hydratedAdminRow / the list batch.
   */
  private adminRow(s: AdminServiceRecord, cfgIn?: ServiceCatalogConfig | null, unavailableTrainingModules: string[] = []) {
    const cfg = cfgIn !== undefined ? cfgIn : parseCatalogConfig(s.catalogConfig);
    const lifecycle = parseLifecycle(s.lifecycleStatus);
    const activation = validateForActivation(s, cfg, { grandfathered: s.isActive, unavailableTrainingModules });
    const approvalState: "NONE" | "VALID" | "STALE" = !cfg?.publishApproval
      ? "NONE"
      : evaluatePublishApproval({
            approverId: cfg.publishApproval.actorId,
            editorId: s.updatedBy ?? s.createdBy ?? null,
            approvedEditorId: cfg.publishApproval.editorId,
            approverHasApprove: true,
            approvedContentHash: cfg.publishApproval.contentHash ?? null,
            currentContentHash: approvalContentHash(s, cfg),
          }).ok
        ? "VALID"
        : "STALE";
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      serviceCode: s.serviceCode,
      internalServiceCode: s.internalServiceCode,
      displayName: s.displayName ?? s.name,
      shortName: s.shortName,
      description: s.description,
      detailedDescription: s.detailedDescription,
      category: s.category,
      subcategory: s.subcategory,
      categoryId: s.categoryId,
      subcategoryId: s.subcategoryId,
      taxonomy: taxonomyView(s),
      parentServiceId: s.parentServiceId,
      basePrice: s.basePrice,
      minPrice: s.minPrice,
      maxPrice: s.maxPrice,
      estimatedDuration: s.estimatedDuration,
      icon: s.icon,
      isActive: s.isActive,
      isFeatured: s.isFeatured,
      isPopular: s.isPopular,
      premiumOnly: s.premiumOnly,
      bookingCount: s.bookingCount,
      availableCities: s.availableCities,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      pricingModel: s.pricingModel,
      thumbnail: s.thumbnail,
      images: s.images,
      includedServices: s.includedServices,
      excludedServices: s.excludedServices,
      requirements: s.requirements,
      seoTitle: s.seoTitle,
      seoDescription: s.seoDescription,
      seoKeywords: s.seoKeywords,
      capabilityProfile: s.capabilityProfile,
      lifecycleStatus: s.lifecycleStatus,
      allowedTransitions: LIFECYCLE_TRANSITIONS[lifecycle].filter((t) => (REQUESTABLE_LIFECYCLES as readonly string[]).includes(t)),
      configStatus: s.configStatus,
      isCustomerVisible: s.isCustomerVisible,
      isBookable: s.isBookable,
      version: s.version,
      ownerTeam: s.ownerTeam,
      operationsNotes: s.operationsNotes,
      lastReviewedAt: s.lastReviewedAt,
      publishedAt: s.publishedAt,
      publishedBy: s.publishedBy,
      createdBy: s.createdBy,
      updatedBy: s.updatedBy,
      catalogConfig: cfg,
      catalogConfigInvalid: s.catalogConfig != null && cfg == null,
      configGaps: catalogConfigGaps(s, cfg),
      configSections: configSections(s, cfg),
      publishGates: publishGateResults(s, cfg, { grandfathered: s.isActive, unavailableTrainingModules }),
      publishApproval: cfg?.publishApproval ?? null,
      /** What an approver sends back as `expectedContentHash`, so they approve what they reviewed. */
      contentHash: approvalContentHash(s, cfg),
      /** NONE, VALID, or STALE (the content or the editor changed after the approval). */
      approvalState,
      /** One of the nine control-plane states (APPROVED and SCHEDULED are derived from the approval). */
      controlState: controlPlaneState({ lifecycleStatus: s.lifecycleStatus, approvalState, scheduledLiveAt: cfg?.scheduledLiveAt, now: new Date() }),
      scheduledLiveAt: cfg?.scheduledLiveAt ?? null,
      publishBlocked: activation.ok ? [] : activation.issues,
      bookable: assertBookable(s, cfg).ok,
      /** Base selection (default quantity, no add-ons), from the one duration calculator. */
      duration: resolveServiceDuration(s, cfg),
      /** Partner-calendar policy (owner decision D1) and what a default booking reserves under it. */
      partnerSlotPolicy: s.partnerSlotPolicy,
      reservedSlotMinutes:
        slotDurationFor(s.partnerSlotPolicy, resolveServiceDuration(s, cfg).totalMinutes) + BOOKING_BUFFER_MINUTES * 2,
    };
  }

  /** Immutable snapshot of what a published version sells. Real identity and price, never blanks. */
  private versionSnapshot(s: AdminServiceRecord, cfg: ServiceCatalogConfig | null) {
    return {
      ...bookingConfigSnapshot(s, cfg, { durationMinutes: resolveServiceDuration(s, cfg).totalMinutes, variant: null, quantity: 1 }),
      serviceCode: s.serviceCode,
      categoryId: s.categoryId,
      subcategoryId: s.subcategoryId,
      basePrice: s.basePrice,
      minPrice: s.minPrice,
      maxPrice: s.maxPrice,
      estimatedDuration: s.estimatedDuration,
      lifecycleStatus: s.lifecycleStatus,
    };
  }

  /** adminRow with requirement catalogue facts loaded (one query, only when the service has requirements). */
  private async hydratedAdminRow(s: AdminServiceRecord) {
    const cfg = await withRequirementItems(parseCatalogConfig(s.catalogConfig));
    return this.adminRow(s, cfg, (await trainingModuleGaps([cfg]))[0]);
  }

  private async writeVersion(
    tx: Prisma.TransactionClient,
    s: AdminServiceRecord,
    actorId: string | undefined,
    approvedRevision?: { rowId: string; approvedBy: string },
  ) {
    const cfg = parseCatalogConfig(s.catalogConfig);
    if (approvedRevision) {
      // The pending row already holds this version number: it becomes the published snapshot.
      const res = await tx.serviceConfigVersion.updateMany({
        where: { id: approvedRevision.rowId, serviceId: s.id, version: s.version, status: "DRAFT" },
        data: {
          status: "PUBLISHED",
          catalogConfig: (s.catalogConfig ?? {}) as Prisma.InputJsonValue,
          snapshot: { ...this.versionSnapshot(s, cfg), approvedBy: approvedRevision.approvedBy } as Prisma.InputJsonValue,
          createdBy: actorId,
          publishedAt: new Date(),
        },
      });
      if (res.count === 0) throw new VersionConflict();
      return;
    }
    // create, not upsert: (service_id, version) is unique, so a second writer of the same version
    // fails loudly (P2002 → VERSION_CONFLICT) instead of silently keeping the first writer's row.
    await tx.serviceConfigVersion.create({
      data: {
        serviceId: s.id,
        version: s.version,
        status: "PUBLISHED",
        catalogConfig: (s.catalogConfig ?? {}) as Prisma.InputJsonValue,
        snapshot: this.versionSnapshot(s, cfg) as Prisma.InputJsonValue,
        createdBy: actorId,
        publishedAt: new Date(),
      },
    });
  }

  /** Validate admin-supplied config. Returns the parsed config or a readable error. */
  private validateConfig(raw: unknown):
    | { ok: true; value: Prisma.InputJsonValue | typeof Prisma.DbNull }
    | { ok: false; error: string } {
    if (raw === null) return { ok: true, value: Prisma.DbNull };
    // requirementItems is attached by the server on hydrate; a client cannot assert catalogue facts.
    const { requirementItems: _clientItems, publishApproval: _forgedApproval, ...clientRaw } = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
    const r = serviceCatalogConfigSchema.safeParse(raw && typeof raw === "object" && !Array.isArray(raw) ? clientRaw : raw);
    if (!r.success) {
      const i = r.error.issues[0];
      return { ok: false, error: `${i?.path.join(".") || "config"}: ${i?.message ?? "invalid"}` };
    }
    return { ok: true, value: r.data as Prisma.InputJsonValue };
  }

  /** Identity, media and taxonomy checks that need no database write. */
  private async validateIdentityAndMedia(input: AdminServiceInput & { basePrice?: number }): Promise<
    | { ok: true; taxonomy: { categoryId?: string | null; subcategoryId?: string | null } }
    | { ok: false; error: AdminWriteError; message: string }
  > {
    for (const [field, value] of [
      ["serviceCode", input.serviceCode],
      ["slug", input.slug],
    ] as const) {
      if (value != null && value.trim() && !IDENTITY_CODE_RE.test(value.trim())) {
        return { ok: false, error: "INVALID_IDENTITY", message: `${field}: use lowercase letters, digits and hyphens` };
      }
    }
    if (input.internalServiceCode != null && input.internalServiceCode.trim() && !INTERNAL_CODE_RE.test(input.internalServiceCode.trim())) {
      return { ok: false, error: "INVALID_IDENTITY", message: "internalServiceCode: letters, digits, dot, underscore and hyphen only" };
    }
    for (const [field, value] of [
      ["basePrice", input.basePrice],
      ["minPrice", input.minPrice],
      ["maxPrice", input.maxPrice],
    ] as const) {
      if (value != null && !isValidRupeeAmount(value)) {
        return { ok: false, error: "INVALID_CONFIG", message: `${field}: must be a non-negative amount in whole paise (max 2 decimals)` };
      }
    }
    const media: Array<[string, string | undefined]> = [
      ["thumbnail", input.thumbnail],
      ...(input.images ?? []).map((u, i): [string, string] => [`images.${i}`, u]),
    ];
    for (const [field, url] of media) {
      if (url != null && url.trim() && !isSafeMediaUrl(url)) {
        return { ok: false, error: "INVALID_MEDIA", message: `${field}: media must be an https:// URL or a site-relative /path` };
      }
    }
    if (input.icon != null && input.icon.trim() && !isSafeMediaUrl(input.icon) && !ICON_TOKEN_RE.test(input.icon.trim())) {
      return { ok: false, error: "INVALID_MEDIA", message: "icon: an https:// URL, a /path, or an icon name" };
    }

    const taxonomy: { categoryId?: string | null; subcategoryId?: string | null } = {};
    if (input.categorySlug !== undefined || input.subcategorySlug !== undefined) {
      const cat = input.categorySlug
        ? await prisma.serviceCategory.findFirst({ where: { slug: input.categorySlug, parentId: null, isActive: true } })
        : null;
      if (input.categorySlug && !cat) return { ok: false, error: "INVALID_TAXONOMY", message: `Unknown category "${input.categorySlug}"` };
      if (input.categorySlug !== undefined) taxonomy.categoryId = cat?.id ?? null;
      if (input.subcategorySlug) {
        if (!cat) return { ok: false, error: "INVALID_TAXONOMY", message: "A subcategory needs its category" };
        const sub = await prisma.serviceCategory.findFirst({ where: { slug: input.subcategorySlug, parentId: cat.id, isActive: true } });
        if (!sub) {
          return { ok: false, error: "INVALID_TAXONOMY", message: `"${input.subcategorySlug}" is not a subcategory of "${input.categorySlug}"` };
        }
        taxonomy.subcategoryId = sub.id;
      } else if (input.subcategorySlug !== undefined || input.categorySlug !== undefined) {
        taxonomy.subcategoryId = null;
      }
    }
    return { ok: true, taxonomy };
  }

  /** List ALL services (active + inactive) for the admin panel. */
  async adminList(query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const where: Prisma.ServiceWhereInput = {};
    if (query.search) {
      const term = query.search;
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { slug: { contains: term, mode: "insensitive" } },
        { serviceCode: { contains: term, mode: "insensitive" } },
        { category: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
      ];
    }
    if (query.category && query.category !== "all") where.category = query.category;
    if (query.categorySlug) where.taxonomyCategory = { slug: query.categorySlug };
    if (query.lifecycle && (SERVICE_LIFECYCLE as readonly string[]).includes(query.lifecycle)) {
      where.lifecycleStatus = query.lifecycle as ServiceLifecycleStatus;
    }

    const lane = (query.status ?? "all").toLowerCase();
    if (lane === "active") where.isActive = true;
    else if (lane === "inactive") where.isActive = false;
    else if (lane === "featured") where.isFeatured = true;
    else if (lane === "premium") where.premiumOnly = true;
    else if (lane === "popular") where.isPopular = true;

    const sort = (query.sort ?? "recent").toLowerCase();
    const orderBy: Prisma.ServiceOrderByWithRelationInput =
      sort === "bookings"
        ? { bookingCount: "desc" }
        : sort === "price"
          ? { basePrice: "desc" }
          : sort === "name"
            ? { name: "asc" }
            : { createdAt: "desc" };

    const [rows, total, catalogTotal, active, featured, premium, popular, categoryRows] = await Promise.all([
      prisma.service.findMany({ where, skip, take: limit, orderBy, include: TAXONOMY_INCLUDE }),
      prisma.service.count({ where }),
      prisma.service.count(),
      prisma.service.count({ where: { isActive: true } }),
      prisma.service.count({ where: { isFeatured: true } }),
      prisma.service.count({ where: { premiumOnly: true } }),
      prisma.service.count({ where: { isPopular: true } }),
      prisma.service.groupBy({
        by: ["category"],
        _count: { _all: true },
        orderBy: { _count: { category: "desc" } },
      }),
    ]);

    const ratings = await ratingsForServices(rows.map((r) => r.id));
    // One catalogue query for the page, so publishBlocked sees the same facts the gate does.
    const cfgs = await withRequirementItemsMany(rows.map((r) => parseCatalogConfig(r.catalogConfig)));
    const trainingGaps = await trainingModuleGaps(cfgs);

    return {
      services: rows.map((s, i) => {
        const agg = ratings.get(s.id);
        return {
          ...this.adminRow(s, cfgs[i], trainingGaps[i]),
          createdAt: s.createdAt.toISOString(),
          rating: agg?.rating ?? null,
          reviewCount: agg?.reviewCount ?? 0,
        };
      }),
      total,
      page,
      limit,
      summary: {
        total: catalogTotal,
        active,
        inactive: Math.max(0, catalogTotal - active),
        featured,
        premium,
        popular,
        categories: categoryRows.map((c) => ({ category: c.category, count: c._count._all })),
      },
    };
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /** Map a failed write to a stable error. Never lets a raw database message reach the client. */
  private writeError(e: unknown): { error: AdminWriteError; message: string; field?: string } | null {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta?.target as string[] | string | undefined) ?? [];
      const field = (Array.isArray(target) ? target.join(",") : String(target)).replace(/^services_|_key$/g, "");
      if (/service_config_versions|version/.test(field)) return { error: "VERSION_CONFLICT", message: "Another change was saved first — reload and try again" };
      return { error: "DUPLICATE", message: `A service with this ${field || "identity"} already exists`, field };
    }
    const text = e instanceof Error ? e.message : String(e);
    if (/SERVICE_SUBCATEGORY_MISMATCH|SERVICE_CATEGORY_NOT_TOP_LEVEL|services_(sub)?category_id_fkey/.test(text)) {
      return { error: "INVALID_TAXONOMY", message: "Subcategory does not belong to the selected category" };
    }
    if (/services_(slug|service_code|internal_service_code)_format/.test(text)) {
      return { error: "INVALID_IDENTITY", message: "Identifier format is invalid" };
    }
    if (/services_(price_range|base_price_nonneg|estimated_duration_positive|price_paise_precision|currency_format)/.test(text)) {
      return { error: "INVALID_CONFIG", message: "Price range or duration is invalid (min ≤ base ≤ max, duration > 0)" };
    }
    // Phase 06: an assignment names an item the catalogue does not have, or the rows violate a CHECK.
    const unknownItem = text.match(/REQUIREMENT_ITEM_UNKNOWN:([a-z0-9-]+)/);
    if (unknownItem) return { error: "INVALID_CONFIG", message: `requirements: item "${unknownItem[1]}" does not exist in the requirement catalogue`, field: "requirements" };
    if (/service_requirements_[a-z_]+_check/.test(text)) {
      return { error: "INVALID_CONFIG", message: "requirements: an assignment violates the requirement rules", field: "requirements" };
    }
    return null;
  }

  /** Create a service. Returns an error code on a validation or unique-constraint failure. */
  async create(input: AdminServiceInput & AdminCreateRequired, actorId?: string) {
    const slug = this.slugify(input.slug?.trim() || input.name);
    const cfg = input.catalogConfig === undefined ? null : this.validateConfig(input.catalogConfig);
    if (cfg && !cfg.ok) return { error: "INVALID_CONFIG" as const, message: cfg.error };
    const checked = await this.validateIdentityAndMedia({ ...input, slug });
    if (!checked.ok) return { error: checked.error, message: checked.message };
    const wantActive = input.isActive !== false;
    const parsed = await withRequirementItems(cfg?.ok && cfg.value !== Prisma.DbNull ? parseCatalogConfig(cfg.value) : null);
    const target: ServiceLifecycleStatus = wantActive ? effectiveLifecycleTarget("ACTIVE", parsed) : "DRAFT";
    if (wantActive) {
      const gate = validateForActivation(
        {
          name: input.name,
          slug,
          description: input.description,
          category: input.category,
          basePrice: input.basePrice,
          minPrice: input.minPrice ?? null,
          maxPrice: input.maxPrice ?? null,
          estimatedDuration: input.estimatedDuration,
          pricingModel: input.pricingModel ?? "fixed",
          isActive: true,
          id: "",
          capabilityProfile: input.capabilityProfile ?? inferCapabilityProfile(input.category),
          categoryId: checked.taxonomy.categoryId,
        },
        parsed,
        { grandfathered: false },
      );
      if (!gate.ok) return this.gateFailure(gate.issues);
      return {
        error: "APPROVAL_REQUIRED" as const,
        message: "A new service is saved as a draft. Move it through review, then have a second admin approve it before it goes live.",
      };
    }
    const flags = lifecycleFlags(target);
    try {
      const s = await prisma.$transaction(async (tx) => {
        const created = await tx.service.create({
          data: {
            name: input.name,
            slug,
            serviceCode: input.serviceCode?.trim() || slug,
            internalServiceCode: input.internalServiceCode?.trim() || null,
            displayName: input.displayName?.trim() || input.name,
            shortName: input.shortName?.trim() || null,
            description: input.description,
            detailedDescription: input.detailedDescription,
            category: input.category,
            subcategory: input.subcategory,
            ...checked.taxonomy,
            basePrice: input.basePrice,
            minPrice: input.minPrice,
            maxPrice: input.maxPrice,
            estimatedDuration: input.estimatedDuration,
            icon: input.icon,
            isFeatured: input.isFeatured ?? false,
            premiumOnly: input.premiumOnly ?? false,
            availableCities: input.availableCities ?? [],
            pricingModel: input.pricingModel ?? "fixed",
            thumbnail: input.thumbnail,
            images: input.images ?? [],
            includedServices: input.includedServices ?? [],
            excludedServices: input.excludedServices ?? [],
            requirements: input.requirements ?? [],
            seoTitle: input.seoTitle,
            seoDescription: input.seoDescription,
            seoKeywords: input.seoKeywords,
            ownerTeam: input.ownerTeam,
            operationsNotes: input.operationsNotes,
            ...(input.partnerSlotPolicy ? { partnerSlotPolicy: input.partnerSlotPolicy } : {}),
            capabilityProfile: parseProfile(input.capabilityProfile ?? null, input.category),
            ...(cfg?.ok ? { catalogConfig: cfg.value } : {}),
            ...flags,
            lifecycleStatus: target,
            configStatus: deriveConfigStatus(
              { ...input, id: "", slug, minPrice: input.minPrice ?? null, maxPrice: input.maxPrice ?? null, pricingModel: input.pricingModel ?? "fixed", isActive: flags.isActive, lifecycleStatus: target },
              parsed,
            ),
            createdBy: actorId,
            updatedBy: actorId,
            ...(wantActive ? { publishedAt: new Date(), publishedBy: actorId } : {}),
          },
          include: TAXONOMY_INCLUDE,
        });
        await syncRelationalCatalog(tx, created.id, parseCatalogConfig(created.catalogConfig));
        await syncServiceRequirements(tx, created.id, parsed);
        await syncServiceExecution(tx, created.id, parsed);
        await this.writeVersion(tx, created, actorId);
        return created;
      });
      if (wantActive) {
        incCounter("service_publish_total");
        void AuditLogService.record("ADMIN_ACTION", "success", {
          userId: actorId,
          details: { action: "SERVICE_PUBLISHED", serviceId: s.id, slug: s.slug, version: s.version },
        });
      }
      await this.invalidateCatalogCache();
      return { service: await this.hydratedAdminRow(s) };
    } catch (e) {
      const mapped = this.writeError(e);
      if (mapped) return mapped;
      throw e;
    }
  }

  /**
   * Customer-visible services with no published version row: they were written straight into the
   * database (a seed script, a manual insert) and passed no gate, approval or audit. Reported, not
   * unpublished — an operator decides what each one is.
   */
  async ungovernedLiveServices(): Promise<{ id: string; name: string; slug: string | null; lifecycleStatus: string; reason: "NO_PUBLISHED_VERSION" }[]> {
    const live = await prisma.service.findMany({ where: CUSTOMER_CATALOG_WHERE, select: { id: true, name: true, slug: true, lifecycleStatus: true }, orderBy: { name: "asc" } });
    if (live.length === 0) return [];
    const versioned = await prisma.serviceConfigVersion.findMany({ where: { serviceId: { in: live.map((s) => s.id) }, status: "PUBLISHED" }, select: { serviceId: true }, distinct: ["serviceId"] });
    const governed = new Set(versioned.map((v) => v.serviceId));
    return live.filter((s) => !governed.has(s.id)).map((s) => ({ id: s.id, name: s.name, slug: s.slug, lifecycleStatus: String(s.lifecycleStatus), reason: "NO_PUBLISHED_VERSION" as const }));
  }

  private gateFailure(issues: PublishIssue[]) {
    incCounter("service_configuration_validation_failures_total");
    // Phase 06: which requirement rule refused the publish (code only — no names, notes or ids).
    for (const code of new Set(issues.filter((i) => i.code.startsWith("REQUIREMENT")).map((i) => i.code))) incCounter("configuration_validation_failure_total", { code });
    return {
      error: "SERVICE_NOT_BOOKABLE" as const,
      issues,
      message: issues.map((i) => i.message).join("; "),
    };
  }

  /**
   * Update a service. `expectedVersion`, when sent, must match the stored version (optimistic
   * concurrency for the editor). Anything that changes what a booking would buy — price, duration,
   * pricing model or catalogue configuration — bumps the version of a live service, and that
   * version is written in the same transaction.
   */
  async update(
    id: string,
    input: Partial<AdminServiceInput & AdminCreateRequired> & { expectedVersion?: number; changeReason?: string },
    actorId?: string,
    opts: { approvedRevision?: { rowId: string; approvedBy: string } } = {},
  ) {
    const exists = await prisma.service.findUnique({ where: { id }, include: TAXONOMY_INCLUDE });
    if (!exists) return { error: "NOT_FOUND" as const };
    if (input.expectedVersion != null && input.expectedVersion !== exists.version) {
      return { error: "VERSION_CONFLICT" as const, message: `Service is at version ${exists.version}, not ${input.expectedVersion} — reload and try again` };
    }
    if (input.serviceCode != null && input.serviceCode.trim() && input.serviceCode.trim() !== exists.serviceCode) {
      return {
        error: "SERVICE_CODE_IMMUTABLE" as const,
        message: "The service code is a stable business identifier and cannot be changed. Use internalServiceCode or the slug.",
      };
    }
    const {
      catalogConfig,
      slug,
      expectedVersion: _v,
      categorySlug: _c,
      subcategorySlug: _sc,
      serviceCode: _code,
      capabilityProfile: _p,
      internalServiceCode: _ic,
      changeReason,
      ...rest
    } = input;
    const cfg = catalogConfig === undefined ? null : this.validateConfig(catalogConfig);
    if (cfg && !cfg.ok) return { error: "INVALID_CONFIG" as const, message: cfg.error };
    const nextSlug = slug?.trim() ? this.slugify(slug) : exists.slug;
    const checked = await this.validateIdentityAndMedia({ ...input, slug: nextSlug });
    if (!checked.ok) return { error: checked.error, message: checked.message };

    const prevLifecycle = parseLifecycle(exists.lifecycleStatus);
    const nextConfigRaw = cfg?.ok ? (cfg.value === Prisma.DbNull ? null : cfg.value) : exists.catalogConfig;
    // Catalogue facts (kind / active) for the assigned items are attached from the database, never from the client.
    let nextCfg = await withRequirementItems(parseCatalogConfig(nextConfigRaw));
    const prevCfg = await withRequirementItems(parseCatalogConfig(exists.catalogConfig));
    const sent = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
    const nextCore = {
      ...exists,
      ...sent,
      slug: nextSlug,
      ...checked.taxonomy,
      minPrice: input.minPrice !== undefined ? input.minPrice : exists.minPrice,
      maxPrice: input.maxPrice !== undefined ? input.maxPrice : exists.maxPrice,
      capabilityProfile:
        input.capabilityProfile !== undefined
          ? parseProfile(input.capabilityProfile, (sent.category as string | undefined) ?? exists.category)
          : exists.capabilityProfile,
    };
    // Price, duration and content live outside catalog_config, so "unchanged" is the whole approved content.
    const contentUnchanged = approvalContentHash(nextCore, nextCfg) === approvalContentHash(exists, prevCfg);
    if (nextCfg && contentUnchanged && prevCfg?.scheduledLiveAt && !nextCfg.scheduledLiveAt) {
      nextCfg = { ...nextCfg, scheduledLiveAt: prevCfg.scheduledLiveAt };
    }
    if (nextCfg && contentUnchanged && prevCfg?.publishApproval) {
      nextCfg = { ...nextCfg, publishApproval: prevCfg.publishApproval };
    } else if (nextCfg?.publishApproval) {
      const { publishApproval: _dropped, ...rest } = nextCfg;
      nextCfg = rest;
    }
    if (nextCfg?.scheduledLiveAt && nextCfg.scheduledLiveAt !== prevCfg?.scheduledLiveAt) {
      if (!contentUnchanged) {
        return { error: "APPROVAL_REQUIRED" as const, message: "Approve the current configuration before scheduling it to go live." };
      }
      const scheduled = evaluatePublishApproval({
        approverId: prevCfg?.publishApproval?.actorId ?? null,
        editorId: exists.updatedBy ?? exists.createdBy ?? null,
        approvedEditorId: prevCfg?.publishApproval?.editorId ?? null,
        approverHasApprove: Boolean(prevCfg?.publishApproval?.actorId),
        approvedContentHash: prevCfg?.publishApproval?.contentHash ?? null,
        currentContentHash: approvalContentHash(exists, prevCfg),
      });
      if (!scheduled.ok) {
        return { error: "APPROVAL_REQUIRED" as const, message: "A second admin must approve this version before it can be scheduled." };
      }
    }
    const wantActive = input.isActive ?? exists.isActive;
    let target: ServiceLifecycleStatus;
    if (wantActive) target = effectiveLifecycleTarget("ACTIVE", nextCfg);
    else if (exists.isActive) target = "PAUSED";
    else target = prevLifecycle; // an inactive DRAFT / REVIEW / ARCHIVED row keeps its stage
    if (!canTransition(prevLifecycle, target)) {
      return this.transitionFailure(prevLifecycle, target);
    }

    const next = {
      ...nextCore,
      catalogConfig: nextCfg,
      isActive: wantActive,
      lifecycleStatus: target,
    };
    // Visible-but-not-bookable (coming soon) to bookable is a publish, not an edit.
    const becomingBookable = prevLifecycle === "PUBLISHED" && target === "ACTIVE";
    if (wantActive) {
      const unavailableTrainingModules = (await trainingModuleGaps([nextCfg]))[0];
      if (exists.isActive && !becomingBookable) {
        // An edit to a live service keeps the gaps it already had, and may not add one.
        const regressions = liveEditRegressions({ before: { service: exists, cfg: prevCfg }, after: { service: next, cfg: nextCfg }, unavailableTrainingModules });
        if (regressions.length) return this.gateFailure(regressions);
      } else {
        const gate = validateForActivation(next, nextCfg, { grandfathered: false, unavailableTrainingModules });
        if (!gate.ok) return this.gateFailure(gate.issues);
      }
    }
    // PUT is one more way into LIVE: it answers to the same approval and schedule as the lifecycle route.
    if (wantActive && (!exists.isActive || becomingBookable)) {
      const refused = this.publishAuthorization(exists.updatedBy ?? exists.createdBy ?? null, nextCfg, approvalContentHash(nextCore, nextCfg));
      if (refused) return refused;
    }
    // Four-eyes policy: approved content of a live service changes only through an approved revision.
    const editPolicy = exists.isActive ? await liveEditPolicy() : null;
    if (exists.isActive && wantActive && !contentUnchanged && !opts.approvedRevision && editPolicy === "four-eyes") {
      return this.proposeRevision(exists, prevCfg, nextCore, nextCfg, input, actorId);
    }
    const sellingChanged =
      (cfg?.ok && JSON.stringify(nextConfigRaw ?? null) !== JSON.stringify(exists.catalogConfig ?? null)) ||
      (input.basePrice !== undefined && input.basePrice !== exists.basePrice) ||
      (input.minPrice !== undefined && input.minPrice !== exists.minPrice) ||
      (input.maxPrice !== undefined && input.maxPrice !== exists.maxPrice) ||
      (input.estimatedDuration !== undefined && input.estimatedDuration !== exists.estimatedDuration) ||
      (input.pricingModel !== undefined && input.pricingModel !== exists.pricingModel);
    const becameLive = wantActive && !exists.isActive;
    // An approved revision is always the next version, whatever it changed.
    const bumpVersion = wantActive && (becameLive || sellingChanged || Boolean(opts.approvedRevision));
    const flags = lifecycleFlags(target);

    try {
      const s = await prisma.$transaction(async (tx) => {
        // Compare-and-set on the version: a concurrent admin save between our read and this write
        // matches zero rows instead of overwriting.
        const res = await tx.service.updateMany({
          where: { id, version: exists.version },
          data: {
            ...rest,
            ...(slug?.trim() ? { slug: nextSlug } : {}),
            ...checked.taxonomy,
            ...(input.internalServiceCode !== undefined ? { internalServiceCode: input.internalServiceCode?.trim() || null } : {}),
            ...(input.capabilityProfile !== undefined ? { capabilityProfile: parseProfile(input.capabilityProfile, next.category) } : {}),
            ...(cfg?.ok ? { catalogConfig: (withoutServerFacts(nextCfg) ?? Prisma.DbNull) as Prisma.InputJsonValue } : {}),
            ...flags,
            lifecycleStatus: target,
            configStatus: deriveConfigStatus(next, nextCfg),
            updatedBy: actorId,
            ...(bumpVersion ? { version: { increment: 1 } } : {}),
            ...(becameLive ? { publishedAt: new Date(), publishedBy: actorId } : {}),
          },
        });
        if (res.count === 0) throw new VersionConflict();
        const row = await tx.service.findUniqueOrThrow({ where: { id }, include: TAXONOMY_INCLUDE });
        if (cfg?.ok) {
          await syncRelationalCatalog(tx, id, nextCfg);
          await syncServiceRequirements(tx, id, nextCfg);
          await syncServiceExecution(tx, id, nextCfg);
        }
        if (bumpVersion) await this.writeVersion(tx, row, actorId, opts.approvedRevision);
        return row;
      });
      if (bumpVersion) {
        incCounter("service_publish_total");
        // Pricing audit: who, what changed (before → after), why, and the version pair.
        const pick = (r: { basePrice: number; minPrice: number | null; maxPrice: number | null; estimatedDuration: number; pricingModel: string; currency: string }) => ({
          basePrice: r.basePrice,
          minPrice: r.minPrice,
          maxPrice: r.maxPrice,
          estimatedDuration: r.estimatedDuration,
          pricingModel: r.pricingModel,
          currency: r.currency,
        });
        void AuditLogService.record("ADMIN_ACTION", "success", {
          userId: actorId,
          details: {
            action: "SERVICE_CONFIG_VERSIONED",
            serviceId: s.id,
            previousVersion: exists.version,
            version: s.version,
            before: pick(exists),
            after: pick(s),
            configChanged: Boolean(cfg?.ok),
            changes: contentDiff(exists, prevCfg, s, parseCatalogConfig(s.catalogConfig)).map((c) => c.field),
            approvedBy: opts.approvedRevision?.approvedBy ?? null,
            liveEditPolicy: editPolicy,
            reason: changeReason?.trim() || null,
          },
        });
      }
      await this.invalidateCatalogCache();
      return { service: await this.hydratedAdminRow(s) };
    } catch (e) {
      if (e instanceof VersionConflict) return { error: "VERSION_CONFLICT" as const, message: "Another change was saved first — reload and try again" };
      const mapped = this.writeError(e);
      if (mapped) return mapped;
      throw e;
    }
  }

  /** The pending revision of a service, or null. */
  async pendingRevision(serviceId: string) {
    const row = await prisma.serviceConfigVersion.findFirst({
      where: { serviceId, status: "DRAFT" },
      orderBy: { version: "desc" },
      select: { id: true, version: true, snapshot: true },
    });
    const view = row ? pendingRevisionView(row) : null;
    return row && view ? { rowId: row.id, snapshot: row.snapshot as PendingRevisionSnapshot, view } : null;
  }

  /** Hold a change to a live service's approved content as the pending revision (one per service). */
  private async proposeRevision(
    exists: AdminServiceRecord,
    prevCfg: ServiceCatalogConfig | null,
    nextCore: object,
    nextCfg: ServiceCatalogConfig | null,
    input: Record<string, unknown>,
    actorId: string | undefined,
  ) {
    const { expectedVersion: _v, ...patch } = input;
    const snapshot: PendingRevisionSnapshot = {
      kind: "PENDING_REVISION",
      patch,
      baseVersion: exists.version,
      baseContentHash: approvalContentHash(exists, prevCfg),
      contentHash: approvalContentHash(nextCore, nextCfg),
      proposedBy: actorId ?? null,
      proposedAt: new Date().toISOString(),
      changeReason: typeof input.changeReason === "string" && input.changeReason.trim() ? input.changeReason.trim() : null,
      changes: contentDiff(exists, prevCfg, nextCore, nextCfg),
    };
    const version = exists.version + 1;
    const data = {
      catalogConfig: (withoutServerFacts(nextCfg) ?? {}) as Prisma.InputJsonValue,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      createdBy: actorId,
    };
    try {
      // Replace this service's own pending row; never a published row that took the number first.
      const replaced = await prisma.serviceConfigVersion.updateMany({ where: { serviceId: exists.id, version, status: "DRAFT" }, data });
      if (replaced.count === 0) {
        await prisma.serviceConfigVersion.create({ data: { ...data, serviceId: exists.id, version, status: "DRAFT" } });
      }
    } catch (e) {
      const mapped = this.writeError(e);
      if (mapped) return mapped;
      throw e;
    }
    incCounter("service_revision_proposed_total");
    await AuditLogService.record("ADMIN_ACTION", "success", {
      userId: actorId,
      details: {
        action: "SERVICE_REVISION_PROPOSED",
        serviceId: exists.id,
        baseVersion: exists.version,
        contentHash: snapshot.contentHash,
        changes: snapshot.changes.map((c) => c.field),
        reason: snapshot.changeReason,
      },
    });
    const view = pendingRevisionView({ version, snapshot });
    return { service: { ...(await this.hydratedAdminRow(exists)), pendingRevision: view }, pendingRevision: view };
  }

  /** A different admin approves the pending revision; it is applied as the next published version. */
  async approveRevision(id: string, actorId: string | undefined, expected: { contentHash?: string; scheduledLiveAt?: string | null } = {}) {
    if (!actorId) return { error: "APPROVAL_REQUIRED" as const, message: "An approver is required." };
    const exists = await prisma.service.findUnique({ where: { id }, include: TAXONOMY_INCLUDE });
    if (!exists) return { error: "NOT_FOUND" as const };
    const pending = await this.pendingRevision(id);
    if (!pending) return { error: "NO_PENDING_REVISION" as const, message: "This service has no pending revision." };
    const snap = pending.snapshot;
    if (expected.contentHash != null && expected.contentHash !== snap.contentHash) {
      return { error: "VERSION_CONFLICT" as const, message: "The revision changed since you opened it. Reload and review it again." };
    }
    if (!snap.proposedBy || snap.proposedBy === actorId) {
      return { error: "APPROVER_IS_EDITOR" as const, message: "The admin who proposed a revision cannot approve it." };
    }
    const liveCfg = await withRequirementItems(parseCatalogConfig(exists.catalogConfig));
    if (snap.baseVersion !== exists.version || snap.baseContentHash !== approvalContentHash(exists, liveCfg)) {
      return {
        error: "REVISION_OUTDATED" as const,
        message: "The live service changed after this revision was proposed. Reject it and propose the change again.",
      };
    }
    if (expected.scheduledLiveAt) {
      const at = scheduledLiveInstant(expected.scheduledLiveAt);
      if (!at) return { error: "INVALID_CONFIG" as const, message: "scheduledLiveAt must be an ISO timestamp" };
      // A time that has already passed is not a schedule: the revision is applied now, below.
      if (at.getTime() > Date.now()) {
        const approval = { actorId, approvedAt: new Date().toISOString(), scheduledLiveAt: expected.scheduledLiveAt };
        const written = await prisma.serviceConfigVersion.updateMany({
          where: { id: pending.rowId, serviceId: id, status: "DRAFT" },
          data: { snapshot: { ...snap, approval } as unknown as Prisma.InputJsonValue },
        });
        if (written.count === 0) return { error: "VERSION_CONFLICT" as const, message: "The revision changed since you opened it. Reload and review it again." };
        incCounter("service_revision_scheduled_total");
        await AuditLogService.record("ADMIN_ACTION", "success", {
          userId: actorId,
          details: { action: "SERVICE_REVISION_SCHEDULED", serviceId: id, baseVersion: snap.baseVersion, contentHash: snap.contentHash, proposedBy: snap.proposedBy, changes: snap.changes.map((c) => c.field), reason: `goes live at ${expected.scheduledLiveAt}` },
        });
        const view = pendingRevisionView({ version: pending.view.version, snapshot: { ...snap, approval } });
        return { service: { ...(await this.hydratedAdminRow(exists)), pendingRevision: view }, pendingRevision: view };
      }
    }
    const result = await this.applyRevision(id, pending, actorId);
    if ("error" in result && result.error) return result;
    incCounter("service_revision_approved_total");
    await AuditLogService.record("ADMIN_ACTION", "success", {
      userId: actorId,
      details: {
        action: "SERVICE_REVISION_APPROVED",
        serviceId: id,
        baseVersion: snap.baseVersion,
        contentHash: snap.contentHash,
        proposedBy: snap.proposedBy,
        changes: snap.changes.map((c) => c.field),
      },
    });
    return result;
  }

  /**
   * Apply an approved revision as the next published version. Goes through `update`, the code any
   * save uses, so the gate, taxonomy and constraints are checked at the moment it goes live — which
   * for a scheduled revision is later than the moment it was approved.
   */
  private applyRevision(id: string, pending: { rowId: string; snapshot: PendingRevisionSnapshot }, approvedBy: string) {
    const snap = pending.snapshot;
    return this.update(
      id,
      { ...(snap.patch as Partial<AdminServiceInput & AdminCreateRequired>), expectedVersion: snap.baseVersion, changeReason: snap.changeReason ?? undefined },
      snap.proposedBy ?? undefined,
      { approvedRevision: { rowId: pending.rowId, approvedBy } },
    );
  }

  /** Discard the pending revision (a reviewer rejecting it, or the proposer withdrawing it). */
  async rejectRevision(id: string, actorId: string | undefined, reason?: string | null) {
    const exists = await prisma.service.findUnique({ where: { id }, include: TAXONOMY_INCLUDE });
    if (!exists) return { error: "NOT_FOUND" as const };
    const pending = await this.pendingRevision(id);
    if (!pending) return { error: "NO_PENDING_REVISION" as const, message: "This service has no pending revision." };
    // The audit row is the only record of a discarded proposal, so it is written before the delete.
    await AuditLogService.record("ADMIN_ACTION", "success", {
      userId: actorId,
      details: {
        action: "SERVICE_REVISION_REJECTED",
        serviceId: id,
        baseVersion: pending.snapshot.baseVersion,
        contentHash: pending.snapshot.contentHash,
        proposedBy: pending.snapshot.proposedBy,
        changes: pending.snapshot.changes.map((c) => c.field),
        reason: reason?.trim() || null,
      },
    });
    await prisma.serviceConfigVersion.deleteMany({ where: { id: pending.rowId, status: "DRAFT" } });
    incCounter("service_revision_rejected_total");
    return { service: { ...(await this.hydratedAdminRow(exists)), pendingRevision: null } };
  }

  /**
   * The one authorization for entering LIVE, whichever route asks: a second admin approved exactly
   * this content, and a scheduled go-live time has arrived. Null means publish may proceed.
   */
  private publishAuthorization(editorId: string | null, cfg: ServiceCatalogConfig | null, contentHash: string) {
    const approval = evaluatePublishApproval({
      approverId: cfg?.publishApproval?.actorId ?? null,
      editorId,
      approvedEditorId: cfg?.publishApproval?.editorId ?? null,
      approverHasApprove: Boolean(cfg?.publishApproval?.actorId),
      approvedContentHash: cfg?.publishApproval?.contentHash ?? null,
      currentContentHash: contentHash,
    });
    if (!approval.ok) {
      incCounter("service_publish_refused_total", { reason: approval.code });
      if (approval.code === "APPROVAL_STALE") {
        return {
          error: "APPROVAL_STALE" as const,
          message: "This service changed after it was approved. A second admin must approve the current content before it goes live.",
        };
      }
      return {
        error: "APPROVAL_REQUIRED" as const,
        message:
          approval.code === "APPROVER_IS_EDITOR"
            ? "The last editor cannot approve their own change."
            : "A second admin with approve permission must approve this version before it goes live.",
      };
    }
    const schedule = scheduledActivationDecision({ scheduledLiveAt: cfg?.scheduledLiveAt, now: new Date(), gateOk: true, approvalOk: true });
    if (schedule.action === "wait") {
      return {
        error: "SCHEDULED_NOT_DUE" as const,
        message: `This service is scheduled to go live at ${cfg?.scheduledLiveAt}. It stays in review until then.`,
      };
    }
    if (schedule.action === "fail") {
      return { error: "INVALID_CONFIG" as const, message: "scheduledLiveAt is not a valid timestamp" };
    }
    return null;
  }

  private transitionFailure(from: ServiceLifecycleStatus, to: ServiceLifecycleStatus) {
    incCounter("service_lifecycle_transition_rejected_total", { from, to });
    return {
      error: "INVALID_LIFECYCLE_TRANSITION" as const,
      message: `A ${from} service cannot move to ${to}`,
      from,
      to,
      allowed: LIFECYCLE_TRANSITIONS[from],
    };
  }

  /**
   * Explicit lifecycle move (the admin "publish / pause / deprecate / archive" actions). The legacy
   * PATCH /status toggle is this with ACTIVE / PAUSED.
   */
  async transition(id: string, requested: ServiceLifecycleStatus, actorId?: string, expectedVersion?: number, reason?: string | null) {
    const exists = await prisma.service.findUnique({ where: { id }, include: TAXONOMY_INCLUDE });
    if (!exists) return { error: "NOT_FOUND" as const };
    if (expectedVersion != null && expectedVersion !== exists.version) {
      return { error: "VERSION_CONFLICT" as const, message: `Service is at version ${exists.version}, not ${expectedVersion}` };
    }
    // Requirement catalogue facts attached, or the activation gate reports REQUIREMENT_ITEMS_UNRESOLVED.
    const cfg = await withRequirementItems(parseCatalogConfig(exists.catalogConfig));
    const from = parseLifecycle(exists.lifecycleStatus);
    const to = effectiveLifecycleTarget(requested, cfg);
    if (from === to) return { service: await this.hydratedAdminRow(exists) };
    if (!canTransition(from, to)) return this.transitionFailure(from, to);
    const flags = lifecycleFlags(to);
    const enteringLive = to === "ACTIVE" || to === "PUBLISHED";
    if (enteringLive) {
      const gate = validateForActivation({ ...exists, isActive: true, categoryId: exists.categoryId }, cfg, { grandfathered: false, unavailableTrainingModules: (await trainingModuleGaps([cfg]))[0] });
      if (!gate.ok) return this.gateFailure(gate.issues);
      const refused = this.publishAuthorization(exists.updatedBy ?? exists.createdBy ?? null, cfg, approvalContentHash(exists, cfg));
      if (refused) return refused;
    }
    // VALIDATING and REVIEW are where the configuration is checked, not labels: entering VALIDATING
    // runs the gate and answers with what it found, and a service leaves it for review only clean.
    let validation: { ok: boolean; blocking: PublishIssue[] } | undefined;
    if (to === "CONFIGURATION_REQUIRED" || to === "READY_FOR_REVIEW") {
      const gate = validateForActivation({ ...exists, isActive: true, categoryId: exists.categoryId }, cfg, { grandfathered: false, unavailableTrainingModules: (await trainingModuleGaps([cfg]))[0] });
      validation = { ok: gate.ok, blocking: gate.ok ? [] : gate.issues };
      if (to === "READY_FOR_REVIEW" && !gate.ok) return this.gateFailure(gate.issues);
    }
    const becameLive = flags.isActive && !exists.isActive;
    try {
      const s = await prisma.$transaction(async (tx) => {
        const res = await tx.service.updateMany({
          where: { id, version: exists.version, lifecycleStatus: exists.lifecycleStatus },
          data: {
            ...flags,
            lifecycleStatus: to,
            configStatus: deriveConfigStatus({ ...exists, ...flags, lifecycleStatus: to }, cfg),
            updatedBy: actorId,
            ...(becameLive ? { publishedAt: new Date(), publishedBy: actorId, version: { increment: 1 } } : {}),
          },
        });
        if (res.count === 0) throw new VersionConflict();
        const row = await tx.service.findUniqueOrThrow({ where: { id }, include: TAXONOMY_INCLUDE });
        if (becameLive) await this.writeVersion(tx, row, actorId);
        return row;
      });
      incCounter("service_lifecycle_transition_total", { from, to });
      if (becameLive) incCounter("service_publish_total");
      if (!flags.isActive && exists.isActive) incCounter("service_pause_total");
      void AuditLogService.record("ADMIN_ACTION", "success", {
        userId: actorId,
        details: { action: "SERVICE_LIFECYCLE_CHANGED", serviceId: s.id, from, to, version: s.version, reason: reason?.trim() || null },
      });
      await this.invalidateCatalogCache();
      // Taking a service off sale stops new bookings only. The bookings already open on it keep
      // their frozen configuration and go ahead; the count tells the admin how many those are.
      const impact = OFF_SALE_LIFECYCLES.includes(to)
        ? { openBookings: await prisma.booking.count({ where: { serviceId: id, status: { in: ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] } } }) }
        : undefined;
      return { service: await this.hydratedAdminRow(s), ...(impact ? { impact } : {}), ...(validation ? { validation } : {}) };
    } catch (e) {
      if (e instanceof VersionConflict) return { error: "VERSION_CONFLICT" as const, message: "Another change was saved first — reload and try again" };
      throw e;
    }
  }

  /**
   * Record approval by a second admin. Does not change `updatedBy`, so the editor stays the editor.
   * Optional `scheduledLiveAt` is stored only as part of this approval.
   */
  async approve(
    id: string,
    actorId: string | undefined,
    scheduledLiveAt?: string | null,
    expected: { version?: number; contentHash?: string } = {},
  ) {
    if (!actorId) return { error: "APPROVAL_REQUIRED" as const, message: "An approver is required." };
    const exists = await prisma.service.findUnique({ where: { id }, include: TAXONOMY_INCLUDE });
    if (!exists) return { error: "NOT_FOUND" as const };
    const lifecycle = parseLifecycle(exists.lifecycleStatus);
    // Approval precedes an entry into LIVE: from review, or resuming a paused service.
    if (lifecycle !== "READY_FOR_REVIEW" && lifecycle !== "PAUSED") {
      return {
        error: "NOT_AWAITING_APPROVAL" as const,
        message: `A ${lifecycle} service is not awaiting approval. Move it to review first.`,
      };
    }
    const hydrated = await withRequirementItems(parseCatalogConfig(exists.catalogConfig));
    const contentHash = approvalContentHash(exists, hydrated);
    // The approver approves what they reviewed, not whatever is stored by the time the request lands.
    if (
      (expected.version != null && expected.version !== exists.version) ||
      (expected.contentHash != null && expected.contentHash !== contentHash)
    ) {
      return { error: "VERSION_CONFLICT" as const, message: "This service changed since you opened it. Reload and review it again." };
    }
    const editorId = exists.updatedBy ?? exists.createdBy;
    if (!editorId) return { error: "APPROVAL_REQUIRED" as const, message: "This service has no editor to approve against." };
    if (actorId === editorId) {
      return { error: "APPROVER_IS_EDITOR" as const, message: "The last editor cannot approve their own change." };
    }
    // An approval of a configuration that cannot be published would be a promise the gate then breaks.
    const gate = validateForActivation({ ...exists, isActive: true, categoryId: exists.categoryId }, hydrated, { grandfathered: false, unavailableTrainingModules: (await trainingModuleGaps([hydrated]))[0] });
    if (!gate.ok) return this.gateFailure(gate.issues);
    const cfg = parseCatalogConfig(exists.catalogConfig) ?? {};
    const next = {
      ...cfg,
      publishApproval: {
        actorId,
        editorId,
        approvedAt: new Date().toISOString(),
        version: exists.version,
        contentHash,
      },
      ...(scheduledLiveAt ? { scheduledLiveAt } : {}),
    };
    const parsed = serviceCatalogConfigSchema.safeParse(next);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { error: "INVALID_CONFIG" as const, message: `${issue?.path.join(".") || "config"}: ${issue?.message ?? "invalid"}` };
    }
    const instant = scheduledLiveAt ? scheduledLiveInstant(scheduledLiveAt) : null;
    if (scheduledLiveAt && !instant) {
      return { error: "INVALID_CONFIG" as const, message: "scheduledLiveAt must be an ISO timestamp" };
    }
    // Compare-and-set on the row we read: a save that lands in between is not overwritten, and not approved.
    const written = await prisma.service.updateMany({
      where: { id, version: exists.version, lifecycleStatus: exists.lifecycleStatus, updatedAt: exists.updatedAt },
      data: {
        catalogConfig: parsed.data as Prisma.InputJsonValue,
        lastReviewedAt: new Date(),
      },
    });
    if (written.count === 0) {
      return { error: "VERSION_CONFLICT" as const, message: "Another change was saved first. Reload and review it again." };
    }
    void AuditLogService.record("ADMIN_ACTION", "success", {
      userId: actorId,
      details: { action: "SERVICE_APPROVED", serviceId: id, version: exists.version, contentHash, editorId, scheduledLiveAt: scheduledLiveAt ?? null },
    });
    const row = await prisma.service.findUniqueOrThrow({ where: { id }, include: TAXONOMY_INCLUDE });
    return { service: await this.hydratedAdminRow(row) };
  }

  /**
   * Remove a scheduled go-live time. The approval is of the content, not of the time, so it stands:
   * the service is then approved and can be published at once, or scheduled again by approving again.
   */
  async unschedule(id: string, actorId: string | undefined) {
    const exists = await prisma.service.findUnique({ where: { id }, include: TAXONOMY_INCLUDE });
    if (!exists) return { error: "NOT_FOUND" as const };
    const cfg = parseCatalogConfig(exists.catalogConfig);
    if (!cfg?.scheduledLiveAt) return { error: "NOT_SCHEDULED" as const, message: "This service has no scheduled go-live time." };
    const { scheduledLiveAt, ...rest } = cfg;
    const written = await prisma.service.updateMany({
      where: { id, version: exists.version, lifecycleStatus: exists.lifecycleStatus, updatedAt: exists.updatedAt },
      data: { catalogConfig: rest as Prisma.InputJsonValue },
    });
    if (written.count === 0) return { error: "VERSION_CONFLICT" as const, message: "Another change was saved first. Reload and try again." };
    await AuditLogService.record("ADMIN_ACTION", "success", {
      userId: actorId,
      details: { action: "SERVICE_UNSCHEDULED", serviceId: id, version: exists.version, reason: `was scheduled for ${scheduledLiveAt}` },
    });
    const row = await prisma.service.findUniqueOrThrow({ where: { id }, include: TAXONOMY_INCLUDE });
    return { service: await this.hydratedAdminRow(row) };
  }

  /** Leader-locked tick. A failed gate leaves the service in review and writes an audit failure. */
  async activateScheduledServices(now = new Date()): Promise<{ activated: number; failed: number; revisionsApplied: number; revisionsFailed: number }> {
    const rows = await prisma.service.findMany({
      where: { lifecycleStatus: "READY_FOR_REVIEW" },
      select: { id: true, catalogConfig: true },
    });
    let activated = 0;
    let failed = 0;
    for (const row of rows) {
      const cfg = parseCatalogConfig(row.catalogConfig);
      if (!cfg?.scheduledLiveAt) continue;
      const at = scheduledLiveInstant(cfg.scheduledLiveAt);
      if (!at || at.getTime() > now.getTime()) continue;
      const result = await this.transition(row.id, cfg.comingSoon ? "PUBLISHED" : "ACTIVE", "scheduler");
      if ("error" in result && result.error) {
        failed += 1;
        void AuditLogService.record("ADMIN_ACTION", "failure", {
          userId: "scheduler",
          details: { action: "SERVICE_SCHEDULED_ACTIVATION_FAILED", serviceId: row.id, error: result.error, message: "message" in result ? result.message : null },
        });
      } else {
        activated += 1;
      }
    }
    // Approved revisions of live services whose time has come. The base is checked again: a live
    // service that changed since the revision was proposed is not overwritten by it.
    let revisionsApplied = 0;
    let revisionsFailed = 0;
    const drafts = await prisma.serviceConfigVersion.findMany({ where: { status: "DRAFT" }, select: { id: true, serviceId: true, version: true, snapshot: true } });
    for (const draft of drafts) {
      const snap = draft.snapshot as PendingRevisionSnapshot | null;
      if (!snap || snap.kind !== "PENDING_REVISION" || !snap.approval) continue;
      const at = scheduledLiveInstant(snap.approval.scheduledLiveAt);
      if (!at || at.getTime() > now.getTime()) continue;
      const exists = await prisma.service.findUnique({ where: { id: draft.serviceId }, include: TAXONOMY_INCLUDE });
      const liveCfg = exists ? await withRequirementItems(parseCatalogConfig(exists.catalogConfig)) : null;
      const outdated = !exists || snap.baseVersion !== exists.version || snap.baseContentHash !== approvalContentHash(exists, liveCfg);
      const result = outdated
        ? { error: "REVISION_OUTDATED" as const, message: "The live service changed after this revision was proposed." }
        : await this.applyRevision(draft.serviceId, { rowId: draft.id, snapshot: snap }, snap.approval.actorId);
      if ("error" in result && result.error) {
        revisionsFailed += 1;
        void AuditLogService.record("ADMIN_ACTION", "failure", {
          userId: "scheduler",
          details: { action: "SERVICE_SCHEDULED_REVISION_FAILED", serviceId: draft.serviceId, baseVersion: snap.baseVersion, error: result.error, reason: "message" in result ? (result.message ?? null) : null },
        });
      } else {
        revisionsApplied += 1;
        void AuditLogService.record("ADMIN_ACTION", "success", {
          userId: "scheduler",
          details: { action: "SERVICE_REVISION_APPROVED", serviceId: draft.serviceId, baseVersion: snap.baseVersion, contentHash: snap.contentHash, proposedBy: snap.proposedBy, approvedBy: snap.approval.actorId, changes: snap.changes.map((c) => c.field), reason: `scheduled for ${snap.approval.scheduledLiveAt}` },
        });
      }
    }
    return { activated, failed, revisionsApplied, revisionsFailed };
  }

  /** Legacy activate / deactivate toggle (keeps history & bookings). */
  async setActive(id: string, isActive: boolean, actorId?: string, reason?: string | null) {
    const exists = await prisma.service.findUnique({ where: { id }, select: { isActive: true } });
    if (!exists) return { error: "NOT_FOUND" as const };
    // Deactivating something already inactive keeps its stage (a DRAFT stays a DRAFT).
    if (!isActive && !exists.isActive) {
      const row = await prisma.service.findUniqueOrThrow({ where: { id }, include: TAXONOMY_INCLUDE });
      return { service: await this.hydratedAdminRow(row) };
    }
    // The toggle is one more way to take a live service off sale: the same reason is required as
    // on the lifecycle route, so no route pauses a service without saying why.
    if (!isActive && !reason?.trim()) {
      return { error: "REASON_REQUIRED" as const, message: "Give the reason for taking this service off sale." };
    }
    return this.transition(id, isActive ? "ACTIVE" : "PAUSED", actorId, undefined, isActive ? undefined : reason);
  }

  async adminById(id: string) {
    const s = await prisma.service.findUnique({ where: { id }, include: TAXONOMY_INCLUDE });
    if (!s) return { error: "NOT_FOUND" as const };
    const cfg = await loadHydratedCatalog(s);
    const pending = await this.pendingRevision(id);
    const approval = parseCatalogConfig(s.catalogConfig)?.publishApproval;
    return {
      service: {
        ...this.adminRow({ ...s, catalogConfig: cfg ?? s.catalogConfig }, undefined, (await trainingModuleGaps([cfg ?? parseCatalogConfig(s.catalogConfig)]))[0]),
        liveEditPolicy: await liveEditPolicy(),
        pendingRevision: pending?.view ?? null,
      },
      actors: await this.actorNames([s.createdBy, s.updatedBy, s.publishedBy, approval?.actorId, approval?.editorId, pending?.view.proposedBy, pending?.view.approvedBy]),
    };
  }

  /** Published version history, newest first. */
  async adminVersions(id: string) {
    const exists = await prisma.service.findUnique({ where: { id }, select: { id: true, version: true } });
    if (!exists) return { error: "NOT_FOUND" as const };
    const versions = await prisma.serviceConfigVersion.findMany({
      // A DRAFT row is a pending revision (see `pendingRevision`), not history.
      where: { serviceId: id, status: "PUBLISHED" },
      orderBy: { version: "desc" },
      take: 100,
      select: { version: true, status: true, createdBy: true, createdAt: true, publishedAt: true, snapshot: true },
    });
    return { currentVersion: exists.version, versions, actors: await this.actorNames(versions.map((v) => v.createdBy)) };
  }

  /**
   * Display names for the admin ids a control-plane response mentions, so the console can say who
   * instead of showing an identifier. Name only: no email, phone or role. An id with no user row
   * (the scheduler) is simply absent, and the console falls back to the id.
   */
  private async actorNames(ids: Array<string | null | undefined>): Promise<Record<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (unique.length === 0) return {};
    const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
    const names: Record<string, string> = {};
    for (const u of users) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
      if (name) names[u.id] = name;
    }
    return names;
  }

  /**
   * What changed between two published versions: the same field-by-field comparison a reviewer sees
   * on a pending revision, read from the immutable snapshots (never from the live row).
   */
  async versionDiff(id: string, fromVersion: number, toVersion: number) {
    const rows = await prisma.serviceConfigVersion.findMany({
      where: { serviceId: id, status: "PUBLISHED", version: { in: [fromVersion, toVersion] } },
      select: { version: true, catalogConfig: true, snapshot: true, createdBy: true, publishedAt: true, createdAt: true },
    });
    const from = rows.find((r) => r.version === fromVersion);
    const to = rows.find((r) => r.version === toVersion);
    if (!from || !to) return { error: "NOT_FOUND" as const };
    const side = (r: typeof from) => ({ version: r.version, publishedAt: r.publishedAt ?? r.createdAt, publishedBy: r.createdBy });
    const fields = (r: typeof from) => (r.snapshot && typeof r.snapshot === "object" && !Array.isArray(r.snapshot) ? (r.snapshot as object) : {});
    return {
      from: side(from),
      to: side(to),
      changes: contentDiff(fields(from), parseCatalogConfig(from.catalogConfig), fields(to), parseCatalogConfig(to.catalogConfig)),
    };
  }

  /**
   * Bring back what a published version sold: its price, duration and configuration. Nothing is
   * rewound. The restore is an ordinary edit through `update`, so it passes the publish gate, obeys
   * the live-edit policy (under four-eyes it becomes a pending revision) and is published as a NEW
   * version; the version restored from and the one replaced both stay in the history.
   */
  async restoreVersion(id: string, version: number, actorId: string | undefined, reason: string) {
    const exists = await prisma.service.findUnique({ where: { id }, include: TAXONOMY_INCLUDE });
    if (!exists) return { error: "NOT_FOUND" as const };
    const row = await prisma.serviceConfigVersion.findFirst({
      where: { serviceId: id, version, status: "PUBLISHED" },
      select: { version: true, catalogConfig: true, snapshot: true },
    });
    if (!row) return { error: "NOT_FOUND" as const };
    const snap = (row.snapshot && typeof row.snapshot === "object" && !Array.isArray(row.snapshot) ? row.snapshot : {}) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const restored = parseCatalogConfig(row.catalogConfig);
    const live = parseCatalogConfig(exists.catalogConfig);
    const target = {
      basePrice: num(snap.basePrice) ?? exists.basePrice,
      minPrice: snap.minPrice === null ? null : (num(snap.minPrice) ?? exists.minPrice),
      maxPrice: snap.maxPrice === null ? null : (num(snap.maxPrice) ?? exists.maxPrice),
      estimatedDuration: num(snap.estimatedDuration) ?? exists.estimatedDuration,
    };
    if (contentDiff({ ...exists }, live, { ...exists, ...target }, restored).length === 0) {
      return { error: "NOTHING_TO_RESTORE" as const, message: `The live service already matches version ${version}.` };
    }
    const { publishApproval: _approval, scheduledLiveAt: _when, ...config } = (restored ?? {}) as Record<string, unknown>;
    return this.update(
      id,
      {
        // A version that had no price range restores as none: null clears the column, undefined would keep the current one.
        ...target,
        catalogConfig: config,
        changeReason: `Restore of v${version}: ${reason.trim()}`,
      } as Partial<AdminServiceInput & AdminCreateRequired> & { changeReason: string },
      actorId,
    );
  }

  /**
   * Who did what to one service, newest first: approvals, lifecycle moves, versioned edits, revision
   * proposals and their outcomes. Read from the activity log the control plane already writes to;
   * each entry is reduced to the fields below, so nothing else stored in an audit row is returned.
   */
  async auditTrail(id: string, limitRaw?: string | number) {
    const exists = await prisma.service.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return { error: "NOT_FOUND" as const };
    const limit = Math.min(Math.max(Number(limitRaw) || 100, 1), 200);
    const rows = await prisma.activityLog.findMany({
      where: { action: "ADMIN_ACTION", description: { contains: `"serviceId":${JSON.stringify(id)}` } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: { id: true, userId: true, description: true, createdAt: true },
    });
    const entries = [];
    for (const row of rows) {
      let d: Record<string, unknown>;
      try {
        d = JSON.parse(row.description ?? "{}") as Record<string, unknown>;
      } catch {
        continue;
      }
      if (d.serviceId !== id || typeof d.action !== "string" || !d.action.startsWith("SERVICE_")) continue;
      entries.push({
        id: row.id,
        at: row.createdAt,
        // A system actor (the scheduler) is not a user row; its label is kept in the payload.
        actorId: row.userId ?? (typeof d.systemActor === "string" ? d.systemActor : null),
        action: d.action,
        status: typeof d.status === "string" ? d.status : null,
        version: typeof d.version === "number" ? d.version : typeof d.baseVersion === "number" ? d.baseVersion : null,
        from: typeof d.from === "string" ? d.from : null,
        to: typeof d.to === "string" ? d.to : null,
        changes: Array.isArray(d.changes) ? d.changes.filter((c): c is string => typeof c === "string") : [],
        reason: typeof d.reason === "string" ? d.reason : null,
        approvedBy: typeof d.approvedBy === "string" ? d.approvedBy : null,
      });
    }
    return { entries, actors: await this.actorNames(entries.flatMap((e) => [e.actorId, e.approvedBy])) };
  }

  private categoryView(c: { id: string; slug: string; name: string; shortName: string | null; description: string | null; sortOrder: number; isActive: boolean; operationalCategories: string[]; parentId: string | null }) {
    return { id: c.id, slug: c.slug, name: c.name, shortName: c.shortName, description: c.description, sortOrder: c.sortOrder, isActive: c.isActive, operationalCategories: c.operationalCategories, parentId: c.parentId };
  }

  /** Add a category or subcategory to the customer taxonomy. The tree is two levels deep (database guard). */
  async createCategory(
    input: { name: string; slug: string; parentId?: string | null; shortName?: string | null; description?: string | null; sortOrder?: number; operationalCategories?: string[] },
    actorId?: string,
  ) {
    const slug = input.slug.trim();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      return { error: "INVALID_IDENTITY" as const, message: "slug: use lowercase letters, digits and single hyphens" };
    }
    if (!input.name.trim()) return { error: "INVALID_IDENTITY" as const, message: "name is required" };
    if (input.parentId) {
      const parent = await prisma.serviceCategory.findUnique({ where: { id: input.parentId }, select: { parentId: true } });
      if (!parent) return { error: "INVALID_TAXONOMY" as const, message: "The parent category does not exist" };
      if (parent.parentId) return { error: "INVALID_TAXONOMY" as const, message: "A subcategory cannot have subcategories" };
    }
    try {
      const created = await prisma.serviceCategory.create({
        data: {
          slug,
          name: input.name.trim(),
          shortName: input.shortName?.trim() || null,
          description: input.description?.trim() || null,
          sortOrder: input.sortOrder ?? 0,
          operationalCategories: input.operationalCategories ?? [],
          parentId: input.parentId ?? null,
        },
      });
      await AuditLogService.record("ADMIN_ACTION", "success", {
        userId: actorId,
        details: { action: "SERVICE_CATEGORY_CREATED", categoryId: created.id, slug: created.slug, parentId: created.parentId },
      });
      await this.invalidateCatalogCache();
      return { category: this.categoryView(created) };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        return { error: "DUPLICATE" as const, message: "A category with this slug already exists" };
      }
      if (/SERVICE_CATEGORY_(TOO_DEEP|SELF_PARENT)/.test(String(e))) {
        return { error: "INVALID_TAXONOMY" as const, message: "A subcategory cannot have subcategories" };
      }
      if (/service_categories_slug_format/.test(String(e))) return { error: "INVALID_IDENTITY" as const, message: "slug format is invalid" };
      throw e;
    }
  }

  /**
   * Rename, describe, reorder or switch a category on or off. The slug is in customer URLs and in
   * dispatch mappings, so it does not change. A category that still holds a live service cannot be
   * switched off: its services would vanish from the customer catalogue without anyone pausing them.
   */
  async updateCategory(
    id: string,
    input: { name?: string; slug?: string; shortName?: string | null; description?: string | null; sortOrder?: number; isActive?: boolean; operationalCategories?: string[] },
    actorId?: string,
  ) {
    const exists = await prisma.serviceCategory.findUnique({ where: { id } });
    if (!exists) return { error: "NOT_FOUND" as const };
    if (input.slug !== undefined && input.slug.trim() !== exists.slug) {
      return { error: "SLUG_IMMUTABLE" as const, message: "A category slug is part of customer URLs and cannot be changed." };
    }
    if (input.name !== undefined && !input.name.trim()) return { error: "INVALID_IDENTITY" as const, message: "name is required" };
    if (input.isActive === false && exists.isActive) {
      const live = await prisma.service.count({ where: { isActive: true, OR: [{ categoryId: id }, { subcategoryId: id }] } });
      if (live > 0) {
        return {
          error: "CATEGORY_IN_USE" as const,
          message: `${live} live service${live === 1 ? " is" : "s are"} in this category. Pause or move ${live === 1 ? "it" : "them"} first.`,
        };
      }
    }
    const updated = await prisma.serviceCategory.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.shortName !== undefined ? { shortName: input.shortName?.trim() || null } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.operationalCategories !== undefined ? { operationalCategories: input.operationalCategories } : {}),
      },
    });
    const changed = (["name", "shortName", "description", "sortOrder", "isActive"] as const).filter((k) => exists[k] !== updated[k]);
    await AuditLogService.record("ADMIN_ACTION", "success", {
      userId: actorId,
      details: { action: "SERVICE_CATEGORY_UPDATED", categoryId: id, slug: updated.slug, changes: changed },
    });
    await this.invalidateCatalogCache();
    return { category: this.categoryView(updated) };
  }

  /** Full taxonomy tree for admin (inactive rows included), with service counts. */
  async adminCategories() {
    const [rows, counts, subCounts] = await Promise.all([
      prisma.serviceCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { slug: "asc" }] }),
      prisma.service.groupBy({ by: ["categoryId"], _count: { _all: true } }),
      prisma.service.groupBy({ by: ["subcategoryId"], _count: { _all: true } }),
    ]);
    const n = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    const sn = new Map(subCounts.map((c) => [c.subcategoryId, c._count._all]));
    return {
      categories: rows
        .filter((r) => r.parentId == null)
        .map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          shortName: c.shortName,
          sortOrder: c.sortOrder,
          isActive: c.isActive,
          operationalCategories: c.operationalCategories,
          serviceCount: n.get(c.id) ?? 0,
          subcategories: rows
            .filter((r) => r.parentId === c.id)
            .map((sc) => ({ id: sc.id, slug: sc.slug, name: sc.name, sortOrder: sc.sortOrder, isActive: sc.isActive, serviceCount: sn.get(sc.id) ?? 0 })),
        })),
    };
  }

  async partnerEligible(providerServiceCategories: string[]) {
    const rows = await prisma.service.findMany({
      where: PARTNER_OPERATIONAL_WHERE,
      orderBy: { name: "asc" },
      take: 200,
    });
    return {
      services: rows
        .filter((s) => {
          const skills = parseCatalogConfig(s.catalogConfig)?.providerRequirements?.requiredSkills;
          if (!skills?.length) return true;
          return skills.every((skill) => providerServiceCategories.includes(skill));
        })
        .map((s) => {
          const cfg = parseCatalogConfig(s.catalogConfig);
          return {
            id: s.id,
            name: s.displayName || s.name,
            slug: s.slug,
            category: s.category,
            estimatedDuration: s.estimatedDuration,
            requiredSkills: cfg?.providerRequirements?.requiredSkills ?? [],
            inspectionRequired: cfg?.inspectionRequired === true,
            materialPolicy: cfg?.materialPolicy ?? null,
            equipmentPolicy: cfg?.equipmentPolicy ?? null,
            materials: partnerMaterialsCopy(cfg?.materialPolicy),
            equipment: partnerEquipmentCopy(cfg?.equipmentPolicy),
            qualityChecklist: cfg?.quality?.notApplicable ? [] : (cfg?.quality?.checklist ?? []),
            proofRequired: cfg?.quality?.proofRequired === true,
            beforeAfterPhotos: cfg?.quality?.beforeAfterPhotos === true,
            trainingRequired: cfg?.providerRequirements?.trainingRequired === true,
            certifications: cfg?.providerRequirements?.certifications ?? [],
          };
        }),
    };
  }

  /**
   * Partner onboarding options from the live catalogue. Falls back to the
   * legacy slug map only when the catalogue has no active rows.
   */
  async partnerOnboardingOptions() {
    const rows = await prisma.service.findMany({
      where: PARTNER_OPERATIONAL_WHERE,
      select: { id: true, slug: true, category: true, displayName: true, name: true, catalogConfig: true },
      orderBy: { name: "asc" },
      take: 200,
    });
    if (rows.length === 0) {
      return { source: "compatibility_map" as const, options: partnerOnboardingOptionDefs() };
    }
    return {
      source: "catalog" as const,
      options: rows.map((s) => {
        const cfg = parseCatalogConfig(s.catalogConfig);
        return {
          id: s.slug,
          label: s.displayName || s.name,
          catalogCategories: [s.category],
          requiredSkills: cfg?.providerRequirements?.requiredSkills ?? [],
          trainingRequired: cfg?.providerRequirements?.trainingRequired === true,
          certifications: cfg?.providerRequirements?.certifications ?? [],
        };
      }),
    };
  }

  /**
   * Hard-delete a service. Bookings reference services with onDelete: Restrict, so a
   * service that has bookings cannot be deleted — callers should deactivate instead.
   */
  async remove(id: string) {
    const exists = await prisma.service.findUnique({ where: { id } });
    if (!exists) return { error: "NOT_FOUND" as const };
    const bookings = await prisma.booking.count({ where: { serviceId: id } });
    if (bookings > 0) return { error: "HAS_BOOKINGS" as const, bookings };
    await prisma.service.delete({ where: { id } });
    await this.invalidateCatalogCache();
    return { ok: true as const };
  }
}

export const catalogService = new CatalogService();
