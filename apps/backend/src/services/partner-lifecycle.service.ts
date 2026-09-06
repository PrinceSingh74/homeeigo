import type { PartnerLifecycleActor, PartnerLifecycleReason, PartnerLifecycleState } from "@prisma/client";
import prisma from "../lib/prisma";
import { eventPlatformConfig } from "../events/core/config";
import { emitStandalone } from "../events/core/event-publisher";
import { buildPartnerLifecycleChangedEvent, buildPartnerSuspendedEvent, buildPartnerReactivatedEvent } from "../events/catalog/partner.events";
import {
  adminActionTarget,
  assertLifecycleTransition,
  canTransitionLifecycle,
  canonicalizeLifecycle,
  getAllowedLifecycleTransitions,
  isDispatchEligibleLifecycle,
  LIFECYCLE_ONBOARDING_PATH,
  type LifecycleAction,
} from "../lib/partner-lifecycle-fsm";
import { parsePagination } from "../lib/pagination";
import { toInputJsonObject } from "../lib/json-input";

export type LifecycleTransitionInput = {
  providerId: string;
  to: PartnerLifecycleState;
  actorType: PartnerLifecycleActor;
  actorId?: string;
  reasonCode: PartnerLifecycleReason;
  reasonText?: string;
  metadata?: Record<string, unknown>;
};

