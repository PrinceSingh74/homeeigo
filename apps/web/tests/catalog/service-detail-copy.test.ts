import { describe, expect, it } from "bun:test";
import { buildCatalog } from "@/lib/catalog/adapter";
import { detailContent } from "@/lib/catalog/content";
import { SCOPE_COPY_SLUGS } from "@/lib/catalog/copy";
import { CATEGORY_FAQS, SCOPE_COPY } from "@/lib/catalog/service-detail-copy";

/**
 * Detail-page copy lives in service-detail-copy.ts so the /services hub bundle does not carry it
 * (2026-10-01). These tests keep the split honest: the catalog's knowledge of WHICH services have
 * scope copy (fallbackApproved) must match the data, and the detail page must still show it.
 * The split itself was proven equivalent on all 114 services' detail content before landing.
 */
describe("service detail copy split", () => {
  it("SCOPE_COPY_SLUGS is exactly the set of services with scope copy", () => {
    const withScope = Object.entries(SCOPE_COPY)
      .filter(([, c]) => Boolean(c.includes?.length || c.excludes?.length))
      .map(([slug]) => slug)
      .sort();
    expect([...SCOPE_COPY_SLUGS].sort()).toEqual(withScope);
  });

  it("the detail page still shows a service's scope copy and its category FAQs", () => {
    const catalog = buildCatalog([]);
    const svc = catalog.services.find((s) => SCOPE_COPY_SLUGS.has(s.slug) && s.def.fallbackApproved);
    expect(svc).toBeDefined();
    const content = detailContent(svc!, null);
    const expected = SCOPE_COPY[svc!.slug]!;
    expect(content.scope?.includes ?? []).toEqual(svc!.def.includes ?? expected.includes ?? []);
    const categoryFaqs = CATEGORY_FAQS[svc!.category] ?? [];
    for (const faq of categoryFaqs) expect(content.faqs).toContainEqual(faq);
  });
});
