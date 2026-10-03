import { PartnerRegistrationSessionStatus, type Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { sanitizeUserInput } from "../utils/sanitizer";
import {
  onboardingProgress,
  onboardingStepLabel,
  ONBOARDING_STEPS,
  rewindCompletedSteps,
  type OnboardingStep,
} from "./partner-lead-state-machine";
import {
  assertActivationReady,
  buildActivationChecklist,
  type ActivationChecklistResult,
} from "./partner-activation-checklist";
import { partnerAcquisitionEvents } from "./partner-acquisition-events.service";
import {
  assertAssessmentAnswersComplete,
  getPublicAssessmentQuestions,
  scoreAssessment,
} from "./partner-assessment-bank";
import { mapsService } from "./maps.service";
import { geofenceService } from "./geofence.service";
import { partnerOsService } from "./partner-os.service";

export class PartnerOnboardingService {
  async getProgress(userId: string) {
    const session = await prisma.partnerRegistrationSession.findUnique({
      where: { userId },
      include: {
        user: { select: { firstName: true, lastName: true, dateOfBirth: true, gender: true } },
        lead: { select: { id: true, source: true, status: true } },
      },
    });
    if (!session) throw new Error("NOT_FOUND:No onboarding session");

    const completedSteps = Array.isArray(session.completedSteps)
      ? (session.completedSteps as string[])
      : [];
    const progress = onboardingProgress(completedSteps);

    let provider: {
      registeredAt: Date | null;
      registrationStatus: string;
      isApproved: boolean;
      changesRequestedAt: Date | null;
      changesRequestedStep: string | null;
      changesRequestedNotes: string | null;
    } | null = null;

    if (session.providerId) {
      provider = await prisma.provider.findUnique({
        where: { id: session.providerId },
        select: {
          registeredAt: true,
          registrationStatus: true,
          isApproved: true,
          changesRequestedAt: true,
          changesRequestedStep: true,
          changesRequestedNotes: true,
        },
      });
    }

    const changesRequested = provider?.registrationStatus === "CHANGES_REQUESTED";
    let submitted =
      session.status === PartnerRegistrationSessionStatus.COMPLETED ||
      Boolean(provider?.registeredAt);
    if (changesRequested) submitted = false;

    const adminTargetStep = provider?.changesRequestedStep as OnboardingStep | undefined;
    const currentStep = (
      changesRequested && adminTargetStep && ONBOARDING_STEPS.includes(adminTargetStep)
        ? adminTargetStep
        : (session.currentStep ?? progress.currentStep)
    ) as OnboardingStep;

    const resumeLabel = onboardingStepLabel(currentStep);
    const canResume =
      (session.status === PartnerRegistrationSessionStatus.ACTIVE || changesRequested) &&
      !submitted &&
      provider?.registrationStatus !== "REJECTED";

    return {
      sessionId: session.id,
      providerId: session.providerId,
      leadId: session.leadId,
      currentStep,
      completedSteps: changesRequested
        ? rewindCompletedSteps(completedSteps, currentStep)
        : completedSteps,
      percentComplete: changesRequested
        ? onboardingProgress(rewindCompletedSteps(completedSteps, currentStep)).percentComplete
        : progress.percentComplete,
      draftData: session.draftData ?? {},
      lastSavedAt: session.lastSavedAt?.toISOString() ?? null,
      expiresAt: session.expiresAt.toISOString(),
      lead: session.lead,
      canResume,
      submitted,
      resumeLabel,
      nextAction: changesRequested
        ? `Update ${resumeLabel} — HQ requested changes`
        : submitted
          ? "Application submitted"
          : `Continue from ${resumeLabel}`,
      changesRequested,
      changesRequestedStep: provider?.changesRequestedStep ?? null,
      changesRequestedNotes: provider?.changesRequestedNotes ?? null,
      changesRequestedAt: provider?.changesRequestedAt?.toISOString() ?? null,
    };
  }

  async saveStep(
    userId: string,
    step: OnboardingStep,
    data: Record<string, unknown>,
    providerId?: string,
  ) {
    const session = await prisma.partnerRegistrationSession.findUnique({ where: { userId } });
    if (!session) throw new Error("NOT_FOUND:No onboarding session");
    if (session.status === PartnerRegistrationSessionStatus.COMPLETED) {
      throw new Error("CONFLICT:Application already submitted — check your approval status");
    }

    const completedSteps = new Set(
      Array.isArray(session.completedSteps) ? (session.completedSteps as string[]) : [],
    );
    completedSteps.add(step);

    const draftData = {
      ...(typeof session.draftData === "object" && session.draftData !== null
        ? (session.draftData as Record<string, unknown>)
        : {}),
      [step]: data,
    };

    await prisma.partnerRegistrationSession.update({
      where: { id: session.id },
      data: {
        currentStep: step,
        completedSteps: [...completedSteps] as Prisma.InputJsonValue,
        draftData: draftData as Prisma.InputJsonValue,
        lastSavedAt: new Date(),
        providerId: providerId ?? session.providerId,
      },
    });

    return this.getProgress(userId);
  }

  async saveProfile(userId: string, providerId: string, input: {
    dateOfBirth?: string;
    gender?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    bio?: string;
  }) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
        gender: input.gender ? sanitizeUserInput(input.gender, 32) : undefined,
      },
    });

    await prisma.provider.update({
      where: { id: providerId },
      data: {
        emergencyContactName: input.emergencyContactName
          ? sanitizeUserInput(input.emergencyContactName, 100)
          : undefined,
        emergencyContactPhone: input.emergencyContactPhone
          ? sanitizeUserInput(input.emergencyContactPhone, 20)
          : undefined,
        bio: input.bio ? sanitizeUserInput(input.bio, 500) : undefined,
      },
    });

    return this.saveStep(userId, "profile", input, providerId);
  }

  async saveSkills(userId: string, providerId: string, input: {
    primarySkill: string;
    secondarySkills?: string[];
    experienceYears: number;
    certifications?: string[];
  }) {
    await prisma.provider.update({
      where: { id: providerId },
      data: {
        primarySkill: sanitizeUserInput(input.primarySkill, 80),
        secondarySkills: input.secondarySkills?.map((s) => sanitizeUserInput(s, 80)) ?? [],
        experienceYears: input.experienceYears,
        certifications: input.certifications?.map((s) => sanitizeUserInput(s, 120)) ?? [],
        serviceCategories: [
          sanitizeUserInput(input.primarySkill, 80),
          ...(input.secondarySkills?.map((s) => sanitizeUserInput(s, 80)) ?? []),
        ],
      },
    });

    return this.saveStep(userId, "skills", input, providerId);
  }

  async saveLocation(userId: string, providerId: string, input: {
    city: string;
    serviceRegions: string[];
    serviceRadiusKm: number;
    baseLatitude?: number;
    baseLongitude?: number;
  }) {
    const city = sanitizeUserInput(input.city, 80);
    if (!city) throw new Error("VALIDATION:City is required");
    if (!Number.isFinite(input.serviceRadiusKm) || input.serviceRadiusKm < 1 || input.serviceRadiusKm > 50) {
      throw new Error("VALIDATION:Service radius must be between 1 and 50 km");
    }
    const hasLat = input.baseLatitude != null;
    const hasLng = input.baseLongitude != null;
    if (hasLat !== hasLng) {
      throw new Error("VALIDATION:Latitude and longitude must be provided together");
    }
    if (hasLat && hasLng && !mapsService.isWithinIndia(input.baseLatitude!, input.baseLongitude!)) {
      throw new Error("VALIDATION:Coordinates are outside the HOMEEIGO service area");
    }

    let geocoded: Awaited<ReturnType<typeof mapsService.reverseGeocode>> = null;
    let coverageZones: Array<{ id: string; name: string; zoneType: string; city: string | null }> = [];
    if (hasLat && hasLng) {
      geocoded = await mapsService.reverseGeocode(input.baseLatitude!, input.baseLongitude!).catch(() => null);
      const containing = await geofenceService
        .findContaining(input.baseLatitude!, input.baseLongitude!)
        .catch(() => []);
      coverageZones = containing.slice(0, 8).map((z) => ({
        id: z.id,
        name: z.name,
        zoneType: z.zoneType,
        city: z.city,
      }));
    }

    const resolvedCity = city || geocoded?.city || "";
    if (!resolvedCity) throw new Error("VALIDATION:Could not determine city for this location");

    await prisma.provider.update({
      where: { id: providerId },
      data: {
        city: resolvedCity,
        serviceRegions: input.serviceRegions.map((r) => sanitizeUserInput(r, 80)),
        serviceRadiusKm: input.serviceRadiusKm,
        baseLatitude: input.baseLatitude,
        baseLongitude: input.baseLongitude,
      },
    });

    return this.saveStep(
      userId,
      "location",
      {
        ...input,
        city: resolvedCity,
        formattedAddress: geocoded?.formattedAddress ?? null,
        coverageZones,
      },
      providerId,
    );
  }

  async saveAvailability(userId: string, providerId: string, input: {
    workingHoursStart?: string;
    workingHoursEnd?: string;
    workingDays?: string[];
  }) {
    if (!input.workingDays?.length) {
      throw new Error("VALIDATION:Select at least one working day");
    }
    await prisma.provider.update({
      where: { id: providerId },
      data: {
        workingHoursStart: input.workingHoursStart,
        workingHoursEnd: input.workingHoursEnd,
        workingDays: input.workingDays ?? [],
      },
    });

    return this.saveStep(userId, "availability", input, providerId);
  }

  async completeDocuments(userId: string, providerId: string, uploadedTypes: string[]) {
    return this.saveStep(userId, "documents", { uploadedTypes }, providerId);
  }

  getAssessmentQuestions(skillSlug?: string | null) {
    return getPublicAssessmentQuestions(skillSlug ?? "general");
  }

  async runAssessment(providerId: string, skillSlug: string, answers: Record<string, string>) {
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw new Error("NOT_FOUND:Provider not found");

    const slug = skillSlug || provider.primarySkill || "general";
    assertAssessmentAnswersComplete(slug, answers);
    const result = scoreAssessment(slug, answers);
    const status = result.passed ? "PASSED" : "RETRY_AVAILABLE";

    const assessment = await prisma.partnerAssessment.upsert({
      where: { providerId_skillSlug: { providerId, skillSlug: result.skillSlug } },
      create: {
        providerId,
        skillSlug: result.skillSlug,
        status,
        score: result.score,
        maxScore: result.maxScore,
        attempts: 1,
        completedAt: new Date(),
        metadata: {
          correctCount: result.correctCount,
          total: result.total,
        },
      },
      update: {
        status,
        score: result.score,
        attempts: { increment: 1 },
        completedAt: new Date(),
        metadata: {
          correctCount: result.correctCount,
          total: result.total,
        },
      },
    });

    await partnerAcquisitionEvents.emitAssessmentCompleted(providerId, result.skillSlug, result.passed);
    if (result.passed && provider.userId) {
      await this.saveStep(
        provider.userId,
        "assessment",
        {
          skillSlug: result.skillSlug,
          score: result.score,
          maxScore: result.maxScore,
        },
        providerId,
      );
    }
    return {
      id: assessment.id,
      skillSlug: result.skillSlug,
      status: assessment.status,
      score: result.score,
      maxScore: result.maxScore,
      passed: result.passed,
      correctCount: result.correctCount,
      total: result.total,
      attempts: assessment.attempts,
    };
  }

  async getTraining(providerId: string) {
    const academy = await partnerOsService.getAcademy(providerId);
    const requiredModules = academy.modules.length;
    const completedCount = academy.modules.filter((m) => m.completedAt).length;
    const remaining = Math.max(requiredModules - completedCount, 0);
    return {
      modules: academy.modules.map((m) => ({
        ...m,
        status: m.completedAt ? "COMPLETED" : "NOT_STARTED",
      })),
      completedCount,
      requiredModules,
      remaining,
      requiredForActivation: requiredModules > 0,
      trainingComplete: requiredModules === 0 || completedCount >= requiredModules,
      policy: "Training is required for activation, not for application submit.",
    };
  }

  async completeTrainingModule(userId: string, providerId: string, moduleId: string) {
    const result = await partnerOsService.completeAcademyModule(providerId, moduleId);
    if ("error" in result && result.error === "NOT_FOUND") {
      throw new Error("NOT_FOUND:Academy module not found");
    }
    const training = await this.getTraining(providerId);
    if (training.trainingComplete) {
      await this.saveStep(
        userId,
        "training",
        { completedCount: training.completedCount, requiredModules: training.requiredModules },
        providerId,
      );
    }
    return training;
  }

  async acknowledgeTraining(userId: string, providerId: string) {
    const training = await this.getTraining(providerId);
    await this.saveStep(
      userId,
      "training",
      {
        acknowledged: true,
        completedCount: training.completedCount,
        requiredModules: training.requiredModules,
        requiredForActivation: training.requiredForActivation,
        trainingComplete: training.trainingComplete,
      },
      providerId,
    );
    return training;
  }

  async getReview(userId: string, providerId: string) {
    const [progress, provider, documents, assessment, training] = await Promise.all([
      this.getProgress(userId),
      prisma.provider.findUnique({
        where: { id: providerId },
        include: { user: { select: { firstName: true, lastName: true, dateOfBirth: true, gender: true } } },
      }),
      prisma.providerDocument.findMany({
        where: { providerId },
        select: { documentType: true, isVerified: true, uploadStatus: true },
      }),
      prisma.partnerAssessment.findFirst({
        where: { providerId },
        orderBy: { updatedAt: "desc" },
      }),
      this.getTraining(providerId),
    ]);
    if (!provider) throw new Error("NOT_FOUND:Provider not found");

    const sections = [
      {
        id: "profile",
        label: "Profile",
        complete: progress.completedSteps.includes("profile"),
        summary: `${provider.user.firstName} ${provider.user.lastName}`.trim(),
      },
      {
        id: "services",
        label: "Services",
        complete: progress.completedSteps.includes("services") || progress.completedSteps.includes("skills"),
        summary: [provider.primarySkill, ...(provider.secondarySkills ?? [])].filter(Boolean).join(", ") || null,
      },
      {
        id: "location",
        label: "Location",
        complete: progress.completedSteps.includes("location"),
        summary: provider.city
          ? `${provider.city}${provider.serviceRadiusKm ? ` · ${provider.serviceRadiusKm} km` : ""}`
          : null,
      },
      {
        id: "availability",
        label: "Availability",
        complete: progress.completedSteps.includes("availability"),
        summary: provider.workingDays?.length
          ? `${provider.workingDays.join(", ")} ${provider.workingHoursStart ?? ""}–${provider.workingHoursEnd ?? ""}`
          : null,
      },
      {
        id: "kyc",
        label: "KYC",
        complete: progress.completedSteps.includes("kyc"),
        summary: provider.panNumberHash ? "Details saved" : "Optional — not yet provided",
      },
      {
        id: "documents",
        label: "Documents",
        complete: progress.completedSteps.includes("documents"),
        summary: documents.length ? `${documents.length} uploaded` : "None uploaded",
      },
      {
        id: "assessment",
        label: "Assessment",
        complete: assessment?.status === "PASSED",
        summary: assessment
          ? `${assessment.status}${assessment.score != null ? ` · ${assessment.score}/${assessment.maxScore}` : ""}`
          : "Not started",
      },
      {
        id: "training",
        label: "Training",
        complete: training.trainingComplete,
        summary: `${training.completedCount}/${training.requiredModules || training.modules.length} modules complete`,
      },
    ];

    const canSubmit = assessment?.status === "PASSED";
    return {
      sections,
      canSubmit,
      submitBlockers: canSubmit ? [] : ["Pass the skill assessment before submitting your application"],
      training,
      coordinates:
        provider.baseLatitude != null && provider.baseLongitude != null
          ? { lat: provider.baseLatitude, lng: provider.baseLongitude }
          : null,
    };
  }

  async acknowledgeReview(userId: string, providerId: string) {
    const review = await this.getReview(userId, providerId);
    await this.saveStep(userId, "review", { acknowledged: true, canSubmit: review.canSubmit }, providerId);
    return review;
  }

  async getActivationChecklist(providerId: string): Promise<ActivationChecklistResult> {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: {
        user: true,
        documents: true,
        partnerBackgroundCheck: true,
        partnerAssessments: true,
        academyProgress: { include: { module: true } },
      },
    });
    if (!provider) throw new Error("NOT_FOUND:Provider not found");

    const academy = await partnerOsService.getAcademy(providerId);
    const applicableIds = new Set(academy.modules.map((m) => m.id));
    return buildActivationChecklist(
      {
        ...provider,
        academyProgress: provider.academyProgress.filter((p) => applicableIds.has(p.moduleId)),
      },
      academy.modules.length,
    );
  }

  async assertReadyForActivation(providerId: string): Promise<ActivationChecklistResult> {
    const checklist = await this.getActivationChecklist(providerId);
    assertActivationReady(checklist);
    return checklist;
  }

  async verifyBackgroundCheck(providerId: string, adminUserId: string, notes?: string) {
    const provider = await prisma.provider.findUnique({ where: { id: providerId } });
    if (!provider) throw new Error("NOT_FOUND:Provider not found");

    await prisma.$transaction([
      prisma.provider.update({
        where: { id: providerId },
        data: {
          backgroundCheckStatus: "CLEARED",
          backgroundCheckDate: new Date(),
        },
      }),
      prisma.partnerBackgroundCheck.upsert({
        where: { providerId },
        create: {
          providerId,
          status: "APPROVED",
          approvedBy: adminUserId,
          approvalNotes: notes ? sanitizeUserInput(notes, 500) : undefined,
          approvedAt: new Date(),
        },
        update: {
          status: "APPROVED",
          approvedBy: adminUserId,
          approvalNotes: notes ? sanitizeUserInput(notes, 500) : undefined,
          approvedAt: new Date(),
        },
      }),
    ]);

    return this.getActivationChecklist(providerId);
  }

  async requestProviderChanges(
    providerId: string,
    adminUserId: string,
    notes: string,
    targetStepOverride?: string,
  ) {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      include: { user: true },
    });
    if (!provider) throw new Error("NOT_FOUND:Provider not found");

    const checklist = await this.getActivationChecklist(providerId);
    const targetStep = (targetStepOverride ?? checklist.suggestedChangeStep) as
      | OnboardingStep
      | undefined;

    if (!targetStep) {
      throw new Error(
        "VALIDATION:Cannot request changes — checklist is complete. Specify targetStep or reject instead.",
      );
    }
    if (!ONBOARDING_STEPS.includes(targetStep)) {
      throw new Error(`VALIDATION:Invalid onboarding step: ${targetStep}`);
    }

    const safeNotes = sanitizeUserInput(notes, 2000);
    if (!safeNotes.trim()) {
      throw new Error("VALIDATION:Notes are required when requesting changes");
    }

    const session = await prisma.partnerRegistrationSession.findFirst({
      where: { OR: [{ providerId }, { userId: provider.userId }] },
    });

    const priorCompleted = session
      ? Array.isArray(session.completedSteps)
        ? (session.completedSteps as string[])
        : []
      : [];
    const rewoundSteps = rewindCompletedSteps(priorCompleted, targetStep);

    await prisma.$transaction(async (tx) => {
      await tx.provider.update({
        where: { id: providerId },
        data: {
          registrationStatus: "CHANGES_REQUESTED",
          changesRequestedAt: new Date(),
          changesRequestedStep: targetStep,
          changesRequestedNotes: safeNotes,
          registeredAt: null,
          isApproved: false,
          rejectedAt: null,
          rejectionReason: null,
        },
      });

      if (session) {
        await tx.partnerRegistrationSession.update({
          where: { id: session.id },
          data: {
            status: PartnerRegistrationSessionStatus.ACTIVE,
            currentStep: targetStep,
            completedSteps: rewoundSteps as Prisma.InputJsonValue,
            lastSavedAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });
      }
    });

    return { checklist, targetStep, notes: safeNotes };
  }
}

export const partnerOnboardingService = new PartnerOnboardingService();
