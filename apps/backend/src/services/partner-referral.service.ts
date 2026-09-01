import {
  BookingStatus,
  PaymentStatus,
  Prisma,
  type PartnerReferralStatus as DbReferralStatus,
} from "@prisma/client";
import prisma from "../lib/prisma";
import type { FraudContext } from "../lib/fraud-context";
import {
  assertReferralTransition,
  nextReferralHop,
  type PartnerReferralStatus,
} from "../lib/partner-referral-fsm";
import {
  evaluateQualificationGates,
  MAJOR_COMPLAINT_CATEGORIES,
  MAJOR_COMPLAINT_PRIORITIES,
  PARTNER_REFERRAL_INVITE_TTL_DAYS,
  PARTNER_REFERRAL_REWARD_RUPEES,
  partnerFacingQualLabel,
  QUALIFYING_JOB_TARGET,
} from "../lib/partner-referral-policy";
import {
  generatePartnerReferralCode,
  normalizePartnerReferralCode,
} from "../lib/partner-referral-code";
import { partnerWebOrigin, issuePartnerLeadInvite } from "./partner-application-invite";
import { partnerLeadService } from "./partner-lead.service";
import { partnerReferralAbuseService } from "./partner-referral-abuse.service";
import { financialLedgerService } from "./financial-ledger.service";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { paiseToRupees, rupeesToPaise } from "../lib/money-paise";
import { notificationService } from "./notification.service";
import { AuditLogService } from "./audit-log.service";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { earningsLiveService } from "./earnings-live.service";
import { eventPlatformConfig } from "../events/core/config";
import { emitStandalone } from "../events/core/event-publisher";
import { buildPartnerReferralEvent } from "../events/catalog/partner.events";
import { EVENT_TYPES } from "../events/catalog/event-types";

