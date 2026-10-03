import prisma from "../../../lib/prisma";
import { academyTrainingState } from "../../../services/partner-academy-requirements";
import { evaluateExpiry } from "../../../lib/compliance-expiry";
import { WithdrawalStatus } from "@prisma/client";
import type { ConditionResolver, ResolvedValue, SubjectRef } from "../types";

/**
 * The fields a condition may name.
 *
 * `onboardingInProgress` was computed below but missing from this list, so every condition asking
 * for it failed closed with UNKNOWN_FIELD — 51 `partner_onboarding_nudge` instances ended that way
 * on 2026-08-20. The allow-list is what the evaluator checks, so a value the resolver knows how to
 * produce is still unreachable until it is named here.
 *
 * Adding it invents no semantics: the meaning was already written, unambiguously, in `computed`
 * below — not approved, and still in onboarding. This closes the gap between what the resolver can
 * answer and what it admits to answering.
 */
const FIELDS = [
  "registrationStatus",
  "isApproved",
  "kycSubmitted",
  "trainingComplete",
  "onboardingInProgress",
  "changesRequested",
  /**
   * The dispatch-eligibility clauses, added for Morning Intelligence.
   *
   * These are not new policy. They are the exact six conditions `matching.service.ts` already uses
   * to decide whether a partner may be offered work, exposed here so a workflow can ask the same
   * question the dispatcher asks instead of a second, slightly different one. `pausedAt` becomes the
   * boolean `paused` because a condition compares values, not timestamps; `user.isBanned` becomes
   * `userBanned` because the resolver's field names are flat.
   */
  "isActive",
  "isBanned",
  "complianceRestricted",
  "paused",
  "userBanned",
  "isOnline",
  "complianceD30",
  "complianceD7",
  "hasFailedPayout",
  "ratingNeedsCoaching",
] as const;

export const providerResolver: ConditionResolver = {
  domain: "provider",
  acceptsSubjectTypes: ["provider"],
  fields: [...FIELDS],

  async resolve(subject: SubjectRef, field: string): Promise<ResolvedValue | null> {
    const provider = await prisma.provider.findUnique({
      where: { id: subject.subjectId },
      select: {
        registrationStatus: true,
        isApproved: true,
        panNumberHash: true,
        aadharNumberHash: true,
        serviceCategories: true,
        academyProgress: { select: { completedAt: true, moduleId: true } },
        isActive: true,
        isBanned: true,
        complianceRestricted: true,
        pausedAt: true,
        isOnline: true,
        rating: true,
        user: { select: { isBanned: true } },
        documents: { select: { expiryDate: true, isVerified: true } },
      },
    });
    if (!provider) return null;

    const now = new Date();
    let complianceD30 = false;
    let complianceD7 = false;
    for (const doc of provider.documents) {
      if (!doc.expiryDate) continue;
      const ev = evaluateExpiry(doc.expiryDate, now);
      if (ev.state === "EXPIRING_SOON" && ev.daysToExpiry != null) {
        if (ev.daysToExpiry <= 30 && ev.daysToExpiry > 7) complianceD30 = true;
        if (ev.daysToExpiry <= 7 && ev.daysToExpiry >= 0) complianceD7 = true;
      }
    }

    const failedPayout = await prisma.withdrawal.findFirst({
      where: { providerId: subject.subjectId, status: WithdrawalStatus.FAILED },
      select: { id: true },
    });

    const publishedModules = await prisma.partnerAcademyModule.findMany({
      where: { isPublished: true },
      select: { id: true, categoryIds: true },
    });
    const training = academyTrainingState(publishedModules, provider.serviceCategories, provider.academyProgress);

    const computed: Record<(typeof FIELDS)[number], unknown> = {
      registrationStatus: provider.registrationStatus,
      isApproved: provider.isApproved,
      kycSubmitted: Boolean(provider.panNumberHash || provider.aadharNumberHash),
      trainingComplete: training.trainingComplete,
      onboardingInProgress:
        !provider.isApproved &&
        (provider.registrationStatus === "PENDING" ||
          provider.registrationStatus === "CHANGES_REQUESTED"),
      changesRequested: provider.registrationStatus === "CHANGES_REQUESTED",
      isActive: provider.isActive,
      isBanned: provider.isBanned,
      complianceRestricted: provider.complianceRestricted,
      /** A pause is a state, not a moment: the condition asks whether it is paused, not when. */
      paused: provider.pausedAt !== null,
      userBanned: provider.user?.isBanned ?? true,
      isOnline: provider.isOnline,
      complianceD30,
      complianceD7,
      hasFailedPayout: Boolean(failedPayout),
      ratingNeedsCoaching: provider.rating > 0 && provider.rating < 3.5,
    };

    return { value: computed[field as (typeof FIELDS)[number]], source: "provider" };
  },
};
