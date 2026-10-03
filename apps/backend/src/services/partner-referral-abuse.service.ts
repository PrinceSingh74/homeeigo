import type { PartnerReferralSignalKind } from "@prisma/client";
import prisma from "../lib/prisma";
import type { FraudContext } from "../lib/fraud-context";
import { REFERRAL_BURST_SIGNAL_THRESHOLD } from "../lib/partner-referral-policy";
import { partnerRiskService } from "./partner-risk.service";

export type AbuseFinding = {
  kind: PartnerReferralSignalKind;
  severity: number;
  evidenceKey: string;
  note: string;
  /** Strong enough to open review / block. Weak findings are signals only. */
  strong: boolean;
};

export class PartnerReferralAbuseService {
  async inspectPair(input: {
    referrerProviderId: string;
    refereeUserId?: string | null;
    refereeProviderId?: string | null;
    ctx?: FraudContext;
  }): Promise<AbuseFinding[]> {
    const findings: AbuseFinding[] = [];
    const referrer = await prisma.provider.findUnique({
      where: { id: input.referrerProviderId },
      select: {
        id: true,
        userId: true,
        bankAccountNumberHash: true,
        upiIdHash: true,
        panNumberHash: true,
        aadharNumberHash: true,
        user: { select: { id: true, phoneHash: true } },
      },
    });
    if (!referrer) return findings;

    const refereeUser = input.refereeUserId
      ? await prisma.user.findUnique({
          where: { id: input.refereeUserId },
          select: { id: true, phoneHash: true, provider: { select: { id: true } } },
        })
      : null;
    const refereeProvider = input.refereeProviderId
      ? await prisma.provider.findUnique({
          where: { id: input.refereeProviderId },
          select: {
            id: true,
            userId: true,
            bankAccountNumberHash: true,
            upiIdHash: true,
            panNumberHash: true,
            aadharNumberHash: true,
          },
        })
      : refereeUser?.provider
        ? await prisma.provider.findUnique({
            where: { id: refereeUser.provider.id },
            select: {
              id: true,
              userId: true,
              bankAccountNumberHash: true,
              upiIdHash: true,
              panNumberHash: true,
              aadharNumberHash: true,
            },
          })
        : null;

    if (refereeUser && refereeUser.id === referrer.userId) {
      findings.push({
        kind: "SELF_REFERRAL",
        severity: 100,
        evidenceKey: `user:${referrer.userId}`,
        note: "Referrer and referred share the same account",
        strong: true,
      });
    }
    if (refereeProvider && refereeProvider.id === referrer.id) {
      findings.push({
        kind: "SELF_REFERRAL",
        severity: 100,
        evidenceKey: `provider:${referrer.id}`,
        note: "Referrer invited their own partner profile",
        strong: true,
      });
    }
    if (referrer.user.phoneHash && refereeUser?.phoneHash && referrer.user.phoneHash === refereeUser.phoneHash) {
      findings.push({
        kind: "PHONE_REUSE",
        severity: 90,
        evidenceKey: `phone:${referrer.user.phoneHash}`,
        note: "Same phone hash on referrer and referred",
        strong: true,
      });
    }

    /**
     * Pair-hash inspection is defense in depth, not the primary control.
     *
     * `Provider.bankAccountNumberHash`, `upiIdHash`, `panNumberHash` and `aadharNumberHash` are
     * `@unique`. Canonical KYC writes go through `assertProviderKycUnique`, which refuses a second
     * partner with the same identity before the row can exist. Two live providers therefore cannot
     * share a bank hash through the product path — duplicate payout accounts are rejected at
     * persistence, not merely flagged after the fact.
     *
     * This loop still runs because uniqueness does not cover every write: a race that loses the
     * application-level check, a direct Prisma update, or a historical import can still produce
     * colliding hashes until the unique index catches them. When that happens, BANK_REUSE /
     * IDENTITY_REUSE remain a strong hold on the referral reward. They are not a substitute for
     * the schema constraint and must not be treated as evidence that shared banks are allowed.
     */
    const hashPairs: Array<{ kind: PartnerReferralSignalKind; a?: string | null; b?: string | null; label: string }> = [
      { kind: "BANK_REUSE", a: referrer.bankAccountNumberHash, b: refereeProvider?.bankAccountNumberHash, label: "bank account" },
      { kind: "BANK_REUSE", a: referrer.upiIdHash, b: refereeProvider?.upiIdHash, label: "UPI" },
      { kind: "IDENTITY_REUSE", a: referrer.panNumberHash, b: refereeProvider?.panNumberHash, label: "PAN" },
      { kind: "IDENTITY_REUSE", a: referrer.aadharNumberHash, b: refereeProvider?.aadharNumberHash, label: "Aadhaar" },
    ];
    for (const p of hashPairs) {
      if (p.a && p.b && p.a === p.b) {
        findings.push({
          kind: p.kind,
          severity: 85,
          evidenceKey: `${p.kind}:${p.a}`,
          note: `Same ${p.label} identifier on referrer and referred`,
          strong: true,
        });
      }
    }

    if (input.ctx?.deviceId && refereeUser) {
      const shared = await prisma.fraudSignal.findFirst({
        where: {
          deviceId: input.ctx.deviceId,
          userId: referrer.userId,
        },
        select: { id: true },
      });
      if (shared) {
        findings.push({
          kind: "DEVICE_REUSE",
          severity: 70,
          evidenceKey: `device:${input.ctx.deviceId}`,
          note: "Same device identifier observed on referrer and referred",
          strong: true,
        });
      }
    }

    if (input.ctx?.ipAddress && input.ctx.ipAddress !== "unknown") {
      const recent = await prisma.fraudSignal.count({
        where: {
          ipAddress: input.ctx.ipAddress,
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        },
      });
      if (recent >= 5) {
        findings.push({
          kind: "SUSPICIOUS_IP",
          severity: 40,
          evidenceKey: `ip-burst:${input.ctx.ipAddress.slice(0, 32)}`,
          note: "Shared or high-velocity IP around registration (signal only; household networks are not fraud by themselves)",
          strong: false,
        });
      }
    }

    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const burst = await prisma.partnerReferral.count({
      where: { referrerProviderId: referrer.id, createdAt: { gte: dayAgo } },
    });
    if (burst >= REFERRAL_BURST_SIGNAL_THRESHOLD) {
      findings.push({
        kind: "PATTERN_ABUSE",
        severity: 45,
        evidenceKey: `burst:${referrer.id}:${dayAgo.toISOString().slice(0, 10)}`,
        note: `${burst} referrals in 24h from this referrer`,
        strong: false,
      });
    }

    if (refereeProvider) {
      const reverse = await prisma.partnerReferral.findFirst({
        where: {
          referrerProviderId: refereeProvider.id,
          referredProviderId: referrer.id,
        },
        select: { id: true },
      });
      if (reverse) {
        findings.push({
          kind: "CYCLE_ABUSE",
          severity: 80,
          evidenceKey: `cycle:${refereeProvider.id}:${referrer.id}`,
          note: "A→B / B→A referral cycle",
          strong: true,
        });
      } else {
        const downstream = await prisma.partnerReferral.findMany({
          where: { referrerProviderId: refereeProvider.id, referredProviderId: { not: null } },
          select: { referredProviderId: true },
          take: 40,
        });
        const mids = downstream.map((d) => d.referredProviderId).filter((id): id is string => Boolean(id));
        if (mids.length > 0) {
          const triangle = await prisma.partnerReferral.findFirst({
            where: { referrerProviderId: { in: mids }, referredProviderId: referrer.id },
            select: { id: true, referrerProviderId: true },
          });
          if (triangle) {
            findings.push({
              kind: "CYCLE_ABUSE",
              severity: 78,
              evidenceKey: `cycle3:${refereeProvider.id}:${triangle.referrerProviderId}:${referrer.id}`,
              note: "A→B→C→A referral cycle",
              strong: true,
            });
          }
        }
      }
    }

    return this.dedupe(findings);
  }

