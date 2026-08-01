import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";

export class PlatformIntelligenceService {
  async listFlags(environment = "production") {
    return prisma.platformFeatureFlag.findMany({
      where: { environment },
      orderBy: { key: "asc" },
    });
  }

  async upsertFlag(
    input: {
      key: string;
      description?: string;
      enabled: boolean;
      rolloutPct: number;
      environment?: string;
      isKillSwitch?: boolean;
    },
    actor: { adminId: string; userId: string },
    reason?: string,
  ) {
    if (input.rolloutPct < 0 || input.rolloutPct > 100) throw new Error("INVALID_ROLLOUT");

    const flag = await prisma.platformFeatureFlag.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        description: input.description ?? null,
        enabled: input.enabled,
        rolloutPct: input.rolloutPct,
        environment: input.environment ?? "production",
        isKillSwitch: input.isKillSwitch ?? false,
        updatedBy: actor.adminId,
      },
      update: {
        description: input.description ?? undefined,
        enabled: input.enabled,
        rolloutPct: input.rolloutPct,
        environment: input.environment ?? undefined,
        isKillSwitch: input.isKillSwitch ?? undefined,
        updatedBy: actor.adminId,
      },
    });

    await prisma.platformFeatureFlagHistory.create({
      data: {
        flagKey: input.key,
        enabled: input.enabled,
        rolloutPct: input.rolloutPct,
        changedBy: actor.adminId,
        reason: reason ?? null,
      },
    });

    await AuditLogService.success("ADMIN_ACTION", {
      userId: actor.userId,
      details: { action: "PLATFORM_FLAG_UPDATED", key: input.key, enabled: input.enabled, rolloutPct: input.rolloutPct },
    });

    return flag;
  }

  async listExperiments() {
    const db = await prisma.platformExperiment.findMany({ orderBy: { key: "asc" } });
    const pricingSurge = {
      key: "surge_v1",
      description: "Dynamic pricing surge A/B (live via /api/pricing/experiment)",
      status: "running",
      variants: [{ name: "control" }, { name: "treatment" }],
      source: "pricing_engine",
    };
    const hasSurge = db.some((e) => e.key === "surge_v1");
    return {
      experiments: hasSurge ? db : [pricingSurge, ...db],
      prometheusMetrics: [
        "pricing_experiment_exposure_total",
        "pricing_experiment_conversion_total",
        "pricing_experiment_revenue",
      ],
    };
  }

  async createExperiment(
    input: { key: string; description?: string; variants: unknown[]; status?: string },
    actor: { adminId: string },
  ) {
    return prisma.platformExperiment.create({
      data: {
        key: input.key,
        description: input.description ?? null,
        status: input.status ?? "draft",
        variants: input.variants as object,
        updatedBy: actor.adminId,
      },
    });
  }

  async getIntelligence() {
    const [flags, experiments] = await Promise.all([this.listFlags(), this.listExperiments()]);
    return {
      generatedAt: new Date().toISOString(),
      featureFlags: flags,
      killSwitches: flags.filter((f) => f.isKillSwitch),
      experiments: experiments.experiments,
      experimentMetrics: experiments.prometheusMetrics,
      flagCount: flags.length,
      enabledFlags: flags.filter((f) => f.enabled).length,
    };
  }
}

export const platformIntelligenceService = new PlatformIntelligenceService();
