import { describe, expect, test } from "bun:test";
import {
  assertLeadTransition,
  canTransitionLead,
  onboardingProgress,
} from "../services/partner-lead-state-machine";

describe("partner lead state machine", () => {
  test("allows valid NEW → CONTACTED transition", () => {
    expect(canTransitionLead("NEW", "CONTACTED")).toBe(true);
    expect(() => assertLeadTransition("NEW", "CONTACTED")).not.toThrow();
  });

  test("blocks invalid NEW → ACTIVATED transition", () => {
    expect(canTransitionLead("NEW", "ACTIVATED")).toBe(false);
    expect(() => assertLeadTransition("NEW", "ACTIVATED")).toThrow(/INVALID_TRANSITION/);
  });

  test("allows CONTACTED and INTERESTED to be marked duplicate", () => {
    expect(canTransitionLead("CONTACTED", "DUPLICATE")).toBe(true);
    expect(canTransitionLead("INTERESTED", "DUPLICATE")).toBe(true);
    expect(canTransitionLead("DORMANT", "DUPLICATE")).toBe(true);
  });
});

describe("onboarding progress", () => {
  test("computes percent from completed steps", () => {
    const p = onboardingProgress(["account", "otp", "services", "profile"]);
    expect(p.percentComplete).toBeGreaterThan(0);
    expect(p.completed).toContain("account");
    expect(p.remaining.length).toBeGreaterThan(0);
  });
});

describe("activation checklist", () => {
  test("blocks activation when required checks missing", async () => {
    const { buildActivationChecklist, assertActivationReady } = await import(
      "../services/partner-activation-checklist"
    );
    const result = buildActivationChecklist(
      {
        user: { firstName: "Rahul" },
        documents: [],
        partnerAssessments: [],
        academyProgress: [],
      },
      2,
    );
    expect(result.ready).toBe(false);
    expect(result.missingLabels.length).toBeGreaterThan(0);
    expect(() => assertActivationReady(result)).toThrow(/ACTIVATION_BLOCKED/);
  });

  test("allows activation when all checks pass", async () => {
    const { buildActivationChecklist, assertActivationReady } = await import(
      "../services/partner-activation-checklist"
    );
    const result = buildActivationChecklist(
      {
        user: { firstName: "Rahul" },
        panNumberHash: "hash",
        bankAccountNumberHash: "bank",
        emergencyContactName: "Mom",
        emergencyContactPhone: "+919999999999",
        backgroundCheckStatus: "CLEARED",
        documents: [{ isVerified: true }],
        partnerAssessments: [{ status: "PASSED" }],
        academyProgress: [{ completedAt: new Date() }, { completedAt: new Date() }],
      },
      2,
    );
    expect(result.ready).toBe(true);
    expect(() => assertActivationReady(result)).not.toThrow();
  });

  test("blocks activation when training modules incomplete", async () => {
    const { buildActivationChecklist } = await import("../services/partner-activation-checklist");
    const result = buildActivationChecklist(
      {
        user: { firstName: "Rahul" },
        panNumberHash: "hash",
        bankAccountNumberHash: "bank",
        emergencyContactName: "Mom",
        emergencyContactPhone: "+919999999999",
        backgroundCheckStatus: "CLEARED",
        documents: [{ isVerified: true }],
        partnerAssessments: [{ status: "PASSED" }],
        academyProgress: [{ completedAt: new Date() }],
      },
      3,
    );
    expect(result.checks.trainingComplete).toBe(false);
    expect(result.ready).toBe(false);
  });

  test("suggests earliest missing onboarding step for request changes", async () => {
    const { buildActivationChecklist } = await import("../services/partner-activation-checklist");
    const result = buildActivationChecklist(
      {
        user: { firstName: "Rahul" },
        documents: [],
        partnerAssessments: [],
        academyProgress: [],
      },
      0,
    );
    expect(result.suggestedChangeStep).toBe("profile");
    expect(result.suggestedChangeStepLabel).toBe("Profile");
  });
});

