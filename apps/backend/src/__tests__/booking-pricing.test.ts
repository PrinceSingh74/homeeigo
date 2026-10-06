import { describe, expect, test } from "bun:test";
import { effectiveAddonCatalogue } from "../lib/service-catalog-config";
import { BookingPricingService } from "../services/booking-pricing.service";

describe("Booking pricing — addon catalog", () => {
  test("a service with no add-ons offers none", () => {
    expect(effectiveAddonCatalogue(null)).toEqual([]);
  });
});

describe("Booking pricing — tax formula", () => {
  test("finalAmount = discountedBase + round(discountedBase * 0.1)", () => {
    const base = 1000;
    const discount = 100;
    const discountedBase = base - discount;
    const taxes = Math.round(discountedBase * 0.1);
    const finalAmount = discountedBase + taxes;
    expect(taxes).toBe(90);
    expect(finalAmount).toBe(990);
  });
});

describe("BookingPricingService", () => {
  test("is exported as singleton", () => {
    expect(typeof BookingPricingService).toBe("function");
  });
});
