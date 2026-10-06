/**
 * Partner data boundary (pure): what a partner may read about a customer depends on the partner's
 * stage with the job, and a partner booking payload carries only allow-listed fields.
 */
import { describe, expect, test } from "bun:test";
import {
  partnerCancellationReason,
  partnerCustomerStage,
  partnerHoldView,
  partnerJobNote,
  toPartnerSafeCustomer,
  unknownPartnerBookingKeys,
} from "../lib/privacy-policy.engine";

const customer = { firstName: "Asha", lastName: "Krishnan", profileImage: "https://img/x.jpg", phone: "+919876543210" };

describe("stage", () => {
  test("a partner who does not hold the job is at the offer stage, whatever the status", () => {
    for (const status of ["PENDING", "ACCEPTED", "IN_PROGRESS", "COMPLETED"]) {
      expect(partnerCustomerStage({ isAssignee: false, status })).toBe("offer");
    }
  });
  test("the assignee is the owner while the job is being fulfilled", () => {
    for (const status of ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"]) {
      expect(partnerCustomerStage({ isAssignee: true, status })).toBe("owner");
    }
  });
  test("once the job is over the assignee is at the history stage", () => {
    for (const status of ["COMPLETED", "CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "CUSTOMER_NO_SHOW", "EXPIRED"]) {
      expect(partnerCustomerStage({ isAssignee: true, status })).toBe("history");
    }
  });
});

describe("customer details by stage", () => {
  test("history keeps the first name only: no surname, photo or phone after the job is over", () => {
    expect(toPartnerSafeCustomer(customer, "history")).toEqual({ firstName: "Asha", lastName: null, profileImage: null, phoneMasked: null });
  });
  test("the owner sees the name, photo and a masked phone, never the number", () => {
    const owner = toPartnerSafeCustomer(customer, "owner");
    expect(owner.lastName).toBe("Krishnan");
    expect(owner.phoneMasked).not.toContain("98765");
    expect(JSON.stringify(owner)).not.toContain("+919876543210");
  });
});

describe("the customer's free-text note", () => {
  test("is withheld from a partner who is only being offered the job, and after the job is over", () => {
    expect(partnerJobNote("Gate code 4421, dog at home", "offer")).toBeNull();
    expect(partnerJobNote("Gate code 4421, dog at home", "history")).toBeNull();
  });
  test("reaches the partner who holds the job", () => {
    expect(partnerJobNote("  Gate code 4421  ", "owner")).toBe("Gate code 4421");
    expect(partnerJobNote("   ", "owner")).toBeNull();
    expect(partnerJobNote(null, "owner")).toBeNull();
  });
});

describe("text written by someone else about a cancellation or a safety hold", () => {
  test("a partner reads a cancellation reason only when the partner wrote it", () => {
    expect(partnerCancellationReason("Could not reach the site", "provider")).toBe("Could not reach the site");
    expect(partnerCancellationReason("Found a cheaper option", "user")).toBeNull();
    expect(partnerCancellationReason("Fraud review FR-221, card mismatch", "admin")).toBeNull();
    expect(partnerCancellationReason("Fraud review FR-221", null)).toBeNull();
  });

  test("a hold keeps what the partner must act on and drops the admin's release reason and the incident id", () => {
    const hold = {
      id: "h1",
      condition: "GAS_LEAK",
      source: "ADMIN",
      state: "RELEASED",
      incidentId: "inc_9",
      note: null,
      raisedByRole: "ADMIN",
      raisedAt: "2026-10-06T05:00:00.000Z",
      releasedAt: "2026-10-06T06:00:00.000Z",
      releaseReason: "Verified with customer by phone; ticket OPS-311",
    };
    expect(partnerHoldView(hold)).toEqual({ ...hold, incidentId: null, releaseReason: null });
    expect(JSON.stringify(partnerHoldView(hold))).not.toMatch(/OPS-311|inc_9/);
  });
});

describe("allow-list", () => {
  const ok = {
    id: "b1",
    bookingNumber: "HOMIGO-1",
    status: "accepted",
    scheduledDate: new Date(),
    finalAmount: 500,
    customer: { firstName: "Asha", lastName: null, profileImage: null, phoneMasked: null },
    address: { label: "Home", city: "Pune", latitude: null, longitude: null },
    service: { id: "s1", name: "Sofa", icon: null, basePrice: 250 },
  };
  test("a payload of allow-listed fields has no unknown keys", () => {
    expect(unknownPartnerBookingKeys(ok)).toEqual([]);
  });
  test("a field nobody listed is reported with its path, at the top level and inside nested objects", () => {
    expect(
      unknownPartnerBookingKeys({
        ...ok,
        adminNotes: "x",
        customer: { ...ok.customer, email: "a@b.c" },
        service: { ...ok.service, operationsNotes: "x" },
        address: { ...ok.address, alternatePhone: "1" },
      }).sort(),
    ).toEqual(["address.alternatePhone", "adminNotes", "customer.email", "service.operationsNotes"]);
  });
});