describe("request changes helpers", () => {
  test("rewinds completed steps from target step", async () => {
    const { rewindCompletedSteps } = await import("../services/partner-lead-state-machine");
    const rewound = rewindCompletedSteps(
      ["account", "otp", "services", "profile", "skills", "kyc", "documents", "submit"],
      "kyc",
    );
    expect(rewound).toEqual(["account", "otp", "services", "profile", "skills"]);
  });

  test("maps onboarding step to lead CRM status", async () => {
    const { leadStatusForOnboardingStep } = await import("../services/partner-lead-state-machine");
    expect(leadStatusForOnboardingStep("kyc")).toBe("KYC_PENDING");
    expect(leadStatusForOnboardingStep("training")).toBe("TRAINING");
    expect(leadStatusForOnboardingStep("profile")).toBe("APPLICATION_STARTED");
  });
});

describe("partner skill assessment scoring", () => {
  test("does not leak correct answers in public questions", async () => {
    const { getPublicAssessmentQuestions } = await import("../services/partner-assessment-bank");
    const pub = getPublicAssessmentQuestions("electrician");
    expect(pub.questions.length).toBeGreaterThanOrEqual(5);
    expect(pub.questions.every((q) => !("correct" in q))).toBe(true);
  });

  test("fails dummy all-yes answers and passes correct electrician answers", async () => {
    const { scoreAssessment, getPublicAssessmentQuestions } = await import(
      "../services/partner-assessment-bank"
    );
    const dummy = scoreAssessment("general", { q1: "yes", q2: "yes", q3: "yes" });
    expect(dummy.passed).toBe(false);
    expect(dummy.score).toBeLessThan(60);

    const cleaningDummy = scoreAssessment("Cleaning", { q1: "yes", c1: "yes" });
    expect(cleaningDummy.passed).toBe(false);
    expect(cleaningDummy.skillSlug).toBe("cleaning");

    const pub = getPublicAssessmentQuestions("electrician");
    const { scoreAssessment: score, assertAssessmentAnswersComplete } = await import(
      "../services/partner-assessment-bank"
    );
    const answers: Record<string, string> = {
      e1: "a",
      e2: "b",
      q3: "b",
      q4: "a",
      q5: "b",
    };
    const result = score("electrician", answers);
    expect(result.passed).toBe(true);
    expect(pub.skillSlug).toBe("electrician");
    expect(() => assertAssessmentAnswersComplete("electrician", { e1: "a" })).toThrow(/every question/);
    expect(() => assertAssessmentAnswersComplete("electrician", answers)).not.toThrow();
  });
});

describe("partner lead application invite", () => {
  test("issues a typed invite JWT that round-trips", async () => {
    const { issuePartnerLeadInvite, verifyPartnerLeadInvite } = await import(
      "../services/partner-application-invite"
    );
    const token = issuePartnerLeadInvite("lead_test_1");
    const decoded = verifyPartnerLeadInvite(token);
    expect(decoded.type).toBe("partner_lead_invite");
    expect(decoded.leadId).toBe("lead_test_1");
  });

  test("rejects terminal and hijacked invites", async () => {
    const { assertLeadInviteUsable } = await import("../services/partner-application-invite");
    expect(() => assertLeadInviteUsable({ status: "REJECTED" })).toThrow(/no longer valid/);
    expect(() => assertLeadInviteUsable({ status: "ACTIVATED" })).toThrow(/no longer valid/);
    expect(() =>
      assertLeadInviteUsable({ status: "APPLICATION_STARTED", userId: "user-a" }, "user-b"),
    ).toThrow(/already linked/);
    expect(() =>
      assertLeadInviteUsable({ status: "APPLICATION_STARTED", userId: "user-a" }, "user-a"),
    ).not.toThrow();
  });
});

