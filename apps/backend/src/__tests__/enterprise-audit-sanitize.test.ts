/**
 * Enterprise audit value sanitisation — mask personal data, keep the evidence.
 *
 * Found on live homigo_db 2026-09-29: `sanitizeAuditValue` stripped every non-digit from a whole
 * string and, when 10+ digits remained, replaced the ENTIRE value with "[REDACTED_PHONE]". A cuid
 * (`adminId`, `providerId`, `bookingId`), an ISO timestamp, a booking number or a free-text reason
 * that mentions a date all have 10+ digits, so 28,003 of 436,297 live audit rows lost who acted,
 * on which booking and when — including the reason carrying the Phase 10 content approval (draft
 * version, content hash, approver). The fix scrubs phones and emails IN PLACE with the log
 * pipeline's shield-then-scrub policy (`scrubTextForTelemetry`), so identifiers survive and a real
 * phone number or address is still never stored.
 */
import { describe, expect, test } from "bun:test";
import { sanitizeAuditValue } from "../services/enterprise-audit.service";

describe("enterprise audit: identifiers and evidence survive sanitisation", () => {
  test("a cuid actor / resource id is stored as-is", () => {
    const out = sanitizeAuditValue({ adminId: "cmq9h67pk0000tz8s6tvnpet5", providerId: "cmq6b29yz03h2tzy4hvpz43i8" });
    expect(out).toEqual({ adminId: "cmq9h67pk0000tz8s6tvnpet5", providerId: "cmq6b29yz03h2tzy4hvpz43i8" });
  });

  test("an ISO timestamp and a booking number are stored as-is", () => {
    const out = sanitizeAuditValue({ completedAt: "2026-09-29T05:24:17.058Z", bookingNumber: "HOMIGO-20260929-00001" });
    expect(out).toEqual({ completedAt: "2026-09-29T05:24:17.058Z", bookingNumber: "HOMIGO-20260929-00001" });
  });

  test("an approval reason keeps its draft version, content hash, approver and date", () => {
    const reason =
      "Phase 10 execution/safety/quality content 2026-09-28.draft.2 · deep-cleaning · hash 6d3e09f791a56dfb · approved by Asha Rao (2026-09-29T05:24:02.246Z)";
    expect(sanitizeAuditValue({ reason })).toEqual({ reason });
  });

  test("nested arrays and objects are sanitised element-wise without dropping identifiers", () => {
    const out = sanitizeAuditValue({ items: [{ bookingId: "cmugl440q0090tze0ct39tm2l" }, "2026-09-29T05:24:17Z"] });
    expect(out).toEqual({ items: [{ bookingId: "cmugl440q0090tze0ct39tm2l" }, "2026-09-29T05:24:17Z"] });
  });
});

describe("enterprise audit: personal data is still never stored", () => {
  test("a bare phone number is masked", () => {
    const out = sanitizeAuditValue({ note: "9812345678" }) as { note: string };
    expect(out.note).not.toContain("9812345678");
  });

  test("a phone number inside a sentence is masked and the rest of the sentence is kept", () => {
    const out = sanitizeAuditValue({ reason: "customer asked to call +91 98123 45678 before arrival" }) as { reason: string };
    expect(out.reason).not.toMatch(/98123\s?45678/);
    expect(out.reason).toContain("customer asked to call");
    expect(out.reason).toContain("before arrival");
  });

  test("an email address inside a sentence is masked and the rest is kept", () => {
    const out = sanitizeAuditValue({ reason: "duplicate of asha.rao@example.com account" }) as { reason: string };
    expect(out.reason).not.toContain("asha.rao@example.com");
    expect(out.reason).toContain("duplicate of");
  });

  test("keys that name personal data or secrets are redacted whatever their value", () => {
    const out = sanitizeAuditValue({ email: "a@b.co", phone: "x", phoneNumber: "y", password: "p", emailEncrypted: "e", phoneEncrypted: "f" });
    expect(out).toEqual({ email: "[REDACTED]", phone: "[REDACTED]", phoneNumber: "[REDACTED]", password: "[REDACTED]", emailEncrypted: "[REDACTED]", phoneEncrypted: "[REDACTED]" });
  });

  test("non-string scalars pass through", () => {
    expect(sanitizeAuditValue({ amount: 825, ok: true, none: null })).toEqual({ amount: 825, ok: true, none: null });
  });
});

describe("enterprise audit: no code path erases a whole value again", () => {
  test("no production source produces the whole-value erasure markers", async () => {
    const { Glob } = await import("bun");
    const offenders: string[] = [];
    for await (const file of new Glob("src/**/*.ts").scan({ cwd: `${import.meta.dir}/../..` })) {
      if (file.includes("__tests__")) continue;
      const text = await Bun.file(`${import.meta.dir}/../../${file}`).text();
      // A quoted marker is how a sanitiser returns it; the words may still appear in comments.
      if (/["'`]\[REDACTED_(PHONE|EMAIL)\]["'`]/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
