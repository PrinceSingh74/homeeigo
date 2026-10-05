import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
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
import { customerVisitPromise, customerQualitySummary, startPinRequired } from "../lib/customer-visit";

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
  private adminRow(s: AdminServiceRecord, cfgIn?: ServiceCatalogConfig | null) {
    const cfg = cfgIn !== undefined ? cfgIn : parseCatalogConfig(s.catalogConfig);
    const lifecycle = parseLifecycle(s.lifecycleStatus);
    const activation = validateForActivation(s, cfg, { grandfathered: s.isActive });
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
    return this.adminRow(s, await withRequirementItems(parseCatalogConfig(s.catalogConfig)));
  }

  private async writeVersion(tx: Prisma.TransactionClient, s: AdminServiceRecord, actorId: string | undefined) {
    const cfg = parseCatalogConfig(s.catalogConfig);
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
    const { requirementItems: _clientItems, ...clientRaw } = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
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

    return {
      services: rows.map((s, i) => {
        const agg = ratings.get(s.id);
        return {
          ...this.adminRow(s, cfgs[i]),
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
    const wantActive = input.isActive ?? true;
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
        },
        parsed,
        { grandfathered: true },
      );
      if (!gate.ok) return this.gateFailure(gate.issues);
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
        if (wantActive) await this.writeVersion(tx, created, actorId);
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
    const nextCfg = await withRequirementItems(parseCatalogConfig(nextConfigRaw));
    const wantActive = input.isActive ?? exists.isActive;
    let target: ServiceLifecycleStatus;
    if (wantActive) target = effectiveLifecycleTarget("ACTIVE", nextCfg);
    else if (exists.isActive) target = "PAUSED";
    else target = prevLifecycle; // an inactive DRAFT / REVIEW / ARCHIVED row keeps its stage
    if (!canTransition(prevLifecycle, target)) {
      return this.transitionFailure(prevLifecycle, target);
    }

    const next = {
      ...exists,
      ...rest,
      slug: nextSlug,
      ...checked.taxonomy,
      minPrice: input.minPrice !== undefined ? input.minPrice : exists.minPrice,
      maxPrice: input.maxPrice !== undefined ? input.maxPrice : exists.maxPrice,
      catalogConfig: nextCfg,
      isActive: wantActive,
      lifecycleStatus: target,
    };
    if (wantActive) {
      const gate = validateForActivation(next, nextCfg, { grandfathered: exists.isActive });
      if (!gate.ok) return this.gateFailure(gate.issues);
    }
    const sellingChanged =
      (cfg?.ok && JSON.stringify(nextConfigRaw ?? null) !== JSON.stringify(exists.catalogConfig ?? null)) ||
      (input.basePrice !== undefined && input.basePrice !== exists.basePrice) ||
      (input.minPrice !== undefined && input.minPrice !== exists.minPrice) ||
      (input.maxPrice !== undefined && input.maxPrice !== exists.maxPrice) ||
      (input.estimatedDuration !== undefined && input.estimatedDuration !== exists.estimatedDuration) ||
      (input.pricingModel !== undefined && input.pricingModel !== exists.pricingModel);
    const becameLive = wantActive && !exists.isActive;
    const bumpVersion = wantActive && (becameLive || sellingChanged);
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
            ...(cfg?.ok ? { catalogConfig: cfg.value } : {}),
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
        if (bumpVersion) await this.writeVersion(tx, row, actorId);
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
  async transition(id: string, requested: ServiceLifecycleStatus, actorId?: string, expectedVersion?: number) {
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
    const becameLive = flags.isActive && !exists.isActive;
    if (becameLive) {
      const gate = validateForActivation({ ...exists, isActive: true }, cfg, { grandfathered: false });
      if (!gate.ok) return this.gateFailure(gate.issues);
    }
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
        details: { action: "SERVICE_LIFECYCLE_CHANGED", serviceId: s.id, from, to, version: s.version },
      });
      await this.invalidateCatalogCache();
      return { service: await this.hydratedAdminRow(s) };
    } catch (e) {
      if (e instanceof VersionConflict) return { error: "VERSION_CONFLICT" as const, message: "Another change was saved first — reload and try again" };
      throw e;
    }
  }

  /** Legacy activate / deactivate toggle (keeps history & bookings). */
  async setActive(id: string, isActive: boolean, actorId?: string) {
    const exists = await prisma.service.findUnique({ where: { id }, select: { isActive: true } });
    if (!exists) return { error: "NOT_FOUND" as const };
    // Deactivating something already inactive keeps its stage (a DRAFT stays a DRAFT).
    if (!isActive && !exists.isActive) {
      const row = await prisma.service.findUniqueOrThrow({ where: { id }, include: TAXONOMY_INCLUDE });
      return { service: await this.hydratedAdminRow(row) };
    }
    return this.transition(id, isActive ? "ACTIVE" : "PAUSED", actorId);
  }

  async adminById(id: string) {
    const s = await prisma.service.findUnique({ where: { id }, include: TAXONOMY_INCLUDE });
    if (!s) return { error: "NOT_FOUND" as const };
    const cfg = await loadHydratedCatalog(s);
    return { service: this.adminRow({ ...s, catalogConfig: cfg ?? s.catalogConfig }) };
  }

  /** Published version history, newest first. */
  async adminVersions(id: string) {
    const exists = await prisma.service.findUnique({ where: { id }, select: { id: true, version: true } });
    if (!exists) return { error: "NOT_FOUND" as const };
    const versions = await prisma.serviceConfigVersion.findMany({
      where: { serviceId: id },
      orderBy: { version: "desc" },
      take: 100,
      select: { version: true, status: true, createdBy: true, createdAt: true, publishedAt: true, snapshot: true },
    });
    return { currentVersion: exists.version, versions };
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