describe("application submit idempotency", () => {
  test("treats registered applications as already submitted except changes-requested", async () => {
    const { isApplicationAlreadySubmitted } = await import("../services/partner-application-guards");
    expect(
      isApplicationAlreadySubmitted({ registeredAt: new Date(), registrationStatus: "PENDING" }),
    ).toBe(true);
    expect(
      isApplicationAlreadySubmitted({ registeredAt: new Date(), registrationStatus: "CHANGES_REQUESTED" }),
    ).toBe(false);
    expect(isApplicationAlreadySubmitted({ registeredAt: null, registrationStatus: "PENDING" })).toBe(false);
  });
});

describe("lead merge survivorship", () => {
  test("flags critical phone/email conflicts and prefers longer name", async () => {
    const { buildMergePreview } = await import("../services/partner-lead-merge");
    const primary = {
      id: "p1",
      name: "Rahul S.",
      phone: "9876543210",
      email: "a@test.com",
      skillInterest: "electrician",
      city: "Gurugram",
      zone: null,
      source: "REFERRAL",
      sourceCampaign: null,
      assignedToAdminId: "admin1",
      notes: "Primary notes",
      userId: null,
      providerId: null,
    } as never;
    const duplicate = {
      id: "d1",
      name: "Rahul Sharma",
      phone: "9123456789",
      email: "b@test.com",
      skillInterest: "electrician",
      city: "Gurugram",
      zone: "Sohna",
      source: "APNA",
      sourceCampaign: "spring",
      assignedToAdminId: null,
      notes: "Dup notes",
      userId: null,
      providerId: null,
    } as never;
    const preview = buildMergePreview(primary, duplicate);
    expect(preview.fields.find((f) => f.key === "name")?.suggested).toBe("duplicate");
    expect(preview.fields.find((f) => f.key === "phone")?.critical).toBe(true);
    expect(preview.fields.find((f) => f.key === "email")?.critical).toBe(true);
    expect(preview.fields.find((f) => f.key === "source")?.suggested).toBe("primary");
    expect(preview.blocking).toEqual([]);
  });

  test("blocks merge when two different providers exist", async () => {
    const { buildMergePreview } = await import("../services/partner-lead-merge");
    const preview = buildMergePreview(
      { id: "p1", name: "A", phone: "1", providerId: "prov_a", userId: null } as never,
      { id: "d1", name: "B", phone: "2", providerId: "prov_b", userId: null } as never,
    );
    expect(preview.blocking.length).toBeGreaterThan(0);
  });
});

describe("acquisition events", () => {
  test("registers lead merged event type", async () => {
    const { EVENT_TYPES } = await import("../events/catalog/event-types");
    expect(EVENT_TYPES.PARTNER_LEAD_MERGED).toBe("homigo.partner.lead.merged");
  });
});

describe("academy training applicability", () => {
  test("counts only category-matching and global published modules", async () => {
    const { academyTrainingState } = await import("../services/partner-academy-requirements");
    const published = [
      { id: "cleaning", categoryIds: ["CLEANING"] },
      { id: "global", categoryIds: [] },
      { id: "plumbing", categoryIds: ["PLUMBING"] },
    ];
    const progress = [
      { moduleId: "cleaning", completedAt: new Date() },
      { moduleId: "global", completedAt: new Date() },
    ];
    const state = academyTrainingState(published, ["CLEANING"], progress);
    expect(state.requiredModules).toBe(2);
    expect(state.completedCount).toBe(2);
    expect(state.trainingComplete).toBe(true);
  });

  test("ignores progress on unpublished-for-this-partner modules", async () => {
    const { academyTrainingState } = await import("../services/partner-academy-requirements");
    const published = [
      { id: "cleaning", categoryIds: ["CLEANING"] },
      { id: "plumbing", categoryIds: ["PLUMBING"] },
    ];
    const progress = [{ moduleId: "plumbing", completedAt: new Date() }];
    const state = academyTrainingState(published, ["CLEANING"], progress);
    expect(state.requiredModules).toBe(1);
    expect(state.completedCount).toBe(0);
    expect(state.trainingComplete).toBe(false);
  });
});