export class PartnerLifecycleService {
  async getCurrent(providerId: string) {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        lifecycleState: true,
        isApproved: true,
        isActive: true,
        isOnline: true,
        pausedAt: true,
        currentStatus: true,
        complianceRestricted: true,
      },
    });
    if (!provider) return null;
    const lifecycleState = canonicalizeLifecycle(provider.lifecycleState);
    return {
      axis: "LIFECYCLE" as const,
      lifecycleState,
      allowedTransitions: getAllowedLifecycleTransitions(lifecycleState),
      dispatchEligible: isDispatchEligibleLifecycle(lifecycleState),
      availability: {
        isOnline: provider.isOnline,
        pausedAt: provider.pausedAt?.toISOString() ?? null,
        currentStatus: provider.currentStatus,
      },
      isApproved: provider.isApproved,
      isActive: provider.isActive,
      complianceRestricted: provider.complianceRestricted,
    };
  }

  async getHistory(providerId: string, query: Record<string, string | undefined> = {}) {
    const { page, limit, skip } = parsePagination({ ...query, limit: query.limit ?? "20" });
    const [rows, total] = await Promise.all([
      prisma.partnerStatusHistory.findMany({
        where: { providerId },
        orderBy: { createdAt: "desc" },
        skip,
        take: Math.min(limit, 50),
      }),
      prisma.partnerStatusHistory.count({ where: { providerId } }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        previousState: r.previousState,
        newState: r.newState,
        actorType: r.actorType,
        actorId: r.actorId,
        reasonCode: r.reasonCode,
        reasonText: r.reasonText,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      })),
      page,
      limit,
      total,
    };
  }

  async adminAction(
    providerId: string,
    action: Exclude<LifecycleAction, "advance">,
    actor: { actorType: PartnerLifecycleActor; actorId: string },
    reasonText?: string,
  ) {
    const current = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { lifecycleState: true, userId: true },
    });
    if (!current) return { error: "NOT_FOUND" as const };
    const to = adminActionTarget(action, current.lifecycleState);
    const reasonCode: PartnerLifecycleReason =
      action === "approve"
        ? "MANUAL_APPROVAL"
        : action === "reactivate"
          ? "REACTIVATION"
          : action === "review"
            ? "SAFETY_REVIEW"
            : "ADMIN_ACTION";
    if (action === "approve") {
      return this.advanceTo(providerId, "ACTIVE", actor, reasonCode, reasonText);
    }
    if (action === "reactivate") {
      const first = await this.transition({
        providerId,
        to: "REACTIVATED",
        actorType: actor.actorType,
        actorId: actor.actorId,
        reasonCode,
        reasonText,
        metadata: { action },
      });
      if ("error" in first && first.error) return first;
      return this.transition({
        providerId,
        to: "ACTIVE",
        actorType: actor.actorType,
        actorId: actor.actorId,
        reasonCode,
        reasonText,
        metadata: { action, chainedFrom: "REACTIVATED" },
      });
    }
    return this.transition({
      providerId,
      to,
      actorType: actor.actorType,
      actorId: actor.actorId,
      reasonCode,
      reasonText,
      metadata: { action },
    });
  }

  async transition(input: LifecycleTransitionInput) {
    const current = await prisma.provider.findUnique({
      where: { id: input.providerId },
      select: { lifecycleState: true, userId: true, isApproved: true, isActive: true },
    });
    if (!current) return { error: "NOT_FOUND" as const };
    // Assert against the raw write target. Canonicalizing first would turn
    // APPROVED → ACTIVE (or unknown tokens → APPLIED) into a real hop.
    try {
      assertLifecycleTransition(current.lifecycleState, input.to);
    } catch {
      return {
        error: "INVALID_TRANSITION" as const,
        from: current.lifecycleState,
        to: input.to,
        allowed: getAllowedLifecycleTransitions(current.lifecycleState),
      };
    }
    const to = canonicalizeLifecycle(input.to);
    const from = canonicalizeLifecycle(current.lifecycleState);
    if (from === to) {
      return { data: await this.getCurrent(input.providerId), unchanged: true };
    }

    const sideEffects = this.sideEffects(to);
    const updated = await prisma.$transaction(async (tx) => {
      const moved = await tx.provider.updateMany({
        where: { id: input.providerId, lifecycleState: current.lifecycleState },
        data: { lifecycleState: to, ...sideEffects },
      });
      if (moved.count === 0) {
        return { raced: true as const };
      }
      await tx.partnerStatusHistory.create({
        data: {
          providerId: input.providerId,
          previousState: current.lifecycleState,
          newState: to,
          actorType: input.actorType,
          actorId: input.actorId,
          reasonCode: input.reasonCode,
          reasonText: input.reasonText,
          metadata: input.metadata ? toInputJsonObject(input.metadata) ?? undefined : undefined,
        },
      });
      return { raced: false as const };
    });

    if (updated.raced) {
      return { error: "CONCURRENT_TRANSITION" as const };
    }

    if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.partnerEventsEnabled) {
      await emitStandalone(
        prisma,
        buildPartnerLifecycleChangedEvent({
          providerId: input.providerId,
          previousState: current.lifecycleState,
          newState: to,
          reasonCode: input.reasonCode,
          actorType: input.actorType,
        }),
      ).catch(() => undefined);
      if (to === "SUSPENDED") {
        await emitStandalone(
          prisma,
          buildPartnerSuspendedEvent({
            providerId: input.providerId,
            previousState: current.lifecycleState,
            reasonCode: input.reasonCode,
          }),
        ).catch(() => undefined);
      }
      if (to === "ACTIVE" && from === "SUSPENDED") {
        await emitStandalone(
          prisma,
          buildPartnerReactivatedEvent({
            providerId: input.providerId,
            previousState: current.lifecycleState,
            reasonCode: input.reasonCode,
          }),
        ).catch(() => undefined);
      }
    }

    await this.notifyPartner(current.userId, { ...input, to });
    if (to === "ACTIVE") {
      const { partnerReferralService } = await import("./partner-referral.service");
      void partnerReferralService.onLifecycleActive(input.providerId).catch(() => undefined);
    }
    return { data: await this.getCurrent(input.providerId) };
  }

  /**
   * Walk each legal hop so Section 01 approval does not skip the FSM.
   * APPLIED → VERIFIED → TRAINING → ACTIVE
   */
  async advanceTo(
    providerId: string,
    target: PartnerLifecycleState,
    actor: { actorType: PartnerLifecycleActor; actorId?: string },
    reasonCode: PartnerLifecycleReason,
    reasonText?: string,
  ) {
    const onboarding = LIFECYCLE_ONBOARDING_PATH;
    const goal = canonicalizeLifecycle(target);
    let guard = 0;
    while (guard++ < 12) {
      const current = await prisma.provider.findUnique({
        where: { id: providerId },
        select: { lifecycleState: true },
      });
      if (!current) return { error: "NOT_FOUND" as const };
      const currentCanonical = canonicalizeLifecycle(current.lifecycleState);
      if (currentCanonical === goal) return { data: await this.getCurrent(providerId) };
      const fromIdx = onboarding.indexOf(currentCanonical);
      const toIdx = onboarding.indexOf(goal);
      const next =
        fromIdx >= 0 && toIdx > fromIdx
          ? onboarding[fromIdx + 1]!
          : adminActionTarget(
              goal === "SUSPENDED" ? "suspend" : goal === "PAUSED" ? "pause" : goal === "UNDER_REVIEW" ? "review" : "approve",
              currentCanonical,
            );
      if (!canTransitionLifecycle(currentCanonical, next)) {
        return {
          error: "INVALID_TRANSITION" as const,
          from: current.lifecycleState,
          to: next,
          allowed: getAllowedLifecycleTransitions(currentCanonical),
        };
      }
      const result = await this.transition({
        providerId,
        to: next,
        actorType: actor.actorType,
        actorId: actor.actorId,
        reasonCode,
        reasonText,
        metadata: { advanceTo: goal },
      });
      if ("error" in result && result.error) return result;
    }
    return { error: "INVALID_TRANSITION" as const };
  }

  /**
   * Side effects on Provider flags. Does not touch wallet, ledger, or bookings.
   * Availability pause (`pausedAt`) is intentionally untouched.
   */
  private sideEffects(to: PartnerLifecycleState): {
    isApproved?: boolean;
    isActive?: boolean;
    isOnline?: boolean;
    isBanned?: boolean;
  } {
    if (to === "ACTIVE" || to === "REACTIVATED") {
      return { isApproved: true, isActive: true };
    }
    if (to === "PAUSED") {
      return { isOnline: false };
    }
    if (to === "SUSPENDED") {
      return { isActive: false, isOnline: false };
    }
    return {};
  }

  private async notifyPartner(userId: string, input: LifecycleTransitionInput) {
    const sensitive = new Set(["SAFETY_REVIEW", "RISK_POLICY"]);
    const titles: Partial<Record<PartnerLifecycleState, string>> = {
      UNDER_REVIEW: "Your account is under review",
      SUSPENDED: "Your partner account was suspended",
      REACTIVATED: "Your partner account was reactivated",
      ACTIVE: "Your partner account is active",
      PAUSED: "Your partnership is paused",
      VERIFIED: "Your application was verified",
      TRAINING: "Training is next",
      APPROVED: "Your application was approved",
    };
    const title = titles[input.to];
    if (!title) return;
    const { notificationService } = await import("./notification.service");
    const message = sensitive.has(input.reasonCode)
      ? "A required review is in progress. You will not receive new jobs until this is resolved. Existing jobs are unaffected."
      : input.reasonText || `Lifecycle is now ${input.to}.`;
    void notificationService
      .createForUser({
        userId,
        type: "partner_lifecycle_changed",
        title,
        message,
        referenceId: input.providerId,
        referenceType: "partner_lifecycle",
      })
      .catch(() => undefined);
  }

  /** Policy hook from Section 05 compliance expiry — UNDER_REVIEW, never auto-suspend. */
  async onComplianceRestricted(providerId: string, actorId?: string) {
    const current = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { lifecycleState: true },
    });
    if (!current) return;
    if (current.lifecycleState !== "ACTIVE" && current.lifecycleState !== "PAUSED") return;
    return this.transition({
      providerId,
      to: "UNDER_REVIEW",
      actorType: "COMPLIANCE",
      actorId,
      reasonCode: "COMPLIANCE_EXPIRY",
      reasonText: "A required document expired",
    });
  }

  /** Policy hook from Section 05 risk review. */
  async onRiskAction(providerId: string, action: "MONITOR" | "REVIEW" | "RESTRICT" | "SUSPEND" | "CLEAR", actorId?: string) {
    if (action === "MONITOR") return;
    const current = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { lifecycleState: true },
    });
    if (!current) return;
    if (action === "REVIEW" || action === "RESTRICT") {
      if (current.lifecycleState === "ACTIVE" || current.lifecycleState === "PAUSED") {
        return this.transition({
          providerId,
          to: "UNDER_REVIEW",
          actorType: "TRUST",
          actorId,
          reasonCode: "RISK_POLICY",
          reasonText: "Trust review required",
        });
      }
    }
    if (action === "SUSPEND") {
      const from = current.lifecycleState;
      if (from === "ACTIVE" || from === "PAUSED") {
        await this.transition({
          providerId,
          to: "UNDER_REVIEW",
          actorType: "TRUST",
          actorId,
          reasonCode: "RISK_POLICY",
        });
      }
      return this.transition({
        providerId,
        to: "SUSPENDED",
        actorType: "TRUST",
        actorId,
        reasonCode: "RISK_POLICY",
        reasonText: "Risk policy suspend",
      });
    }
    if (action === "CLEAR" && current.lifecycleState === "UNDER_REVIEW") {
      return this.transition({
        providerId,
        to: "ACTIVE",
        actorType: "TRUST",
        actorId,
        reasonCode: "ADMIN_ACTION",
        reasonText: "Risk review cleared",
      });
    }
  }

  async onApplicationApproved(providerId: string, actorId?: string) {
    return this.advanceTo(
      providerId,
      "ACTIVE",
      { actorType: "ADMIN", actorId },
      "MANUAL_APPROVAL",
      "Application approved",
    );
  }
}

export const partnerLifecycleService = new PartnerLifecycleService();
