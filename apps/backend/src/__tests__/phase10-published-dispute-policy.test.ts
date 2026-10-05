/**
 * The published 48-hour quality-dispute promise, encoded per service (pure; no database).
 * Source: apps/web/src/lib/legal/legal-data.ts "Quality Disputes & Rework".
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PUBLISHED_DAMAGE_POLICY, PUBLISHED_DISPUTE_POLICY, PUBLISHED_GUARANTEE, PUBLISHED_LIABILITY, disputePolicyDecision } from "../../scripts/phase10-apply-published-dispute-policy";
import { buildWarrantySnapshot, evaluateWarrantyEligibility } from "../lib/service-warranty";
import { serviceCatalogConfigSchema } from "../lib/service-catalog-config";

const HOUR = 3_600_000;

describe("published dispute policy", () => {
  it("the published text still says what the policy encodes (a wording change must revisit the policy)", () => {
    const legal = readFileSync(join(import.meta.dir, "../../../web/src/lib/legal/legal-data.ts"), "utf8");
    expect(legal).toContain("raise a dispute within 48 hours of completion");
    expect(legal).toContain("We'll first offer a free rework");
    expect(legal).toContain("partial or full refund");
    expect(legal).toContain("with photos where possible");
  });

  it("the customer-facing guarantee and liability texts are the published clauses, word for word", () => {
    const legal = readFileSync(join(import.meta.dir, "../../../web/src/lib/legal/legal-data.ts"), "utf8");
    expect(legal).toContain(PUBLISHED_GUARANTEE);
    expect(legal).toContain(PUBLISHED_LIABILITY);
    expect(PUBLISHED_DAMAGE_POLICY.endsWith(PUBLISHED_LIABILITY)).toBe(true);
    // The damage text promises nothing beyond the policy: damage is not covered, and the report window is the policy's own.
    expect(PUBLISHED_DISPUTE_POLICY.warranty.eligibleIssueTypes).not.toContain("DAMAGE" as never);
    expect(PUBLISHED_DAMAGE_POLICY).toContain("within 48 hours of completion");
    expect(PUBLISHED_DISPUTE_POLICY.complaintWindowDays * 24).toBe(48);
    const snap = buildWarrantySnapshot(disputePolicyDecision({ requirements: [] }).next as never);
    expect(snap.guarantee).toBe(PUBLISHED_GUARANTEE);
    expect(snap.damagePolicy).toBe(PUBLISHED_DAMAGE_POLICY);
  });

  it("a service that already carries the published terms without the texts is upgraded; hand-written texts are kept", () => {
    const { guarantee: _g, damagePolicy: _d, ...terms } = PUBLISHED_DISPUTE_POLICY.warranty;
    const before = { quality: { complaintWindowDays: 2 }, warranty: terms, rework: { fee: "WAIVED" } };
    const up = disputePolicyDecision(before);
    expect(up.decision).toBe("APPLY");
    expect((up.next!.warranty as Record<string, unknown>).guarantee).toBe(PUBLISHED_GUARANTEE);
    expect(disputePolicyDecision(up.next).decision).toBe("IDENTICAL");
    const own = disputePolicyDecision({ ...before, warranty: { ...terms, guarantee: "Our own promise." } });
    expect(own).toMatchObject({ decision: "KEEP_EXISTING", conflicts: ["warranty.guarantee"] });
  });

  it("an unconfigured service gets the policy; the result passes the catalogue schema", () => {
    const r = disputePolicyDecision({ requirements: [], quality: { checklist: ["x"] } });
    expect(r.decision).toBe("APPLY");
    expect(serviceCatalogConfigSchema.safeParse(r.next).success).toBe(true);
    expect((r.next!.quality as Record<string, unknown>).checklist).toEqual(["x"]);
  });

  it("frozen snapshot: 48 h window, warranty on for QUALITY/INCOMPLETE, rework first, refund allowed", () => {
    const next = disputePolicyDecision({ requirements: [] }).next!;
    const snap = buildWarrantySnapshot(next as never);
    expect(snap).toMatchObject({ enabled: true, durationDays: 2, complaintWindowDays: 2, startEvent: "COMPLETION", reworkFirst: true, refundAllowed: true, proofRequired: false });
    expect(snap.eligibleIssueTypes).toEqual(["QUALITY", "INCOMPLETE"]);
  });

  it("47 h after completion a QUALITY issue is covered, rework offered first; 49 h later the window is closed", () => {
    const policy = buildWarrantySnapshot(disputePolicyDecision({ requirements: [] }).next as never);
    const completedAt = new Date("2026-09-28T06:00:00Z");
    const row = { state: "ACTIVE", startsAt: completedAt, expiresAt: new Date(completedAt.getTime() + 48 * HOUR) };
    const inside = evaluateWarrantyEligibility({ policy, row, completedAt, category: "QUALITY", proofPresent: false, now: new Date(completedAt.getTime() + 47 * HOUR) } as never);
    expect(inside.complaintWindowOpen).toBe(true);
    expect(inside.warrantyCovers).toBe(true);
    expect(inside.allowedActions[0]).toBe("REWORK");
    expect(inside.allowedActions).toContain("REFUND");
    const late = evaluateWarrantyEligibility({ policy, row, completedAt, category: "QUALITY", proofPresent: false, now: new Date(completedAt.getTime() + 49 * HOUR) } as never);
    expect(late.complaintWindowOpen).toBe(false);
    expect(late.reasonCodes).toContain("COMPLAINT_WINDOW_CLOSED");
  });

  it("damage is not in the published promise: not covered (a complaint can still be inspected)", () => {
    const policy = buildWarrantySnapshot(disputePolicyDecision({ requirements: [] }).next as never);
    const completedAt = new Date("2026-09-28T06:00:00Z");
    const row = { state: "ACTIVE", startsAt: completedAt, expiresAt: new Date(completedAt.getTime() + 48 * HOUR) };
    const r = evaluateWarrantyEligibility({ policy, row, completedAt, category: "DAMAGE", proofPresent: true, now: new Date(completedAt.getTime() + HOUR) } as never);
    expect(r.complaintWindowOpen).toBe(true);
    expect(r.warrantyCovers).toBe(false);
    expect(r.reasonCodes).toContain("ISSUE_TYPE_NOT_COVERED");
  });

  it("idempotent; an owner-set different policy is kept, never overwritten", () => {
    const applied = disputePolicyDecision({ requirements: [] }).next!;
    expect(disputePolicyDecision(applied).decision).toBe("IDENTICAL");
    expect(disputePolicyDecision({ warranty: { enabled: true, durationDays: 30 } }).decision).toBe("KEEP_EXISTING");
    expect(disputePolicyDecision({ quality: { complaintWindowDays: 7 } }).decision).toBe("KEEP_EXISTING");
    expect(disputePolicyDecision({ quality: { notApplicable: true } }).decision).toBe("KEEP_EXISTING");
  });

  it("encodes nothing the text does not say", () => {
    expect(PUBLISHED_DISPUTE_POLICY.warranty.exclusions).toEqual([]);
    expect(PUBLISHED_DISPUTE_POLICY.rework).toEqual({ fee: "WAIVED" });
  });
});
