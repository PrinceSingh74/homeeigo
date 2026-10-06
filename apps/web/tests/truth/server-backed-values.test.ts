/**
 * Pure mappers that decide what a customer reads from what the server sent. Each one returns
 * nothing — never a default figure — when the server has nothing.
 *
 * Run from apps/web: `bun test tests/truth`.
 */
import { describe, expect, test } from "bun:test";
import { liveMetricsFromStats } from "@/lib/live-metrics";
import { groupMarketplaceSections, toMarketplaceService } from "@/lib/marketplace-sections";
import { statusConfigFor } from "@/lib/booking-status";
import { liveTrackingView } from "@/lib/live-tracking-view";
import { tierOptions } from "@/lib/catalog/pricing";
import { bookingSummaryLine } from "@/lib/booking-summary";
import type { BackendService } from "@/types/backend";

describe("liveMetricsFromStats", () => {
  test("no stats (loading or down) is no metrics, not marketing defaults", () => {
    expect(liveMetricsFromStats(undefined)).toEqual([]);
    expect(liveMetricsFromStats(null)).toEqual([]);
  });

  test("a metric with no real value is hidden", () => {
    const out = liveMetricsFromStats({ completedBookings: 0, activeProviders: 0, availableServices: 0, customers: 0, averageRating: null, reviewCount: 0 });
    expect(out).toEqual([]);
  });

  test("real values are shown as the server's numbers", () => {
    const out = liveMetricsFromStats({ completedBookings: 1234, activeProviders: 56, availableServices: 40, customers: 900, averageRating: 4.6, reviewCount: 210 });
    expect(out.map((m) => [m.number, m.label])).toEqual([
      ["1,234", "Bookings completed"],
      ["56", "Active professionals"],
      ["4.6★", "Average rating"],
    ]);
  });

  test("an average with no reviews behind it is not a rating", () => {
    const out = liveMetricsFromStats({ completedBookings: 3, activeProviders: 0, availableServices: 1, customers: 2, averageRating: 5, reviewCount: 0 });
    expect(out.map((m) => m.label)).toEqual(["Bookings completed"]);
  });
});

const svc = (over: Partial<BackendService>): BackendService => ({ id: "s1", name: "Bathroom Cleaning", slug: "bathroom-cleaning", subcategory: "home-care", ...over }) as BackendService;

describe("marketplace sections", () => {
  test("an empty or failed catalogue is empty sections — no built-in services", () => {
    const out = groupMarketplaceSections([]);
    expect([out.homeCare, out.premiumCare, out.laundry, out.outdoor, out.express]).toEqual([[], [], [], [], []]);
  });

  test("services are grouped by the server's subcategory", () => {
    const out = groupMarketplaceSections([svc({}), svc({ id: "s2", slug: "x", subcategory: "laundry" })]);
    expect(out.homeCare.map((s) => s.serviceId)).toEqual(["s1"]);
    expect(out.laundry.map((s) => s.serviceId)).toEqual(["s2"]);
  });

  test("a service the API gives no price, duration or flag gets none — not the built-in entry's", () => {
    const m = toMarketplaceService(svc({}));
    expect(m.price).toBe("");
    expect(m.priceValue).toBeUndefined();
    expect(m.duration).toBe("");
    expect(m.badge).toBeUndefined();
    expect(m.rating).toBeNull();
  });

  test("a badge is a server flag, named for what the flag means", () => {
    expect(toMarketplaceService(svc({ isPopular: true })).badge).toBe("Popular");
    expect(toMarketplaceService(svc({ isFeatured: true })).badge).toBe("Featured");
    expect(toMarketplaceService(svc({ basePrice: 199, estimatedDuration: 40 })).price).toBe("₹199 onwards");
  });
});

describe("statusConfigFor — a pre-start booking says where it really is", () => {
  const base = { status: "confirmed" as const, proName: "" };

  test("unpaid: payment is what is pending", () => {
    const cfg = statusConfigFor({ ...base, backendStatus: "pending", paymentStatus: "pending" });
    expect(cfg.shortLabel).toBe("Awaiting payment");
    expect(cfg.description).not.toMatch(/will arrive/i);
  });

  test("paid, nobody assigned: waiting for a professional, not 'your pro will arrive'", () => {
    const cfg = statusConfigFor({ ...base, backendStatus: "pending", paymentStatus: "success" });
    expect(cfg.label).toBe("Finding a professional");
    expect(cfg.shortLabel).toBe("Finding a pro");
    expect(cfg.description).not.toMatch(/will arrive/i);
  });

  test("a professional accepted: assigned", () => {
    for (const backendStatus of ["accepted", "assigned"]) {
      const cfg = statusConfigFor({ ...base, proName: "Asha Verma", backendStatus, paymentStatus: "success" });
      expect(cfg.label).toBe("Professional assigned");
      expect(cfg.shortLabel).toBe("Upcoming");
    }
  });

  test("an unknown pre-start state claims nothing about a professional", () => {
    const cfg = statusConfigFor({ ...base });
    expect(cfg.label).toBe("Booked");
    expect(cfg.description).not.toMatch(/pro|professional/i);
  });

  test("other statuses are unchanged", () => {
    expect(statusConfigFor({ status: "completed", proName: "A" }).label).toBe("Completed");
    expect(statusConfigFor({ status: "expired", proName: "" }).shortLabel).toBe("Expired");
  });
});

describe("liveTrackingView", () => {
  const tracking = { id: "t", bookingId: "b", status: "en_route", eta: 9 };

  test("no active booking, or no tracking record, is not live", () => {
    expect(liveTrackingView(undefined, undefined)).toBeNull();
    expect(liveTrackingView({ backendStatus: "en_route" }, undefined)).toBeNull();
  });

  test("a booking nobody is travelling for is not 'on the way'", () => {
    expect(liveTrackingView({ backendStatus: "pending" }, { ...tracking, status: "pending" })).toBeNull();
    expect(liveTrackingView({ backendStatus: "accepted" }, { ...tracking, status: "assigned" })).toBeNull();
  });

  test("en route with tracking: the server's eta, or none", () => {
    expect(liveTrackingView({ backendStatus: "en_route" }, tracking)).toEqual({ etaMin: 9 });
    expect(liveTrackingView({ backendStatus: "en_route" }, { ...tracking, eta: undefined })).toEqual({ etaMin: null });
  });
});

describe("tiers are prices, not packages", () => {
  test("one price is one unnamed option", () => {
    expect(tierOptions({ base: 300, min: 300, max: 300 })).toEqual([{ index: 1, name: "", price: 300 }]);
  });

  test("three prices are named for what they are", () => {
    expect(tierOptions({ base: 300, min: 200, max: 500 }).map((t) => t.name)).toEqual(["Lowest price", "Base price", "Highest price"]);
  });

  test("the summary names no package: nothing for a single price, the price's own name otherwise", () => {
    expect(bookingSummaryLine({ hasSelection: false, selection: undefined, serverPrice: 300, tier: { name: "", price: 300 } })).toEqual({ label: null, amount: 300 });
    expect(bookingSummaryLine({ hasSelection: false, selection: undefined, serverPrice: 300, tier: { name: "Base price", price: 300 } })).toEqual({ label: "Base price", amount: 300 });
  });
});
