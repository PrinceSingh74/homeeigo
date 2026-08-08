/**
 * Feature Store Service — versioned, reproducible feature layers for ML.
 */
import { ANALYTICS_CONFIG } from "../config";
import { bqQuery, loadRows } from "../etl/bq-client";
import { cacheService } from "../../src/services/cache.service";
import { createVersion } from "../versioning/service";
import prisma from "../../src/lib/prisma";
import { logger } from "../../src/lib/logger";
import { hashPii } from "../etl/pii";

const P = ANALYTICS_CONFIG.projectId;
const D = ANALYTICS_CONFIG.dataset;
const F = `${D}_feature`;

export type FeatureGroup = "customer" | "partner" | "payment" | "finance" | "fraud" | "geo" | "demand" | "eta";

const FEATURE_VIEWS: Record<FeatureGroup, string> = {
  customer: `${F}.fs_customer_features_v2`,
  partner: `${F}.fs_partner_features_v2`,
  payment: `${F}.fs_payment_features_v2`,
  finance: `${F}.fs_finance_features_v2`,
  fraud: `${F}.fs_fraud_features_v2`,
  geo: `${F}.fs_geo_features_v2`,
  demand: `${F}.fs_demand_features_v2`,
  eta: `${F}.fs_eta_features_v2`,
};

export class FeatureStoreService {
  async getFeatures(group: FeatureGroup, limit = 100): Promise<Record<string, unknown>[]> {
    const view = FEATURE_VIEWS[group];
    return cacheService.getOrFetch(`feature-store:${group}:${limit}`, 120, async () => {
      return bqQuery(`SELECT * FROM \`${P}.${view}\` LIMIT ${limit}`);
    }, 5);
  }

  async getFeatureMetadata(): Promise<{ group: FeatureGroup; view: string; version: string }[]> {
    const version = await createVersion("feature", { views: FEATURE_VIEWS });
    return Object.entries(FEATURE_VIEWS).map(([group, view]) => ({
      group: group as FeatureGroup,
      view,
      version: version.versionTag,
    }));
  }

  /** Training dataset export — reproducible snapshot with version tag. */
  async exportTrainingDataset(
    group: FeatureGroup,
    split: "training" | "validation" | "testing",
  ): Promise<{ versionTag: string; rowCount: number; view: string }> {
    const view = FEATURE_VIEWS[group];
    const version = await createVersion("training", { group, split, view });
    const [row] = await bqQuery<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${P}.${view}\``);
    return { versionTag: version.versionTag, rowCount: Number(row?.n ?? 0), view };
  }

  /** Batch prediction input — latest features for online/shadow models. */
  async getBatchPredictionInput(group: FeatureGroup, keys: string[], keyColumn: string): Promise<Record<string, unknown>[]> {
    if (keys.length === 0) return [];
    // keyColumn lands unquoted in the WHERE clause, so it must be an identifier and
    // nothing else — values are escaped, but a column name cannot be parameterised.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyColumn)) {
      throw new Error(`Invalid key column: ${keyColumn}`);
    }
    const view = FEATURE_VIEWS[group];
    const inList = keys.map((k) => `'${k.replace(/'/g, "''")}'`).join(",");
    return bqQuery(`SELECT * FROM \`${P}.${view}\` WHERE ${keyColumn} IN (${inList})`);
  }
}

/**
 * Retry ML feature rows whose BigQuery load previously failed.
 *
 * The sink writes to `ml_feature_staging` first and then loads to BigQuery, catching
 * load errors so a warehouse outage never breaks the booking flow. Nothing drained that
 * buffer, so a failed row stayed `processed: false` forever. This closes the loop.
 */
export async function drainFeatureStagingBacklog(limit = 200): Promise<{ attempted: number; loaded: number }> {
  const pending = await prisma.mlFeatureStaging.findMany({
    where: { processed: false, sinkType: "eta_labels" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  if (pending.length === 0) return { attempted: 0, loaded: 0 };

  const rows = pending.map((r) => {
    const p = (r.payload ?? {}) as Record<string, unknown>;
    return {
      event_id: r.eventId,
      booking_id: r.bookingId,
      provider_hash: typeof p.providerId === "string" ? hashPii(p.providerId) : null,
      travel_duration_min: p.travelDurationMin ?? null,
      distance_km: p.distanceKm ?? null,
      google_eta_min: p.googleEtaMin ?? null,
      hour_of_day: p.hourOfDay ?? null,
      day_of_week: p.dayOfWeek ?? null,
      city: p.city ?? null,
      service_category: p.serviceCategory ?? null,
      ingested_at: new Date().toISOString(),
    };
  });

  try {
    const loaded = await loadRows("feature", "ml_eta_labels", rows);
    await prisma.mlFeatureStaging.updateMany({
      where: { id: { in: pending.map((r) => r.id) } },
      data: { processed: true, processedAt: new Date() },
    });
    logger.info("ml_feature_backlog_drained", { attempted: pending.length, loaded });
    return { attempted: pending.length, loaded };
  } catch (err) {
    // Leave rows unprocessed so the next tick retries them.
    logger.warn("ml_feature_backlog_drain_deferred", {
      attempted: pending.length,
      error: err instanceof Error ? err.message : String(err),
    });
    return { attempted: pending.length, loaded: 0 };
  }
}

export const featureStoreService = new FeatureStoreService();
