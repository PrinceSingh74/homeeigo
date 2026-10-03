export type BookParams = {
  service?: string;
  package?: number;
  promo?: string;
  coupon?: string;
  campaign?: string;
  q?: string;
  /** Pre-selected add-on ids (server-authoritative catalogue). */
  addons?: string[];
  /** Pre-filled booking instructions, e.g. hourly tasks chosen on the service page. */
  notes?: string;
  /** Selection ids + quantity only — the server prices them. Never a price. */
  variant?: string;
  quantity?: number;
  audience?: string;
  preference?: string;
};

/** Longest instructions prefill carried in a URL. */
const MAX_NOTES = 400;

export function bookUrl(params: BookParams = {}): string {
  const sp = new URLSearchParams();
  if (params.service) sp.set("service", params.service);
  if (params.package !== undefined) sp.set("package", String(params.package));
  const couponCode = params.promo ?? params.coupon ?? params.campaign;
  if (couponCode) sp.set("promo", couponCode);
  if (params.q) sp.set("q", params.q);
  if (params.variant) sp.set("variant", params.variant);
  if (params.quantity != null) sp.set("quantity", String(params.quantity));
  if (params.audience) sp.set("for", params.audience);
  if (params.preference) sp.set("pref", params.preference);
  if (params.addons?.length) sp.set("addons", params.addons.join(","));
  if (params.notes?.trim()) sp.set("notes", params.notes.trim().slice(0, MAX_NOTES));
  const qs = sp.toString();
  return qs ? `/book?${qs}` : "/book";
}

/** First non-empty coupon-like query param (promo, coupon, or campaign). */
export function resolveBookCouponCode(searchParams: URLSearchParams): string | null {
  for (const key of ["promo", "coupon", "campaign"] as const) {
    const value = searchParams.get(key)?.trim();
    if (value) return value;
  }
  return null;
}

export function parseBookParams(searchParams: URLSearchParams): {
  serviceId: string | null;
  packageIndex: number | null;
  promo: string | null;
  query: string;
  addons: string[];
  notes: string;
  variant: string | null;
  quantity: number | null;
  audience: string | null;
  preference: string | null;
} {
  const serviceId = searchParams.get("service");
  const pkg = searchParams.get("package");
  return {
    serviceId,
    packageIndex: pkg !== null && pkg !== "" ? Number(pkg) : null,
    promo: resolveBookCouponCode(searchParams),
    query: searchParams.get("q") ?? "",
    addons: (searchParams.get("addons") ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
    notes: (searchParams.get("notes") ?? "").slice(0, MAX_NOTES),
    variant: searchParams.get("variant")?.trim() || null,
    quantity: parseQuantity(searchParams.get("quantity")),
    audience: searchParams.get("for")?.trim() || null,
    preference: searchParams.get("pref")?.trim() || null,
  };
}

/** A positive integer, or null — anything else is dropped (the server validates the range). */
function parseQuantity(raw: string | null): number | null {
  if (!raw || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

export function generateBookingId(): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `HMG-${n}`;
}
