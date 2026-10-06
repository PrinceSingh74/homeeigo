import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { searchPriceLabel } from "../../src/lib/search-price";

/** Re-audit, 2026-10-06: the /book search dropdown printed "From ₹0" for a service with no price. */
describe("the price shown beside a search result", () => {
  test("is the lowest price the server holds", () => {
    expect(searchPriceLabel({ basePrice: 499, minPrice: 299 })).toBe("From ₹299");
    expect(searchPriceLabel({ basePrice: 499, minPrice: null })).toBe("From ₹499");
    expect(searchPriceLabel({ basePrice: 499, minPrice: 499 })).toBe("From ₹499");
  });

  test("is absent when the server holds none: never ₹0", () => {
    expect(searchPriceLabel({ basePrice: null, minPrice: null })).toBeNull();
    expect(searchPriceLabel({ basePrice: 0, minPrice: 0 })).toBeNull();
    expect(searchPriceLabel({})).toBeNull();
  });

  test("the booking page does not say nothing matches before the catalogue has answered, and suggests no searches of its own", () => {
    const page = readFileSync(join(import.meta.dir, "..", "..", "src", "app", "book", "BookPageClient.tsx"), "utf8");
    expect(page).toContain("catalogueReady && searchQuery.trim() && filteredServices.length === 0");
    expect(page).not.toMatch(/Try\s+cleaning, AC, plumbing/);
  });
});