const EVENT_BY_STATUS: Partial<Record<PartnerReferralStatus, string>> = {
  INVITED: EVENT_TYPES.PARTNER_REFERRAL_INVITED,
  REGISTERED: EVENT_TYPES.PARTNER_REFERRAL_REGISTERED,
  VERIFIED: EVENT_TYPES.PARTNER_REFERRAL_VERIFIED,
  TRAINING: EVENT_TYPES.PARTNER_REFERRAL_TRAINING,
  ACTIVE: EVENT_TYPES.PARTNER_REFERRAL_ACTIVATED,
  FIRST_JOB: EVENT_TYPES.PARTNER_REFERRAL_FIRST_JOB,
  QUALIFIED: EVENT_TYPES.PARTNER_REFERRAL_QUALIFIED,
  REWARD_RELEASED: EVENT_TYPES.PARTNER_REFERRAL_REWARDED,
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export class PartnerReferralService {
  async ensureCode(providerId: string) {
    const existing = await prisma.partnerReferralCode.findUnique({ where: { providerId } });
    if (existing && !existing.isRevoked) return existing;
    for (let i = 0; i < 8; i++) {
      const code = generatePartnerReferralCode();
      try {
        if (existing?.isRevoked) {
          return prisma.partnerReferralCode.update({
            where: { providerId },
            data: { code, isRevoked: false, revokedAt: null },
          });
        }
        return await prisma.partnerReferralCode.create({ data: { providerId, code } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
    }
    throw new Error("CONFLICT:Could not allocate a referral code");
  }

  async revokeCode(providerId: string, actorId: string) {
    const row = await prisma.partnerReferralCode.update({
      where: { providerId },
      data: { isRevoked: true, revokedAt: new Date() },
    }).catch(() => null);
    await AuditLogService.success("ADMIN_ACTION", {
      userId: actorId,
      details: { action: "REVOKE_PARTNER_REFERRAL_CODE", providerId },
    });
    return row;
  }

  async previewCode(raw: string) {
    const code = normalizePartnerReferralCode(raw);
    const row = await prisma.partnerReferralCode.findUnique({
      where: { code },
      include: { provider: { select: { businessName: true, user: { select: { firstName: true } } } } },
    });
    if (!row || row.isRevoked) return { valid: false as const };
    if (row.expiresAt && row.expiresAt < new Date()) return { valid: false as const };
    return {
      valid: true as const,
      code: row.code,
      referrerFirstName: row.provider.user.firstName,
      referrerLabel: row.provider.businessName || row.provider.user.firstName,
    };
  }

  shareUrl(code: string) {
    return `${partnerWebOrigin()}/register?ref=${encodeURIComponent(code)}`;
  }

  async invite(input: {
    referrerProviderId: string;
    name: string;
    phone: string;
    email?: string;
    city?: string;
    skillInterest?: string;
    campaign?: string;
  }) {
    const codeRow = await this.ensureCode(input.referrerProviderId);
    const findings = await partnerReferralAbuseService.inspectPair({
      referrerProviderId: input.referrerProviderId,
    });
    const referrer = await prisma.provider.findUnique({
      where: { id: input.referrerProviderId },
      select: {
        userId: true,
        user: { select: { id: true, phoneHash: true, phoneNumber: true, phoneEncrypted: true } },
      },
    });
    if (!referrer) throw new Error("NOT_FOUND:Referrer not found");
    const { userPiiService } = await import("./user-pii.service");
    const inviteeHash = userPiiService.hashPhone(input.phone);
    let referrerHash = referrer.user.phoneHash ?? null;
    if (!referrerHash) {
      const resolved = await userPiiService.resolvePhone(referrer.user, {
        actorId: referrer.userId,
        authorized: true,
      });
      if (resolved) referrerHash = userPiiService.hashPhone(resolved);
    }
    if (referrerHash && referrerHash === inviteeHash) {
      throw new Error("VALIDATION:You cannot refer yourself");
    }

    const expiresAt = new Date(Date.now() + PARTNER_REFERRAL_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    let lead;
    try {
      lead = await partnerLeadService.createLead({
        name: input.name,
        phone: input.phone,
        email: input.email,
        city: input.city,
        skillInterest: input.skillInterest,
        source: "PARTNER_REFERRAL",
        sourceCampaign: input.campaign,
        channel: "partner_network",
        metadata: {
          referrerProviderId: input.referrerProviderId,
          referralCode: codeRow.code,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.startsWith("DUPLICATE:")) {
        throw new Error("CONFLICT:This person already has a partner application");
      }
      throw err;
    }

    const existing = await prisma.partnerReferral.findUnique({ where: { referredLeadId: lead.id } });
    if (existing) {
      throw new Error("CONFLICT:This invite is already attributed");
    }

    const referral = await prisma.partnerReferral.create({
      data: {
        referrerProviderId: input.referrerProviderId,
        referredLeadId: lead.id,
        referralCode: codeRow.code,
        source: "PARTNER_REFERRAL",
        campaign: input.campaign ?? null,
        status: "INVITED",
        invitedAt: new Date(),
        expiresAt,
        history: {
          create: { fromStatus: null, toStatus: "INVITED", actorType: "partner", actorId: input.referrerProviderId, reason: "invite" },
        },
      },
    });

    const decision = partnerReferralAbuseService.decision(findings);
    if (decision.review !== "NONE") {
      await prisma.partnerReferral.update({
        where: { id: referral.id },
        data: {
          reviewStatus: decision.review,
          qualificationStatus: decision.blockReward ? "BLOCKED" : "PENDING",
          blockedReason: decision.blockReward ? "Anti-abuse review" : null,
        },
      });
    }
    await partnerReferralAbuseService.persist(referral.id, findings, input.referrerProviderId);
    if (decision.review !== "NONE") {
      await this.notifyAdminReview(referral.id, decision.review);
    }

    const inviteToken = issuePartnerLeadInvite(lead.id);
    await this.emitStatus(referral.id, "INVITED");
    await this.notifyReferrer(input.referrerProviderId, {
      title: "Referral invited",
      message: `${input.name.split(" ")[0] ?? "Your invite"} received your HOMEEIGO partner invite.`,
      referenceId: referral.id,
    });

    return {
      referralId: referral.id,
      leadId: lead.id,
      status: referral.status,
      code: codeRow.code,
      shareUrl: this.shareUrl(codeRow.code),
      inviteUrl: `${partnerWebOrigin()}/register?invite=${encodeURIComponent(inviteToken)}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async claimOnRegistration(input: {
    refereeUserId: string;
    referralCode?: string | null;
    inviteLeadId?: string | null;
    ctx?: FraudContext;
  }) {
    const code = input.referralCode ? normalizePartnerReferralCode(input.referralCode) : null;
    let referral = input.inviteLeadId
      ? await prisma.partnerReferral.findUnique({ where: { referredLeadId: input.inviteLeadId } })
      : null;

    if (!referral && code) {
      const codeRow = await prisma.partnerReferralCode.findUnique({ where: { code } });
      if (!codeRow || codeRow.isRevoked) return { attributed: false as const, reason: "invalid_code" };
      const referrer = await prisma.provider.findUnique({
        where: { id: codeRow.providerId },
        select: { id: true, userId: true },
      });
      if (!referrer) return { attributed: false as const, reason: "invalid_code" };
      if (referrer.userId === input.refereeUserId) {
        return { attributed: false as const, reason: "self_referral" };
      }

      const user = await prisma.user.findUnique({
        where: { id: input.refereeUserId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          phoneHash: true,
          phoneNumber: true,
          phoneEncrypted: true,
          email: true,
          emailEncrypted: true,
          partnerLead: { select: { id: true } },
        },
      });
      if (user?.partnerLead?.id) {
        const locked = await prisma.partnerReferral.findUnique({ where: { referredLeadId: user.partnerLead.id } });
        if (locked) return { attributed: false as const, reason: "already_attributed" };
      }

      let leadId = input.inviteLeadId ?? user?.partnerLead?.id ?? null;
      if (!leadId) {
        const { userPiiService } = await import("./user-pii.service");
        const phone = user
          ? await userPiiService.resolvePhone(user, { actorId: input.refereeUserId, authorized: true })
          : null;
        const email = user
          ? await userPiiService.resolveEmail(user, { actorId: input.refereeUserId, authorized: true })
          : null;
        if (phone) {
          try {
            const lead = await partnerLeadService.createLead({
              name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Partner applicant",
              phone,
              email: email ?? undefined,
              source: "PARTNER_REFERRAL",
              channel: "partner_referral_link",
              metadata: { referrerProviderId: referrer.id, referralCode: code, refereeUserId: input.refereeUserId },
            });
            leadId = lead.id;
            await prisma.partnerLead.update({
              where: { id: leadId },
              data: { userId: input.refereeUserId },
            }).catch(() => undefined);
          } catch {
            leadId = null;
          }
        }
      }

      if (leadId) {
        const raced = await prisma.partnerReferral.findUnique({ where: { referredLeadId: leadId } });
        if (raced) return { attributed: false as const, reason: "already_attributed" };
      }

      try {
        referral = await prisma.partnerReferral.create({
          data: {
            referrerProviderId: referrer.id,
            referredLeadId: leadId,
            referralCode: code,
            source: "PARTNER_REFERRAL",
            status: "INVITED",
            invitedAt: new Date(),
            history: {
              create: { fromStatus: null, toStatus: "INVITED", actorType: "system", actorId: input.refereeUserId, reason: "claim" },
            },
          },
        });
        await this.emitStatus(referral.id, "INVITED");
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          return { attributed: false as const, reason: "already_attributed" };
        }
        throw err;
      }
    }

    if (!referral) return { attributed: false as const, reason: "no_referral" };

    const findings = await partnerReferralAbuseService.inspectPair({
      referrerProviderId: referral.referrerProviderId,
      refereeUserId: input.refereeUserId,
      ctx: input.ctx,
    });
    await partnerReferralAbuseService.persist(referral.id, findings, referral.referrerProviderId);
    const decision = partnerReferralAbuseService.decision(findings);
    if (decision.review !== "NONE") {
      await this.notifyAdminReview(referral.id, decision.review);
    }

    if (referral.status === "INVITED") {
      await this.advance(referral.id, "REGISTERED", {
        actorType: "system",
        actorId: input.refereeUserId,
        reason: "otp_verified",
        extra: {
          registeredAt: new Date(),
          reviewStatus: decision.review === "NONE" ? referral.reviewStatus : decision.review,
          qualificationStatus: decision.blockReward ? "BLOCKED" : referral.qualificationStatus,
          blockedReason: decision.blockReward ? findings.find((f) => f.strong)?.note ?? "Anti-abuse review" : undefined,
        },
      });
    }

    await this.notifyReferrer(referral.referrerProviderId, {
      title: "Referral registered",
      message: "Someone used your partner invite and verified their mobile.",
      referenceId: referral.id,
    });

    return { attributed: true as const, referralId: referral.id };
  }

  async bindProvider(providerId: string, userId: string) {
    const lead = await prisma.partnerLead.findFirst({
      where: { OR: [{ providerId }, { userId }] },
      select: { id: true, referral: { select: { id: true, referredProviderId: true } } },
    });
    const referral =
      lead?.referral ??
      (await prisma.partnerReferral.findFirst({
        where: {
          referredProviderId: null,
          OR: [
            { referredLeadId: lead?.id ?? "__none__" },
            { lead: { userId } },
            { history: { some: { actorId: userId, toStatus: "REGISTERED" } } },
          ],
        },
        orderBy: { createdAt: "desc" },
      }));
    if (!referral) return;
    if (referral.referredProviderId && referral.referredProviderId !== providerId) return;
    await prisma.partnerReferral.update({
      where: { id: referral.id },
      data: { referredProviderId: providerId, referredLeadId: lead?.id ?? undefined },
    }).catch(() => undefined);
    await this.syncFromCanonical(providerId);
  }

  async onVerified(providerId: string) {
    await this.syncFromCanonical(providerId);
  }

  async onTraining(providerId: string) {
    await this.syncFromCanonical(providerId);
  }

  async onLifecycleActive(providerId: string) {
    await this.syncFromCanonical(providerId);
  }

  async onJobCompleted(providerId: string, bookingId: string) {
    const referral = await this.byReferredProvider(providerId);
    if (!referral) return;
    const jobs = await this.countSuccessfulJobs(providerId);
    const extra: Prisma.PartnerReferralUpdateInput = { successfulJobs: jobs };
    if (jobs >= 1 && !referral.firstJobAt) extra.firstJobAt = new Date();
    if (referral.status === "ACTIVE" && jobs >= 1) {
      await this.advance(referral.id, "FIRST_JOB", { reason: `job:${bookingId}`, extra });
    } else {
      await prisma.partnerReferral.update({ where: { id: referral.id }, data: extra });
    }
    if (jobs === QUALIFYING_JOB_TARGET || jobs === QUALIFYING_JOB_TARGET - 1) {
      await this.notifyReferrer(referral.referrerProviderId, {
        title: jobs >= QUALIFYING_JOB_TARGET ? "3 successful jobs completed" : "Referral job milestone",
        message:
          jobs >= QUALIFYING_JOB_TARGET
            ? "Your referral completed 3 successful jobs. Qualification is being evaluated."
            : `Your referral has completed ${jobs} of ${QUALIFYING_JOB_TARGET} successful jobs.`,
        referenceId: referral.id,
      });
    }
    await this.evaluateAndMaybeQualify(referral.id);
  }

  async onRiskUpdated(providerId: string) {
    const asReferred = await this.byReferredProvider(providerId);
    if (asReferred) await this.evaluateAndMaybeQualify(asReferred.id);
    const made = await prisma.partnerReferral.findMany({
      where: { referrerProviderId: providerId, status: { in: ["FIRST_JOB", "QUALIFIED"] } },
      select: { id: true },
      take: 50,
    });
    for (const row of made) await this.evaluateAndMaybeQualify(row.id);
  }

  async syncFromCanonical(providerId: string) {
    const referral = await this.byReferredProvider(providerId);
    if (!referral) return;
    const findings = await partnerReferralAbuseService.inspectPair({
      referrerProviderId: referral.referrerProviderId,
      refereeProviderId: providerId,
    });
    await partnerReferralAbuseService.persist(referral.id, findings, referral.referrerProviderId);
    const decision = partnerReferralAbuseService.decision(findings);
    if (decision.review !== "NONE") {
      await prisma.partnerReferral.update({
        where: { id: referral.id },
        data: {
          reviewStatus: decision.review,
          qualificationStatus: decision.blockReward ? "BLOCKED" : referral.qualificationStatus,
          blockedReason: decision.blockReward ? findings.find((f) => f.strong)?.note ?? "Anti-abuse review" : referral.blockedReason,
        },
      });
      await this.notifyAdminReview(referral.id, decision.review);
    }
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { isVerified: true, lifecycleState: true },
    });
    if (!provider) return;
    const academy = await this.trainingComplete(providerId);
    const jobs = await this.countSuccessfulJobs(providerId);
    await prisma.partnerReferral.update({
      where: { id: referral.id },
      data: { successfulJobs: jobs, firstJobAt: jobs >= 1 ? referral.firstJobAt ?? new Date() : referral.firstJobAt },
    });
    if (provider.isVerified) await this.walkTo(referral.id, "VERIFIED", { verifiedAt: new Date() }, "sync_verified");
    if (academy) await this.walkTo(referral.id, "TRAINING", { trainingAt: new Date() }, "sync_training");
    if (provider.lifecycleState === "ACTIVE") {
      await this.walkTo(referral.id, "ACTIVE", { activatedAt: new Date() }, "sync_active");
    }
    if (jobs >= 1) await this.walkTo(referral.id, "FIRST_JOB", { firstJobAt: new Date() }, "sync_first_job");
    await this.evaluateAndMaybeQualify(referral.id);
  }

  async evaluateAndMaybeQualify(referralId: string) {
    const referral = await prisma.partnerReferral.findUnique({ where: { id: referralId } });
    if (!referral || !referral.referredProviderId) return { qualified: false as const };
    if (referral.status === "REWARD_RELEASED") return { qualified: true as const, already: true as const };

    const eval_ = await this.qualificationSnapshot(referral.referredProviderId, referral);
    const nextQual = eval_.blocked ? "BLOCKED" : eval_.eligible ? "ELIGIBLE" : "PENDING";
    await prisma.partnerReferral.update({
      where: { id: referralId },
      data: {
        successfulJobs: eval_.jobs,
        qualificationStatus: referral.qualificationStatus === "REWARDED" ? "REWARDED" : nextQual,
        blockedReason: eval_.blocked ? eval_.blockReasons[0] ?? "Blocked" : null,
      },
    });

    if (!eval_.eligible) return { qualified: false as const, evaluation: eval_ };
    if (referral.status !== "FIRST_JOB" && referral.status !== "QUALIFIED") {
      return { qualified: false as const, evaluation: eval_ };
    }
    if (referral.status === "FIRST_JOB") {
      await this.advance(referralId, "QUALIFIED", {
        reason: "qualification_engine",
        extra: { qualifiedAt: new Date(), qualificationStatus: "QUALIFIED" },
      });
      await this.notifyReferrer(referral.referrerProviderId, {
        title: "Referral qualified",
        message: "Your referral met every qualification gate. Reward is being processed.",
        referenceId: referralId,
      });
    }
    await this.creditReward(referralId, { actorId: "system", reason: "auto_qualify" });
    return { qualified: true as const, evaluation: eval_ };
  }

  async creditReward(
    referralId: string,
    actor: { actorId: string; reason: string },
  ): Promise<{ created: boolean; rewardId?: string; amount?: number; error?: string }> {
    const referral = await prisma.partnerReferral.findUnique({ where: { id: referralId } });
    if (!referral) return { created: false, error: "NOT_FOUND" };
    if (referral.status === "REWARD_RELEASED") {
      const existing = await prisma.partnerReferralReward.findUnique({ where: { referralId } });
      return { created: false, rewardId: existing?.id, amount: existing?.amount };
    }
    if (referral.status !== "QUALIFIED") return { created: false, error: "NOT_QUALIFIED" };
    if (referral.reviewStatus === "BLOCKED" || referral.reviewStatus === "HELD") {
      return { created: false, error: "HELD" };
    }
    const eval_ = referral.referredProviderId
      ? await this.qualificationSnapshot(referral.referredProviderId, referral)
      : null;
    if (!eval_?.eligible) return { created: false, error: "GATES_FAILED" };

    const amount = round2(PARTNER_REFERRAL_REWARD_RUPEES);
    const idempotencyKey = `partner_referral_reward:${referralId}`;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const fresh = await tx.partnerReferral.findUnique({ where: { id: referralId } });
        if (!fresh || fresh.status !== "QUALIFIED") return { created: false as const };
        const dup = await tx.partnerReferralReward.findUnique({ where: { referralId } });
        if (dup?.status === "CREDITED") return { created: false as const, rewardId: dup.id, amount: dup.amount };

        const locked = await tx.$queryRaw<
          Array<{ user_id: string | null; wallet_balance: number; wallet_balance_paise: bigint | null }>
        >`
          SELECT user_id, wallet_balance, wallet_balance_paise
          FROM providers WHERE id = ${referral.referrerProviderId} FOR UPDATE
        `;
        const provider = locked[0];
        if (!provider) throw new Error("PROVIDER_NOT_FOUND");

        const reward = dup
          ? await tx.partnerReferralReward.update({
              where: { id: dup.id },
              data: { status: "PENDING", amount },
            })
          : await tx.partnerReferralReward.create({
              data: {
                referralId,
                referrerProviderId: referral.referrerProviderId,
                amount,
                status: "PENDING",
                idempotencyKey,
                releasedBy: actor.actorId,
                releaseReason: actor.reason,
              },
            });

        const amountPaise = rupeesToPaise(amount);
        const beforePaise = provider.wallet_balance_paise ?? rupeesToPaise(provider.wallet_balance);
        const afterPaise = beforePaise + amountPaise;
        const balanceBefore = paiseToRupees(beforePaise);
        const balanceAfter = paiseToRupees(afterPaise);

        await tx.provider.update({
          where: { id: referral.referrerProviderId },
          data: { walletBalance: balanceAfter, walletBalancePaise: afterPaise },
        });

        const walletTxn = await tx.walletTransaction.create({
          data: {
            transactionNumber: await nextWalletTxnNumber(tx),
            providerId: referral.referrerProviderId,
            amount,
            amountPaise,
            walletBalanceBefore: balanceBefore,
            walletBalanceBeforePaise: beforePaise,
            walletBalanceAfter: balanceAfter,
            walletBalanceAfterPaise: afterPaise,
            type: "BONUS",
            status: "COMPLETED",
            description: "Partner referral reward",
            reason: "PARTNER_REFERRAL",
            referenceId: reward.id,
            referenceType: "partner_referral_reward",
            idempotencyKey: `partner_referral_wallet:${referralId}`,
            completedAt: new Date(),
            metadata: JSON.stringify({ referralId, referredProviderId: referral.referredProviderId }),
          },
        });

        const journal = await financialLedgerService.recordPartnerReferralRewardInTransaction(tx, {
          rewardId: reward.id,
          referralId,
          providerId: referral.referrerProviderId,
          amount,
        });

        await tx.partnerReferralReward.update({
          where: { id: reward.id },
          data: {
            status: "CREDITED",
            walletTxnId: walletTxn.id,
            ledgerJournalId: journal.id,
            creditedAt: new Date(),
          },
        });

        assertReferralTransition(fresh.status, "REWARD_RELEASED");
        await tx.partnerReferral.update({
          where: { id: referralId, status: "QUALIFIED" },
          data: {
            status: "REWARD_RELEASED",
            rewardedAt: new Date(),
            qualificationStatus: "REWARDED",
          },
        });
        await tx.partnerReferralStatusHistory.create({
          data: {
            referralId,
            fromStatus: "QUALIFIED",
            toStatus: "REWARD_RELEASED",
            actorType: actor.actorId === "system" ? "system" : "admin",
            actorId: actor.actorId,
            reason: actor.reason,
          },
        });

        return {
          created: true as const,
          rewardId: reward.id,
          amount,
          userId: provider.user_id,
          walletTxnId: walletTxn.id,
        };
      });

      if (result.created) {
        recordFinancialMetric("partner_referral_reward_total", 1);
        recordFinancialMetric("partner_referral_reward_amount", result.amount ?? amount);
        await AuditLogService.success("PARTNER_REFERRAL_REWARD_CREDITED", {
          userId: result.userId ?? undefined,
          details: {
            referralId,
            rewardId: result.rewardId,
            amount: result.amount,
            walletTxnId: result.walletTxnId,
            actorId: actor.actorId,
          },
        });
        await this.emitStatus(referralId, "REWARD_RELEASED");
        if (result.userId) {
          await notificationService.createForUser({
            userId: result.userId,
            type: "REFERRAL",
            title: "Referral reward released",
            message: `₹${result.amount} was credited to your partner wallet.`,
            referenceId: result.rewardId,
            priority: "high",
          }).catch(() => undefined);
          void earningsLiveService.broadcastEarningsUpdate(result.userId).catch(() => undefined);
        }
      }
      return result;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const raced = await prisma.partnerReferralReward.findUnique({ where: { referralId } });
        return { created: false, rewardId: raced?.id, amount: raced?.amount };
      }
      throw err;
    }
  }

  async partnerDashboard(providerId: string) {
    const codeRow = await this.ensureCode(providerId);
    const rows = await prisma.partnerReferral.findMany({
      where: { referrerProviderId: providerId },
      include: {
        referred: { select: { businessName: true, user: { select: { firstName: true, lastName: true } } } },
        lead: { select: { name: true } },
        reward: { select: { status: true, amount: true, creditedAt: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const counts = {
      invited: 0,
      registered: 0,
      verified: 0,
      training: 0,
      active: 0,
      firstJob: 0,
      qualified: 0,
      rewarded: 0,
    };
    for (const r of rows) {
      if (this.reached(r.status, "INVITED")) counts.invited += 1;
      if (this.reached(r.status, "REGISTERED")) counts.registered += 1;
      if (this.reached(r.status, "VERIFIED")) counts.verified += 1;
      if (this.reached(r.status, "TRAINING")) counts.training += 1;
      if (this.reached(r.status, "ACTIVE")) counts.active += 1;
      if (this.reached(r.status, "FIRST_JOB")) counts.firstJob += 1;
      if (this.reached(r.status, "QUALIFIED")) counts.qualified += 1;
      if (this.reached(r.status, "REWARD_RELEASED")) counts.rewarded += 1;
    }
    const rewardAgg = await prisma.partnerReferralReward.aggregate({
      where: { referrerProviderId: providerId, status: "CREDITED" },
      _sum: { amount: true },
    });
    return {
      code: codeRow.code,
      shareUrl: this.shareUrl(codeRow.code),
      rewardPerQualified: PARTNER_REFERRAL_REWARD_RUPEES,
      jobTarget: QUALIFYING_JOB_TARGET,
      counts,
      totalRewarded: rewardAgg._sum.amount ?? 0,
      referrals: rows.map((r) => this.partnerFacingRow(r)),
    };
  }

  async adminOverview() {
    const [byStatus, byQual, bySource, rewards, riskOpen, liability, topRaw] = await Promise.all([
      prisma.partnerReferral.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.partnerReferral.groupBy({ by: ["qualificationStatus"], _count: { _all: true } }),
      prisma.partnerReferral.groupBy({ by: ["source"], _count: { _all: true } }),
      prisma.partnerReferralReward.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amount: true } }),
      prisma.partnerReferral.count({ where: { reviewStatus: "OPEN" } }),
      prisma.partnerReferral.count({
        where: { qualificationStatus: { in: ["ELIGIBLE", "QUALIFIED"] }, status: { not: "REWARD_RELEASED" } },
      }),
      prisma.partnerReferral.groupBy({
        by: ["referrerProviderId"],
        _count: { _all: true },
        orderBy: { _count: { referrerProviderId: "desc" } },
        take: 8,
      }),
    ]);
    const credited = rewards.find((r) => r.status === "CREDITED");
    const held = rewards.find((r) => r.status === "HELD");
    const pending = rewards.find((r) => r.status === "PENDING");
    const blocked = rewards.find((r) => r.status === "BLOCKED");
    const funnel = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
    const invited =
      (funnel.INVITED ?? 0) +
      (funnel.REGISTERED ?? 0) +
      (funnel.VERIFIED ?? 0) +
      (funnel.TRAINING ?? 0) +
      (funnel.ACTIVE ?? 0) +
      (funnel.FIRST_JOB ?? 0) +
      (funnel.QUALIFIED ?? 0) +
      (funnel.REWARD_RELEASED ?? 0);
    const registered = invited - (funnel.INVITED ?? 0);
    const activated =
      (funnel.ACTIVE ?? 0) + (funnel.FIRST_JOB ?? 0) + (funnel.QUALIFIED ?? 0) + (funnel.REWARD_RELEASED ?? 0);
    const firstJob = (funnel.FIRST_JOB ?? 0) + (funnel.QUALIFIED ?? 0) + (funnel.REWARD_RELEASED ?? 0);
    const qualified = (funnel.QUALIFIED ?? 0) + (funnel.REWARD_RELEASED ?? 0);
    const referrerIds = topRaw.map((t) => t.referrerProviderId);
    const referrers = referrerIds.length
      ? await prisma.provider.findMany({
          where: { id: { in: referrerIds } },
          select: { id: true, city: true, user: { select: { firstName: true, lastName: true } } },
        })
      : [];
    const nameOf = (id: string) => {
      const p = referrers.find((r) => r.id === id);
      if (!p) return "Partner";
      return [p.user.firstName, p.user.lastName].filter(Boolean).join(" ") || "Partner";
    };
    return {
      funnel,
      reached: {
        invited,
        registered,
        verified: registered - (funnel.REGISTERED ?? 0),
        training: (funnel.TRAINING ?? 0) + activated,
        active: activated,
        firstJob,
        qualified,
        rewarded: funnel.REWARD_RELEASED ?? 0,
      },
      sources: bySource.map((s) => ({ source: s.source, referrals: s._count._all })),
      topReferrers: topRaw.map((t) => ({
        providerId: t.referrerProviderId,
        name: nameOf(t.referrerProviderId),
        referrals: t._count._all,
      })),
      qualification: Object.fromEntries(byQual.map((s) => [s.qualificationStatus, s._count._all])),
      conversion: {
        invitedToRegisteredPct: invited > 0 ? Math.round((registered / invited) * 1000) / 10 : null,
        registeredToActivePct: registered > 0 ? Math.round((activated / registered) * 1000) / 10 : null,
        qualifiedPct: invited > 0 ? Math.round((qualified / invited) * 1000) / 10 : null,
      },
      economics: {
        released: credited?._sum.amount ?? 0,
        releasedCount: credited?._count._all ?? 0,
        held: held?._sum.amount ?? 0,
        pending: pending?._sum.amount ?? 0,
        blocked: blocked?._sum.amount ?? 0,
        qualifiedAwaitingReward: liability,
        rewardAmount: PARTNER_REFERRAL_REWARD_RUPEES,
        liabilityEstimate: liability * PARTNER_REFERRAL_REWARD_RUPEES,
      },
      riskOpen,
    };
  }

  async adminList(query: {
    status?: string;
    review?: string;
    city?: string;
    campaign?: string;
    source?: string;
    from?: string;
    to?: string;
    risk?: string;
    q?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const where: Prisma.PartnerReferralWhereInput = {};
    if (query.status) where.status = query.status as DbReferralStatus;
    if (query.review) where.reviewStatus = query.review as never;
    if (query.source) where.source = query.source as never;
    if (query.campaign) where.campaign = { contains: query.campaign, mode: "insensitive" };
    if (query.city) where.referred = { city: { contains: query.city, mode: "insensitive" } };
    if (query.risk === "open" || query.risk === "1") {
      where.OR = [{ reviewStatus: { in: ["OPEN", "HELD", "BLOCKED"] } }, { signals: { some: {} } }];
    }
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    const [total, rows] = await Promise.all([
      prisma.partnerReferral.count({ where }),
      prisma.partnerReferral.findMany({
        where,
        include: {
          referrer: { select: { id: true, city: true, user: { select: { firstName: true, lastName: true } } } },
          referred: { select: { id: true, city: true, lifecycleState: true, user: { select: { firstName: true } } } },
          lead: { select: { name: true, city: true } },
          reward: { select: { status: true, amount: true } },
          _count: { select: { signals: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      total,
      page,
      limit,
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        qualificationStatus: r.qualificationStatus,
        reviewStatus: r.reviewStatus,
        successfulJobs: r.successfulJobs,
        campaign: r.campaign,
        source: r.source,
        signalCount: r._count.signals,
        referrer: {
          id: r.referrer.id,
          name: [r.referrer.user.firstName, r.referrer.user.lastName].filter(Boolean).join(" "),
          city: r.referrer.city,
        },
        referred: {
          id: r.referred?.id ?? null,
          name: r.referred?.user.firstName ?? r.lead?.name ?? "Invited",
          city: r.referred?.city ?? r.lead?.city ?? null,
          lifecycle: r.referred?.lifecycleState ?? null,
        },
        reward: r.reward,
        createdAt: r.createdAt,
      })),
    };
  }

  async adminDetail(referralId: string) {
    const r = await prisma.partnerReferral.findUnique({
      where: { id: referralId },
      include: {
        referrer: { select: { id: true, city: true, lifecycleState: true, user: { select: { firstName: true, lastName: true } } } },
        referred: { select: { id: true, city: true, lifecycleState: true, user: { select: { firstName: true } } } },
        lead: { select: { id: true, name: true, city: true, status: true, source: true } },
        reward: true,
        history: { orderBy: { createdAt: "asc" } },
        signals: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!r) return null;
    const evaluation = r.referredProviderId
      ? await this.qualificationSnapshot(r.referredProviderId, r)
      : null;
    return { ...r, evaluation, rewardPolicy: PARTNER_REFERRAL_REWARD_RUPEES };
  }

  async adminAction(
    referralId: string,
    action: "review" | "approve" | "block" | "release" | "hold",
    actorId: string,
    reason?: string,
  ) {
    const referral = await prisma.partnerReferral.findUnique({ where: { id: referralId } });
    if (!referral) throw new Error("NOT_FOUND:Referral not found");
    if (action === "review") {
      await prisma.partnerReferral.update({
        where: { id: referralId },
        data: { reviewStatus: "OPEN" },
      });
    }
    if (action === "approve") {
      await prisma.partnerReferral.update({
        where: { id: referralId },
        data: { reviewStatus: "APPROVED", qualificationStatus: referral.qualificationStatus === "BLOCKED" ? "PENDING" : referral.qualificationStatus, blockedReason: null },
      });
      await this.evaluateAndMaybeQualify(referralId);
    }
    if (action === "block") {
      await prisma.partnerReferral.update({
        where: { id: referralId },
        data: {
          reviewStatus: "BLOCKED",
          qualificationStatus: "BLOCKED",
          blockedReason: reason ?? "Admin blocked",
        },
      });
      await prisma.partnerReferralReward.updateMany({
        where: { referralId, status: { in: ["PENDING", "HELD"] } },
        data: { status: "BLOCKED", releaseReason: reason },
      });
    }
    if (action === "hold") {
      await prisma.partnerReferral.update({
        where: { id: referralId },
        data: { reviewStatus: "HELD", blockedReason: reason ?? "Reward held" },
      });
      await prisma.partnerReferralReward.updateMany({
        where: { referralId, status: "PENDING" },
        data: { status: "HELD", releaseReason: reason },
      });
    }
    if (action === "release") {
      if (!reason?.trim()) throw new Error("VALIDATION:Reason is required to release a reward");
      await prisma.partnerReferral.update({
        where: { id: referralId },
        data: { reviewStatus: "APPROVED", blockedReason: null },
      });
      if (referral.status !== "QUALIFIED" && referral.status !== "REWARD_RELEASED") {
        await this.evaluateAndMaybeQualify(referralId);
      }
      const credited = await this.creditReward(referralId, { actorId, reason });
      if (credited.error && credited.error !== "NOT_QUALIFIED") {
        throw new Error(`CONFLICT:${credited.error}`);
      }
    }
    await AuditLogService.success("ADMIN_ACTION", {
      userId: actorId,
      details: { action: `PARTNER_REFERRAL_${action.toUpperCase()}`, referralId, reason },
    });
    return this.adminDetail(referralId);
  }

  async countSuccessfulJobs(providerId: string): Promise<number> {
    const fake = await prisma.partnerRiskSignal.findMany({
      where: { providerId, type: "FAKE_COMPLETION", bookingId: { not: null } },
      select: { bookingId: true },
    });
    const exclude = fake.map((f) => f.bookingId!).filter(Boolean);
    return prisma.booking.count({
      where: {
        providerId,
        status: BookingStatus.COMPLETED,
        completedAt: { not: null },
        cancelledAt: null,
        paymentStatus: PaymentStatus.SUCCESS,
        ...(exclude.length ? { id: { notIn: exclude } } : {}),
      },
    });
  }

  private async hasMajorComplaint(providerId: string): Promise<boolean> {
    const ticket = await prisma.supportTicket.findFirst({
      where: {
        providerId,
        category: { in: [...MAJOR_COMPLAINT_CATEGORIES] },
        priority: { in: [...MAJOR_COMPLAINT_PRIORITIES] },
      },
      select: { id: true },
    });
    if (ticket) return true;
    const incident = await prisma.partnerSafetyIncident.findFirst({
      where: {
        providerId,
        type: "CUSTOMER_SAFETY",
        severity: { in: ["HIGH", "CRITICAL", "high", "critical"] },
        status: { notIn: ["RESOLVED", "CLOSED"] },
      },
      select: { id: true },
    });
    return Boolean(incident);
  }

  private async hasAuthoritativeFraudFlag(providerId: string): Promise<boolean> {
    const profile = await prisma.partnerRiskProfile.findUnique({
      where: { providerId },
      select: { reviewStatus: true, riskLevel: true },
    });
    if (profile?.reviewStatus === "RESTRICT" || profile?.reviewStatus === "SUSPEND") return true;
    if (profile?.riskLevel === "CRITICAL") return true;
    const abuse = await prisma.partnerRiskSignal.findFirst({
      where: { providerId, type: "REFERRAL_ABUSE" },
      select: { id: true },
    });
    return Boolean(abuse);
  }

  private async qualificationSnapshot(
    referredProviderId: string,
    referral: {
      reviewStatus: string;
      referrerProviderId: string;
      referredProviderId: string | null;
    },
  ) {
    const [provider, jobs, complaint, fraud] = await Promise.all([
      prisma.provider.findUnique({
        where: { id: referredProviderId },
        select: { lifecycleState: true, userId: true },
      }),
      this.countSuccessfulJobs(referredProviderId),
      this.hasMajorComplaint(referredProviderId),
      this.hasAuthoritativeFraudFlag(referredProviderId),
    ]);
    const self = referral.referrerProviderId === referredProviderId;
    return evaluateQualificationGates({
      referredLifecycleActive: provider?.lifecycleState === "ACTIVE",
      successfulJobs: jobs,
      hasMajorComplaint: complaint,
      hasAuthoritativeFraudFlag: fraud,
      reviewBlocked: referral.reviewStatus === "BLOCKED" || referral.reviewStatus === "HELD",
      selfReferral: self,
    });
  }

  private async trainingComplete(providerId: string): Promise<boolean> {
    const modules = await prisma.partnerAcademyModule.findMany({
      where: { isPublished: true },
      select: { id: true },
    });
    if (modules.length === 0) return true;
    const done = await prisma.partnerAcademyProgress.count({
      where: { providerId, completedAt: { not: null }, moduleId: { in: modules.map((m) => m.id) } },
    });
    return done >= modules.length;
  }

  private async byReferredProvider(providerId: string) {
    return prisma.partnerReferral.findUnique({ where: { referredProviderId: providerId } });
  }

  private async walkTo(
    referralId: string,
    target: PartnerReferralStatus,
    extra: Prisma.PartnerReferralUpdateInput,
    reason: string,
  ) {
    const current = await prisma.partnerReferral.findUnique({ where: { id: referralId } });
    if (!current) return;
    const hop = nextReferralHop(current.status);
    if (hop !== target) return;
    await this.advance(referralId, target, { reason, extra });
  }

  private async advance(
    referralId: string,
    to: PartnerReferralStatus,
    opts: {
      actorType?: string;
      actorId?: string;
      reason?: string;
      extra?: Prisma.PartnerReferralUpdateInput;
    },
  ) {
    const current = await prisma.partnerReferral.findUnique({ where: { id: referralId } });
    if (!current) return;
    if (current.status === to) return;
    assertReferralTransition(current.status, to);
    const moved = await prisma.partnerReferral.updateMany({
      where: { id: referralId, status: current.status },
      data: { status: to, ...(opts.extra ?? {}) },
    });
    if (moved.count === 0) return;
    await prisma.partnerReferralStatusHistory.create({
      data: {
        referralId,
        fromStatus: current.status,
        toStatus: to,
        actorType: opts.actorType ?? "system",
        actorId: opts.actorId,
        reason: opts.reason,
      },
    });
    await this.emitStatus(referralId, to);
  }

  private reached(status: string, gate: PartnerReferralStatus): boolean {
    const order: PartnerReferralStatus[] = [
      "INVITED", "REGISTERED", "VERIFIED", "TRAINING", "ACTIVE", "FIRST_JOB", "QUALIFIED", "REWARD_RELEASED",
    ];
    return order.indexOf(status as PartnerReferralStatus) >= order.indexOf(gate);
  }

  private partnerFacingRow(r: {
    id: string;
    status: string;
    qualificationStatus: string;
    reviewStatus: string;
    successfulJobs: number;
    invitedAt: Date;
    registeredAt: Date | null;
    qualifiedAt: Date | null;
    rewardedAt: Date | null;
    referred: { businessName: string | null; user: { firstName: string; lastName: string } } | null;
    lead: { name: string } | null;
    reward: { status: string; amount: number; creditedAt: Date | null } | null;
  }) {
    const name =
      r.referred?.businessName ||
      r.referred?.user.firstName ||
      r.lead?.name?.split(" ")[0] ||
      "Invited partner";
    const remaining = Math.max(0, QUALIFYING_JOB_TARGET - r.successfulJobs);
    const qual = partnerFacingQualLabel({
      qualificationStatus: r.qualificationStatus,
      reviewStatus: r.reviewStatus,
      status: r.status,
    });
    const blockedFacing = qual === "Blocked" ? "Under review" : qual;
    return {
      id: r.id,
      name,
      status: r.status,
      jobs: r.successfulJobs,
      jobTarget: QUALIFYING_JOB_TARGET,
      qualificationLabel: blockedFacing === "Under review" ? "Pending" : blockedFacing,
      nextMilestone:
        r.status === "REWARD_RELEASED"
          ? "Reward released"
          : remaining > 0 && this.reached(r.status, "ACTIVE")
            ? `Complete ${remaining} more successful job${remaining === 1 ? "" : "s"} to unlock your reward.`
            : r.status === "INVITED"
              ? "Waiting for your invite to register."
              : "Keep going — gates are evaluated automatically.",
      rewardAmount: r.reward?.status === "CREDITED" ? r.reward.amount : null,
      invitedAt: r.invitedAt,
      registeredAt: r.registeredAt,
      qualifiedAt: r.qualifiedAt,
      rewardedAt: r.rewardedAt,
    };
  }

  private async emitStatus(referralId: string, status: PartnerReferralStatus) {
    const type = EVENT_BY_STATUS[status];
    if (!type) return;
    if (!eventPlatformConfig.outboxEnabled || !eventPlatformConfig.partnerEventsEnabled) return;
    const row = await prisma.partnerReferral.findUnique({
      where: { id: referralId },
      select: { id: true, referrerProviderId: true, referredProviderId: true, status: true },
    });
    if (!row) return;
    await emitStandalone(
      prisma,
      buildPartnerReferralEvent({
        type,
        referralId: row.id,
        referrerProviderId: row.referrerProviderId,
        referredProviderId: row.referredProviderId,
        status: row.status,
      }),
    ).catch(() => undefined);
  }

  private async notifyAdminReview(referralId: string, review: string) {
    const already = await prisma.notification.findFirst({
      where: { referenceId: referralId, referenceType: "partner_referral_review" },
      select: { id: true },
    });
    if (already) return;
    const row = await prisma.partnerReferral.findUnique({
      where: { id: referralId },
      select: { referrerProviderId: true, referredProviderId: true, status: true },
    });
    if (row && eventPlatformConfig.outboxEnabled && eventPlatformConfig.partnerEventsEnabled) {
      await emitStandalone(
        prisma,
        buildPartnerReferralEvent({
          type: EVENT_TYPES.PARTNER_REFERRAL_FLAGGED,
          referralId,
          referrerProviderId: row.referrerProviderId,
          referredProviderId: row.referredProviderId,
          status: row.status,
        }),
      ).catch(() => undefined);
    }
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true, deletedAt: null },
      select: { id: true },
      take: 20,
    });
    await Promise.all(
      admins.map((a) =>
        notificationService
          .createForUser({
            userId: a.id,
            type: "RISK_REVIEW",
            title: "Referral risk review",
            message: review === "BLOCKED"
              ? "A partner referral was blocked pending operations review."
              : "A partner referral has abuse signals and needs review.",
            referenceId: referralId,
            referenceType: "partner_referral_review",
            priority: "high",
          })
          .catch(() => undefined),
      ),
    );
  }

  private async notifyReferrer(
    referrerProviderId: string,
    msg: { title: string; message: string; referenceId: string },
  ) {
    const p = await prisma.provider.findUnique({
      where: { id: referrerProviderId },
      select: { userId: true },
    });
    if (!p?.userId) return;
    const already = await prisma.notification.findFirst({
      where: {
        userId: p.userId,
        referenceId: msg.referenceId,
        referenceType: "partner_referral",
        title: msg.title,
      },
      select: { id: true },
    });
    if (already) return;
    await notificationService
      .createForUser({
        userId: p.userId,
        type: "REFERRAL",
        title: msg.title,
        message: msg.message,
        referenceId: msg.referenceId,
        referenceType: "partner_referral",
      })
      .catch(() => undefined);
  }
}

export const partnerReferralService = new PartnerReferralService();
