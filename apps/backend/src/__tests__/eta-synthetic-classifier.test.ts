import { describe, expect, test } from "bun:test";
import { isSyntheticBookingNumber } from "../services/eta-intelligence.service";

describe("production booking-number recognition", () => {
  test("accepts the exact format nextBookingNumber() mints", () => {
    expect(isSyntheticBookingNumber("HOMIGO-20260807-00001")).toBe(false);
    expect(isSyntheticBookingNumber("HOMIGO-20260101-99999")).toBe(false);
  });

  test("rejects certification and verification fixtures", () => {
    expect(isSyntheticBookingNumber("P2VERIFY-1786182192225")).toBe(true);
    expect(isSyntheticBookingNumber("CERT-1786182192225")).toBe(true);
    expect(isSyntheticBookingNumber("PROBE-001")).toBe(true);
    expect(isSyntheticBookingNumber("ADV-adv-audit-mq6uke74-REF")).toBe(true);
    expect(isSyntheticBookingNumber("FRAUD-1")).toBe(true);
    expect(isSyntheticBookingNumber("RZP-99")).toBe(true);
  });

  test("rejects near-misses of the production format", () => {
    expect(isSyntheticBookingNumber("HOMIGO-2026087-00001")).toBe(true);   // 7-digit date
    expect(isSyntheticBookingNumber("HOMIGO-20260807-0001")).toBe(true);   // 4-digit seq
    expect(isSyntheticBookingNumber("HOMIGO-20260807-000012")).toBe(true); // 6-digit seq
    expect(isSyntheticBookingNumber("homigo-20260807-00001")).toBe(true);  // lowercase
    expect(isSyntheticBookingNumber("XHOMIGO-20260807-00001")).toBe(true); // prefixed
    expect(isSyntheticBookingNumber("HOMIGO-20260807-00001X")).toBe(true); // suffixed
    expect(isSyntheticBookingNumber("HOMIGO-20260807-0000A")).toBe(true);  // non-numeric seq
  });

  test("treats missing identity as synthetic — fails closed", () => {
    expect(isSyntheticBookingNumber(null)).toBe(true);
    expect(isSyntheticBookingNumber(undefined)).toBe(true);
    expect(isSyntheticBookingNumber("")).toBe(true);
  });

  test("is an allowlist: an unknown future prefix is excluded by default", () => {
    // The risk to avoid is a new fixture prefix silently entering ETA training.
    expect(isSyntheticBookingNumber("NEWFIXTURE-20260807-00001")).toBe(true);
    expect(isSyntheticBookingNumber("STAGING-20260807-00001")).toBe(true);
  });
});
