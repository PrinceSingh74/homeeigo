/**
 * Static copy that used to state numbers, ratings, prices, promos or guarantees nothing on the
 * server backs. These read the source: the claims were literals, so there is no function to call.
 *
 * Run from apps/web: `bun test tests/truth`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = (rel: string) => readFileSync(join(import.meta.dir, "..", "..", "src", rel), "utf8");
/** The needles found, so a failure names the claim instead of printing the file. */
const found = (rel: string, needles: (string | RegExp)[]) => {
  const text = src(rel);
  return needles.filter((n) => (typeof n === "string" ? text.includes(n) : n.test(text))).map(String);
};

describe("no fallback figures", () => {
  test("live metrics and the cities heading", () => {
    expect(found("hooks/use-live-metrics.ts", ["11+", "50,000+", "10,000+", "4.9"])).toEqual([]);
    expect(found("components/services-page/sections/CitiesSection.tsx", ["11+"])).toEqual([]);
  });

  test("home hero: no literal rating, no verified / background-checked claim", () => {
    expect(found("components/home/HeroSectionServer.tsx", ["4.9", /Verified/, /[Bb]ackground-checked/, "Top-rated", "12 min", /verified pro/i])).toEqual([]);
  });

  test("marketplace sections never fall back to the built-in lists", () => {
    expect(found("hooks/use-marketplace-sections.ts", ["HOME_CARE_SERVICES", "FALLBACK_BY_SLUG", "Most Booked"])).toEqual([]);
  });
});

describe("no invented filters, promos, reviews or amounts", () => {
  test("quick filters", () => {
    expect(found("components/overlays/QuickFiltersPanel.tsx", ["₹", "Most Popular", "best match"])).toEqual([]);
  });

  test("services catalogue modal", () => {
    expect(found("components/overlays/ServicesCatalogModal.tsx", ["TRENDING_SERVICES", "CUSTOMER_REVIEWS", "AI_RECOMMENDATIONS", "SERVICE_CATEGORIES", "HOME150", "₹150", "minPrice ?? 0", "Most booked"])).toEqual([]);
  });

  test("referral toast and the AI dashboard data", () => {
    expect(found("components/profile/StatsCards.tsx", ["₹"])).toEqual([]);
    expect(found("lib/ai-dashboard.ts", ["₹", "%", "Arjun", "Premium Member", "due in", "Trending near you", "Verified experts"])).toEqual([]);
  });

  test("the assistant sheet names no stranger, claims no AI, offers no invented code", () => {
    expect(found("components/overlays/AiAssistantSheet.tsx", ["Arjun", "Powered by AI", "AI picked", "COOL100"])).toEqual([]);
  });
});

describe("copy matches what the platform does for every booking", () => {
  test("how it works", () => {
    expect(found("components/overlays/HowItWorksModal.tsx", [/background-checked/i, /guaranteed/i, /Verified/, "AI matches"])).toEqual([]);
  });

  test("bookings empty state and providers metadata", () => {
    expect(found("app/(with-bottom-nav)/(aurora-nav)/bookings/page.tsx", [/verified pros/i, /cancel anytime/i, "60 seconds"])).toEqual([]);
    expect(found("app/(with-bottom-nav)/(aurora-nav)/providers/layout.tsx", [/verified/i, /background-checked/i])).toEqual([]);
  });

  test("refund timing is the server's statement, not a literal", () => {
    expect(found("components/booking/BookingDetailModal.tsx", ["5–7", "Wallet refunds are instant"])).toEqual([]);
  });

  test("the success modal does not announce a confirmed visit before a professional accepts", () => {
    expect(found("components/overlays/BookingSuccessModal.tsx", ["Booking confirmed!"])).toEqual([]);
  });

  test("the AI tracking card and section render from real tracking only", () => {
    expect(found("components/ai/AiLiveTrackingCard.tsx", ["?? 0", "Heading to your home now", "Assigned expert"])).toEqual([]);
    expect(found("components/ai/AiMobileLiveSection.tsx", ["?? 0"])).toEqual([]);
  });
});
