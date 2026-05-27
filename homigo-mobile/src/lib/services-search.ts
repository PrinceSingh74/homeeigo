import { SERVICES } from "./services";
import {
  CATEGORIES,
  TRENDING_SERVICES,
  type TrendingService,
} from "@/constants/servicesData";

export function resolveServiceIdFromQuery(query: string): string {
  const q = query.trim().toLowerCase();
  if (!q) return "cleaning";

  const direct = SERVICES.find(
    (s) =>
      s.id === q ||
      s.name.toLowerCase().includes(q) ||
      s.title.toLowerCase().includes(q) ||
      s.keywords.some((k) => k.includes(q) || q.includes(k)),
  );
  if (direct) return direct.id;

  const trending = TRENDING_SERVICES.find((t) =>
    t.title.toLowerCase().includes(q),
  );
  if (trending) return trending.serviceId;

  const category = CATEGORIES.find((c) => c.name.toLowerCase().includes(q));
  if (category) return category.serviceId;

  if (q.includes("ac") || q.includes("cool")) return "ac-service";
  if (q.includes("plumb") || q.includes("pipe") || q.includes("leak"))
    return "plumbing";
  if (q.includes("electric") || q.includes("wiring")) return "electrician";
  if (q.includes("clean") || q.includes("sofa")) return "cleaning";
  if (q.includes("pest")) return "pest-control";
  if (q.includes("salon") || q.includes("spa")) return "salon";

  return "cleaning";
}

export function filterTrendingServices(
  list: TrendingService[],
  searchQuery: string,
  categoryId: number | null,
  popularSearch: string | null,
): TrendingService[] {
  let out = list;
  if (categoryId != null) {
    out = out.filter((s) => s.categoryIds.includes(categoryId));
  }
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.serviceId.toLowerCase().includes(q),
    );
  }
  if (popularSearch) {
    const p = popularSearch.toLowerCase();
    const filtered = out.filter((s) =>
      s.title.toLowerCase().includes(p.split(" ")[0] ?? p),
    );
    if (filtered.length > 0) out = filtered;
  }
  return out.length > 0 ? out : list;
}
