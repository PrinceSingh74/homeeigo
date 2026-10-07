/**
 * "Is your professional at the door but can't check in?" — the customer's side of the arrival
 * exception (POST /api/bookings/:id/confirm-arrival). Arrival is normally established by the
 * professional's device; this is offered only where the server would accept it and only until it
 * has been used, and it is a secondary control, never a step every customer is pushed through.
 *
 * Run from apps/web: `bun test tests/booking`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canOfferArrivalConfirmation, confirmationStillStands } from "@/lib/arrival-confirmation";

const base = { backendStatus: "en_route", hasProfessional: true, arrivedAt: null, confirmedThisSession: false };

describe("canOfferArrivalConfirmation", () => {
  test("offered while a professional holds the job and it has not started", () => {
    for (const backendStatus of ["accepted", "assigned", "en_route", "EN_ROUTE"]) {
      expect(canOfferArrivalConfirmation({ ...base, backendStatus })).toBe(true);
    }
  });

  test("not offered before anyone has the job, or once it has started or ended", () => {
    for (const backendStatus of ["pending", "in_progress", "completed", "cancelled", "cancelled_by_user", "expired", "provider_no_show", "", undefined, null]) {
      expect(canOfferArrivalConfirmation({ ...base, backendStatus })).toBe(false);
    }
  });

  test("not offered with no professional on the booking, whatever the status says", () => {
    expect(canOfferArrivalConfirmation({ ...base, hasProfessional: false })).toBe(false);
  });

  test("not offered once arrival is recorded — the device check-in worked", () => {
    expect(canOfferArrivalConfirmation({ ...base, arrivedAt: "2026-10-07T09:00:00.000Z" })).toBe(false);
  });

  test("not offered again once confirmed for this booking in this session", () => {
    expect(canOfferArrivalConfirmation({ ...base, confirmedThisSession: true })).toBe(false);
  });
});

/**
 * The server's confirmation vouches for one professional and for a limited time (it says until
 * when). A confirmation remembered in the page must not outlive either: if the job passes to
 * another professional, or the time runs out, the customer has to be able to confirm again.
 */
describe("confirmationStillStands", () => {
  const now = Date.parse("2026-10-07T09:00:00.000Z");
  const made = { professionalId: "pro-1", validUntil: "2026-10-07T10:00:00.000Z" };

  test("stands for the professional it was given for, until the time the server gave", () => {
    expect(confirmationStillStands(made, { professionalId: "pro-1", now })).toBe(true);
  });

  test("does not stand for a professional who took the job over", () => {
    expect(confirmationStillStands(made, { professionalId: "pro-2", now })).toBe(false);
  });

  test("does not stand after the server's time has passed, or when nothing was remembered", () => {
    expect(confirmationStillStands(made, { professionalId: "pro-1", now: Date.parse("2026-10-07T10:00:01.000Z") })).toBe(false);
    expect(confirmationStillStands(undefined, { professionalId: "pro-1", now })).toBe(false);
  });

  test("with no end time from the server it stands for the same professional", () => {
    expect(confirmationStillStands({ professionalId: "pro-1", validUntil: null }, { professionalId: "pro-1", now })).toBe(true);
  });
});

describe("the booking detail wires it as a secondary, explained control", () => {
  const src = (rel: string) => readFileSync(join(import.meta.dir, "..", "..", "src", rel), "utf8");
  const modal = src("components/booking/BookingDetailModal.tsx");
  const control = src("components/booking/ArrivalConfirmation.tsx");

  test("the modal renders the control, and the control decides visibility with the helper", () => {
    expect(modal.includes("<ArrivalConfirmation")).toBe(true);
    expect(control.includes("canOfferArrivalConfirmation(")).toBe(true);
  });

  test("it posts to the server's endpoint and shows the server's sentences", () => {
    expect(src("services/core/api.ts").includes("/confirm-arrival")).toBe(true);
    expect(src("hooks/use-core-data.ts").includes("coreApi.bookings.confirmArrival")).toBe(true);
    // The success and refusal text come from the response, not from literals here.
    expect(control.includes("your professional can now check in")).toBe(false);
    expect(control.includes("once a professional is on the way")).toBe(false);
  });

  test("it says exactly what confirming does, and asks before doing it", () => {
    expect(control.includes("Is your professional at the door but can&apos;t check in?")).toBe(true);
    expect(control.includes("Confirm only if the professional is physically at your address.")).toBe(true);
    expect(control.includes("This lets them check in when their phone cannot get a location.")).toBe(true);
    expect(/min-h-11/.test(control)).toBe(true);
  });
});
