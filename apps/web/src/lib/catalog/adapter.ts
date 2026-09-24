import type { BackendService } from "@/types/backend";
import { matchServiceVisual } from "@/lib/service-visuals";
import {
  AUDIENCES,
  BEAUTY_TYPES,
  CATEGORIES,
  CATEGORY_BY_ID,
  CROSS_LISTINGS,
  LEGACY_BEAUTY_LEAF,
  SERVICE_DEFS,
} from "@/lib/catalog/taxonomy";
import type { PublicCatalogConfig } from "@/types/backend";
import type {
  Audience,
  Catalog,
  CategoryId,
  CategoryView,
  PricingModel,
  ServiceDef,
  ServiceView,
} from "@/lib/catalog/types";

/* ------------------------------------------------------------------ */
/* Data quality                                                        */
/* ------------------------------------------------------------------ */

const FIXTURE_PATTERNS = [
  /^adv[\s-]service\b/i,
  /^phase\s?\d/i,
  /\bcert(ification)?\b/i,
  /\btest(ing)?\b/i,
  /\bdemo\b/i,
  /\bchaos\b/i,
  /\bfixture\b/i,
  /\bseed\b/i,
  /^rc\d+$/i,
];

/**
 * Whether a backend record that is NOT in the curated catalogue may be shown.
 * Test fixtures ("Adv Service adv-chaos-…", "rc1781462361600", "Phase2 Cert…")
 * stay hidden. A single plain word an admin typed in lowercase ("spa") is a real
 * SKU and is shown with a title-cased label. Multi-word all-lowercase copy
 * ("fasade cleaning") stays hidden until someone reviews the name.
 */
export function isCustomerFacingService(s: Pick<BackendService, "name" | "slug">): boolean {
  const name = (s.name ?? "").trim();
  const slug = s.slug ?? "";
  if (name.length < 3) return false;
  const titled = /^[A-Z]/.test(name);
  const plainWord = /^[a-z][a-z'-]{2,}$/.test(name);
  if (!titled && !plainWord) return false;
  if (/\d{4,}/.test(name) || /\d{4,}/.test(slug)) return false;
  if (/\b[a-z]+-[a-z0-9]+-[a-z0-9]{5,}\b/i.test(name)) return false;
  return !FIXTURE_PATTERNS.some((re) => re.test(name) || re.test(slug));
}

function displayTitle(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|\s)([a-z])/g, (_, gap: string, ch: string) => gap + ch.toUpperCase());
}

