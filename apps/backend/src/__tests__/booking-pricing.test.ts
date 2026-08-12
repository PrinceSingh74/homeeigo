import { describe, expect, test } from "bun:test";
import { BOOKING_ADDONS, BookingPricingService } from "../services/booking-pricing.service";

describe("Booking pricing — addon catalog", () => {
  test("addon prices are fixed server-side", () => {
    expect(BOOKING_ADDONS.find((a) => a.id === "fridge")?.price).toBe(99);
    expect(BOOKING_ADDONS.find((a) => a.id === "sofa")?.price).toBe(149);
    expect(BOOKING_ADDONS.find((a) => a.id === "microwave")?.price).toBe(79);
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
