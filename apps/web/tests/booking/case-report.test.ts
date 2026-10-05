/**
 * "Report an issue" is offered only when the server says a report is possible.
 *
 * Run from apps/web: `bun test tests/booking`.
 *
 * Before `report` existed on GET /:id/cases the client could only offer the form and show the
 * refusal. These tests pin both halves: the server's answer decides when it is present, and the
 * old offer-then-handle behaviour is what remains when it is absent.
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_CASE_PHOTO_BYTES,
  REPORT_REFUSAL,
  casePhotoError,
  casePhotoProblem,
  reportDecision,
  reportRefusal,
} from "@/lib/case-report";

const base = { completionState: "CONFIRMED", latestCaseState: null, refusal: null };

describe("reportDecision — the server said", () => {
  test("canReport: the action is offered", () => {
    expect(reportDecision({ ...base, report: { canReport: true, reason: null, openCaseId: null } })).toEqual({ kind: "offer", label: "Report an issue" });
  });

  test("canReport after an earlier, closed case: it is 'another' issue", () => {
    const d = reportDecision({ report: { canReport: true, reason: null, openCaseId: null }, completionState: "ISSUE_REPORTED", latestCaseState: "RESOLVED", refusal: null });
    expect(d).toEqual({ kind: "offer", label: "Report another issue" });
  });

  test("a closed window is a plain reason, never a button", () => {
    const d = reportDecision({ ...base, report: { canReport: false, reason: "COMPLAINT_WINDOW_CLOSED", openCaseId: null } });
    expect(d).toEqual({ kind: "reason", message: REPORT_REFUSAL.COMPLAINT_WINDOW_CLOSED!.message });
  });

  test("every documented reason has its own wording", () => {
    for (const reason of ["COMPLAINT_WINDOW_CLOSED", "COMPLAINT_WINDOW_NOT_CONFIGURED", "BOOKING_NOT_COMPLETED", "CASES_UNAVAILABLE"]) {
      const d = reportDecision({ ...base, report: { canReport: false, reason, openCaseId: null } });
      expect(d).toEqual({ kind: "reason", message: REPORT_REFUSAL[reason]!.message });
    }
  });

  test("a reason with no wording (NOT_FOUND, or a new code) still explains instead of offering", () => {
    for (const reason of ["NOT_FOUND", "SOMETHING_NEW"]) {
      const d = reportDecision({ ...base, report: { canReport: false, reason, openCaseId: null } });
      expect(d.kind).toBe("reason");
      expect(d.kind === "reason" && d.message.length > 0 && !d.message.includes(reason)).toBe(true);
    }
  });

  test("an open case points to that case, whatever the completion state", () => {
    for (const completionState of ["PENDING_CUSTOMER", "CONFIRMED", "AUTO_CONFIRMED", "ISSUE_REPORTED"]) {
      const d = reportDecision({ report: { canReport: false, reason: null, openCaseId: "case-1" }, completionState, latestCaseState: "TRIAGE", refusal: null });
      expect(d).toEqual({ kind: "open_case", caseId: "case-1" });
    }
  });

  test("not reportable with nothing to say shows nothing", () => {
    expect(reportDecision({ ...base, report: { canReport: false, reason: null, openCaseId: null } })).toEqual({ kind: "none" });
  });

  test("a final refusal in this session outranks an earlier canReport", () => {
    const refusal = REPORT_REFUSAL.COMPLAINT_WINDOW_CLOSED!;
    const d = reportDecision({ ...base, report: { canReport: true, reason: null, openCaseId: null }, refusal });
    expect(d).toEqual({ kind: "reason", message: refusal.message });
  });

  test("a retryable refusal does not withdraw the action", () => {
    const d = reportDecision({ ...base, report: { canReport: true, reason: null, openCaseId: null }, refusal: REPORT_REFUSAL.CASES_UNAVAILABLE });
    expect(d.kind).toBe("offer");
  });
});

describe("reportDecision — the server did not say (older backend)", () => {
  test("pending or confirmed: offer, and let the server refuse", () => {
    for (const completionState of ["PENDING_CUSTOMER", "CONFIRMED", "AUTO_CONFIRMED"]) {
      expect(reportDecision({ report: undefined, completionState, latestCaseState: null, refusal: null }).kind).toBe("offer");
    }
  });

  test("issue reported with the case still open: no second report", () => {
    expect(reportDecision({ report: null, completionState: "ISSUE_REPORTED", latestCaseState: "INVESTIGATION", refusal: null })).toEqual({ kind: "none" });
    expect(reportDecision({ report: null, completionState: "ISSUE_REPORTED", latestCaseState: null, refusal: null })).toEqual({ kind: "none" });
  });

  test("issue reported and that case closed: another can be reported", () => {
    for (const latestCaseState of ["RESOLVED", "REJECTED"]) {
      expect(reportDecision({ report: null, completionState: "ISSUE_REPORTED", latestCaseState, refusal: null })).toEqual({ kind: "offer", label: "Report another issue" });
    }
  });

  test("no completion row: nothing is offered", () => {
    expect(reportDecision({ report: null, completionState: null, latestCaseState: null, refusal: null })).toEqual({ kind: "none" });
  });

  test("a final refusal withdraws the action", () => {
    const refusal = REPORT_REFUSAL.COMPLAINT_WINDOW_NOT_CONFIGURED!;
    expect(reportDecision({ report: null, completionState: "CONFIRMED", latestCaseState: null, refusal })).toEqual({ kind: "reason", message: refusal.message });
  });
});

describe("reportRefusal", () => {
  test("known codes use our wording and their finality", () => {
    expect(reportRefusal("COMPLAINT_WINDOW_CLOSED", "server text")).toEqual(REPORT_REFUSAL.COMPLAINT_WINDOW_CLOSED!);
    expect(reportRefusal("CASES_UNAVAILABLE", null).final).toBe(false);
  });

  test("an unknown code keeps the server's message and stays retryable", () => {
    expect(reportRefusal("WHATEVER", "Try later")).toEqual({ message: "Try later", final: false });
    expect(reportRefusal(undefined, "  ")).toEqual({ message: "Could not report this issue. Please try again.", final: false });
  });
});

describe("case photos", () => {
  test("a JPG, PNG or WEBP of up to 8 MB is fine", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(casePhotoProblem({ size: 1024, type })).toBeNull();
    }
    expect(casePhotoProblem({ size: MAX_CASE_PHOTO_BYTES, type: "image/jpeg" })).toBeNull();
  });

  test("one byte over the limit is refused before any upload", () => {
    expect(casePhotoProblem({ size: MAX_CASE_PHOTO_BYTES + 1, type: "image/png" })).toContain("8 MB");
  });

  test("other types and empty files are refused", () => {
    expect(casePhotoProblem({ size: 1024, type: "image/heic" })).toContain("JPG, PNG or WEBP");
    expect(casePhotoProblem({ size: 1024, type: "application/pdf" })).not.toBeNull();
    expect(casePhotoProblem({ size: 0, type: "image/png" })).not.toBeNull();
  });

  test("a file with no declared type is left to the server, which reads the bytes", () => {
    expect(casePhotoProblem({ size: 1024, type: "" })).toBeNull();
  });

  test("every documented upload refusal has wording; anything else is generic", () => {
    const codes = ["VALIDATION_ERROR", "CASE_NOT_FOUND", "CASE_CLOSED", "EVIDENCE_LIMIT", "CASES_UNAVAILABLE"];
    const messages = codes.map(casePhotoError);
    expect(new Set(messages).size).toBe(codes.length);
    expect(casePhotoError("NOPE")).toBe(casePhotoError(undefined));
    expect(messages).not.toContain(casePhotoError(undefined));
  });
});
