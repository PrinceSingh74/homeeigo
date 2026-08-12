export type BookParams = {
  service?: string;
  package?: number;
  promo?: string;
  coupon?: string;
  campaign?: string;
  q?: string;
};

export function bookUrl(params: BookParams = {}): string {
  const sp = new URLSearchParams();
  if (params.service) sp.set("service", params.service);
  if (params.package !== undefined) sp.set("package", String(params.package));
  const couponCode = params.promo ?? params.coupon ?? params.campaign;
  if (couponCode) sp.set("promo", couponCode);
  if (params.q) sp.set("q", params.q);
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
} {
  const serviceId = searchParams.get("service");
  const pkg = searchParams.get("package");
  return {
    serviceId,
    packageIndex: pkg !== null && pkg !== "" ? Number(pkg) : null,
    promo: resolveBookCouponCode(searchParams),
    query: searchParams.get("q") ?? "",
  };
}

export function generateBookingId(): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `HMG-${n}`;
}
