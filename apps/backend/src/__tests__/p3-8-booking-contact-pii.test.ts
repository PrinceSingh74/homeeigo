/**
 * P3-8 — regression for the booking-contact PII typecheck defect.
 *
 * The error was TS2345: `{ id, phoneNumber, phoneEncrypted }` not assignable to `UserPiiFields`,
 * because that shared type requires `email` AND `phoneNumber` even though `resolvePhone` reads
 * neither `email` nor anything else beyond the phone pair.
 *
 * The tempting "fix" — adding `email: true` to the booking-contact selects — would have been a
 * PRIVACY REGRESSION: it makes a partner-facing call path fetch and hold the counterparty's email,
 * PII it never uses and must not have. Casting away the mismatch would have been worse. The real
 * defect was an over-demanding type, so `resolveEmail`/`resolvePhone` were narrowed to the fields
 * they actually read. `UserPiiFields` still satisfies both, so no existing caller changed.
 *
 * These assertions are deterministic and touch neither the database nor the encryption service.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { userPiiService } from "../services/user-pii.service";
import { maskPhone, maskPhoneForPartner } from "../lib/pii-normalize";

describe("P3-8 — resolvePhone requires only the phone pair", () => {
  /**
   * The compile-level heart of the fix: this is exactly the shape booking-contact selects. If
   * `resolvePhone` ever demands `email` again, this file stops compiling and the CI typecheck
   * gate fails — which is the regression, since the runtime behaviour was never wrong.
   */
  const bookingContactShape = { id: "u1", phoneNumber: "+919876543210", phoneEncrypted: null };

  test("accepts the minimal shape and returns the plaintext phone", async () => {
    await expect(userPiiService.resolvePhone(bookingContactShape)).resolves.toBe("+919876543210");
  });

  test("returns null — never an empty string — when there is no phone at all", async () => {
    const noPhone = { id: "u2", phoneNumber: null, phoneEncrypted: null };
    const result = await userPiiService.resolvePhone(noPhone);
    expect(result).toBeNull();
    // A defaulted "" would make `Boolean(phone)` false but still flow a bogus value into
    // normalizePhone/tel: URIs downstream. Null is the only correct absence.
    expect(result).not.toBe("");
  });
});

describe("P3-8 — booking-contact fetches no PII beyond the phone pair", () => {
  let src = "";
  beforeAll(async () => {
    const file = Bun.file(`${import.meta.dir}/../services/booking-contact.service.ts`);
    src = (await file.text()).replace(/\s+/g, " ");
  });

  test("neither user select pulls the email column", () => {
    // Both loadForProvider and loadForCustomer select only id/phoneNumber/phoneEncrypted.
    expect(src).not.toContain("email: true");
    expect(src.match(/phoneEncrypted: true/g)?.length).toBe(2);
  });

  test("ownership is enforced in the query, not after it", () => {
    // The row cannot be loaded at all unless the caller owns the booking.
    expect(src).toContain("where: { id: bookingId, providerId }");
    expect(src).toContain("where: { id: bookingId, userId }");
  });

  test("raw phone numbers are never returned to either party", () => {
    // Responses expose phoneMasked only; the raw number appears solely inside the tel: dial URI,
    // which is the deliberate controlled-call action gated by CALLABLE_STATUSES.
    // Both read paths mask, and null-guard rather than defaulting.
    expect(src.match(/phoneMasked: phone \? maskPhoneForPartner\(phone\) : null/g)?.length).toBe(2);
    // X-28 (owner decision 2026-09-29): the partner → customer call returns NO number at all (no relay
    // exists); the one tel: URI left is customer → partner, which that decision does not cover.
    expect(src.match(/dialUri: `tel:\$\{e164\}`/g)?.length).toBe(1);
    expect(src).toContain('throw new Error("CALL_RELAY_UNAVAILABLE")');
    expect(src).toContain("PARTNER_CALL_RELAY_AVAILABLE = false");
    // No response field returns the unmasked value directly.
    expect(src).not.toContain("phone, canCall");
    expect(src).not.toContain("phoneNumber: phone");
  });

  test("the audit trail records a masked number, not the real one", () => {
    expect(src).toContain("call initiated to ${maskPhone(e164)}");
  });
});

describe("P3-8 — masking does not leak the subscriber number", () => {
  const real = "+919876543210";

  test("partner-facing mask reveals at most the last 4 digits", () => {
    const masked = maskPhoneForPartner(real);
    expect(masked).not.toContain("9876543210");
    expect(masked).toContain("3210");
    expect(masked).toBe("+91 •••• 3210");
  });

  test("audit mask hides the middle of the number", () => {
    expect(maskPhone(real)).not.toContain("9876543210");
  });
});
