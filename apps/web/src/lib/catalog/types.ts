import type { LucideIcon } from "lucide-react";
import type { PublicCatalogConfig, QuantityRule } from "@/types/backend";

/**
 * Customer-facing service catalogue schema.
 *
 * Two layers:
 *   1. Definitions (taxonomy.ts) — editorial structure: which categories and
 *      services exist, how they are named, grouped, searched and routed.
 *   2. Live data (GET /api/services) — the source of truth for price, duration,
 *      active status, description, popularity and images.
 *
 * `buildCatalog()` merges the two. A definition with no active backend record
 * is "coming-soon" (Notify me); once an admin activates a backend service with
 * a bound slug it becomes bookable with no frontend change.
 */

export type PricingModel =
  | "hourly"
  | "fixed"
  | "per-unit"
  | "per-seat"
  | "area"
  | "package"
  | "inspection"
  | "quote";

export type CategoryId =
  | "home-help"
  | "home-cleaning"
  | "event-occasion"
  | "home-maintenance"
  | "appliance-care"
  | "specialized-care"
  | "laundry-fabric"
  | "vehicle-care"
  | "beauty"
  | "senior-care"
  | "pet-care"
  | "executive-concierge"
  | "special-services";

export type Audience = "women" | "men" | "girls" | "boys" | "senior-women" | "senior-men";

export type BeautyType =
  | "hair"
  | "skin"
  | "waxing"
  | "nails"
  | "makeup"
  | "grooming"
  | "spa"
  | "bridal";

export type CategoryTreatment = "default" | "beauty" | "senior" | "pet" | "executive" | "future";

export type Faq = { q: string; a: string };

export type CategoryDef = {
  id: CategoryId;
  name: string;
  /** Pill label in the category rail. */
  shortName: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  /** Accent hex used for icon tints only — surfaces stay neutral. */
  tone: string;
  treatment: CategoryTreatment;
  subgroups?: { id: string; name: string }[];
  /** Backend `category` values that fall back into this category. */
  backendCategories?: string[];
  /** Shown on a category's coming-soon services. */
  planned?: string[];
  /** Deprecated (Phase 06): no longer rendered — preparation comes only from backend requirements. */
  prepare?: string[];
  faqs?: Faq[];
  /** Category-wide note, e.g. "non-medical assistance only". */
  notice?: string;
};

export type ServiceDef = {
  /** Public URL slug — unique across the catalogue. */
  slug: string;
  name: string;
  category: CategoryId;
  subgroup?: string;
  /** Backend `slug` values that make this service live. First active match wins. */
  bind?: string[];
  /** Fallback description when the backend has none. */
  short: string;
  pricingModel: PricingModel;
  /** Unit noun for per-unit / per-seat pricing, e.g. "bathroom". */
  unit?: string;
  aliases?: string[];
  icon?: LucideIcon;
  /** Curated image; overrides the name-matched visual. */
  image?: string;
  /**
   * Draft scope copy. Rendered ONLY when `fallbackApproved` is true; otherwise the
   * page shows backend content or "Details will be confirmed during booking".
   */
  includes?: string[];
  excludes?: string[];
  /** Set true once the business has reviewed includes/excludes for this service. */
  fallbackApproved?: boolean;
  /** Deprecated (Phase 06): no longer rendered — preparation comes only from backend requirements. */
  prepare?: string[];
  faqs?: Faq[];
  /** Planned options shown while coming soon. */
  planned?: string[];
  /** Offer the server-authoritative booking add-ons on this service. */
  addons?: boolean;
  /** Add-on ids that make no sense for this service (e.g. fridge on Fridge Cleaning). */
  excludeAddons?: string[];
  /** Hourly booking mode (hours × rate) instead of tier selection. */
  hourly?: boolean;
  /** Default audience eligibility; the backend config overrides it once configured. */
  audiences?: Audience[];
  beautyType?: BeautyType;
};

/** A service listed in a second category. Always links to the canonical page. */
export type CrossListing = { ref: string; category: CategoryId; subgroup?: string };

/**
 * live         — active backend record with a price, bookable.
 * coming-soon  — no active backend record, or the admin flagged it as coming soon.
 * (Hidden/internal backend records never become ServiceViews at all.)
 * Configuration gaps on a live service are listed in `gaps`, not hidden behind "soon".
 */
export type ServiceStatus = "live" | "coming-soon";

export type Variant = NonNullable<PublicCatalogConfig["variants"]>[number];
export type Addon = { id: string; name: string; price: number; durationMin?: number; desc?: string };

export type PriceInfo = { base: number; min: number; max: number };

export type ServiceView = {
  slug: string;
  name: string;
  category: CategoryId;
  subgroup?: string;
  description: string;
  href: string;
  status: ServiceStatus;
  /** Backend id — used for /book?service=… and the detail fetch. */
  backendId?: string;
  pricingModel: PricingModel;
  unit?: string;
  price?: PriceInfo;
  durationMin?: number;
  image?: string;
  icon: LucideIcon;
  tone: string;
  popular: boolean;
  premiumOnly: boolean;
  /** Effective eligibility (backend config, else catalogue default). */
  audiences: Audience[];
  beautyType?: BeautyType;
  hourly: boolean;
  /** Public backend configuration (null when none). */
  config: PublicCatalogConfig | null;
  quantity?: QuantityRule;
  /** Server-resolved service-line price per quantity — clients never multiply prices. */
  quantityPrices: { quantity: number; servicePrice: number }[] | null;
  variants: Variant[];
  /** Real aggregate, only when backed by reviews (list endpoint). */
  rating: { value: number; count: number } | null;
  /** Missing configuration on a live service — for admin/dev audits, never shown to customers. */
  gaps: string[];
  /** Stable position in the editorial order — the "Recommended" sort. */
  order: number;
  searchText: string;
  def: ServiceDef;
};

export type CategoryView = {
  def: CategoryDef;
  /** Canonical services plus cross-listings, editorial order. */
  services: ServiceView[];
  liveCount: number;
};

export type Catalog = {
  categories: CategoryView[];
  /** Every canonical service once (no cross-listing duplicates). */
  services: ServiceView[];
  bySlug: Map<string, ServiceView>;
  liveCount: number;
};
