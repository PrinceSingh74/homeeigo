import { describe, expect, test } from "bun:test";
import { buildCatalog } from "../src/lib/catalog/adapter";
import { assembleCatalog, catalogPageCount, mergeServicePages } from "../src/lib/catalog/service-pages";
import { servicePageMeta } from "../src/lib/catalog/service-meta";
import type { BackendService } from "../src/types/backend";

function filler(n: number): BackendService {
  return { id: `filler-${n}`, name: `Fixture ${n}`, slug: `fixture-${n}`, basePrice: 100 };
}

const bathroom: BackendService = {
  id: "bath",
  name: "Bathroom Cleaning",
  slug: "bathroom-cleaning",
  basePrice: 399,
  indexable: true,
};

describe("catalogue pages past 100", () => {
  test("page count follows the reported total, not the first page", () => {
    expect(catalogPageCount({ services: Array.from({ length: 100 }, (_, i) => filler(i)), total: 101, limit: 100 })).toBe(2);
    expect(catalogPageCount({ services: [bathroom], total: 1, limit: 100 })).toBe(1);
  });

  test("a failed later page is an unknown catalogue, not a truncated one", () => {
    const page1 = { services: [filler(1)], total: 101, limit: 100 };
    expect(assembleCatalog([page1, null])).toBeNull();
    expect(assembleCatalog([null])).toBeNull();
  });

  test("a live service that sits past the first 100 stays indexable", () => {
    const page1 = { services: Array.from({ length: 100 }, (_, i) => filler(i)), total: 101, limit: 100 };
    const page2 = { services: [bathroom], total: 101, limit: 100 };
    const full = assembleCatalog([page1, page2])!;
    expect(full.services).toHaveLength(101);
    expect(mergeServicePages([page1, page1, page2]).filter((s) => s.id === "bath")).toHaveLength(1);

    const published = buildCatalog(full.services).bySlug.get("bathroom-cleaning")!;
    expect(published.status).toBe("live");
    expect(servicePageMeta(published, "Home Cleaning").index).toBe(true);

    // The bug: stopping after page 1 leaves the taxonomy row with no backend match,
    // so the same live service is rendered coming-soon and noindex.
    const truncated = buildCatalog(page1.services).bySlug.get("bathroom-cleaning")!;
    expect(truncated.status).toBe("coming-soon");
    expect(servicePageMeta(truncated, "Home Cleaning").index).toBe(false);
  });
});
