import { describe, expect, test } from "bun:test";
import { AuthApiError } from "@/lib/auth/errors";
import {
  buildBookingSelection,
  couponErrorMessage,
  quoteErrorMessage,
  quoteLines,
  selectionKey,
  selectionToBookingFields,
  type BookingQuote,
} from "./booking-quote";

const QUOTE: BookingQuote = {
  serviceBasePrice: 499,
  packagePrice: 499,
  addons: [{ id: "sofa", name: "Sofa Cleaning", price: 149 }],
  addonTotal: 149,
  baseAmount: 648,
  weatherSurgeMultiplier: 1.1,
  weatherSurgeAmount: 65,
  weatherCondition: "heavy rain",
  membershipDiscount: 71,
  campaignDiscount: 100,
  freeDeliveryDiscount: 0,
  discount: 171,
  discountedBase: 542,
  taxes: 54,
  finalAmount: 596,
  couponCode: "FIX100",
};

describe("booking selection", () => {
  test("tier services send packagePrice, quantity services never do", () => {
    const tier = buildBookingSelection({ serviceId: "s1", packagePrice: 499, addonIds: [] });
    expect(tier.packagePrice).toBe(499);
    expect(tier.quantity).toBeUndefined();
    const qty = buildBookingSelection({ serviceId: "s1", packagePrice: 499, quantityRule: { min: 2, default: 3 }, addonIds: [] });
    expect(qty.packagePrice).toBeUndefined();
    expect(qty.quantity).toBe(3);
    const variant = buildBookingSelection({ serviceId: "s1", variantId: "classic", audience: "women", addonIds: [] });
    expect(variant.variantId).toBe("classic");
    expect(variant.audience).toBe("women");
    expect(selectionToBookingFields(variant).variantId).toBe("classic");
  });

  test("the booking body carries ids only — never an amount or coordinates", () => {
    const sel = buildBookingSelection({
      serviceId: "s1",
      packagePrice: 499,
      addonIds: ["sofa", "fridge", "sofa"],
      couponCode: " fix100 ",
      coords: { latitude: 28.5, longitude: 77.1 },
    });
    const body = selectionToBookingFields(sel);
    expect(body).toEqual({ serviceId: "s1", packagePrice: 499, addonIds: ["fridge", "sofa"], couponCode: "FIX100" });
    expect(JSON.stringify(body)).not.toContain("finalAmount");
    expect(sel.lat).toBe(28.5);
  });

  test("key changes with every priced input", () => {
    const base = { serviceId: "s1", packagePrice: 499, addonIds: [] as string[] };
    const k = selectionKey(buildBookingSelection(base));
    expect(selectionKey(buildBookingSelection({ ...base, packagePrice: 799 }))).not.toBe(k);
    expect(selectionKey(buildBookingSelection({ ...base, addonIds: ["sofa"] }))).not.toBe(k);
    expect(selectionKey(buildBookingSelection({ ...base, couponCode: "X" }))).not.toBe(k);
    expect(selectionKey(buildBookingSelection({ ...base, coords: { latitude: 1, longitude: 2 } }))).not.toBe(k);
    expect(selectionKey(buildBookingSelection(base))).toBe(k);
  });
});

describe("quote display", () => {
  test("rows come straight from the server breakdown", () => {
    const lines = quoteLines(QUOTE);
    const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
    expect(byKey.service?.amount).toBe(499);
    expect(byKey["addon:sofa"]?.amount).toBe(149);
    expect(byKey.surge?.amount).toBe(65);
    expect(byKey.membership?.kind).toBe("discount");
    expect(byKey.coupon?.amount).toBe(100);
    expect(byKey.tax?.amount).toBe(54);
    expect(byKey.visit).toBeUndefined();
  });

  test("error codes map to clear messages", () => {
    expect(quoteErrorMessage(new AuthApiError("x", 403, "UPGRADE_REQUIRED"))).toContain("premium");
    expect(quoteErrorMessage(new AuthApiError("x", 400, "INVALID_PACKAGE_PRICE"))).toContain("package");
    expect(quoteErrorMessage(new AuthApiError("Coupon error: EXPIRED", 400, "EXPIRED"))).toContain("expired");
    expect(quoteErrorMessage(new AuthApiError("offline", 0))).toContain("offline");
    expect(couponErrorMessage("MIN_ORDER_NOT_MET")).toContain("minimum");
    expect(couponErrorMessage(undefined)).toBeNull();
  });
});

describe("quote ↔ booking address binding (Phase 05 closure)", () => {
  test("the quoted selection carries the saved address, and the key changes with it", () => {
    const a = buildBookingSelection({ serviceId: "s1", addonIds: ["b", "a"], addressId: "addr-1", coords: { latitude: 28.6, longitude: 77.2 } });
    expect(a.addressId).toBe("addr-1");
    expect(a.addonIds).toEqual(["a", "b"]);
    const b = buildBookingSelection({ serviceId: "s1", addonIds: ["a", "b"], addressId: "addr-2", coords: { latitude: 28.6, longitude: 77.2 } });
    expect(selectionKey(a)).not.toBe(selectionKey(b));
  });
});
