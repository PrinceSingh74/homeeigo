import { describe, expect, test } from "bun:test";
import { daysToExpiry, evaluateExpiry, partnerFacingStatus } from "../lib/compliance-expiry";
import { maskPhoneForPartner } from "../lib/pii-normalize";
import {
  assertBookingAudience,
  collectForbiddenPartnerKeys,
  toCustomerSafePartner,
  toPartnerSafeAddress,
  toPartnerSafeCustomer,
} from "../lib/privacy-policy.engine";
import { impliedSpeedKmh, scoreFromSignals } from "../lib/partner-risk-score";

describe("Section 05 compliance expiry", () => {
  test("30/7/expired windows are backend-authoritative", () => {
    const now = new Date("2026-08-26T00:00:00Z");
    expect(evaluateExpiry(new Date("2026-09-30T00:00:00Z"), now).state).toBe("VALID");
    expect(evaluateExpiry(new Date("2026-09-20T00:00:00Z"), now).reminderWindow).toBe("D30");
    expect(evaluateExpiry(new Date("2026-09-01T00:00:00Z"), now).reminderWindow).toBe("D7");
    expect(evaluateExpiry(new Date("2026-08-25T00:00:00Z"), now).state).toBe("EXPIRED");
    expect(daysToExpiry(new Date("2026-08-26T00:00:00Z"), now)).toBe(0);
  });

  test("partner facing status never exposes risk scores", () => {
    const r = partnerFacingStatus({
      restricted: true,
      hasExpired: true,
      hasExpiring: false,
      hasUnverified: false,
      kycOk: true,
    });
    expect(r.status).toBe("RESTRICTED");
    expect(r.explanation.toLowerCase()).not.toContain("score");
  });
});

describe("Section 05 privacy engine", () => {
  test("partner never receives raw phone", () => {
    const c = toPartnerSafeCustomer({ firstName: "Asha", lastName: "K", phone: "+919876543210" });
    expect(c.phoneMasked).not.toContain("9876543210");
    expect(JSON.stringify(c)).not.toContain("9876543210");
  });

  test("an OFFER shows the first name only; the owner of the job sees surname, photo and masked phone", () => {
    const input = { firstName: "Asha", lastName: "Krishnan", profileImage: "https://cdn/p.jpg", phone: "+919876543210" };
    const offer = toPartnerSafeCustomer(input, "offer");
    expect(offer).toEqual({ firstName: "Asha", lastName: null, profileImage: null, phoneMasked: null });
    const owner = toPartnerSafeCustomer(input, "owner");
    expect(owner.lastName).toBe("Krishnan");
    expect(owner.profileImage).toBe("https://cdn/p.jpg");
    expect(owner.phoneMasked).not.toBeNull();
    // default stays the owner projection (existing callers that already own the job)
    expect(toPartnerSafeCustomer(input).lastName).toBe("Krishnan");
  });

  test("history address is minimized", () => {
    const addr = toPartnerSafeAddress(
      {
        label: "Home",
        fullAddress: "12 MG Road, Bengaluru",
        addressLine1: "12 MG Road",
        addressLine2: null,
        buildingName: "A",
        flatNumber: "1",
        landmark: "Park",
        specialInstructions: "Gate code 4455",
        city: "Bengaluru",
        state: "KA",
        zipCode: "560001",
        latitude: 12.9,
        longitude: 77.6,
      },
      {
        audience: "partner",
        purpose: "booking_history",
        bookingId: "b1",
        bookingStatus: "COMPLETED",
      },
    );
    expect(addr?.addressLine1).toBeNull();
    expect(addr?.specialInstructions).toBeNull();
    expect(addr?.latitude).toBeNull();
    expect(addr?.fullAddress).toContain("Bengaluru");
  });

  test("forbidden partner keys are detected on nested payloads", () => {
    expect(collectForbiddenPartnerKeys({ customer: { phoneMasked: "••••3210" } })).toEqual([]);
    expect(collectForbiddenPartnerKeys({ bankAccountNumber: "1234", nested: { riskScore: 9 } })).toEqual([
      "bankAccountNumber",
      "riskScore",
    ]);
  });

  test("cross-booking audience is denied", () => {
    expect(
      assertBookingAudience(
        {
          audience: "partner",
          purpose: "booking_fulfilment",
          bookingId: "A",
          bookingStatus: "IN_PROGRESS",
          authorizedPartnerId: "p1",
        },
        { partnerId: "p2" },
      ),
    ).toBe(false);
  });

  test("customer-safe partner omits KYC and bank", () => {
    const p = toCustomerSafePartner({
      id: "prov1",
      firstName: "Ravi",
      lastName: "S",
      rating: 4.8,
      phone: "+919111111111",
    });
    expect(JSON.stringify(p)).not.toMatch(/kyc|bank|risk/i);
    expect(p.phoneMasked).toBe(maskPhoneForPartner("+919111111111"));
  });
});

describe("Section 05 risk scoring", () => {
  test("empty signals are LOW and explainable", () => {
    const r = scoreFromSignals([]);
    expect(r.level).toBe("LOW");
    expect(r.score).toBe(0);
    expect(r.explanation.why).toMatch(/no active/i);
  });

  test("one weak GPS signal does not reach HIGH", () => {
    const r = scoreFromSignals([{ type: "GPS_SPOOF", severity: 40, confidence: 0.4 }]);
    expect(r.level === "LOW" || r.level === "MEDIUM").toBe(true);
    expect(r.score).toBeLessThan(50);
  });

  test("impossible travel speed helper", () => {
    const speed = impliedSpeedKmh(1400, 2 * 60 * 1000);
    expect(speed).not.toBeNull();
    expect(speed!).toBeGreaterThan(400);
  });

  test("explainability lists signal types without auto-convicting", () => {
    const r = scoreFromSignals([
      { type: "FAKE_ARRIVAL", severity: 50, confidence: 0.6 },
      { type: "FAKE_COMPLETION", severity: 50, confidence: 0.6 },
      { type: "CANCELLATION_ABUSE", severity: 45, confidence: 0.7 },
    ]);
    expect(r.explanation.why).toMatch(/FAKE_ARRIVAL|fake arrival/i);
    expect(r.level).not.toBe("CRITICAL");
  });
});
