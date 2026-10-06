/**
 * What a saved booking says about its selection and its professional. The customer booking payload
 * (booking.service listForUser / getById) carries a provider name or null and NO selection summary,
 * so a booking loaded from the server must not be labelled "Standard" or "Assigned Pro".
 *
 * Run from apps/web: `bun test tests/booking`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bookingSubtitle, professionalLabel, providerNameFromBackend } from "@/lib/bookings";
import { PACKAGE_TIERS, tierOptions } from "@/lib/catalog/pricing";

const src = (rel: string) => readFileSync(join(import.meta.dir, "..", "..", "src", rel), "utf8");
const has = (text: string, needle: string | RegExp) => (typeof needle === "string" ? text.includes(needle) : needle.test(text));

describe("providerNameFromBackend", () => {
  test("the list payload's providerName, or the detail payload's provider.name", () => {
    expect(providerNameFromBackend({ providerName: "Asha Verma" })).toBe("Asha Verma");
    expect(providerNameFromBackend({ provider: { id: "p1", name: "Ravi K." } })).toBe("Ravi K.");
  });

  test("nobody assigned is an empty name, never a placeholder person", () => {
    expect(providerNameFromBackend({})).toBe("");
    expect(providerNameFromBackend({ providerName: null, provider: null })).toBe("");
    expect(providerNameFromBackend({ providerName: "   " })).toBe("");
  });
});

describe("professionalLabel", () => {
  test("the real name when there is one", () => {
    expect(professionalLabel({ proName: "Asha Verma", status: "confirmed" })).toBe("Asha Verma");
  });

  test("an honest sentence when there is none", () => {
    expect(professionalLabel({ proName: "", status: "confirmed" })).toBe("Professional not assigned yet");
    // "yet" would be untrue for a booking that is over.
    expect(professionalLabel({ proName: "", status: "cancelled" })).toBe("No professional assigned");
    expect(professionalLabel({ proName: "", status: "expired" })).toBe("No professional assigned");
  });
});

describe("bookingSubtitle", () => {
  test("selection and professional when both are known", () => {
    expect(bookingSubtitle({ packageName: "Split AC · 3 unit", proName: "Asha Verma", status: "confirmed" })).toBe("Split AC · 3 unit · Asha Verma");
  });

  test("no selection from the server means no dangling separator and no invented package", () => {
    expect(bookingSubtitle({ packageName: "", proName: "Asha Verma", status: "confirmed" })).toBe("Asha Verma");
    expect(bookingSubtitle({ packageName: "", proName: "", status: "confirmed" })).toBe("Professional not assigned yet");
  });
});

describe("the booking mapper and its consumers carry no placeholders", () => {
  test("mapBackendBookingToSaved invents neither a package nor a professional", () => {
    const hooks = src("hooks/use-core-data.ts");
    expect(has(hooks, /packageName:\s*"Standard"/)).toBe(false);
    expect(has(hooks, "Assigned Pro")).toBe(false);
    expect(has(hooks, "Matching a pro")).toBe(false);
  });

  test("no consumer appends 'Package' to the selection or prints a bare placeholder", () => {
    expect(has(src("components/booking/BookingDetailModal.tsx"), "packageName} Package")).toBe(false);
    expect(has(src("components/booking/BookingCard.tsx"), "{booking.packageName} · {booking.proName}")).toBe(false);
    expect(has(src("components/LiveTrackingSection.tsx"), "{activeBooking!.serviceName} · {activeBooking!.packageName}")).toBe(false);
    expect(has(src("components/ai/AiLiveTrackingCard.tsx"), "Assigned Pro")).toBe(false);
  });
});

describe("tiers are named, not described", () => {
  test("no tier carries a description the server does not configure", () => {
    expect(PACKAGE_TIERS.map((t) => Object.keys(t).sort())).toEqual([["index", "name"], ["index", "name"], ["index", "name"]]);
    expect(Object.keys(tierOptions({ base: 300, min: 200, max: 500 })[0]!).sort()).toEqual(["index", "name", "price"]);
  });
});

describe("copy that promised more than the server does", () => {
  test("the success modal does not say a booking can be cancelled anytime", () => {
    const modal = src("components/overlays/BookingSuccessModal.tsx");
    expect(has(modal, /cancel anytime/i)).toBe(false);
    expect(has(modal, /cancellation terms apply/i)).toBe(true);
  });

  test("the assistant quotes no price, discount amount or popularity", () => {
    const sheet = src("components/overlays/AiAssistantSheet.tsx");
    expect(has(sheet, "₹")).toBe(false);
    expect(has(sheet, /most popular/i)).toBe(false);
  });
});
