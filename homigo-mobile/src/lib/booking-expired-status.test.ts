/**
 * §43 + §77 — the mobile app must understand EXPIRED, and must reach the same commercial answer the
 * web app does.
 *
 * Run from homigo-mobile: `bun test src/lib/booking-expired-status.test.ts`.
 *
 * A booking whose payment window closed (PAYMENT_PENDING_TTL) must never render as nothing and must
 * never render as "confirmed". It must also not offer reschedule: the slot was released, so the
 * server refuses with INVALID_STATUS and the button would only produce an error.
 */
import { describe, expect, test } from "bun:test";
import type { BookingStatus } from "@/lib/store";
import { STATUS_CONFIG, countByFilter, filterBookings } from "@/lib/booking-status";
import { canRescheduleBooking } from "@/lib/booking-reschedule-rules";

describe("EXPIRED is a state of its own", () => {
  test("it has complete, readable copy", () => {
    const cfg = STATUS_CONFIG.expired;
    expect(cfg).toBeTruthy();
    expect(cfg.label.toLowerCase()).toContain("expired");
    expect(cfg.label.toLowerCase()).not.toContain("cancel");
    expect(cfg.description.length).toBeGreaterThan(0);
    expect(cfg.icon).toBe("timer-off");
  });

  test("every presentation state still has a config — none renders blank", () => {
    for (const s of ["confirmed", "in_progress", "completed", "cancelled", "expired"] as BookingStatus[]) {
      expect(STATUS_CONFIG[s]?.label.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("its wording matches the web app's, so the two surfaces say the same thing", () => {
    // Kept in step deliberately: §77 requires equivalent commercial semantics across clients.
    expect(STATUS_CONFIG.expired.label).toBe("Payment time expired");
    expect(STATUS_CONFIG.expired.shortLabel).toBe("Expired");
  });
});

describe("it is visible, but never 'upcoming'", () => {
  const rows = [
    { id: "a", status: "confirmed" as BookingStatus },
    { id: "b", status: "completed" as BookingStatus },
    { id: "c", status: "cancelled" as BookingStatus },
    { id: "d", status: "expired" as BookingStatus },
  ];

  test("shown under 'all' and in the didn't-happen tab", () => {
    expect(filterBookings(rows, "all").map((r) => r.id)).toContain("d");
    expect(filterBookings(rows, "cancelled").map((r) => r.id)).toContain("d");
  });

  test("not upcoming, not completed", () => {
    expect(filterBookings(rows, "upcoming").map((r) => r.id)).not.toContain("d");
    expect(filterBookings(rows, "completed").map((r) => r.id)).not.toContain("d");
  });

  test("the tab count matches the tab contents", () => {
    expect(countByFilter(rows).cancelled).toBe(filterBookings(rows, "cancelled").length);
  });
});

describe("reschedule is not offered for a released slot", () => {
  test("EXPIRED cannot be rescheduled, while a live booking still can", () => {
    expect(canRescheduleBooking("expired")).toBe(false);
    expect(canRescheduleBooking("EXPIRED")).toBe(false);
    expect(canRescheduleBooking("pending")).toBe(true);
    expect(canRescheduleBooking("accepted")).toBe(true);
  });
});

describe("§52/§53 — no-show, and parity with the web app", () => {
  test("both outcomes have their own copy, and the professional's absence is not the customer's fault", () => {
    expect(STATUS_CONFIG.customer_no_show.label).toBe("Missed appointment");
    expect(STATUS_CONFIG.provider_no_show.label).toBe("Professional didn't arrive");
    expect(STATUS_CONFIG.provider_no_show.description.toLowerCase()).toContain("not been charged");
  });

  test("neither is offered as upcoming, and both remain visible", () => {
    const rows = [
      { id: "a", status: "confirmed" as BookingStatus },
      { id: "n1", status: "customer_no_show" as BookingStatus },
      { id: "n2", status: "provider_no_show" as BookingStatus },
    ];
    expect(filterBookings(rows, "upcoming").map((r) => r.id)).toEqual(["a"]);
    expect(filterBookings(rows, "cancelled").map((r) => r.id).sort()).toEqual(["n1", "n2"]);
    expect(countByFilter(rows).cancelled).toBe(2);
  });

  test("a settled no-show is never offered a reschedule button", () => {
    expect(canRescheduleBooking("customer_no_show")).toBe(false);
    expect(canRescheduleBooking("provider_no_show")).toBe(false);
  });
});
