/**
 * §43 — every client must understand EXPIRED.
 *
 * Run from apps/web: `bun test tests/booking`.
 *
 * A booking whose payment window closed (PAYMENT_PENDING_TTL) must never render as nothing, and —
 * the worse failure this file exists to prevent — must never render as "confirmed". Before the
 * EXPIRED state existed on the client, `collapseCustomerBookingStatus` fell through to "confirmed",
 * so a released booking told the customer a professional was coming.
 */
import { describe, expect, test } from "bun:test";
import { collapseCustomerBookingStatus, type BookingStatus } from "@/lib/bookings";
import { STATUS_CONFIG, countByFilter, filterBookings } from "@/lib/booking-status";

describe("the backend's EXPIRED reaches the customer as its own state", () => {
  test("it is not confirmed, not cancelled, not dropped", () => {
    expect(collapseCustomerBookingStatus("EXPIRED")).toBe("expired");
    expect(collapseCustomerBookingStatus("expired")).toBe("expired");
  });

  test("the statuses around it are unchanged", () => {
    expect(collapseCustomerBookingStatus("PENDING")).toBe("confirmed");
    expect(collapseCustomerBookingStatus("ACCEPTED")).toBe("confirmed");
    expect(collapseCustomerBookingStatus("EN_ROUTE")).toBe("in_progress");
    expect(collapseCustomerBookingStatus("COMPLETED")).toBe("completed");
    expect(collapseCustomerBookingStatus("CANCELLED_BY_USER")).toBe("cancelled");
    expect(collapseCustomerBookingStatus("CANCELLED_BY_PROVIDER")).toBe("cancelled");
    expect(collapseCustomerBookingStatus("REJECTED")).toBe("cancelled");
  });
});

describe("it renders as something a customer can read", () => {
  test("every presentation state has a complete config — none can render blank", () => {
    const states: BookingStatus[] = ["confirmed", "in_progress", "completed", "cancelled", "expired"];
    for (const s of states) {
      const cfg = STATUS_CONFIG[s];
      expect(cfg).toBeTruthy();
      expect(cfg.label.length).toBeGreaterThan(0);
      expect(cfg.shortLabel.length).toBeGreaterThan(0);
      expect(cfg.description.length).toBeGreaterThan(0);
    }
  });

  test("its wording says the window closed, and never says someone cancelled", () => {
    const cfg = STATUS_CONFIG.expired;
    expect(cfg.label.toLowerCase()).toContain("expired");
    expect(cfg.label.toLowerCase()).not.toContain("cancel");
    expect(cfg.description.toLowerCase()).not.toContain("cancel");
    // and it is visually distinct from a cancellation
    expect(cfg.accent).not.toBe(STATUS_CONFIG.cancelled.accent);
  });
});

describe("it is never invisible in the list", () => {
  const rows = [
    { id: "a", status: "confirmed" as BookingStatus },
    { id: "b", status: "completed" as BookingStatus },
    { id: "c", status: "cancelled" as BookingStatus },
    { id: "d", status: "expired" as BookingStatus },
  ];

  test("'all' shows it, and it lands in the didn't-happen tab rather than nowhere", () => {
    expect(filterBookings(rows, "all").map((r) => r.id)).toContain("d");
    expect(filterBookings(rows, "cancelled").map((r) => r.id)).toContain("d");
  });

  test("it is not offered as upcoming — the slot was released", () => {
    expect(filterBookings(rows, "upcoming").map((r) => r.id)).not.toContain("d");
    expect(filterBookings(rows, "completed").map((r) => r.id)).not.toContain("d");
  });

  test("the tab count matches what the tab actually shows", () => {
    const counts = countByFilter(rows);
    expect(counts.cancelled).toBe(filterBookings(rows, "cancelled").length);
    expect(counts.all).toBe(rows.length);
  });
});

describe("§52/§53 — the two no-show outcomes are never the same thing", () => {
  test("each maps to its own state, and neither collapses into cancelled or confirmed", () => {
    expect(collapseCustomerBookingStatus("CUSTOMER_NO_SHOW")).toBe("customer_no_show");
    expect(collapseCustomerBookingStatus("PROVIDER_NO_SHOW")).toBe("provider_no_show");
  });

  test("the wording never blames the customer for the professional's absence", () => {
    const provider = STATUS_CONFIG.provider_no_show;
    expect(provider.label.toLowerCase()).toContain("didn't arrive");
    // and it says the customer was not charged, which is the §53 promise
    expect(provider.description.toLowerCase()).toContain("not been charged");

    const customer = STATUS_CONFIG.customer_no_show;
    expect(customer.label).not.toBe(provider.label);
    expect(customer.description.toLowerCase()).toContain("waited");
  });

  test("both are visible in the didn't-happen tab and never offered as upcoming", () => {
    const rows = [
      { id: "a", status: "confirmed" as BookingStatus },
      { id: "n1", status: "customer_no_show" as BookingStatus },
      { id: "n2", status: "provider_no_show" as BookingStatus },
    ];
    const cancelledTab = filterBookings(rows, "cancelled").map((r) => r.id);
    expect(cancelledTab).toContain("n1");
    expect(cancelledTab).toContain("n2");
    expect(filterBookings(rows, "upcoming").map((r) => r.id)).toEqual(["a"]);
    expect(countByFilter(rows).cancelled).toBe(2);
  });
});
