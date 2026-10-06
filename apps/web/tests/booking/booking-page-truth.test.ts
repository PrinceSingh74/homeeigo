/**
 * Claims the customer web must not make because nothing on the server backs them. These read the
 * source: the strings were static JSX, so there is no function to call.
 *
 * Run from apps/web: `bun test tests/booking`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_TIERS } from "@/lib/catalog/pricing";

const src = (rel: string) => readFileSync(join(import.meta.dir, "..", "..", "src", rel), "utf8");
/** Booleans, so a failure names the claim instead of printing the whole file. */
const has = (text: string, needle: string | RegExp) => (typeof needle === "string" ? text.includes(needle) : needle.test(text));

describe("the booking page invents no numbers or badges", () => {
  const page = src("app/book/BookPageClient.tsx");

  test("no hardcoded marketing statistics", () => {
    const found = ["50,000+", "Happy Customers", "4.9 ★", "Average Rating", "12K+", "Bookings Today"].filter((c) => has(page, c));
    expect(found).toEqual([]);
  });

  test("no 'Best Seller' on every service; a popular badge only from the server's flag", () => {
    expect(has(page, "Best Seller")).toBe(false);
    expect(has(page, "rawService?.isPopular")).toBe(true);
  });

  test("the selected service card says Selected, not Featured", () => {
    expect(has(page, />\s*Featured\s*</)).toBe(false);
  });

  test("no tier is called most popular, and none is flagged popular from its price", () => {
    expect(has(page, /Most Popular/i)).toBe(false);
    expect(has(page, /popular:\s*t\.price/)).toBe(false);
    expect(has(JSON.stringify(PACKAGE_TIERS), /popular/i)).toBe(false);
  });

  test("the summary line and the saved booking come from the selection, not always the tier", () => {
    expect(has(page, "bookingSummaryLine(")).toBe(true);
    expect(has(page, "packageName: selected.name")).toBe(false);
    expect(has(page, "{selected.name} Package")).toBe(false);
  });
});

describe("the success modal says what happened", () => {
  test("it opens after a verified online payment, so nothing is 'payable at service'", () => {
    const modal = src("components/overlays/BookingSuccessModal.tsx");
    expect(has(modal, /payable at service/i)).toBe(false);
    expect(has(modal, /paid online/i)).toBe(true);
  });
});

describe("the cancellation card carries no policy of its own", () => {
  test("no percentages or windows in the component", () => {
    const card = src("components/booking/CancellationPolicyCard.tsx");
    expect(has(card, "DEFAULT_TIERS")).toBe(false);
    expect(has(card, /\b(100|90|75|24|5–7)\b/)).toBe(false);
    expect(has(card, "useCancellationPolicyQuery")).toBe(true);
  });
});

describe("the service page offers no control the server cannot honour", () => {
  test("no professional-preference selector while assignment cannot filter on it", () => {
    expect(has(src("components/services-catalog/detail/ServiceDetail.tsx"), "BeautyProfessionalSelector")).toBe(false);
  });
});
