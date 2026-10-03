import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";
import { invalidateFlagCache } from "./feature-flag.service";

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

    /**
     * Drop the cached decision everywhere before anyone is told the write succeeded.
     *
     * Without this the write lands in the database and the running processes keep serving the old
     * answer until their copies expire — an admin disabling a feature watched it stay on for a full
     * cache lifetime, which is the one moment a feature flag has to be believed.
     */
    await invalidateFlagCache(input.key);

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
    /**
     * A code-defined experiment with no registry row used to be injected here as
     * `status: "running"`. It read exactly like a governed experiment in the admin list while
     * having no owner, no stored variants and — before the stop switch was added — no way to
     * turn it off. Presenting an unregistered experiment as running is the kind of fabricated
     * governance record that makes an inventory worse than an empty one.
     *
     * It is still listed, because the code path genuinely exists and hiding it would be the
     * opposite error. It is listed as what it is: unregistered, and therefore suppressed by the
     * stop switch until somebody registers it.
     */
    const pricingSurge = {
      key: "surge_v1",
      description: "Dynamic pricing surge A/B, defined in code at dynamic-pricing.service. Not registered, so assignment is suppressed and every caller receives control.",
      status: "unregistered",
      variants: [{ name: "control" }, { name: "treatment" }],
      source: "pricing_engine",
      registered: false,
      // The arms return an identical price multiplier, so no effect is measurable either way.
      differentiated: false,
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

  /**
   * Creating or activating an experiment changes what real customers are exposed to, so it is
   * audited like the feature-flag change beside it.
   *
   * It was not. `updateFlag` a few lines above recorded PLATFORM_FLAG_UPDATED through
   * AuditLogService while this wrote a row and returned — so "who started the experiment that was
   * running in March, and when" had no answer, on the one governance object whose whole purpose
   * is to alter production behaviour for a subset of users.
   */
  async createExperiment(
    input: { key: string; description?: string; variants: unknown[]; status?: string },
    actor: { adminId: string; userId?: string },
  ) {
    const status = input.status ?? "draft";
    const created = await prisma.platformExperiment.create({
      data: {
        key: input.key,
        description: input.description ?? null,
        status,
        variants: input.variants as object,
        updatedBy: actor.adminId,
      },
    });

    await AuditLogService.recordGoverned("EXPERIMENT_CREATED", "success", {
      userId: actor.userId ?? actor.adminId,
      reason: `Experiment ${input.key} created as ${status}`,
      details: {
        experimentKey: input.key,
        status,
        variants: input.variants,
        // An experiment created directly as `running` is live from this moment; that is a
        // materially different act from creating a draft and is recorded as such.
        activatedOnCreate: status === "running",
      },
    });

    return created;
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
