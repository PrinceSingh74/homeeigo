/**
 * Feature Store Service — versioned, reproducible feature layers for ML.
 */
import { ANALYTICS_CONFIG } from "../config";
import { bqQuery } from "../etl/bq-client";
import { cacheService } from "../../src/services/cache.service";
import { createVersion } from "../versioning/service";

const P = ANALYTICS_CONFIG.projectId;
const D = ANALYTICS_CONFIG.dataset;
const F = `${D}_feature`;

export type FeatureGroup = "customer" | "partner" | "payment" | "finance" | "fraud" | "geo" | "demand";

const FEATURE_VIEWS: Record<FeatureGroup, string> = {
  customer: `${F}.fs_customer_features_v2`,
  partner: `${F}.fs_partner_features_v2`,
  payment: `${F}.fs_payment_features_v2`,
  finance: `${F}.fs_finance_features_v2`,
  fraud: `${F}.fs_fraud_features_v2`,
  geo: `${F}.fs_geo_features_v2`,
  demand: `${F}.fs_demand_features_v2`,
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
    const view = FEATURE_VIEWS[group];
    const inList = keys.map((k) => `'${k.replace(/'/g, "''")}'`).join(",");
    return bqQuery(`SELECT * FROM \`${P}.${view}\` WHERE ${keyColumn} IN (${inList})`);
  }
}

export const featureStoreService = new FeatureStoreService();
