import type { BackendService } from "@/types/backend";
import type { MarketplaceService } from "@/lib/services-marketplace-data";

/**
 * The live catalogue grouped into the marketplace sections, by the `subcategory` the admin panel
 * manages. Everything here is the API record's: a service with no price, duration, rating or flag
 * has none. There is no built-in list behind it — an empty or failed catalogue is empty sections,
 * and the page says so instead of showing services and prices nobody configured.
 */

const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=1200&q=90&auto=format&fit=crop";

function formatDuration(s: BackendService): string {
  if (s.durationRange) return s.durationRange;
  const mins = s.estimatedDuration;
  if (mins == null || mins <= 0) return "";
  if (mins >= 60 * 24) return `${Math.round(mins / 60)} hrs`;
  if (mins >= 120) return `${(mins / 60).toFixed(1).replace(/\.0$/, "")} hrs`;
  return `${mins} mins`;
}

export function toMarketplaceService(s: BackendService): MarketplaceService {
  const price = s.basePrice ?? s.minPrice ?? null;
  return {
    id: s.slug ?? s.id,
    slug: s.slug,
    name: s.name,
    image: s.thumbnail ?? s.icon ?? DEFAULT_IMAGE,
    duration: formatDuration(s),
    // Real aggregate only; no reviews → null (never a curated or placeholder number).
    rating: s.rating != null && s.rating > 0 && (s.reviewCount ?? 0) > 0 ? Number(s.rating.toFixed(1)) : null,
    price: price != null && price > 0 ? `₹${price} onwards` : "",
    priceValue: price != null && price > 0 ? price : undefined,
    // The catalogue's own flags, named for what they are. `isFeatured` is an editorial flag, not
    // a booking count, so it reads "Featured".
    badge: s.isPopular ? "Popular" : s.isFeatured ? "Featured" : undefined,
    // Real catalog cuid — the /book page matches on service.id from the API.
    serviceId: s.id,
  };
}

export type MarketplaceSectionLists = {
  homeCare: MarketplaceService[];
  premiumCare: MarketplaceService[];
  laundry: MarketplaceService[];
  outdoor: MarketplaceService[];
  express: MarketplaceService[];
};

export function groupMarketplaceSections(services: BackendService[]): MarketplaceSectionLists {
  const by = (sub: string) => services.filter((s) => s.subcategory === sub).map(toMarketplaceService);
  return {
    homeCare: by("home-care"),
    premiumCare: by("premium-care"),
    laundry: by("laundry"),
    outdoor: by("outdoor"),
    express: by("express"),
  };
}
