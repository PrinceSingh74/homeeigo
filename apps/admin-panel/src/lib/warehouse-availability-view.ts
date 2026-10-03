import type { MlopsHealth, MlopsHealthResponse, PipelineHealth } from "@/services/admin-api";
import { formatCount } from "@/lib/format";

/**
 * What the admin surfaces may show when the data warehouse is down (X-88 / X-90), decided in one
 * place. The routes answer a stated `available: false` with no figures; these views keep that from
 * being rendered as a claim nobody measured ("empty registry", "0%", "0 observed days").
 */

export type MlRegistryView =
  | { state: "loading" | "unavailable"; health: null }
  | { state: "ready"; health: MlopsHealth };

/** A registry that answered — even with zero models ("Models 0" is a measurement) — is `ready`. */
export function mlRegistryView(res: MlopsHealthResponse | undefined, isError: boolean): MlRegistryView {
  if (isError || res?.available === false) return { state: "unavailable", health: null };
  if (!res || !res.data) return { state: "loading", health: null };
  return { state: "ready", health: res.data };
}

/**
 * X-91: the AI HQ registry tiles. The "Healthy" tile read `ml.healthy ?? ml.active ?? ml.production`
 * — none of which `/api/mlops/health` returns — so it always showed 0. The tiles now show the
 * registry's own fields under their own names; "healthy" was never defined by the API and is not
 * invented here.
 */
export function registryTiles(h: MlopsHealth): Array<{ label: string; value: string }> {
  return [
    { label: "Models", value: formatCount(h.total) },
    { label: "Trained", value: formatCount(h.trained) },
  ];
}

export function pipelineView(p: PipelineHealth): { freshnessLabel: string; qualityLabel: string; mlopsLabel: string } {
  const mlops = p.mlops as Record<string, unknown> & { available?: boolean };
  return {
    freshnessLabel: `${p.freshness ?? 0} / ${p.totalDatasets ?? 0}`,
    // Null = no rule could be evaluated. Not 0%.
    qualityLabel: p.qualityScore == null ? "—" : `${Number(p.qualityScore).toFixed(0)}%`,
    // X-91: this read `mlops.status`, which the API never sends — always "—". It now shows the
    // registry's own counts; without them, nothing is rendered as a figure.
    mlopsLabel:
      mlops?.available === false
        ? "Unavailable"
        : typeof mlops?.total === "number" && typeof mlops?.trained === "number"
          ? `${formatCount(mlops.trained)} / ${formatCount(mlops.total)} trained`
          : "—",
  };
}

export function evaluationDatasetLine(
  d: { observedDays: number; calendarDays: number; imputedDays: number; version: string },
  split: { trainDays: number; trainEnd: string; testStart: string; testEnd: string },
): string | null {
  // A dataset that was never read has no day counts to report; the verdict says why.
  if (d.version === "unavailable") return null;
  return (
    `${d.observedDays} observed day(s) over ${d.calendarDays} calendar days` +
    (d.imputedDays > 0 ? `, ${d.imputedDays} filled with zero` : "") +
    ` · trained on ${split.trainDays}d to ${split.trainEnd} · tested on ${split.testStart}–${split.testEnd} · dataset ${d.version}`
  );
}
