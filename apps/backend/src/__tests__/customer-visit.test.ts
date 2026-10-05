/**
 * Phase 10 — customer visit promise and the public catalogue projection.
 * Pure: no database. Sentences must match the engines, and partner-only fields must be absent.
 */
import { describe, expect, test } from "bun:test";
import { serviceCatalogConfigSchema, publicCatalogConfig, type ServiceCatalogConfig } from "../lib/service-catalog-config";
import { customerEmergencyLine, customerVisitPromise, customerQualitySummary, startPinRequired, visitConfirmationHours } from "../lib/customer-visit";
import { confirmationWindowHours, DEFAULT_CONFIRMATION_WINDOW_HOURS } from "../services/booking-completion.service";
import { buildWarrantySnapshot } from "../lib/service-warranty";

const full = serviceCatalogConfigSchema.parse({
  safetyNotes: ["Keep children out of the room"],
  safety: {
    warnings: ["Ventilate the room"],
    prohibitedConditions: ["Gas smell"],
    providerRequirements: ["Wear gloves"],
    customerRequirements: ["Clear the work area"],
    medicalDisclaimer: "Tell the professional about any respiratory condition.",
    emergencyProtocol: "Leave the room and call 112.",
    information: "The work uses a mild cleaner.",
  },
  execution: {
    steps: [
      { id: "arrive", title: "Arrive", kind: "PREPARATION", evidence: "NONE" },
      { id: "photo", title: "Photograph", kind: "WORK", evidence: "BEFORE_AFTER_PHOTOS", ppe: ["gloves"] },
      { id: "extra", title: "Extra photo", kind: "WORK", evidence: "PHOTO", when: { variantIds: ["premium"] } },
    ],
  },
  quality: {
    checklist: ["Edges are clean"],
    completionCriteria: ["No streaks"],
    proofRequired: true,
    beforeAfterPhotos: true,
    customerConfirmation: true,
    confirmationWindowHours: 12,
    complaintWindowDays: 2,
    warrantyDays: 7,
  },
  warranty: {
    enabled: true,
    durationDays: 7,
    startEvent: "COMPLETION",
    eligibleIssueTypes: ["QUALITY", "INCOMPLETE"],
    exclusions: ["Existing damage"],
    reworkFirst: true,
    refundAllowed: true,
  },
  rework: { fee: "WAIVED", sameProviderPreferred: true, windowDays: 7 },
  customerPolicy: { age: { mode: "ADULT_ONLY", adultAge: 18 } },
  trust: { guarantee: "We guarantee perfection", backgroundCheckRequired: true },
  matching: { skillWeight: 0.5, preferredProvider: true },
  providerRequirements: { requiredSkills: ["secret-skill"], kycRequired: true, verifiedProfessionalRequired: true },
  requirements: [],
});

describe("public catalogue hides partner and matching internals", () => {
  test("execution, safety, quality, warranty, trust, age policy and matching are absent", () => {
    const pub = publicCatalogConfig(full)!;
    expect(pub.execution).toBeUndefined();
    expect(pub.safety).toBeUndefined();
    expect(pub.quality).toBeUndefined();
    expect(pub.warranty).toBeUndefined();
    expect(pub.rework).toBeUndefined();
    expect(pub.trust).toBeUndefined();
    expect(pub.customerPolicy).toBeUndefined();
    expect(pub.matching).toBeUndefined();
    expect(pub.requirements).toBeUndefined();
    expect(pub.providerRequirements).toEqual({ verifiedProfessionalRequired: true });
    expect(pub.safetyNotes).toEqual(["Keep children out of the room"]);
    const blob = JSON.stringify(pub);
    expect(blob).not.toContain("Gas smell");
    expect(blob).not.toContain("secret-skill");
    expect(blob).not.toContain("We guarantee perfection");
    expect(blob).not.toContain("Edges are clean");
    expect(blob).not.toContain("gloves");
  });
});

