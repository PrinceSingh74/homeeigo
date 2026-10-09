import { describe, expect, test } from "bun:test";
import { servicePageMeta } from "../src/lib/catalog/service-meta";

const base = {
  name: "Deep clean",
  description: "A full home clean.",
  href: "/services/home/deep-clean",
  status: "live" as const,
  seoTitle: null as string | null,
  seoDescription: null as string | null,
  seoKeywords: null as string | null,
  indexable: true as boolean | undefined,
};

describe("service page metadata", () => {
  test("uses the stored title and description, and a canonical with no version", () => {
    const meta = servicePageMeta(
      { ...base, seoTitle: "Deep clean at home", seoDescription: "Book a deep clean.", seoKeywords: "deep clean, home" },
      "Home",
    );
    expect(meta.title).toBe("Deep clean at home");
    expect(meta.description).toBe("Book a deep clean.");
    expect(meta.canonical).toBe("/services/home/deep-clean");
    expect(meta.keywords).toEqual(["deep clean", "home"]);
    expect(meta.description).not.toMatch(/₹|verified|insured/i);
  });

  test("a coming-soon or noindex service is not indexable; an absent SEO title falls back to the name", () => {
    expect(servicePageMeta({ ...base, status: "coming-soon" }, "Home").index).toBe(false);
    expect(servicePageMeta({ ...base, indexable: false }, "Home").index).toBe(false);
    expect(servicePageMeta({ ...base, indexable: undefined }, "Home").index).toBe(true);
    expect(servicePageMeta(base, "Home").title).toBe("Deep clean — Home");
  });
});
