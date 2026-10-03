/**
 * Phase 10 — the execution / safety / quality content DRAFT for the 31 live services
 * (scripts/data/phase-10-execution-safety-content-draft.ts) passes its offline validator in-process,
 * and the pure helpers of the apply plan behave (managed keys only, approval gate, stable hash).
 * No database, no network.
 */
import { describe, expect, test } from "bun:test";
import { DRAFT, DRAFT_VERSION, STATUS_ORDER } from "../../scripts/data/phase-10-execution-safety-content-draft";
import { validateDraft } from "../../scripts/phase10-content-validate";
import { approvalFor, buildNextConfig, contentHash, diffManaged, untouchedKeysPreserved, validateOnTarget, type Approval } from "../../scripts/phase10-content-apply-plan";

const report = validateDraft();

describe("phase 10 content draft — offline validator", () => {
  test("0 violations", () => {
    expect(report.violations).toEqual([]);
    expect(report.version).toBe(DRAFT_VERSION);
  });

  test("31 services: 25 DRAFT_FOR_OWNER_REVIEW, 5 OWNER_APPROVAL_REQUIRED, 1 SAFETY_HOLD", () => {
    expect(report.totals.services).toBe(31);
    expect(report.totals.DRAFT_FOR_OWNER_REVIEW).toBe(25);
    expect(report.totals.OWNER_APPROVAL_REQUIRED).toBe(5);
    expect(report.totals.SAFETY_HOLD).toBe(1);
    expect(STATUS_ORDER.reduce((n, s) => n + (report.totals[s] ?? 0), 0)).toBe(31);
  });

  test("196 steps and 204 prohibited conditions across the draft", () => {
    expect(report.totals.steps).toBe(196);
    expect(report.totals.prohibitedConditions).toBe(204);
  });

  test("OWNER_APPROVAL_REQUIRED and SAFETY_HOLD services carry no WORK step and name their open decision", () => {
    for (const row of report.services.filter((r) => r.status !== "DRAFT_FOR_OWNER_REVIEW")) {
      expect(row.work).toBe(0);
      expect(row.openQuestions).toBeGreaterThan(3); // the 3 global questions + at least one service-specific decision
    }
  });

  test("every service has a safety block with prohibited conditions and an emergency protocol", () => {
    for (const [slug, d] of Object.entries(DRAFT)) {
      expect(d.safety?.prohibitedConditions?.length ?? 0, slug).toBeGreaterThan(0);
      expect(d.safety?.emergencyProtocol, slug).toBeTruthy();
    }
  });
});

describe("phase 10 apply plan — pure helpers", () => {
  const slug = "sofa-deep-cleaning";
  const d = DRAFT[slug]!;
  const current = {
    materialPolicy: "PROFESSIONAL_PROVIDED",
    coverage: { pincodes: ["201301"] },
    quality: { warrantyDays: 7, checklist: ["old"] },
    requirementItems: [{ code: "server-populated" }],
    requirements: [{ id: "x", itemCode: "x", responsibility: "CUSTOMER", enforcement: "INFORMATIONAL", verification: "NONE" }],
  };

  test("buildNextConfig changes only execution/safety/quality, keeps quality sub-keys the draft does not set, drops requirementItems", () => {
    const next = buildNextConfig(current, d);
    expect(next.execution).toEqual(d.execution);
    expect(next.safety).toEqual(d.safety);
    expect(next.quality).toEqual({ warrantyDays: 7, ...d.quality });
    expect("requirementItems" in next).toBe(false);
    expect(next.coverage).toEqual(current.coverage);
    expect(next.requirements).toEqual(current.requirements);
    expect(untouchedKeysPreserved(current, next)).toBe(true);
    expect(diffManaged(current, next).map((x) => x.key)).toEqual(["execution", "safety", "quality"]);
  });

  test("diffManaged is empty once the draft is already applied; a changed non-managed key is detected", () => {
    const next = buildNextConfig(current, d);
    expect(diffManaged(next, buildNextConfig(next, d))).toEqual([]);
    expect(untouchedKeysPreserved(current, { ...next, coverage: { pincodes: [] } })).toBe(false);
  });

  test("the merged config passes the real catalog schema and validateExecutionPlan on a plain target", () => {
    expect(validateOnTarget(buildNextConfig({ materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED" }, d))).toEqual([]);
  });

  test("contentHash is stable, per service, and bound to the draft version", () => {
    expect(contentHash(slug)).toBe(contentHash(slug));
    expect(contentHash(slug)).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(slug)).not.toBe(contentHash("bathroom-cleaning"));
    expect(contentHash(slug, { ...d, quality: { ...d.quality!, proofRequired: !d.quality!.proofRequired } })).not.toBe(contentHash(slug));
  });

  test("approval gate: refuses non-DRAFT statuses, missing/mismatched approvals, wrong draft version and stale hashes", () => {
    const approval: Approval = { approvedBy: "Owner", approvedAt: "2026-09-26", draftVersion: DRAFT_VERSION, services: [{ slug, contentHash: contentHash(slug) }] };
    expect(approvalFor(slug, approval, "owner")).toEqual({ ok: true });
    expect(approvalFor("no-such-service", approval, "Owner")).toEqual({ ok: false, reason: "NO_DRAFT" });
    expect(approvalFor("fasade-cleaning", { ...approval, services: [{ slug: "fasade-cleaning", contentHash: contentHash("fasade-cleaning") }] }, "Owner").ok).toBe(false);
    expect(approvalFor("electrician", { ...approval, services: [{ slug: "electrician", contentHash: contentHash("electrician") }] }, "Owner").ok).toBe(false);
    expect(approvalFor(slug, null, "Owner").ok).toBe(false);
    expect(approvalFor(slug, approval, "Someone Else").ok).toBe(false);
    expect(approvalFor(slug, { ...approval, draftVersion: "other" }, "Owner").ok).toBe(false);
    expect(approvalFor("bathroom-cleaning", approval, "Owner")).toEqual({ ok: false, reason: "REFUSED_NOT_APPROVED" });
    expect(approvalFor(slug, { ...approval, services: [{ slug, contentHash: "0".repeat(64) }] }, "Owner").ok).toBe(false);
  });

  test("every DRAFT_FOR_OWNER_REVIEW service merges cleanly onto a plain target (what the apply would write)", () => {
    for (const [s, dd] of Object.entries(DRAFT)) {
      if (dd.status !== "DRAFT_FOR_OWNER_REVIEW") continue;
      const next = buildNextConfig({ materialPolicy: "PROFESSIONAL_PROVIDED", equipmentPolicy: "PROFESSIONAL_PROVIDED" }, dd);
      // Safety-linked steps need the target's own requirements, which a plain target does not have — that is
      // exactly what INVALID_ON_TARGET reports at plan time, so only the schema half is asserted here.
      const problems = validateOnTarget(next).filter((p) => !/safety|requirement/i.test(p));
      expect(problems, s).toEqual([]);
    }
  });
});
