export type ServicePackage = {
  name: string;
  tag: string;
  price: number;
  popular?: boolean;
  items: string[];
};

export type Service = {
  id: string;
  name: string;
  imageKey?: string;
  iconKey?: "scissors";
  price: string;
  priceFrom: number;
  color: string;
  title: string;
  tagline: string;
  rating: string;
  reviews: string;
  homes: string;
  packages: ServicePackage[];
  keywords: string[];
  featured?: boolean;
  /** Backend category (for serviceability checks). */
  category?: string;
  /** Quantity-priced service (server prices quantity × unit; package tiers do not apply). */
  quantityRule?: { min: number; max?: number; step?: number; default?: number; unitLabel?: string } | null;
  audiences?: string[];
  variants?: { id: string; name: string; price: number; audiences?: string[] }[];
  /** This service's own add-on catalogue; absent → no client-side add-on list. */
  addons?: { id: string; name: string; desc: string; price: number }[];
  /** Admin marked it "coming soon" — not bookable. */
  comingSoon?: boolean;
};

export const LOCATIONS = [
  { id: "gurugram-49", label: "Gurugram, Sector 49", city: "Gurugram", pin: "122018" },
  { id: "gurugram-56", label: "Gurugram, Sector 56", city: "Gurugram", pin: "122011" },
  { id: "delhi-saket", label: "Delhi, Saket", city: "New Delhi", pin: "110017" },
  { id: "noida-62", label: "Noida, Sector 62", city: "Noida", pin: "201309" },
] as const;

export type LocationId = (typeof LOCATIONS)[number]["id"];

/**
 * Search-only keyword index (query → service slug). It deliberately carries NO prices, ratings,
 * review counts or "homes served" numbers: the old static catalogue shipped invented figures
 * ("4.8", "12.5k" reviews, "12K+ homes cleaned") that could reach customers as if real. Every
 * displayed service — price, rating, packages — comes from the backend catalogue
 * (useCatalogServices → mapBackendServiceToMobile).
 */
export const SERVICE_SEARCH_INDEX: ReadonlyArray<{ id: string; name: string; title: string; keywords: string[] }> = [
  { id: "cleaning", name: "Cleaning", title: "Home Cleaning", keywords: ["clean", "cleaning", "deep clean", "home", "sofa", "kitchen"] },
  { id: "ac-service", name: "AC Service", title: "AC Service & Repair", keywords: ["ac", "air conditioner", "cooling", "gas"] },
  { id: "plumbing", name: "Plumbing", title: "Plumbing Services", keywords: ["plumber", "plumbing", "leak", "tap"] },
  { id: "electrician", name: "Electrician", title: "Electrician Services", keywords: ["electric", "electrician", "wiring", "fan"] },
  { id: "pest-control", name: "Pest Control", title: "Pest Control", keywords: ["pest", "cockroach", "termite"] },
  { id: "salon", name: "Salon", title: "Salon at Home", keywords: ["salon", "haircut", "facial", "spa"] },
];

export const BOOKING_TIMES = [
  "09:00 AM",
  "11:00 AM",
  "01:00 PM",
  "03:00 PM",
  "05:00 PM",
  "07:00 PM",
];

export function popularPackageIndex(service: Service) {
  const p = service.packages.findIndex((x) => x.popular);
  return p === -1 ? 0 : p;
}

export function getLocation(id: LocationId) {
  return LOCATIONS.find((l) => l.id === id) ?? LOCATIONS[0];
}

