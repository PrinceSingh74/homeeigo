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

export function mapBackendServiceToMobile(service: BackendService): Service {
  const key = categoryKey(service);
  const base = service.basePrice ?? service.minPrice ?? 199;
  const rating = service.rating ?? 4.8;
  const reviews = service.reviewCount ?? 0;

  return {
    id: service.id,
    name: service.name,
    imageKey: CATEGORY_IMAGE[key] ?? "cleaning",
    price: `₹${base}`,
    priceFrom: base,
    color: CATEGORY_COLORS[key] ?? "#7C3AED",
    title: service.name,
    tagline: service.description ?? "Professional home service by verified experts.",
    rating: rating.toFixed(1),
    reviews: reviews >= 1000 ? `${(reviews / 1000).toFixed(1)}k` : String(reviews),
    homes: service.bookingCount ? `${service.bookingCount}+ bookings` : "Trusted by Homeeigo users",
    featured: service.isFeatured,
    keywords: [service.name, service.category ?? "", service.slug ?? ""].filter(Boolean),
    packages: [
      {
        name: "Standard",
        tag: "Most popular",
        price: base,
        popular: true,
        items: ["Verified professional", "Quality check", "Support included"],
      },
      {
        name: "Premium",
        tag: "Extended care",
        price: Math.round(base * 1.4),
        items: ["Priority scheduling", "Extended warranty", "Premium support"],
      },
    ],
  };
}

export function mapBackendServices(services: BackendService[]): Service[] {
  return services.map(mapBackendServiceToMobile);
}
