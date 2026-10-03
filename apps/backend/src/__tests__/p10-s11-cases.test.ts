/**
 * Phase 10 §11 — case policy, pure: the transition map, what a frozen warranty lets a case lead to,
 * terminal states, evidence shapes and audiences. No I/O.
 */
import { describe, expect, test } from "bun:test";
import {
  actionAllowed,
  canTransition,
  CASE_STATES,
  CASE_TRANSITIONS,
  caseTypeFor,
  evidenceShapeError,
  evidenceVisibleTo,
  followUpFeeDecision,
  followUpKindFor,
  isProof,
  isTerminalCaseState,
  RESOLVABLE_FROM,
  reworkPolicyFrom,
  reworkWindowOpen,
  terminalStateFor,
  TERMINAL_CASE_STATES,
} from "../lib/booking-case-policy";
import { buildWarrantySnapshot, evaluateWarrantyEligibility, warrantyFromLegacyBookingSnapshot, type WarrantySnapshot } from "../lib/service-warranty";

const policy = (over: Partial<WarrantySnapshot> = {}): WarrantySnapshot => ({
  schema: "warranty.v1", enabled: true, durationDays: 30, startEvent: "COMPLETION", eligibleIssueTypes: ["QUALITY", "INCOMPLETE"],
  exclusions: [], proofRequired: false, reworkFirst: true, refundAllowed: true, complaintWindowDays: 7, ...over,
});
const day = 86_400_000;
const completedAt = new Date("2026-09-01T10:00:00Z");
const row = (state: "ACTIVE" | "EXPIRED" | "VOID" = "ACTIVE", days = 30) => ({ state, startsAt: completedAt, expiresAt: new Date(completedAt.getTime() + days * day) });
const at = (daysAfter: number) => new Date(completedAt.getTime() + daysAfter * day);

describe("§11 transition map", () => {
  test("terminal states admit nothing; every open state is reachable from the map only as listed", () => {
    expect(TERMINAL_CASE_STATES).toEqual(["RESOLVED", "REJECTED"]);
    for (const s of TERMINAL_CASE_STATES) {
      expect(isTerminalCaseState(s)).toBe(true);
      expect(CASE_TRANSITIONS[s]).toEqual([]);
      for (const to of CASE_STATES) expect(canTransition(s, to)).toBe(false);
    }
    // RESOLVED / REJECTED are decisions, never a bare transition target.
    for (const from of CASE_STATES) {
      expect(canTransition(from, "RESOLVED")).toBe(false);
      expect(canTransition(from, "REJECTED")).toBe(false);
    }
  });

  test("the map is explicit: CASE_CREATED goes to TRIAGE or ESCALATED and nowhere else; unknown states never transition", () => {
    expect(canTransition("CASE_CREATED", "TRIAGE")).toBe(true);
    expect(canTransition("CASE_CREATED", "ESCALATED")).toBe(true);
    expect(canTransition("CASE_CREATED", "ACTION")).toBe(false);
    expect(canTransition("CASE_CREATED", "INVESTIGATION")).toBe(false);
    expect(canTransition("TRIAGE", "CASE_CREATED")).toBe(false);
    expect(canTransition("ACTION", "ELIGIBILITY")).toBe(false);
    expect(canTransition("ESCALATED", "TRIAGE")).toBe(true);
    expect(canTransition("BOGUS", "TRIAGE")).toBe(false);
    expect(canTransition("TRIAGE", "BOGUS")).toBe(false);
  });

  test("a decision needs a triaged case: CASE_CREATED is not resolvable, every other open state is", () => {
    expect(RESOLVABLE_FROM).not.toContain("CASE_CREATED");
    for (const s of CASE_STATES) if (!isTerminalCaseState(s) && s !== "CASE_CREATED") expect(RESOLVABLE_FROM).toContain(s);
    expect(terminalStateFor("REJECT")).toBe("REJECTED");
    for (const a of ["REWORK", "REFUND", "INSPECTION", "NONE"] as const) expect(terminalStateFor(a)).toBe("RESOLVED");
    expect(followUpKindFor("REWORK")).toBe("REWORK");
    expect(followUpKindFor("INSPECTION")).toBe("REVISIT");
    expect(followUpKindFor("REFUND")).toBeNull();
    expect(followUpKindFor("NONE")).toBeNull();
  });
});

