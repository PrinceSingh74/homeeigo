import { tierOptions } from "@/lib/catalog/pricing";
import type { Service } from "@/lib/services";
import type { BackendService } from "@/types/backend";

/**
 * The booking page's view of a catalogue service.
 *
 * Everything commercial — name, description, price, tiers, rating, review count, featured flag — is
 * the API record's, or absent. The built-in list (lib/services) may lend presentation only: a
 * colour, an icon and a picture. It is chosen by list position, so it is usually a different
 * service; its price, tagline, "homes served" line, package contents and flags never apply.
 */

/** What a service may borrow from a built-in entry. */
export type ServicePresentation = Pick<Service, "color" | "icon" | "img">;

/** Used when there is no built-in entry to borrow from (every production build). */
export const NEUTRAL_PRESENTATION: ServicePresentation = { color: "#7C3AED" };

/**
 * Exactly the tiers the server prices (resolvePackagePrice: min / base / max, exact values only).
 * Not base × 1.35 when maxPrice is unset — the server refuses that price — and no per-tier feature
 * claims the service does not actually configure. A service the API gives no price has no tier,
 * rather than a ₹0 one.
 */
export function packagesFromApi(api: BackendService): Service["packages"] {
  const base = api.basePrice ?? api.minPrice;
  if (base == null) return [];
  const min = api.minPrice ?? base;
  const max = api.maxPrice ?? Math.max(base, min);
  return tierOptions({ base, min, max }).map((t) => ({
    name: t.name,
    tag: "",
    price: t.price,
    items: [],
    tierIndex: t.index,
  }));
}

export function toUiService(api: BackendService, presentation: ServicePresentation = NEUTRAL_PRESENTATION): Service {
  const priceFrom = api.basePrice ?? api.minPrice ?? null;
  const rated = api.rating != null && api.rating > 0 && (api.reviewCount ?? 0) > 0;
  return {
    id: api.id,
    slug: api.slug,
    name: api.name,
    title: api.name,
    tagline: api.description ?? "",
    priceFrom: priceFrom ?? 0,
    // Empty, not "₹0": the page prints "From …" only when there is a price to print.
    price: priceFrom != null ? `₹${priceFrom}` : "",
    packages: packagesFromApi(api),
    rating: rated ? String(api.rating) : "",
    reviews: rated ? String(api.reviewCount) : "",
    homes: "",
    keywords: [],
    featured: api.isFeatured === true,
    color: presentation.color,
    icon: presentation.icon,
    img: api.thumbnail ?? api.icon ?? presentation.img,
  };
}