function sentenceCase(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Backend copy is used when it reads like customer copy; otherwise the curated line. */
function customerDescription(backend: string | undefined, fallback: string): string {
  const d = (backend ?? "").trim();
  return d.length >= 12 && /^[A-Z]/.test(d) ? d : fallback;
}

const VALID_MODELS = new Set<PricingModel>([
  "hourly",
  "fixed",
  "per-unit",
  "per-seat",
  "area",
  "package",
  "inspection",
  "quote",
]);

/** Admin override: a backend pricingModel other than the column default wins. */
function resolveModel(def: ServiceDef, backend?: BackendService): PricingModel {
  const m = backend?.pricingModel?.toLowerCase().replace(/_/g, "-") as PricingModel | undefined;
  if (m && m !== "fixed" && VALID_MODELS.has(m)) return m;
  return def.pricingModel;
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export function categoryHref(id: CategoryId): string {
  return `/services/${id}`;
}

export function audienceHref(aud: string): string {
  return `/services/beauty/${aud}`;
}

export function serviceHref(def: Pick<ServiceDef, "slug" | "category">): string {
  return `/services/${def.category}/${def.slug}`;
}

/** A beauty service opened from an audience page carries that audience as a preselection. */
export function serviceHrefFor(svc: Pick<ServiceView, "href" | "audiences">, audience?: string): string {
  return audience && svc.audiences.includes(audience as Audience) ? `${svc.href}?for=${audience}` : svc.href;
}

/**
 * Backend quantity-rule type → display model. The backend has 16 types (ROOM, SOFA_SEAT, MATTRESS,
 * FAN, LOAD, …); every counted thing that is not time, area or a package is "per unit", and the rule's
 * own unitLabel supplies the word. An unmapped type used to leave pricingModel undefined and the
 * detail page printed "undefined · ₹250 / seat".
 */
const QUANTITY_MODELS: Record<string, PricingModel> = {
  HOUR: "hourly",
  SEAT: "per-seat",
  AREA: "area",
  SQ_FT: "area",
  PACKAGE: "package",
};
const quantityModel = (type: string): PricingModel => QUANTITY_MODELS[type] ?? "per-unit";
const UNIT_MODELS = new Set<PricingModel>(["hourly", "per-unit", "per-seat", "area"]);

/** Reasons a live service is not fully configured. Never customer-facing. */
function gapsFor(def: ServiceDef, cfg: PublicCatalogConfig | null): string[] {
  const gaps: string[] = [];
  if (UNIT_MODELS.has(def.pricingModel) && !cfg?.quantity) {
    gaps.push(`Catalogue expects "${def.pricingModel}" pricing but no quantity rule is configured — sold as a fixed price`);
  }
  if (def.audiences && !cfg?.audiences) gaps.push("Audience eligibility not configured — catalogue default used");
  if (!cfg?.materialPolicy) gaps.push("Materials policy not configured");
  if (!cfg?.equipmentPolicy) gaps.push("Equipment policy not configured");
  if (!def.fallbackApproved) gaps.push("Scope (included / not included) relies on backend content — no approved fallback");
  return gaps;
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

function imageFor(def: ServiceDef, backend?: BackendService): string | undefined {
  if (def.image) return def.image;
  const photo = matchServiceVisual(def.name)?.photo;
  // Curated local art is one consistent, branded set — prefer it.
  if (photo?.startsWith("/")) return photo;
  return backend?.thumbnail ?? photo ?? undefined;
}

function toView(def: ServiceDef, order: number, backend?: BackendService): ServiceView {
  const cat = CATEGORY_BY_ID.get(def.category)!;
  const visual = matchServiceVisual(def.name);
  const config = backend?.catalogConfig ?? null;
  // An admin can hold an active record back as "coming soon" from configuration.
  const live = Boolean(backend) && !config?.comingSoon;
  const base = backend?.basePrice ?? backend?.minPrice;
  const price =
    live && base != null && base > 0
      ? {
          base,
          min: Math.min(backend?.minPrice ?? base, base),
          max: Math.max(backend?.maxPrice ?? base, base),
        }
      : undefined;
  const description = customerDescription(backend?.description, def.short);
  const subgroupName = cat.subgroups?.find((g) => g.id === def.subgroup)?.name ?? "";
  const audiences = ((live ? config?.audiences : undefined) ?? def.audiences ?? []) as Audience[];
  const audienceNames = audiences.map((a) => AUDIENCES.find((x) => x.id === a)?.name ?? "").join(" ");
  const quantity = live ? config?.quantity : undefined;
  const status = live && price ? "live" : "coming-soon";
  const typeName = BEAUTY_TYPES.find((t) => t.id === def.beautyType)?.name ?? "";

  return {
    slug: def.slug,
    name: def.name,
    category: def.category,
    subgroup: def.subgroup,
    description,
    href: serviceHref(def),
    status,
    backendId: backend?.id,
    // A unit model is only claimed when a quantity rule makes it true.
    pricingModel: quantity
      ? quantityModel(quantity.type)
      : status === "live"
        ? UNIT_MODELS.has(resolveModel(def, backend))
          ? "fixed"
          : resolveModel(def, backend)
        : def.pricingModel,
    unit: def.unit,
    price,
    durationMin: backend?.estimatedDuration || undefined,
    image: imageFor(def, backend),
    icon: def.icon ?? visual?.icon ?? cat.icon,
    tone: visual?.color ?? cat.tone,
    popular: Boolean(backend?.isPopular),
    premiumOnly: Boolean(backend?.premiumOnly),
    audiences,
    beautyType: def.beautyType,
    hourly: Boolean(def.hourly) || quantity?.type === "HOUR",
    config: live ? config : null,
    quantity,
    quantityPrices: live ? (backend?.quantityPrices ?? null) : null,
    variants: live ? (config?.variants ?? []).filter((v) => v.active) : [],
    rating:
      backend?.rating != null && backend.rating > 0 && (backend.reviewCount ?? 0) > 0
        ? { value: backend.rating, count: backend.reviewCount! }
        : null,
    gaps: status === "live" ? gapsFor(def, config) : [],
    order,
    searchText: normalize(
      [
        def.name,
        ...(def.aliases ?? []),
        cat.name,
        cat.shortName,
        subgroupName,
        audienceNames,
        typeName,
        description,
      ].join(" "),
    ),
    def,
  };
}

/**
 * Category for a backend service the curated catalogue does not list. The backend taxonomy
 * (service_categories) is authoritative; `backendCategories` is only the fallback for responses
 * from a backend that predates it.
 */
function fallbackCategory(b: Pick<BackendService, "category" | "taxonomy">): CategoryId {
  const fromTaxonomy = b.taxonomy?.category?.slug;
  if (fromTaxonomy && CATEGORY_BY_ID.has(fromTaxonomy as CategoryId)) return fromTaxonomy as CategoryId;
  const c = (b.category ?? "").toLowerCase();
  const hit = CATEGORIES.find((cat) => cat.backendCategories?.includes(c));
  return hit?.id ?? "special-services";
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const liveFirst = (a: ServiceView, b: ServiceView) =>
  Number(b.status === "live") - Number(a.status === "live") || a.order - b.order;

export function buildCatalog(backendServices: BackendService[] | undefined | null): Catalog {
  const bySlugBackend = new Map<string, BackendService>();
  for (const s of backendServices ?? []) {
    if (s.slug) bySlugBackend.set(s.slug, s);
  }

  const consumed = new Set<string>();
  const services: ServiceView[] = [];

  SERVICE_DEFS.forEach((def, i) => {
    let match: BackendService | undefined;
    for (const slug of def.bind ?? []) {
      const hit = bySlugBackend.get(slug);
      if (hit && !consumed.has(slug)) {
        match = hit;
        consumed.add(slug);
        break;
      }
    }
    services.push(toView(def, i, match));
  });

  // Active backend services the catalogue does not know yet: show them in their
  // category if the name is customer-ready, hide test/unreviewed records.
  const known = new Set(services.map((s) => s.slug));
  let extraOrder = SERVICE_DEFS.length;
  for (const b of backendServices ?? []) {
    if (!b.slug || consumed.has(b.slug) || !isCustomerFacingService(b)) continue;
    const slug = known.has(b.slug) ? `service-${b.slug}` : b.slug;
    const category = fallbackCategory(b);
    const titled = displayTitle(b.name);
    const subgroupSlug = b.taxonomy?.subcategory?.slug;
    const subgroup = CATEGORY_BY_ID.get(category)?.subgroups?.some((g) => g.id === subgroupSlug)
      ? subgroupSlug
      : undefined;
    const def: ServiceDef = {
      slug,
      name: titled,
      category,
      subgroup,
      short: sentenceCase(b.description?.trim() || titled),
      pricingModel: "fixed",
    };
    services.push(toView(def, extraOrder++, b));
    known.add(slug);
  }

  const bySlug = new Map(services.map((s) => [s.slug, s]));

  const categories: CategoryView[] = CATEGORIES.map((def) => {
    const own = services.filter((s) => s.category === def.id);
    const crossed = CROSS_LISTINGS.filter((c) => c.category === def.id)
      .flatMap((c): ServiceView[] => {
        const ref = bySlug.get(c.ref);
        return ref ? [{ ...ref, subgroup: c.subgroup }] : [];
      });
    const list = [...own, ...crossed].sort(liveFirst);
    return { def, services: list, liveCount: list.filter((s) => s.status === "live").length };
  });

  return {
    categories,
    services,
    bySlug,
    liveCount: services.filter((s) => s.status === "live").length,
  };
}

/* ------------------------------------------------------------------ */
/* Path resolution for /services/[...path]                             */
/* ------------------------------------------------------------------ */

export type ResolvedPath =
  | { kind: "category"; category: CategoryView }
  | { kind: "audience"; category: CategoryView; audience: (typeof AUDIENCES)[number] }
  | { kind: "service"; service: ServiceView; category: CategoryView }
  | { kind: "redirect"; to: string }
  | { kind: "not-found" };

export function resolveServicesPath(catalog: Catalog, segments: string[]): ResolvedPath {
  const [a, b, c, ...rest] = segments.map((s) => decodeURIComponent(s).toLowerCase());
  if (!a || rest.length) return { kind: "not-found" };
  const categoryOf = (id: CategoryId) => catalog.categories.find((x) => x.def.id === id)!;
  const cat = catalog.categories.find((x) => x.def.id === a);

  if (!cat) {
    // Legacy / backend-slug URLs such as /services/deep-cleaning → canonical page.
    if (b) return { kind: "not-found" };
    const svc =
      catalog.bySlug.get(a) ?? catalog.services.find((s) => s.def.bind?.includes(a));
    return svc ? { kind: "redirect", to: svc.href } : { kind: "not-found" };
  }

  if (!b) return { kind: "category", category: cat };

  if (cat.def.id === "beauty") {
    const audience = AUDIENCES.find((x) => x.id === b);
    if (audience && !c) return { kind: "audience", category: cat, audience };
    if (audience && c) {
      // Old one-record-per-audience URL → the canonical service, audience preselected.
      const svc = catalog.bySlug.get(LEGACY_BEAUTY_LEAF[c] ?? c);
      return svc && svc.category === "beauty" && svc.audiences.includes(audience.id)
        ? { kind: "redirect", to: `${svc.href}?for=${audience.id}` }
        : { kind: "not-found" };
    }
  }
  if (c) return { kind: "not-found" };

  const svc = catalog.bySlug.get(b);
  if (!svc) return { kind: "not-found" };
  // One page per service: cross-listed and audience services live at their canonical URL.
  const path = `/services/${a}/${b}`;
  if (svc.href !== path) return { kind: "redirect", to: svc.href };
  return { kind: "service", service: svc, category: categoryOf(svc.category) };
}

/**
 * Every path /services/[...path] answers: canonical pages AND the legacy or
 * cross-listed URLs that redirect to them. Anything outside this list is a 404.
 */
export function allServicePaths(catalog: Catalog): string[] {
  const paths = new Set<string>();
  for (const c of catalog.categories) paths.add(categoryHref(c.def.id));
  for (const a of AUDIENCES) paths.add(audienceHref(a.id));
  for (const s of catalog.services) {
    paths.add(s.href);
    // /services/<slug> and /services/<backend-slug> → canonical page.
    paths.add(`/services/${s.slug}`);
    for (const b of s.def.bind ?? []) paths.add(`/services/${b}`);
    // Old one-record-per-audience beauty URLs.
    if (s.category === "beauty") for (const a of s.audiences) paths.add(`/services/beauty/${a}/${s.slug}`);
  }
  for (const [leaf, target] of Object.entries(LEGACY_BEAUTY_LEAF)) {
    const svc = catalog.bySlug.get(target);
    if (svc) for (const a of svc.audiences) paths.add(`/services/beauty/${a}/${leaf}`);
  }
  for (const c of CROSS_LISTINGS) paths.add(`/services/${c.category}/${c.ref}`);
  // Only keep paths that actually resolve (no accidental 200s for junk).
  return [...paths].filter((p) => {
    const segs = p.replace(/^\/services\//, "").split("/");
    return resolveServicesPath(catalog, segs).kind !== "not-found";
  });
}

/**
 * Legacy / cross-listed URL → canonical URL. Served by next.config.js
 * `redirects()` (a real 308 from the routing layer, before any render), from
 * the generated `service-redirects.json`. Taxonomy-only input keeps it
 * deterministic; `catalog-redirects.test.ts` fails if the file drifts.
 */
export function serviceRedirects(catalog: Catalog): { source: string; destination: string }[] {
  return allServicePaths(catalog)
    .map((p) => ({ p, r: resolveServicesPath(catalog, p.replace(/^\/services\//, "").split("/")) }))
    .flatMap(({ p, r }) => (r.kind === "redirect" ? [{ source: p, destination: r.to }] : []))
    .sort((a, b) => a.source.localeCompare(b.source));
}