describe("§11 allowedActions from the frozen warranty", () => {
  test("covered issue, rework-first: REWORK leads, REFUND allowed; type WARRANTY_CLAIM", () => {
    const e = evaluateWarrantyEligibility({ policy: policy(), row: row(), completedAt, category: "QUALITY", proofPresent: false, now: at(3) });
    expect(e.complaintWindowOpen).toBe(true);
    expect(e.warrantyCovers).toBe(true);
    expect(e.allowedActions).toEqual(["REWORK", "INSPECTION", "REJECT", "REFUND"]);
    expect(caseTypeFor(e)).toBe("WARRANTY_CLAIM");
    for (const a of ["REWORK", "REFUND", "INSPECTION", "REJECT", "NONE"] as const) expect(actionAllowed(e, a)).toBe(true);
  });

  test("expired warranty row (Q6): still a complaint inside its window, but no REWORK and no REFUND without an override", () => {
    const e = evaluateWarrantyEligibility({ policy: policy(), row: row("EXPIRED"), completedAt, category: "QUALITY", proofPresent: true, now: at(3) });
    expect(e.complaintWindowOpen).toBe(true);
    expect(e.warrantyCovers).toBe(false);
    expect(e.reasonCodes).toContain("WARRANTY_EXPIRED");
    expect(e.allowedActions).toEqual(["INSPECTION", "REJECT"]);
    expect(actionAllowed(e, "REFUND")).toBe(false);
    expect(actionAllowed(e, "REWORK")).toBe(false);
    expect(actionAllowed(e, "NONE")).toBe(true);
    expect(caseTypeFor(e)).toBe("COMPLAINT");
    // The date alone expires it too — an ACTIVE row past expires_at is not cover.
    const byDate = evaluateWarrantyEligibility({ policy: policy(), row: row("ACTIVE", 2), completedAt, category: "QUALITY", proofPresent: true, now: at(3) });
    expect(byDate.warrantyCovers).toBe(false);
    expect(byDate.reasonCodes).toContain("WARRANTY_EXPIRED");
  });

  test("the policy never widens: refundAllowed=false drops REFUND, reworkFirst=false demotes REWORK, an unlisted category is not covered, VOID is not covered", () => {
    const noRefund = evaluateWarrantyEligibility({ policy: policy({ refundAllowed: false }), row: row(), completedAt, category: "QUALITY", proofPresent: false, now: at(1) });
    expect(noRefund.allowedActions).toEqual(["REWORK", "INSPECTION", "REJECT"]);
    const reworkLast = evaluateWarrantyEligibility({ policy: policy({ reworkFirst: false }), row: row(), completedAt, category: "QUALITY", proofPresent: false, now: at(1) });
    expect(reworkLast.allowedActions).toEqual(["INSPECTION", "REJECT", "REWORK", "REFUND"]);
    const damage = evaluateWarrantyEligibility({ policy: policy(), row: row(), completedAt, category: "DAMAGE", proofPresent: false, now: at(1) });
    expect(damage.warrantyCovers).toBe(false);
    expect(damage.reasonCodes).toContain("ISSUE_TYPE_NOT_COVERED");
    const voided = evaluateWarrantyEligibility({ policy: policy(), row: row("VOID"), completedAt, category: "QUALITY", proofPresent: false, now: at(1) });
    expect(voided.reasonCodes).toContain("WARRANTY_VOID");
    expect(voided.allowedActions).toEqual(["INSPECTION", "REJECT"]);
  });

  test("proofRequired: not covered until proof is attached; a note is not proof", () => {
    const without = evaluateWarrantyEligibility({ policy: policy({ proofRequired: true }), row: row(), completedAt, category: "QUALITY", proofPresent: false, now: at(1) });
    expect(without.warrantyCovers).toBe(false);
    expect(without.proofMissing).toBe(true);
    expect(without.reasonCodes).toContain("PROOF_REQUIRED");
    const withProof = evaluateWarrantyEligibility({ policy: policy({ proofRequired: true }), row: row(), completedAt, category: "QUALITY", proofPresent: true, now: at(1) });
    expect(withProof.warrantyCovers).toBe(true);
    expect(isProof("NOTE")).toBe(false);
    expect(isProof("JOB_EVIDENCE")).toBe(true);
    expect(isProof("CUSTOMER_MEDIA")).toBe(true);
  });

  test("complaint window: closed after complaintWindowDays, never configured = NO_COMPLAINT_WINDOW, no warranty at all still allows a complaint", () => {
    const closed = evaluateWarrantyEligibility({ policy: policy(), row: row(), completedAt, category: "QUALITY", proofPresent: false, now: at(8) });
    expect(closed.complaintWindowOpen).toBe(false);
    expect(closed.reasonCodes).toContain("COMPLAINT_WINDOW_CLOSED");
    const none = evaluateWarrantyEligibility({ policy: policy({ complaintWindowDays: 0 }), row: row(), completedAt, category: "QUALITY", proofPresent: false, now: at(1) });
    expect(none.complaintWindowOpen).toBe(false);
    expect(none.reasonCodes).toContain("NO_COMPLAINT_WINDOW");
    const unconfigured = evaluateWarrantyEligibility({ policy: null, row: null, completedAt, category: "QUALITY", proofPresent: false, now: at(1) });
    expect(unconfigured.complaintWindowOpen).toBe(false);
    expect(unconfigured.reasonCodes).toEqual(["NO_COMPLAINT_WINDOW", "NO_WARRANTY"]);
    const noWarranty = evaluateWarrantyEligibility({ policy: policy({ enabled: false, durationDays: 0 }), row: null, completedAt, category: "QUALITY", proofPresent: false, now: at(1) });
    expect(noWarranty.complaintWindowOpen).toBe(true);
    expect(noWarranty.warrantyCovers).toBe(false);
    expect(noWarranty.allowedActions).toEqual(["INSPECTION", "REJECT"]);
    expect(evaluateWarrantyEligibility({ policy: policy(), row: row(), completedAt: null, category: "QUALITY", proofPresent: false, now: at(1) }).reasonCodes).toContain("BOOKING_NOT_COMPLETED");
  });

  test("snapshot: the typed warranty block wins; legacy warrantyDays alone gives the narrow legacy cover; notApplicable disables", () => {
    const typed = buildWarrantySnapshot({ warranty: { enabled: true, durationDays: 10, eligibleIssueTypes: ["DAMAGE"], refundAllowed: false }, quality: { complaintWindowDays: 3 } });
    expect(typed).toMatchObject({ schema: "warranty.v1", enabled: true, durationDays: 10, eligibleIssueTypes: ["DAMAGE"], refundAllowed: false, reworkFirst: true, complaintWindowDays: 3 });
    const legacy = buildWarrantySnapshot({ quality: { warrantyDays: 5, complaintWindowDays: 2 } });
    expect(legacy).toMatchObject({ enabled: true, durationDays: 5, eligibleIssueTypes: ["QUALITY", "INCOMPLETE"], complaintWindowDays: 2 });
    expect(buildWarrantySnapshot({ quality: { warrantyDays: 5, notApplicable: true } })).toMatchObject({ enabled: false, durationDays: 0, complaintWindowDays: 0 });
    expect(buildWarrantySnapshot({ warranty: { enabled: true, durationDays: 0 } }).enabled).toBe(false);
    expect(warrantyFromLegacyBookingSnapshot({ warranty: typed })).toEqual(typed);
    expect(warrantyFromLegacyBookingSnapshot({ quality: { warrantyDays: 7 } })).toMatchObject({ enabled: true, durationDays: 7 });
    expect(warrantyFromLegacyBookingSnapshot({ quality: { warrantyDays: 7, notApplicable: true } })).toBeNull();
    expect(warrantyFromLegacyBookingSnapshot(null)).toBeNull();
  });
});

