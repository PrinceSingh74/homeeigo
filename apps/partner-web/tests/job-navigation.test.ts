import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  googleDirectionsUrl,
  jobDestination,
  navigationCustomerLabel,
  navigationHref,
  pickNavigationBooking,
} from "../src/lib/job-navigation";

/**
 * Navigation was not bound to a job, 2026-10-06: the job page had no way to navigate, and
 * `/navigation` routed to the FIRST active booking with coordinates — with two accepted jobs, possibly
 * the other customer's door. Its destination label read `customer.name`, a field the API never sends.
 */
const root = join(import.meta.dir, "..", "src");
const nav = readFileSync(join(root, "app", "(partner)", "navigation", "page.tsx"), "utf8");
const page = readFileSync(join(root, "app", "(partner)", "requests", "[id]", "page.tsx"), "utf8");

const at = (id: string, latitude: number | null, longitude: number | null) => ({
  id,
  customer: { firstName: "Asha", lastName: "Rao" },
  address: { fullAddress: `${id} street`, latitude, longitude },
});

describe("which booking navigation routes to", () => {
  const bookings = [at("b1", null, null), at("b2", 12.9, 77.5), at("b3", 13.0, 77.6)];

  test("the requested job, not the first one with coordinates", () => {
    expect(pickNavigationBooking(bookings, "b3")?.id).toBe("b3");
  });

  test("a requested job without coordinates routes nowhere — never to another job", () => {
    expect(pickNavigationBooking(bookings, "b1")).toBeNull();
  });

  test("a requested job that is not in the list routes nowhere", () => {
    expect(pickNavigationBooking(bookings, "nope")).toBeNull();
  });

  test("with no job requested, the first one with coordinates (the old behaviour)", () => {
    expect(pickNavigationBooking(bookings, null)?.id).toBe("b2");
    expect(pickNavigationBooking(bookings, undefined)?.id).toBe("b2");
    expect(pickNavigationBooking([], null)).toBeNull();
  });
});

describe("the destination and its label come from the payload", () => {
  test("coordinates are a destination only when both are numbers", () => {
    expect(jobDestination(at("b", 12.9, 77.5))).toEqual({ lat: 12.9, lng: 77.5 });
    expect(jobDestination(at("b", null, 77.5))).toBeNull();
    expect(jobDestination(at("b", 12.9, null))).toBeNull();
    expect(jobDestination({ id: "b" })).toBeNull();
    expect(jobDestination(null)).toBeNull();
  });

  test("the label is the first and last name the API sends, or nothing", () => {
    expect(navigationCustomerLabel(at("b", 1, 1))).toBe("Asha Rao");
    expect(navigationCustomerLabel({ id: "b", customer: { firstName: "Asha", lastName: null } })).toBe("Asha");
    expect(navigationCustomerLabel({ id: "b", customer: { firstName: null, lastName: null } })).toBeNull();
    expect(navigationCustomerLabel({ id: "b" })).toBeNull();
  });

  test("links", () => {
    expect(navigationHref("abc 1")).toBe("/navigation?booking=abc%201");
    expect(googleDirectionsUrl({ lat: 12.9, lng: 77.5 })).toBe("https://www.google.com/maps/dir/?api=1&destination=12.9,77.5&travelmode=driving");
  });
});

describe("the pages use it", () => {
  test("/navigation reads ?booking and picks through the helper", () => {
    expect(nav).toContain('.get("booking")');
    expect(nav).toContain("pickNavigationBooking(");
    expect(nav).not.toContain("customer?.name");
    expect(nav).not.toContain("customer.name");
  });

  test("the job page offers Navigate and the external maps link, only with coordinates", () => {
    expect(page).toContain("navigationHref(booking.id)");
    expect(page).toContain("googleDirectionsUrl(destination)");
    expect(page).toMatch(/\{destination \? \(/);
  });
});
