import type { ConsentPolicyType, ConsentSource } from "@prisma/client";
import prisma from "../lib/prisma";
import { CURRENT_POLICY_VERSIONS, POLICY_TITLES } from "../lib/legal-policy";

export class ConsentService {
  async ensurePolicyVersionsSeeded() {
    const now = new Date();
    for (const policyType of Object.keys(CURRENT_POLICY_VERSIONS) as ConsentPolicyType[]) {
      const version = CURRENT_POLICY_VERSIONS[policyType];
      await prisma.policyVersion.upsert({
        where: { policyType_version: { policyType, version } },
        create: {
          policyType,
          version,
          title: POLICY_TITLES[policyType],
          effectiveAt: now,
          isCurrent: true,
        },
        update: { isCurrent: true, title: POLICY_TITLES[policyType] },
      });
      await prisma.policyVersion.updateMany({
        where: { policyType, version: { not: version } },
        data: { isCurrent: false },
      });
    }
  }

  listCurrentPolicies() {
    return (Object.keys(CURRENT_POLICY_VERSIONS) as ConsentPolicyType[]).map((policyType) => ({
      policyType: policyType.toLowerCase(),
      version: CURRENT_POLICY_VERSIONS[policyType],
      title: POLICY_TITLES[policyType],
    }));
  }

  async recordConsents(opts: {
    userId?: string;
    policies: ConsentPolicyType[];
    source: ConsentSource;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  }) {
    const rows = opts.policies.map((policyType) => ({
      userId: opts.userId,
      policyType,
      policyVersion: CURRENT_POLICY_VERSIONS[policyType],
      granted: true,
      source: opts.source,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent,
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
    }));
    await prisma.consentRecord.createMany({ data: rows });
    return rows;
  }

  async recordSignupConsents(
    userId: string,
    ctx: { ipAddress?: string; userAgent?: string },
  ) {
    return this.recordConsents({
      userId,
      policies: ["TERMS", "PRIVACY"],
      source: "SIGNUP",
      ...ctx,
    });
  }

  async recordCookieConsent(opts: {
    userId?: string;
    granted: boolean;
    ipAddress?: string;
    userAgent?: string;
  }) {
    await prisma.consentRecord.create({
      data: {
        userId: opts.userId,
        policyType: "COOKIES",
        policyVersion: CURRENT_POLICY_VERSIONS.COOKIES,
        granted: opts.granted,
        source: "COOKIE_BANNER",
        ipAddress: opts.ipAddress,
        userAgent: opts.userAgent,
      },
    });
  }
}

export const consentService = new ConsentService();
