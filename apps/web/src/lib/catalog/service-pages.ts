/**
 * The public catalogue list is capped at 100 rows per page. Callers that decide
 * whether a service exists — sitemap, indexability, the route guard — have to
 * walk every page. A missing later page is an unknown catalogue, not an empty one:
 * treating it as empty marks live services coming-soon and noindex.
 */

export type ServiceListPage<T> = {
  services: T[];
  total: number;
  limit?: number;
};

const DEFAULT_PAGE_CAP = 20;

export function catalogPageCount(
  first: { total?: number; services: readonly unknown[]; limit?: number },
  cap = DEFAULT_PAGE_CAP,
): number {
  const limit = first.limit && first.limit > 0 ? first.limit : 100;
  const total = first.total && first.total > 0 ? first.total : first.services.length;
  if (limit <= 0) return 1;
  return Math.min(cap, Math.max(1, Math.ceil(total / limit)));
}

export function mergeServicePages<T extends { id: string }>(pages: Array<ServiceListPage<T>>): T[] {
  const seen = new Set<string>();
  const services: T[] = [];
  for (const page of pages) {
    for (const service of page.services) {
      if (seen.has(service.id)) continue;
      seen.add(service.id);
      services.push(service);
    }
  }
  return services;
}

/**
 * `null` when page 1 failed or any later page failed. A partial list is not returned:
 * the caller must fail open rather than decide a service is unpublished.
 */
export function assembleCatalog<T extends { id: string }>(
  pages: Array<ServiceListPage<T> | null>,
): { services: T[]; total: number } | null {
  const first = pages[0];
  if (!first) return null;
  if (pages.some((page) => page == null)) return null;
  const present = pages as Array<ServiceListPage<T>>;
  return { services: mergeServicePages(present), total: first.total };
}
