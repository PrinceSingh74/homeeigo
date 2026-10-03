import type { BackendService } from "@/types/backend";
import type { Service } from "@/lib/services";

const CATEGORY_COLORS: Record<string, string> = {
  cleaning: "#7C3AED",
  ac: "#06B6D4",
  plumbing: "#2563EB",
  electrical: "#F59E0B",
  painting: "#EC4899",
  pest: "#10B981",
};

const CATEGORY_IMAGE: Record<string, string> = {
  cleaning: "cleaning",
  ac: "ac",
  plumbing: "plumbing",
  electrical: "electrical",
  painting: "painting",
  pest: "pest",
};

function categoryKey(service: BackendService): string {
  const raw = (service.category ?? service.slug ?? service.name ?? "").toLowerCase();
  if (raw.includes("clean")) return "cleaning";
  if (raw.includes("ac") || raw.includes("air")) return "ac";
  if (raw.includes("plumb")) return "plumbing";
  if (raw.includes("electr")) return "electrical";
  if (raw.includes("paint")) return "painting";
  if (raw.includes("pest")) return "pest";
  return "cleaning";
}

/**
 * Package tiers exactly as the backend prices them (min / base / max — resolvePackagePrice accepts
 * only these), in the same order and naming as the web tierOptions. Nothing is invented: the old
 * "Premium" was base × 1.4 with "Extended warranty" / "Premium support" claims no service offers,
 * and the server now refuses a price that is not a configured tier.
 */
export function packageTiers(service: Pick<BackendService, "basePrice" | "minPrice" | "maxPrice">) {
  const base = service.basePrice ?? service.minPrice ?? 0;
  const min = service.minPrice ?? base;
  const max = service.maxPrice ?? Math.max(base, min);
  const tiers = [
    { name: "Basic", tag: "Essentials", price: min },
    { name: "Standard", tag: "Most popular", price: base, popular: true },
    { name: "Premium", tag: "Most thorough", price: max },
  ];
  const seen = new Set<number>();
  // Standard claims its price first, so a min == base service shows "Standard", not "Basic".
  const out: Array<(typeof tiers)[number]> = [];
  for (const i of [1, 0, 2]) {
    const t = tiers[i]!;
    if (t.price <= 0 || seen.has(t.price)) continue;
    seen.add(t.price);
    out.push(t);
  }
  return out
    .sort((a, b) => a.price - b.price)
    .map((t) => ({ name: t.name, tag: t.tag, price: t.price, popular: t.popular, items: [] as string[] }));
}

export function mapBackendServiceToMobile(service: BackendService): Service {
  const key = categoryKey(service);
  const base = service.basePrice ?? service.minPrice ?? 0;
  const reviews = service.reviewCount ?? 0;
  // Only a real review aggregate is shown; otherwise "New" — never a placeholder score.
  const rating = service.rating != null && service.rating > 0 && reviews > 0 ? service.rating.toFixed(1) : "New";

  return {
    id: service.id,
    name: service.name,
    imageKey: CATEGORY_IMAGE[key] ?? "cleaning",
    price: `₹${base}`,
    priceFrom: base,
    color: CATEGORY_COLORS[key] ?? "#7C3AED",
    title: service.name,
    tagline: service.description ?? "Professional home service by verified experts.",
    rating,
    reviews: reviews >= 1000 ? `${(reviews / 1000).toFixed(1)}k` : String(reviews),
    homes: service.bookingCount ? `${service.bookingCount}+ bookings` : "Trusted by Homeeigo users",
    featured: service.isFeatured,
    keywords: [service.name, service.category ?? "", service.slug ?? ""].filter(Boolean),
    packages: packageTiers(service),
    category: service.category,
    quantityRule: service.catalogConfig?.quantity
      ? {
          min: service.catalogConfig.quantity.min,
          max: service.catalogConfig.quantity.max,
          step: service.catalogConfig.quantity.step,
          default: service.catalogConfig.quantity.default,
          unitLabel: service.catalogConfig.quantity.unitLabel,
        }
      : null,
    audiences: service.catalogConfig?.audiences?.length ? [...service.catalogConfig.audiences] : undefined,
    variants: service.catalogConfig?.variants
      ? service.catalogConfig.variants
          .filter((v) => v.active)
          .map((v) => ({ id: v.id, name: v.name, price: v.price, audiences: v.audiences }))
      : undefined,
    // Only the server's own add-ons (it rejects any id that is not in the service's catalogue).
    addons: service.catalogConfig?.addons
      ? service.catalogConfig.addons
          .filter((a) => a.active)
          .map((a) => ({ id: a.id, name: a.name, desc: "", price: a.price }))
      : undefined,
    comingSoon: service.catalogConfig?.comingSoon === true,
  };
}

export function mapBackendServices(services: BackendService[]): Service[] {
  return services.map(mapBackendServiceToMobile);
}
