/**
 * What a customer is told about whether a service can be booked at an address: one of five
 * statuses and one sentence. The reason behind the answer (which zone, which rule, how many
 * professionals) never leaves the server.
 */
import { describe, expect, test } from "bun:test";
import { CUSTOMER_SERVICEABILITY_STATUSES, customerServiceability } from "../lib/customer-serviceability";

const ok = { bookable: true, hasCoordinates: true, inServiceArea: true as boolean | null, coverageAllowed: true, slots: null as { total: number; available: number } | null };

describe("customerServiceability", () => {
  test("the five statuses", () => {
    expect(CUSTOMER_SERVICEABILITY_STATUSES).toEqual(["AVAILABLE", "LIMITED", "NOT_AVAILABLE", "NEEDS_CONFIRMATION", "TEMPORARILY_UNAVAILABLE"]);
  });

  test("a bookable service inside its area is available", () => {
    expect(customerServiceability(ok)).toEqual({ status: "AVAILABLE", message: "Available for your location" });
    expect(customerServiceability({ ...ok, slots: { total: 20, available: 15 } }).status).toBe("AVAILABLE");
  });

  test("a paused or not-yet-bookable service is temporarily unavailable, whatever the address", () => {
    expect(customerServiceability({ ...ok, bookable: false })).toEqual({ status: "TEMPORARILY_UNAVAILABLE", message: "This service is temporarily unavailable." });
    expect(customerServiceability({ ...ok, bookable: false, inServiceArea: false }).status).toBe("TEMPORARILY_UNAVAILABLE");
  });

  test("outside the configured cities or PIN codes, or outside every service zone, it is not available", () => {
    const expected = { status: "NOT_AVAILABLE" as const, message: "This service is not currently available in your area" };
    expect(customerServiceability({ ...ok, coverageAllowed: false })).toEqual(expected);
    expect(customerServiceability({ ...ok, inServiceArea: false })).toEqual(expected);
  });

  test("an address without a map pin, or a zone check that could not run, needs confirmation: never a yes or a no", () => {
    const expected = { status: "NEEDS_CONFIRMATION" as const, message: "We need to confirm that we can serve this address." };
    expect(customerServiceability({ ...ok, hasCoordinates: false, inServiceArea: null })).toEqual(expected);
    expect(customerServiceability({ ...ok, inServiceArea: null })).toEqual(expected);
  });

  test("a known refusal outranks an unknown: the wrong city is not 'needs confirmation'", () => {
    expect(customerServiceability({ ...ok, hasCoordinates: false, inServiceArea: null, coverageAllowed: false }).status).toBe("NOT_AVAILABLE");
  });

  test("a date with fewer than half of its times left is limited; a full date says so", () => {
    expect(customerServiceability({ ...ok, slots: { total: 20, available: 9 } })).toEqual({ status: "LIMITED", message: "Limited availability for this date" });
    expect(customerServiceability({ ...ok, slots: { total: 20, available: 10 } }).status).toBe("AVAILABLE");
    expect(customerServiceability({ ...ok, slots: { total: 20, available: 0 } })).toEqual({ status: "LIMITED", message: "No times are left on this date. Try another date." });
    // A day with no slots at all (closed) is the same answer as a full one.
    expect(customerServiceability({ ...ok, slots: { total: 0, available: 0 } }).status).toBe("LIMITED");
  });

  test("the answer carries a status and a sentence, nothing else", () => {
    for (const input of [ok, { ...ok, bookable: false }, { ...ok, inServiceArea: false }, { ...ok, slots: { total: 4, available: 1 } }]) {
      expect(Object.keys(customerServiceability(input)).sort()).toEqual(["message", "status"]);
    }
  });
});
