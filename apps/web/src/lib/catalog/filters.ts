import { AUDIENCES, BEAUTY_TYPES, CATEGORY_BY_ID } from "@/lib/catalog/taxonomy";
import { PRICING_MODEL_LABEL } from "@/lib/catalog/pricing";
import type { Audience, BeautyType, PricingModel, ServiceView } from "@/lib/catalog/types";

export type SortKey = "recommended" | "popular" | "price-asc" | "price-desc" | "duration";

/** Only sorts backed by real data. No "newest" or "fastest availability" — the API has neither. */
export const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "recommended", label: "Recommended" },
  { id: "popular", label: "Popular" },
  { id: "price-asc", label: "Price: Low to High" },
  { id: "price-desc", label: "Price: High to Low" },
  { id: "duration", label: "Shortest duration" },
];

export type PriceBand = "under-300" | "300-700" | "over-700";
export type DurationBand = "under-45" | "45-90" | "over-90";

export type FilterState = {
  sort: SortKey;
  status?: "live" | "coming-soon";
  models: PricingModel[];
  price?: PriceBand;
  duration?: DurationBand;
  popular: boolean;
  subgroup?: string;
  audience?: Audience;
  beautyType?: BeautyType;
};

export const EMPTY_FILTERS: FilterState = { sort: "recommended", models: [], popular: false };

const PRICE_BANDS: { id: PriceBand; label: string; test: (p: number) => boolean }[] = [
  { id: "under-300", label: "Under ₹300", test: (p) => p < 300 },
  { id: "300-700", label: "₹300 – ₹700", test: (p) => p >= 300 && p <= 700 },
  { id: "over-700", label: "Over ₹700", test: (p) => p > 700 },
];

const DURATION_BANDS: { id: DurationBand; label: string; test: (m: number) => boolean }[] = [
  { id: "under-45", label: "Under 45 min", test: (m) => m < 45 },
  { id: "45-90", label: "45 – 90 min", test: (m) => m >= 45 && m <= 90 },
  { id: "over-90", label: "Over 90 min", test: (m) => m > 90 },
];

export type Option<T extends string> = { id: T; label: string; count: number };

export type FilterFacets = {
  status: Option<"live" | "coming-soon">[];
  models: Option<PricingModel>[];
  price: Option<PriceBand>[];
  duration: Option<DurationBand>[];
  popular: number;
  subgroups: Option<string>[];
  audiences: Option<Audience>[];
  beautyTypes: Option<BeautyType>[];
};

function tally<T extends string>(
  items: ServiceView[],
  key: (s: ServiceView) => T | undefined,
  label: (id: T) => string,
  order?: T[],
): Option<T>[] {
  const counts = new Map<T, number>();
  for (const s of items) {
    const k = key(s);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const ids = order ? order.filter((id) => counts.has(id)) : [...counts.keys()];
  return ids.map((id) => ({ id, label: label(id), count: counts.get(id)! }));
}

/**
 * Context-aware facets: a group appears only when it can actually narrow the
 * current set (two or more distinct values). Irrelevant filters never render.
 */
export function computeFacets(items: ServiceView[], categoryId?: string): FilterFacets {
  const live = items.filter((s) => s.status === "live");
  const keep = <T>(opts: T[]) => (opts.length >= 2 ? opts : []);
  const cat = categoryId ? CATEGORY_BY_ID.get(categoryId as never) : undefined;

  return {
    status: keep(
      tally(items, (s) => s.status, (id) => (id === "live" ? "Bookable now" : "Coming soon"), [
        "live",
        "coming-soon",
      ]),
    ),
    models: keep(
      tally(items, (s) => s.pricingModel, (id) => PRICING_MODEL_LABEL[id], Object.keys(
        PRICING_MODEL_LABEL,
      ) as PricingModel[]),
    ),
    price: keep(
      tally(
        live,
        (s) => (s.price ? PRICE_BANDS.find((b) => b.test(s.price!.base))?.id : undefined),
        (id) => PRICE_BANDS.find((b) => b.id === id)!.label,
        PRICE_BANDS.map((b) => b.id),
      ),
    ),
    duration: keep(
      tally(
        live,
        (s) => (s.durationMin ? DURATION_BANDS.find((b) => b.test(s.durationMin!))?.id : undefined),
        (id) => DURATION_BANDS.find((b) => b.id === id)!.label,
        DURATION_BANDS.map((b) => b.id),
      ),
    ),
    popular: live.filter((s) => s.popular).length,
    subgroups: cat?.subgroups && cat.id !== "beauty"
      ? keep(
          tally(
            items,
            (s) => s.subgroup,
            (id) => cat.subgroups!.find((g) => g.id === id)?.name ?? id,
            cat.subgroups.map((g) => g.id),
          ),
        )
      : [],
    // Multi-valued: a service counts once for every audience it is eligible for.
    audiences: keep(
      AUDIENCES.map((a) => ({ id: a.id, label: a.name, count: items.filter((s) => s.audiences.includes(a.id)).length }))
        .filter((o) => o.count > 0),
    ),
    beautyTypes: keep(
      tally(
        items,
        (s) => s.beautyType,
        (id) => BEAUTY_TYPES.find((t) => t.id === id)!.name,
        BEAUTY_TYPES.map((t) => t.id),
      ),
    ),
  };
}

export function applyFilters(items: ServiceView[], f: FilterState): ServiceView[] {
  const band = PRICE_BANDS.find((b) => b.id === f.price);
  const dur = DURATION_BANDS.find((b) => b.id === f.duration);
  return items.filter(
    (s) =>
      (!f.status || s.status === f.status) &&
      (!f.models.length || f.models.includes(s.pricingModel)) &&
      (!band || (s.price != null && band.test(s.price.base))) &&
      (!dur || (s.durationMin != null && dur.test(s.durationMin))) &&
      (!f.popular || s.popular) &&
      (!f.subgroup || s.subgroup === f.subgroup) &&
      (!f.audience || s.audiences.includes(f.audience)) &&
      (!f.beautyType || s.beautyType === f.beautyType),
  );
}

const liveRank = (s: ServiceView) => (s.status === "live" ? 0 : 1);

export function sortServices(items: ServiceView[], sort: SortKey): ServiceView[] {
  const list = [...items];
  const byOrder = (a: ServiceView, b: ServiceView) => liveRank(a) - liveRank(b) || a.order - b.order;
  switch (sort) {
    case "popular":
      return list.sort((a, b) => Number(b.popular) - Number(a.popular) || byOrder(a, b));
    case "price-asc":
    case "price-desc": {
      const dir = sort === "price-asc" ? 1 : -1;
      // Unpriced (coming soon / quote) services always sink to the end.
      return list.sort((a, b) =>
        a.price && b.price ? (a.price.base - b.price.base) * dir || byOrder(a, b) : a.price ? -1 : b.price ? 1 : byOrder(a, b),
      );
    }
    case "duration":
      return list.sort((a, b) =>
        a.durationMin && b.durationMin
          ? a.durationMin - b.durationMin || byOrder(a, b)
          : a.durationMin
            ? -1
            : b.durationMin
              ? 1
              : byOrder(a, b),
      );
    default:
      return list.sort(byOrder);
  }
}

export function activeFilterCount(f: FilterState): number {
  return (
    Number(Boolean(f.status)) +
    f.models.length +
    Number(Boolean(f.price)) +
    Number(Boolean(f.duration)) +
    Number(f.popular) +
    Number(Boolean(f.subgroup)) +
    Number(Boolean(f.audience)) +
    Number(Boolean(f.beautyType))
  );
}
