import { existsSync } from "node:fs";
import { isDeployedEnvironment } from "./deployed-environment";

/**
 * One decision about whether a BigQuery call may leave the machine.
 *
 * ── Why this is centralised ──────────────────────────────────────────────────
 *
 * `vertex-ai.service.ts` carried this rule privately: under NODE_ENV=test with no ADC, refuse
 * rather than let the BigQuery client probe the GCE metadata server and hang ~5s before failing.
 * That hang starves the postgres-backed suites running alongside it.
 *
 * Four other modules construct their own `new BigQuery(...)` and had no such rule, so tests were
 * silently making LIVE warehouse calls. That was not theoretical: `forecast-explainer` asserts that
 * the model version it reports equals the version in the registry, and the two disagreed precisely
 * because `mlops.service` reached real BigQuery (returning `model_demand_forecast@v1`) while
 * `vertex-ai` was refused by the barrier and reported the source as unavailable. A test comparing
 * two sources of truth was comparing one live and one stubbed.
 *
 * Beyond that single failure, a suite whose result depends on warehouse contents and network
 * reachability is not a suite whose green means anything. Both are now decided here, once.
 *
 * ── Why a developer machine is refused too (2026-09-28) ─────────────────────────────────────────
 *
 * The rule used to be "anything that is not NODE_ENV=test may write". A backend started on a
 * laptop against the isolated homigo_test database (NODE_ENV=development) then ran its scheduled
 * ETL through the developer's gcloud Application Default Credentials — which the Google client
 * finds on its own in the gcloud config directory — and sent test-database rows to the shared
 * warehouse. Nothing in the process had asked for that; a login made earlier for another purpose
 * was enough.
 *
 * So outside a deployment the warehouse is reachable only when all three are stated explicitly:
 *   ANALYTICS_WAREHOUSE_EGRESS=enabled
 *   ANALYTICS_WAREHOUSE_TARGET=<project>.<dataset>    — must equal the target this process resolves
 *   GOOGLE_APPLICATION_CREDENTIALS=<existing key file> — the implicit gcloud login never counts
 * Deployed environments (production, staging) are unchanged: they authenticate through the
 * runtime's service account and are allowed as long as the target is well formed.
 */

/** The defaults `analytics/config.ts` and the ML services fall back to when the env is unset. */
export const DEFAULT_GCP_PROJECT_ID = "homigo-497619";
export const DEFAULT_BQ_DATASET = "homigo_analytics";

export type WarehouseEgressRefusal =
  | "test_runtime_without_opt_in"
  | "malformed_target"
  | "local_egress_not_enabled"
  | "local_target_not_authorized"
  | "local_credentials_not_explicit";

export type WarehouseEgressDecision =
  | { allowed: true; target: string; basis: "deployed_environment" | "test_opt_in" | "local_authorized" }
  | { allowed: false; target: string; reason: WarehouseEgressRefusal };

// GCP project ids: 6–30 chars of lowercase letters, digits and hyphens, starting with a letter and
// not ending with a hyphen. The un-substituted deploy template value "PROJECT_ID" fails this.
const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATASET_RE = /^[A-Za-z0-9_]{1,1024}$/;

export function warehouseEgressDecision(env: NodeJS.ProcessEnv = process.env): WarehouseEgressDecision {
  const projectId = (env.GCP_PROJECT_ID ?? DEFAULT_GCP_PROJECT_ID).trim();
  const dataset = (env.BQ_DATASET ?? DEFAULT_BQ_DATASET).trim();
  const target = `${projectId}.${dataset}`;

  // In a test runtime ONLY the explicit opt-in counts. Merely having GOOGLE_APPLICATION_CREDENTIALS
  // in the developer's shell used to open the barrier, silently sending test fixtures to the live
  // warehouse (independent review, release certification 2026-09-20).
  const testRuntime = env.NODE_ENV === "test";
  if (testRuntime && env.HOMIGO_REQUIRE_BIGQUERY !== "1") {
    return { allowed: false, target, reason: "test_runtime_without_opt_in" };
  }
  if (!PROJECT_ID_RE.test(projectId) || !DATASET_RE.test(dataset)) {
    return { allowed: false, target, reason: "malformed_target" };
  }
  if (testRuntime) return { allowed: true, target, basis: "test_opt_in" };
  if (isDeployedEnvironment(env)) return { allowed: true, target, basis: "deployed_environment" };

  if ((env.ANALYTICS_WAREHOUSE_EGRESS ?? "").trim().toLowerCase() !== "enabled") {
    return { allowed: false, target, reason: "local_egress_not_enabled" };
  }
  if ((env.ANALYTICS_WAREHOUSE_TARGET ?? "").trim() !== target) {
    return { allowed: false, target, reason: "local_target_not_authorized" };
  }
  const credentials = (env.GOOGLE_APPLICATION_CREDENTIALS ?? "").trim();
  if (!credentials || !existsSync(credentials)) {
    return { allowed: false, target, reason: "local_credentials_not_explicit" };
  }
  return { allowed: true, target, basis: "local_authorized" };
}

/** Set HOMIGO_REQUIRE_BIGQUERY=1 to opt a test run back into real warehouse calls. */
export function bigQueryAllowed(): boolean {
  return warehouseEgressDecision().allowed;
}

/**
 * The message deliberately matches what the Google client emits when ADC is missing, so callers
 * that already classify that string keep behaving identically whether the refusal came from here or
 * from the SDK.
 */
export const BQ_NO_CREDENTIALS_MESSAGE =
  "Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.";

/** The SDK's missing-credentials message, plus which rule refused. */
export class WarehouseEgressRefusedError extends Error {
  constructor(public readonly reason: WarehouseEgressRefusal) {
    super(BQ_NO_CREDENTIALS_MESSAGE);
  }
}

export function assertBqAdcAvailable(): void {
  const decision = warehouseEgressDecision();
  if (decision.allowed) return;
  throw new WarehouseEgressRefusedError(decision.reason);
}
