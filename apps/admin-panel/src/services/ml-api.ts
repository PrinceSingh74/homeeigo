import { apiRequest } from "@/lib/api-client";

/**
 * Phase-12 ML governance — the admin panel's only path to the model registry.
 *
 * Every call goes to `/api/admin/ml/*`. Nothing here decides readiness, computes a metric, judges
 * leakage or ranks a model: those are backend decisions, and recomputing any of them in the browser
 * would create a second answer that could disagree with the one the registry acted on.
 */

export type Readiness = "DATA_READY" | "DATA_PARTIAL" | "DATA_INSUFFICIENT" | "DATA_UNTRUSTED" | "NOT_APPLICABLE";

export type LeakageFinding = {
  kind: "TARGET_RECONSTRUCTION" | "LABEL_DEFINING_FEATURE" | "NON_REPRODUCIBLE_DEFINITION" | "FUTURE_INFORMATION";
  detail: string;
  affectedRows: number | null;
  severity: "BLOCKING" | "WARNING";
};

export type ModelReadiness = {
  model: string;
  purpose: string;
  readiness: Readiness;
  evidence: Record<string, number | string | null>;
  leakage: LeakageFinding[];
  blocker: string | null;
  decision: "BUILD_NOW" | "READINESS_ONLY" | "DATA_INSUFFICIENT" | "HUMAN_DECISION_REQUIRED" | "KEEP_EXISTING";
  source: string;
};

export type ReadinessReport = {
  models: ModelReadiness[];
  summary: Record<string, number>;
  warehouseReachable: boolean;
  generatedAt: string;
  rulesVersion: string;
};

export type HealthCheck = {
  name: string;
  state: "OK" | "WARN" | "FAIL" | "UNKNOWN";
  detail: string;
  measured: Record<string, unknown>;
};

export type PlatformHealth = {
  serviceable: boolean;
  checks: HealthCheck[];
  summary: string;
  generatedAt: string;
  rulesVersion: string;
};

export type ModelStage =
  | "TRAINING" | "TRAINED" | "EVALUATED" | "CANDIDATE" | "SHADOW"
  | "APPROVED" | "PRODUCTION" | "ROLLED_BACK" | "REJECTED" | "RETIRED";

export type ModelVersion = {
  id: string;
  modelName: string;
  version: number;
  stage: ModelStage;
  datasetVersion: string;
  featureVersion: string;
  codeVersion: string;
  artifactRef: string;
  artifactHash: string | null;
  metrics: Record<string, number> | null;
  baselineName: string | null;
  beatsBaseline: boolean | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  promotedAt: string | null;
  rolledBackAt: string | null;
  rolledBackReason: string | null;
  createdBy: string;
  createdAt: string;
};

export type GovernedModel = {
  modelName: string;
  versions: number;
  production: ModelVersion | null;
  latest: ModelVersion;
  stages: Record<string, number>;
};

export type DemandEvaluation = {
  dataset: {
    version: string; source: string; firstDate: string; lastDate: string;
    calendarDays: number; observedDays: number; imputedDays: number;
    duplicateDates: string[]; ageDays: number; warnings: string[];
  };
  split: { trainDays: number; testDays: number; trainEnd: string; testStart: string; testEnd: string };
  results: Array<{
    name: string;
    kind: "BASELINE" | "CANDIDATE" | "PRODUCTION";
    description: string;
    metrics: { n: number; mae: number; rmse: number; bias: number; medianAbsoluteError: number; mase: number | null;
               notReported: Array<{ metric: string; reason: string }> } | null;
    unavailableReason?: string;
  }>;
  best: { name: string; kind: string; mae: number } | null;
  candidateBeatsAllBaselines: boolean | null;
  verdict: string;
  evaluatedAt: string;
};

type Wrapped<T> = { success: boolean; data?: T };

export const mlApi = {
  health: () =>
    apiRequest<Wrapped<PlatformHealth>>("/api/admin/ml/health", { auth: true }).then((r) => r.data!),
  readiness: () =>
    apiRequest<Wrapped<ReadinessReport>>("/api/admin/ml/readiness", { auth: true }).then((r) => r.data!),
  models: () =>
    apiRequest<Wrapped<GovernedModel[]>>("/api/admin/ml/models", { auth: true }).then((r) => r.data!),
  versions: (name: string) =>
    apiRequest<Wrapped<ModelVersion[]>>(`/api/admin/ml/models/${encodeURIComponent(name)}/versions`, { auth: true })
      .then((r) => r.data!),
  demandEvaluation: (testDays?: number) =>
    apiRequest<Wrapped<DemandEvaluation>>("/api/admin/ml/demand/evaluation", {
      auth: true, query: testDays ? { testDays: String(testDays) } : {},
    }).then((r) => r.data!),

  approve: (versionId: string, note: string) =>
    apiRequest<Wrapped<{ version: number }> & { detail?: string }>(
      `/api/admin/ml/versions/${versionId}/approve`, { auth: true, method: "POST", body: { note } },
    ),
  promote: (versionId: string) =>
    apiRequest<Wrapped<{ version: number; superseded: number | null }> & { detail?: string }>(
      `/api/admin/ml/versions/${versionId}/promote`, { auth: true, method: "POST" },
    ),
  rollback: (modelName: string, reason: string) =>
    apiRequest<Wrapped<{ from: number; to: number | null }> & { detail?: string }>(
      `/api/admin/ml/models/${encodeURIComponent(modelName)}/rollback`, { auth: true, method: "POST", body: { reason } },
    ),
};