describe("customer visit promise", () => {
  test("process follows the booking engines, and the PIN step drops only when the flag is off", () => {
    const on = customerVisitPromise(full, { startPinRequired: true });
    expect(on.process.map((s) => s.code)).toEqual(["ARRIVAL", "VERIFICATION", "SERVICE", "CONFIRMATION"]);
    expect(on.process.find((s) => s.code === "CONFIRMATION")!.detail).toContain("12 hours");
    const off = customerVisitPromise(full, { startPinRequired: false });
    expect(off.process.map((s) => s.code)).toEqual(["ARRIVAL", "SERVICE", "CONFIRMATION"]);
    expect(startPinRequired(undefined)).toBe(true);
    expect(startPinRequired("false")).toBe(false);
    expect(startPinRequired("true")).toBe(true);
  });

  test("confirmation hours match the completion engine, including the 48-hour default", () => {
    expect(visitConfirmationHours(null)).toBe(DEFAULT_CONFIRMATION_WINDOW_HOURS);
    expect(visitConfirmationHours(full)).toBe(confirmationWindowHours({ quality: { confirmationWindowHours: 12 } }));
    const na = serviceCatalogConfigSchema.parse({ quality: { notApplicable: true, confirmationWindowHours: 12 } });
    expect(visitConfirmationHours(na)).toBe(confirmationWindowHours({ quality: null }));
  });

  test("safety is the customer view: no prohibited conditions, PPE or provider requirements", () => {
    const v = customerVisitPromise(full);
    expect(v.safety).toEqual({
      warnings: ["Ventilate the room", "Keep children out of the room"],
      customerRequirements: ["Clear the work area"],
      chemicalRestrictions: [],
      information: "The work uses a mild cleaner.",
      medicalDisclaimer: "Tell the professional about any respiratory condition.",
      emergencyProtocol: "Leave the room and call 112.",
    });
    const blob = JSON.stringify(v);
    expect(blob).not.toContain("Gas smell");
    expect(blob).not.toContain("Wear gloves");
    expect(blob).not.toContain("gloves");
    expect(blob).not.toContain("Edges are clean");
    expect(blob).not.toContain("No streaks");
    // `trust.guarantee` stays internal; only `warranty.guarantee` (customer-facing) is ever shown.
    expect(blob).not.toContain("We guarantee perfection");
    expect(v.warranty?.guarantee ?? null).toBeNull();
  });

  test("chemical restrictions, the guarantee and the damage policy are shown verbatim; PPE and the incident protocol are not", () => {
    const cfg = serviceCatalogConfigSchema.parse({
      safety: {
        ppe: ["Respirator mask"],
        chemicalRestrictions: ["No bleach on natural stone"],
        incidentProtocol: "Photograph the area and call the operations desk.",
      },
      warranty: { guarantee: "Not happy? We come back.", damagePolicy: "Report damage within 24 hours with a photo." },
    });
    const v = customerVisitPromise(cfg);
    expect(v.safety!.chemicalRestrictions).toEqual(["No bleach on natural stone"]);
    expect(v.warranty).toEqual({
      statements: [],
      exclusions: [],
      guarantee: "Not happy? We come back.",
      damagePolicy: "Report damage within 24 hours with a photo.",
    });
    const blob = JSON.stringify(v);
    expect(blob).not.toContain("Respirator mask");
    expect(blob).not.toContain("operations desk");
  });

  test("a partner-voiced emergency line is not shown as a customer instruction, and no number is invented", () => {
    expect(customerEmergencyLine("Leave the room and call 112.")).toBe("Leave the room and call 112.");
    expect(customerEmergencyLine("Stop work and do not restart.")).toBe(
      "If something is unsafe, the professional stops the service and follows the platform safety procedure.",
    );
    expect(customerEmergencyLine("Stop work. Call +91 98765 43210.")).toContain("Configured contact: +91 98765 43210.");
    expect(customerEmergencyLine(null)).toBeNull();
    const partner = serviceCatalogConfigSchema.parse({
      safety: { emergencyProtocol: "Stop work and do not restart until cleared." },
    });
    const line = customerVisitPromise(partner).safety!.emergencyProtocol!;
    expect(line).not.toContain("do not restart");
    expect(line).not.toMatch(/\b112\b/);
  });

  test("proof states what the quality flags and unconditional steps require, and flags option-only photos", () => {
    const v = customerVisitPromise(full);
    expect(v.proof!.statements).toEqual(["The professional takes before and after photos of the work."]);
    const conditional = serviceCatalogConfigSchema.parse({
      execution: { steps: [{ id: "shot", title: "Shot", kind: "WORK", evidence: "PHOTO", when: { variantIds: ["a"] } }] },
    });
    expect(customerVisitPromise(conditional).proof!.statements).toEqual(["Some options include photos of the work."]);
    expect(customerVisitPromise(null).proof).toBeNull();
  });

  test("warranty copy matches the frozen snapshot and does not promise a refund or a revisit the engine will not do", () => {
    const v = customerVisitPromise(full);
    const frozen = buildWarrantySnapshot(full);
    expect(frozen.enabled).toBe(true);
    expect(v.warranty!.statements[0]).toContain("7-day cover");
    expect(v.warranty!.statements[0]).toContain("when the visit is completed");
    expect(v.warranty!.statements.join(" ")).toContain("the result of the work");
    expect(v.warranty!.statements.join(" ")).toContain("no extra charge");
    expect(v.warranty!.statements.join(" ")).toContain("not automatic");
    expect(v.warranty!.statements.join(" ")).toContain("same professional is requested first");
    expect(v.warranty!.statements.join(" ")).toContain("2 days");
    expect(v.warranty!.exclusions).toEqual(["Existing damage"]);

    const quoted = serviceCatalogConfigSchema.parse({
      warranty: { enabled: true, durationDays: 3, refundAllowed: false, reworkFirst: true },
      rework: { fee: "QUOTED" },
    });
    const q = customerVisitPromise(quoted);
    expect(q.warranty!.statements.join(" ")).not.toContain("no extra charge");
    expect(q.warranty!.statements.join(" ")).not.toContain("refund");

    expect(customerVisitPromise(null).warranty).toBeNull();
    expect(customerVisitPromise(serviceCatalogConfigSchema.parse({})).warranty).toBeNull();
  });

  test("age is shown only when the mode has its configured number", () => {
    expect(customerVisitPromise(full).age).toEqual({ statement: "To book this service you must be at least 18 years old." });
    // The schema refuses this shape. A malformed stored policy must still not invent an age.
    const missing = { customerPolicy: { age: { mode: "MINIMUM_AGE" as const } } } as ServiceCatalogConfig;
    expect(customerVisitPromise(missing).age).toBeNull();
    const none = serviceCatalogConfigSchema.parse({ customerPolicy: { age: { mode: "NONE" } } });
    expect(customerVisitPromise(none).age).toBeNull();
    const guardian = serviceCatalogConfigSchema.parse({ customerPolicy: { age: { mode: "GUARDIAN_REQUIRED", guardianMinimumAge: 21 } } });
    expect(customerVisitPromise(guardian).age!.statement).toContain("21");
  });

  test("quality summary days follow the warranty a booking freezes, not a zero legacy field", () => {
    const cfg = serviceCatalogConfigSchema.parse({
      quality: { proofRequired: true, warrantyDays: 0, checklist: ["Edges are clean"] },
      warranty: { enabled: true, durationDays: 7, eligibleIssueTypes: ["QUALITY"] },
    });
    expect(customerQualitySummary(cfg)).toEqual({ proofRequired: true, beforeAfterPhotos: false, warrantyDays: 7 });
    expect(customerQualitySummary(cfg)!.warrantyDays).toBe(buildWarrantySnapshot(cfg).durationDays);
    expect(customerQualitySummary(null)).toBeNull();
    const blob = JSON.stringify(customerQualitySummary(cfg));
    expect(blob).not.toContain("Edges are clean");
  });

  test("an empty service still has the platform process and nothing else", () => {
    const v = customerVisitPromise(null);
    expect(v.process.length).toBeGreaterThan(0);
    expect(v.safety).toBeNull();
    expect(v.proof).toBeNull();
    expect(v.warranty).toBeNull();
    expect(v.age).toBeNull();
    expect(v.process.find((s) => s.code === "CONFIRMATION")!.detail).toContain("48 hours");
  });
});
