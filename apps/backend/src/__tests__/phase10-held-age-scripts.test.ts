/**
 * Phase 10 — the held-service and age-policy apply scripts (pure parts; no database).
 */
import { describe, expect, it } from "bun:test";
import { DRAFT } from "../../scripts/data/phase-10-execution-safety-content-draft";
import { HELD_SLUGS, heldWorkSteps } from "../../scripts/phase10-apply-held-safety";
import { AGE_POLICY, ageDecision, ageEvidence } from "../../scripts/phase10-apply-age-policy";
import { buildNextConfig, validateOnTarget } from "../../scripts/phase10-content-apply-plan";
import { phase06Requirements } from "../../scripts/phase10-content-validate";

describe("held services", () => {
  it("the held set is exactly the six services without verified method facts", () => {
    expect(HELD_SLUGS).toEqual(["ac-service", "electrician", "fasade-cleaning", "home-painting", "pest-control", "plumbing"]);
  });

  it("no held draft carries a WORK step, and each still has arrival/safety/quality/closeout steps", () => {
    for (const slug of HELD_SLUGS) {
      const d = DRAFT[slug]!;
      expect(heldWorkSteps(d)).toEqual([]);
      const kinds = new Set(((d.execution as { steps: Array<{ kind: string }> }).steps).map((s) => s.kind));
      for (const k of ["PREPARATION", "SAFETY_CHECK", "QUALITY_CHECK", "CLOSEOUT"]) expect(kinds.has(k)).toBe(true);
      expect((d.safety?.prohibitedConditions ?? []).length).toBeGreaterThan(0);
      expect((d.safety?.warnings ?? []).length).toBeGreaterThan(0);
      expect((d.quality?.checklist ?? []).length).toBeGreaterThan(0);
    }
  });

  it("each held draft is valid on its Phase 06 requirements (the canonical admin write would accept it)", () => {
    for (const slug of HELD_SLUGS) {
      expect(validateOnTarget(buildNextConfig({ requirements: phase06Requirements(slug) }, DRAFT[slug]!))).toEqual([]);
    }
  });

  it("a held draft that gained a WORK step is refused (the method may not be invented)", () => {
    const d = structuredClone(DRAFT["electrician"]!);
    (d.execution as { steps: Array<Record<string, unknown>> }).steps.push({ id: "rewire", title: "Rewire the circuit", kind: "WORK", description: "x", evidence: "NONE", sortOrder: 99 });
    expect(heldWorkSteps(d)).toEqual(["rewire"]);
  });
});

describe("age policy", () => {
  it("no evidence → NONE v1", () => {
    expect(ageDecision({ requirements: [], faqs: [{ q: "How long does it take?", a: "About two hours." }] }).decision).toBe("APPLY_NONE");
  });

  it("a booking-age statement in the catalogue → owner decision, never a default", () => {
    for (const text of ["Suitable for 18+ only", "Not for children under 12", "Minimum age 16", "Adults only", "Not available to minors"]) {
      const r = ageDecision({ faqs: [{ q: "Who is this for?", a: text }] });
      expect(r.decision).toBe("OWNER_DECISION_REQUIRED");
      expect(r.evidence[0]!.path).toBe("faqs[0].a");
    }
  });

  it("household mentions and requirement ids are not booking-age rules", () => {
    expect(ageDecision({ requirements: [{ id: "adult-present", label: "An adult must be present during the visit" }] }).decision).toBe("APPLY_NONE");
    expect(ageDecision({ requirements: [{ customerWarning: "Tell us if anyone at home is pregnant, an infant or elderly." }] }).decision).toBe("APPLY_NONE");
    expect(ageDecision({ audiences: ["senior-women"] }, { description: "Bathing help for seniors" }).decision).toBe("APPLY_NONE");
  });

  it("does not trip on words that merely contain 'age'", () => {
    expect(ageEvidence({ faqs: [{ a: "Package includes usage of our own detergent; average visit 2 hours; manage your booking" }] })).toEqual([]);
  });

  it("an identical policy is IDENTICAL; a different explicit policy is kept, never overwritten", () => {
    expect(ageDecision({ customerPolicy: AGE_POLICY }).decision).toBe("IDENTICAL");
    expect(ageDecision({ customerPolicy: { age: { mode: "MINIMUM", minimumAge: 18 }, version: 1 } }).decision).toBe("KEEP_EXISTING");
  });

  it("media and server bookkeeping keys are not read as catalogue statements", () => {
    expect(ageEvidence({ media: { alt: "adult pouring water" }, requirementItems: [{ label: "age 18" }] })).toEqual([]);
  });
});
