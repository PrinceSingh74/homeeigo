/** Phase 1 analytics platform configuration — extends Phase 0, no duplicate schedulers. */
export const ANALYTICS_CONFIG = {
  projectId: process.env.GCP_PROJECT_ID ?? "homigo-497619",
  dataset: process.env.BQ_DATASET ?? "homigo_analytics",
  location: process.env.BQ_LOCATION ?? "asia-south1",
  pipelineVersion: process.env.ETL_PIPELINE_VERSION ?? "1.0.0",
  defaultBatchSize: Number(process.env.ETL_BATCH_SIZE ?? 2000),
  defaultTimeoutMs: Number(process.env.ETL_TIMEOUT_MS ?? 600_000),
  maxParallelJobs: Number(process.env.ETL_MAX_PARALLEL ?? 3),
  incrementalIntervalMs: Number(process.env.ETL_INTERVAL_MS ?? 15 * 60 * 1000),
  fullSyncCron: process.env.ETL_FULL_CRON ?? "0 2 * * *",
} as const;

export const BQ_DATASETS = {
  raw: `${ANALYTICS_CONFIG.dataset}_raw`,
  validated: `${ANALYTICS_CONFIG.dataset}_validated`,
  curated: ANALYTICS_CONFIG.dataset,
  feature: `${ANALYTICS_CONFIG.dataset}_feature`,
  analytics: `${ANALYTICS_CONFIG.dataset}_analytics`,
} as const;

export type EtlDomain =
  | "booking"
  | "partner"
  | "payment"
  | "wallet"
  | "ledger"
  | "fraud"
  | "location"
  | "customer"
  | "notification"
  | "review"
  | "referral"
  | "hcoin"
  | "automation"
  | "events"
  | "audit"
  | "eta";

export type EtlJobDefinition = {
  id: string;
  domain: EtlDomain;
  targetTable: string;
  bqLayer: keyof typeof BQ_DATASETS;
  priority: number;
  dependencies: string[];
  defaultBatchSize: number;
  slaTargetSeconds: number;
  supportsIncremental: boolean;
};

export const ETL_JOB_DEFINITIONS: EtlJobDefinition[] = [
  { id: "etl.booking", domain: "booking", targetTable: "fact_bookings", bqLayer: "curated", priority: 10, dependencies: [], defaultBatchSize: 2000, slaTargetSeconds: 3600, supportsIncremental: true },
  { id: "etl.partner", domain: "partner", targetTable: "dim_partner", bqLayer: "curated", priority: 20, dependencies: [], defaultBatchSize: 1000, slaTargetSeconds: 7200, supportsIncremental: true },
  { id: "etl.payment", domain: "payment", targetTable: "fact_payments", bqLayer: "curated", priority: 15, dependencies: ["etl.booking"], defaultBatchSize: 2000, slaTargetSeconds: 3600, supportsIncremental: true },
  { id: "etl.wallet", domain: "wallet", targetTable: "fact_wallet_txns", bqLayer: "curated", priority: 25, dependencies: ["etl.payment"], defaultBatchSize: 2000, slaTargetSeconds: 7200, supportsIncremental: true },
  { id: "etl.ledger", domain: "ledger", targetTable: "fact_ledger_entries", bqLayer: "curated", priority: 25, dependencies: ["etl.payment"], defaultBatchSize: 2000, slaTargetSeconds: 7200, supportsIncremental: true },
  { id: "etl.fraud", domain: "fraud", targetTable: "fact_fraud_signals", bqLayer: "curated", priority: 30, dependencies: ["etl.booking"], defaultBatchSize: 1000, slaTargetSeconds: 7200, supportsIncremental: true },
  { id: "etl.location", domain: "location", targetTable: "fact_gps_pings", bqLayer: "curated", priority: 20, dependencies: [], defaultBatchSize: 5000, slaTargetSeconds: 3600, supportsIncremental: true },
  { id: "etl.customer", domain: "customer", targetTable: "dim_customer", bqLayer: "curated", priority: 30, dependencies: ["etl.booking"], defaultBatchSize: 2000, slaTargetSeconds: 86400, supportsIncremental: true },
  { id: "etl.notification", domain: "notification", targetTable: "fact_notifications", bqLayer: "raw", priority: 40, dependencies: [], defaultBatchSize: 3000, slaTargetSeconds: 14400, supportsIncremental: true },
  { id: "etl.review", domain: "review", targetTable: "fact_reviews", bqLayer: "curated", priority: 35, dependencies: ["etl.booking"], defaultBatchSize: 2000, slaTargetSeconds: 14400, supportsIncremental: true },
  { id: "etl.referral", domain: "referral", targetTable: "fact_referrals", bqLayer: "curated", priority: 40, dependencies: ["etl.customer"], defaultBatchSize: 1000, slaTargetSeconds: 86400, supportsIncremental: true },
  { id: "etl.hcoin", domain: "hcoin", targetTable: "fact_hcoin_txns", bqLayer: "curated", priority: 35, dependencies: ["etl.wallet"], defaultBatchSize: 2000, slaTargetSeconds: 7200, supportsIncremental: true },
  { id: "etl.automation", domain: "automation", targetTable: "fact_scheduled_jobs", bqLayer: "raw", priority: 45, dependencies: [], defaultBatchSize: 2000, slaTargetSeconds: 14400, supportsIncremental: true },
  { id: "etl.events", domain: "events", targetTable: "fact_domain_events", bqLayer: "raw", priority: 15, dependencies: [], defaultBatchSize: 3000, slaTargetSeconds: 3600, supportsIncremental: true },
  { id: "etl.audit", domain: "audit", targetTable: "fact_audit_logs", bqLayer: "raw", priority: 50, dependencies: [], defaultBatchSize: 3000, slaTargetSeconds: 86400, supportsIncremental: true },
  { id: "etl.dimensions", domain: "booking", targetTable: "dim_service", bqLayer: "curated", priority: 5, dependencies: [], defaultBatchSize: 500, slaTargetSeconds: 86400, supportsIncremental: false },
  { id: "etl.aggregates", domain: "booking", targetTable: "agg_hourly_demand", bqLayer: "analytics", priority: 50, dependencies: ["etl.booking"], defaultBatchSize: 0, slaTargetSeconds: 7200, supportsIncremental: false },
  { id: "etl.eta", domain: "eta", targetTable: "eta_training", bqLayer: "analytics", priority: 12, dependencies: ["etl.booking"], defaultBatchSize: 2000, slaTargetSeconds: 3600, supportsIncremental: true },
];

export function getJobDefinition(jobId: string): EtlJobDefinition | undefined {
  return ETL_JOB_DEFINITIONS.find((j) => j.id === jobId);
}
