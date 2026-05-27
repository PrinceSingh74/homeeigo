export type BookParams = {
  service?: string;
  package?: number;
  promo?: string;
  q?: string;
};

export function bookUrl(params: BookParams = {}): string {
  const sp = new URLSearchParams();
  if (params.service) sp.set("service", params.service);
  if (params.package !== undefined) sp.set("package", String(params.package));
  if (params.promo) sp.set("promo", params.promo);
  if (params.q) sp.set("q", params.q);
  const qs = sp.toString();
  return qs ? `/book?${qs}` : "/book";
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
    promo: searchParams.get("promo"),
    query: searchParams.get("q") ?? "",
  };
}

export function generateBookingId(): string {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `HMG-${n}`;
}