describe("§11 follow-up fee, evidence shapes and audiences", () => {
  test("only a WAIVED policy prices a follow-up (0); QUOTED needs an owner-approved price; none is not configured", () => {
    expect(followUpFeeDecision(null)).toEqual({ ok: false, error: "REWORK_FEE_NOT_CONFIGURED" });
    expect(followUpFeeDecision({})).toEqual({ ok: false, error: "REWORK_FEE_NOT_CONFIGURED" });
    expect(followUpFeeDecision({ fee: "QUOTED" })).toEqual({ ok: false, error: "OWNER_APPROVAL_REQUIRED" });
    expect(followUpFeeDecision({ fee: "WAIVED", sameProviderPreferred: true, windowDays: 14 })).toEqual({ ok: true, fee: "WAIVED", sameProviderPreferred: true, windowDays: 14 });
    expect(followUpFeeDecision({ fee: "WAIVED", windowDays: 0 })).toEqual({ ok: true, fee: "WAIVED", sameProviderPreferred: false, windowDays: null });
    expect(reworkPolicyFrom({ fee: "FREE", sameProviderPreferred: "yes", windowDays: -1 })).toEqual({});
    expect(reworkPolicyFrom("x")).toBeNull();
    expect(reworkWindowOpen(null, completedAt, at(400))).toBe(true);
    expect(reworkWindowOpen(14, completedAt, at(14))).toBe(true);
    expect(reworkWindowOpen(14, completedAt, at(15))).toBe(false);
    expect(reworkWindowOpen(14, null, at(1))).toBe(false);
  });

  test("evidence shapes: an empty id / note / media, or a non-https url, is invalid; a note is not proof", () => {
    expect(evidenceShapeError({ kind: "JOB_EVIDENCE", jobEvidenceId: " " })).toBe("EVIDENCE_INVALID");
    expect(evidenceShapeError({ kind: "JOB_EVIDENCE", jobEvidenceId: "abc" })).toBeNull();
    expect(evidenceShapeError({ kind: "CUSTOMER_MEDIA" })).toBe("EVIDENCE_INVALID");
    expect(evidenceShapeError({ kind: "CUSTOMER_MEDIA", mediaUrl: "http://x/y.jpg" })).toBe("EVIDENCE_INVALID");
    expect(evidenceShapeError({ kind: "CUSTOMER_MEDIA", mediaUrl: "https://cdn.example/y.jpg" })).toBeNull();
    expect(evidenceShapeError({ kind: "CUSTOMER_MEDIA", mediaStorageKey: "k/1" })).toBeNull();
    expect(evidenceShapeError({ kind: "NOTE", note: "" })).toBe("EVIDENCE_INVALID");
    expect(evidenceShapeError({ kind: "NOTE", note: "it leaks" })).toBeNull();
    expect(evidenceShapeError({ kind: "OTHER" } as never)).toBe("EVIDENCE_INVALID");
  });

  test("audiences: the customer sees only their own evidence, the partner customer+partner, admin everything", () => {
    expect(evidenceVisibleTo("CUSTOMER", "CUSTOMER")).toBe(true);
    expect(evidenceVisibleTo("CUSTOMER", "ADMIN")).toBe(false);
    expect(evidenceVisibleTo("CUSTOMER", "PARTNER")).toBe(false);
    expect(evidenceVisibleTo("PARTNER", "CUSTOMER")).toBe(true);
    expect(evidenceVisibleTo("PARTNER", "PARTNER")).toBe(true);
    expect(evidenceVisibleTo("PARTNER", "ADMIN")).toBe(false);
    expect(evidenceVisibleTo("PARTNER", "SYSTEM")).toBe(false);
    for (const a of ["CUSTOMER", "PARTNER", "ADMIN", "SYSTEM"]) expect(evidenceVisibleTo("ADMIN", a)).toBe(true);
  });
});
