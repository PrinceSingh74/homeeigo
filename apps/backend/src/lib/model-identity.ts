/**
 * One answer to "which version of this model is that?".
 *
 * ── The conflict this resolves ───────────────────────────────────────────────
 *
 * The same model was identified two different ways. `forecast-explainer` read the warehouse model
 * registry and reported `model_demand_forecast` as `v1`. `executive-intelligence` and
 * `demand-supply-warning` instead assigned `IntelResult.source` — a PROVENANCE string such as
 * `"bigquery:arima_plus"` — into their `modelVersion` field. `ExecutiveFact` already carries a
 * dedicated `source` field, so that wrote the provenance twice and left the real version unreported:
 * a field named `modelVersion` that could never contain a model version.
 *
 * Two identities for one model is the drift this module exists to prevent. Callers ask here.
 *
 * Fails to `null` rather than guessing. An unknown version is a fact; an invented one is not, and a
 * confident wrong version is worse than an honest absence.
 */
import { mlopsService } from "../services/mlops.service";
import { logger } from "./logger";

export type ModelIdentity = {
  model: string;
  version: string;
  type: string;
  status: string;
  /** TRAINED and nothing else. A BLOCKED or PARTIALLY_TRAINED model is not one to rely on. */
  usable: boolean;
};

/** The registry, projected. Returns [] when the warehouse cannot be reached. */
export async function modelRegistryEntries(): Promise<ModelIdentity[]> {
  try {
    const r = await mlopsService.registry();
    return r.models.map((m) => ({
      model: String(m.model_name),
      version: String(m.version),
      type: String(m.model_type),
      status: String(m.status),
      usable: String(m.status) === "TRAINED",
    }));
  } catch (err) {
    logger.warn("model_registry_unavailable", { error: String(err).slice(0, 200) });
    return [];
  }
}

/**
 * One model's identity, matched on the EXACT registry name.
 *
 * Exact rather than prefix or fuzzy: `model_demand_forecast` and `model_revenue_forecast` are
 * different models, and borrowing one's version for the other would be a silent misattribution that
 * no consumer could detect.
 */
export async function resolveModelIdentity(modelName: string): Promise<ModelIdentity | null> {
  const entries = await modelRegistryEntries();
  return entries.find((m) => m.model === modelName) ?? null;
}