  async persist(referralId: string, findings: AbuseFinding[], referrerProviderId: string) {
    if (findings.length === 0) return;
    await prisma.partnerReferralAbuseSignal.createMany({
      data: findings.map((f) => ({
        referralId,
        kind: f.kind,
        severity: f.severity,
        evidenceKey: f.evidenceKey.slice(0, 180),
        note: f.note,
      })),
      skipDuplicates: true,
    });

    const strong = findings.filter((f) => f.strong);
    if (strong.length === 0) return;

    await partnerRiskService.recordSignal({
      providerId: referrerProviderId,
      type: "REFERRAL_ABUSE",
      source: "partner_referral",
      severity: Math.max(...strong.map((s) => s.severity)),
      confidence: strong.some((s) => s.kind === "SELF_REFERRAL") ? 0.95 : 0.7,
      fingerprint: `REFERRAL_ABUSE:${referrerProviderId}:${referralId}`,
      evidence: {
        kinds: strong.map((s) => s.kind),
        referralId,
      },
    });
  }

  decision(findings: AbuseFinding[]): { review: "NONE" | "OPEN" | "BLOCKED"; blockReward: boolean } {
    const self = findings.some((f) => f.kind === "SELF_REFERRAL" || f.kind === "CYCLE_ABUSE");
    if (self) return { review: "BLOCKED", blockReward: true };
    const strong = findings.some((f) => f.strong);
    if (strong) return { review: "OPEN", blockReward: true };
    return { review: "NONE", blockReward: false };
  }

  private dedupe(findings: AbuseFinding[]): AbuseFinding[] {
    const seen = new Set<string>();
    const out: AbuseFinding[] = [];
    for (const f of findings) {
      const k = `${f.kind}:${f.evidenceKey}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(f);
    }
    return out;
  }
}

export const partnerReferralAbuseService = new PartnerReferralAbuseService();
