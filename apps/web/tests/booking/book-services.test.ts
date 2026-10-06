/**
 * The booking page's view of a catalogue service. Only presentation (colour, icon, picture) may come
 * from the built-in list; a price, tagline, rating, review count, "homes served" line, package
 * contents or featured flag must be the API's or absent. `toUiService` used to spread a built-in
 * entry — chosen by list position, so usually a different service — under the API record.
 *
 * Run from apps/web: `bun test tests/booking`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { packagesFromApi, toUiService } from "@/lib/book-services";
import type { Service } from "@/lib/services";
import type { BackendService } from "@/types/backend";

const STATIC: Service = {
  id: "plumbing",
  slug: "plumbing",
  name: "Plumbing",
  img: "/svc-plumbing.png",
  price: "₹249",
  priceFrom: 249,
  color: "#3B82F6",
  title: "Plumbing Services",
  tagline: "Leak-free homes by expert plumbers.",
  rating: "4.7",
  reviews: "7.8k",
  homes: "10K+ jobs done",
  featured: true,
  keywords: ["plumber"],
  packages: [{ name: "Standard", tag: "Full Repair", price: 449, popular: true, items: ["60-day Warranty"] }],
};

const api = (over: Partial<BackendService> = {}): BackendService => ({ id: "svc_1", name: "Sofa Shampoo", slug: "sofa-shampoo", ...over }) as BackendService;

describe("toUiService", () => {
  test("a service the API gives no description, price, rating or flag has none — not the built-in entry's", () => {
    const ui = toUiService(api(), STATIC);
    expect(ui.tagline).toBe("");
    expect(ui.price).toBe("");
    expect(ui.priceFrom).toBe(0);
    expect(ui.rating).toBe("");
    expect(ui.reviews).toBe("");
    expect(ui.homes).toBe("");
    expect(ui.featured).toBe(false);
    expect(ui.packages).toEqual([]);
    expect(JSON.stringify(ui)).not.toContain("Warranty");
  });

  test("presentation may come from the built-in entry", () => {
    const ui = toUiService(api(), STATIC);
    expect(ui.color).toBe("#3B82F6");
    expect(ui.img).toBe("/svc-plumbing.png");
    expect(toUiService(api({ thumbnail: "https://cdn/x.png" }), STATIC).img).toBe("https://cdn/x.png");
  });

  test("everything commercial is the API's", () => {
    const ui = toUiService(api({ description: "Deep shampoo for sofas.", basePrice: 599, minPrice: 499, maxPrice: 899, rating: 4.6, reviewCount: 12, isFeatured: false }), STATIC);
    expect(ui.name).toBe("Sofa Shampoo");
    expect(ui.tagline).toBe("Deep shampoo for sofas.");
    expect(ui.price).toBe("₹599");
    expect(ui.rating).toBe("4.6");
    expect(ui.reviews).toBe("12");
    expect(ui.packages.map((p) => [p.name, p.price, p.tierIndex])).toEqual([["Lowest price", 499, 0], ["Base price", 599, 1], ["Highest price", 899, 2]]);
  });

  test("a rating with no reviews behind it is not shown as a rating", () => {
    expect(toUiService(api({ rating: 5, reviewCount: 0 }), STATIC).rating).toBe("");
  });
});

describe("packagesFromApi", () => {
  test("tiers carry a name and the server's price — no tag, no contents, no popular flag", () => {
    for (const p of packagesFromApi(api({ basePrice: 300 }))) {
      expect(p.tag).toBe("");
      expect(p.items).toEqual([]);
      expect(p.popular).toBeUndefined();
    }
  });

  test("no price from the API means no tier, rather than a ₹0 one", () => {
    expect(packagesFromApi(api())).toEqual([]);
  });
});

describe("the booking page never falls back to the built-in catalogue", () => {
  const page = readFileSync(join(import.meta.dir, "..", "..", "src", "app", "book", "BookPageClient.tsx"), "utf8");

  test("no built-in service list is used as the list of services", () => {
    expect(/SERVICES\.length \? SERVICES/.test(page)).toBe(false);
    expect(page.includes("Live pricing unavailable")).toBe(false);
    expect(page.includes("Live catalog is syncing")).toBe(false);
  });

  test("the booking body renders only once the catalogue has loaded", () => {
    expect(page.includes("catalogueReady")).toBe(true);
  });

  test("chips say what is checked for every booking: approval, not identity verification", () => {
    expect(/Verified\\nProfessionals/.test(page)).toBe(false);
    expect(/Approved\\nProfessionals/.test(page)).toBe(true);
  });
});
