/**
 * Phase 15 — governed scenario simulation and executive what-if.
 *
 * ── What this is, and what it is not ─────────────────────────────────────────────
 *
 * `digitalTwinService.simulate` already exists and already computes a scenario. This does **not**
 * replace it and does not reimplement its arithmetic — that would be a second engine disagreeing
 * with the first. It wraps it in the things a scenario result needs before an executive is allowed
 * to act on it: named assumptions, real data freshness, a model version, a reproducible id, and an
 * honest statement of what is not known.
 *
 * ── Why the wrapper is necessary rather than cosmetic ────────────────────────────
 *
 * The underlying model returns `confidence: 0.8`. That number is hardcoded. No validation of the
 * simulation against realised outcomes exists anywhere in this platform, so 0.8 is not a measured
 * confidence — it is a number that looks like one, which is worse than no number at all because it
 * survives being read aloud in a meeting.
 *
 * The model also carries coefficients nobody derived from this platform's data: rain multiplies
 * demand by 1.25, a festival by 1.6, conversion decays as `exp(-0.6 × surge delta)`, and losing a
 * provider adds ETA at 30% per unit of lost supply. Those may be reasonable priors. They are not
 * measurements, and the platform has never checked them against an outcome. Deleting them would
 * throw away a working directional model; presenting them as fact is the actual defect. So they
 * are surfaced, by name and with their provenance, next to every number they produce.
 *
 * ── Read-only by construction ────────────────────────────────────────────────────
 *
 * A what-if that can write is not a what-if. Isolation here is structural rather than promised:
 * this module imports no repository, no finance service and no workflow entry point, and the one
 * call it makes reads aggregates. The test suite asserts the module's import graph contains
 * nothing that can mutate, which is a property a reviewer can check rather than a claim they have
 * to believe.
 */
import crypto from "crypto";
import { digitalTwinService } from "./digital-twin.service";
import { incCounter, observeHist } from "../lib/metrics";
import { logger } from "../lib/logger";
import { evaluateFlag } from "./feature-flag.service";

/**
 * Every coefficient the simulation applies that was not measured from this platform's own data.
 *
 * Stated as data rather than prose so the API can return them verbatim: an executive reading
 * "revenue +18%" is entitled to see that the number rests on an unvalidated elasticity constant.
 */
export const SIMULATION_ASSUMPTIONS = [
  {
    id: "rain.demand_multiplier",
    value: 1.25,
    applies_when: "scenario.rainStart",
    basis: "UNVALIDATED_PRIOR",
    note: "Rain is assumed to raise demand 25%. Not derived from this platform's weather-joined booking history, and never compared against a realised outcome.",
  },
  {
    id: "festival.demand_multiplier",
    value: 1.6,
    applies_when: "scenario.festival",
    basis: "UNVALIDATED_PRIOR",
    note: "A festival is assumed to raise demand 60%. No festival calendar or festival-labelled booking history exists in this platform to check it against.",
  },
  {
    id: "rain.traffic_multiplier",
    value: 1.2,
    applies_when: "scenario.rainStart",
    basis: "UNVALIDATED_PRIOR",
    note: "Rain is assumed to slow travel 20%.",
  },
  {
    id: "conversion.price_elasticity",
    value: -0.6,
    applies_when: "always",
    basis: "UNVALIDATED_PRIOR",
    note: "Conversion is modelled as exp(-0.6 x surge delta). This platform has no price-experiment result to fit an elasticity from — the one pricing experiment that exists has identical arms and records no conversions.",
  },
  {
    id: "eta.supply_loss_penalty",
    value: 0.3,
    applies_when: "scenario.providerDeltaPct < 0",
    basis: "UNVALIDATED_PRIOR",
    note: "Losing supply is assumed to inflate ETA at 30% of the proportion lost.",
  },
  {
    id: "surge.clamp",
    value: "[1, 3]",
    applies_when: "always",
    basis: "MATCHES_LIVE_ENGINE",
    note: "The surge clamp mirrors the live pricing engine's own bounds, so the simulation cannot project a surge the platform would never charge.",
  },
] as const;

/** Why this result cannot be treated as a forecast. Returned with every simulation. */
export const SIMULATION_LIMITATIONS = [
  "NOT_BACKTESTED: no simulated scenario has ever been compared against what subsequently happened, so the model's directional accuracy is unmeasured.",
  "NO_CONFIDENCE_INTERVAL: the engine is a deterministic point calculation. It produces one number, not a distribution, and cannot express uncertainty in its own output.",
  "PRIOR_DRIVEN: five of the six coefficients are unvalidated priors (see assumptions). Their combined error is unknown and does not cancel.",
  "SNAPSHOT_BOUND: the baseline is a live read. A scenario run an hour later starts from different numbers and is not comparable to this one unless the snapshot id matches.",
  "NO_SECOND_ORDER_EFFECTS: partner churn, customer re-booking, competitor response and word-of-mouth are absent from the model entirely.",
] as const;

/**
 * Bumped when the wrapper's contract or the underlying arithmetic changes, so a stored result can
 * be read back knowing what produced it. Not a version of the twin's data — that is `snapshotId`.
 */
/**
 * The city-twin cache window, mirroring `digitalTwinService.cityTwin`'s own TTL.
 *
 * Restated here because the twin does not export it. If that TTL grows this becomes an
 * understatement, so the note says "may be up to" — true for any window at least this large — and
 * the test asserts the reported staleness is never zero.
 */
export const TWIN_CACHE_TTL_SECONDS = 45;

export const SIMULATION_MODEL_VERSION = "scenario-sim.v1";

export type ScenarioParameters = {
  demandDeltaPct?: number;
  providerDeltaPct?: number;
  trafficDeltaPct?: number;
  rainStart?: boolean;
  festival?: boolean;
};

export type SimulationResult = {
  scenarioId: string;
  city: string;
  parameters: Required<ScenarioParameters>;
  baseline: Record<string, number>;
  projected: Record<string, number>;
  delta: Record<string, number>;
  modelVersion: string;
  /** Identity of the underlying data the baseline was read from. Same id ⇒ comparable runs. */
  snapshotId: string;
  /**
   * When the baseline was actually observed, and how much older than that it may be.
   *
   * Not a bare timestamp. `digitalTwinService.simulate` returns `freshness: new Date()` — the
   * response time — while the city twin it reads from is served through a 45-second cache. A
   * scenario run against 44-second-old numbers therefore reported itself as instantaneously
   * fresh. The magnitude is small; the shape of the error is exactly the one Phase 13 removed
   * from the telemetry-age panel, and passing it through this layer would launder it.
   */
  dataFreshness: {
    observedAt: string;
    basis: "TWIN_SNAPSHOT" | "UNKNOWN";
    maxStalenessSeconds: number;
    note: string;
  };
  generatedAt: string;
  assumptions: typeof SIMULATION_ASSUMPTIONS;
  limitations: typeof SIMULATION_LIMITATIONS;
  /**
   * Deliberately not a number.
   *
   * The underlying engine returns `confidence: 0.8`, hardcoded and never validated. Passing that
   * through would be the single most misleading field in the response, so this states what is
   * actually known about the result's reliability instead.
   */
  confidence: {
    kind: "UNVALIDATED";
    basis: "DETERMINISTIC_MODEL_NO_BACKTEST";
    note: string;
  };
  readOnly: true;
};

/** Fill defaults so two callers who omit different fields still produce the same scenario id. */
function normalise(p: ScenarioParameters): Required<ScenarioParameters> {
  return {
    demandDeltaPct: p.demandDeltaPct ?? 0,
    providerDeltaPct: p.providerDeltaPct ?? 0,
    trafficDeltaPct: p.trafficDeltaPct ?? 0,
    rainStart: p.rainStart ?? false,
    festival: p.festival ?? false,
  };
}

/**
 * A stable id for "this scenario, against this data".
 *
 * Includes the baseline snapshot, not just the parameters: the same question asked against
 * different underlying numbers is a different result, and giving both the same id would let two
 * incomparable runs be compared. Reproducibility here means *given the same inputs and the same
 * snapshot*, not "the same forever" — the baseline is live data and moves.
 */
function scenarioIdFor(city: string, params: Required<ScenarioParameters>, snapshotId: string): string {
  const canonical = JSON.stringify({ city, params, snapshotId, model: SIMULATION_MODEL_VERSION });
  return `scn_${crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 20)}`;
}

/** Identity of the baseline numbers, so two runs can be told apart or matched. */
function snapshotIdFor(baseline: Record<string, number>): string {
  return `snap_${crypto.createHash("sha256").update(JSON.stringify(baseline)).digest("hex").slice(0, 16)}`;
}

/**
 * RELEASE GATE. Phase-15 capabilities shipped without any flag of their own, which made a
 * progressive rollout impossible: the only options were "unreachable" and "on for everyone".
 * `evaluateFlag` fails closed -- a key with no row returns `{enabled:false, reason:"FLAG_MISSING"}`
 * -- so declaring the key here means the capability is OFF until an operator creates the flag and
 * enables it, and can be switched off again without a deploy.
 */
export const SIMULATION_FEATURE_FLAG = "PHASE15_SCENARIO_SIMULATION" as const;

export class ScenarioSimulationService {
  /**
   * Run a scenario. Reads live aggregates, writes nothing.
   *
   * Capability 5 (scenario simulation) and capability 6 (executive what-if) are the same
   * computation asked by different people — one wants the operational shape, the other the
   * financial delta. Building two engines would guarantee they eventually disagree, so there is
   * one, and the executive view is a projection of this result rather than a parallel model.
   */
  async simulate(city: string, parameters: ScenarioParameters): Promise<SimulationResult> {
    const t0 = Date.now();
    const params = normalise(parameters);

    const flag = await evaluateFlag(SIMULATION_FEATURE_FLAG);
    if (!flag.enabled) {
      throw new Error(`SIMULATION_DISABLED:${flag.reason}`);
    }

    /**
     * The twin snapshot is read first, for its freshness. `simulate` regenerates `freshness` as
     * the response time and discards the snapshot's own, so consuming that value would report
     * cache-age-zero for data that may be up to a cache window old. This is a cache hit for
     * `simulate`'s own internal read, so it costs a lookup rather than a second aggregation.
     */
    const snapshot = await digitalTwinService.cityTwin(city).catch(() => null);
    const raw = await digitalTwinService.simulate(city, params);
    const data = raw.data as {
      baseline: Record<string, number>;
      projected: Record<string, number>;
      impact: Record<string, number>;
    };

    const snapshotId = snapshotIdFor(data.baseline);
    const scenarioId = scenarioIdFor(city, params, snapshotId);

    observeHist("homigo_simulation_duration_seconds", (Date.now() - t0) / 1000, { city });
    incCounter("homigo_simulation_runs_total", { city, kind: "scenario" });

    return {
      scenarioId,
      city,
      parameters: params,
      baseline: data.baseline,
      projected: data.projected,
      delta: data.impact,
      modelVersion: SIMULATION_MODEL_VERSION,
      snapshotId,
      dataFreshness: {
        observedAt: snapshot?.freshness ?? "UNKNOWN",
        basis: snapshot?.freshness ? "TWIN_SNAPSHOT" : "UNKNOWN",
        maxStalenessSeconds: TWIN_CACHE_TTL_SECONDS,
        note: snapshot?.freshness
          ? `Baseline observed at this time and served through the city-twin cache, so it may be up to ${TWIN_CACHE_TTL_SECONDS}s older than the scenario run.`
          : "The twin snapshot could not be read, so the age of the baseline is unknown. It is not reported as fresh.",
      },
      generatedAt: new Date().toISOString(),
      assumptions: SIMULATION_ASSUMPTIONS,
      limitations: SIMULATION_LIMITATIONS,
      confidence: {
        kind: "UNVALIDATED",
        basis: "DETERMINISTIC_MODEL_NO_BACKTEST",
        note: "The underlying engine reports a fixed 0.8 that was never measured against an outcome. It is not passed through. Treat this result as directional, not predictive.",
      },
      readOnly: true,
    };
  }

  /**
   * Executive what-if — the same run, presented as baseline / scenario / delta.
   *
   * ── Why there is no money in here ────────────────────────────────────────────
   *
   * The obvious next step is to turn `revenuePct` into rupees by multiplying it against current
   * revenue. That would be arithmetic performed outside the authoritative finance services on a
   * number derived from five unvalidated priors, and it would arrive in an executive report
   * looking exactly like a ledger figure. The percentage keeps its provenance visible; a currency
   * amount would not. Converting it is a finance decision, made with finance's own services.
   */
  async whatIf(city: string, parameters: ScenarioParameters): Promise<{
    question: Required<ScenarioParameters>;
    baseline: Record<string, number>;
    scenario: Record<string, number>;
    delta: Record<string, number>;
    interpretation: string[];
    assumptions: typeof SIMULATION_ASSUMPTIONS;
    limitations: typeof SIMULATION_LIMITATIONS;
    dataFreshness: SimulationResult["dataFreshness"];
    modelVersion: string;
    scenarioId: string;
    confidence: SimulationResult["confidence"];
    financialProjection: {
      available: false;
      reason: string;
    };
  }> {
    const sim = await this.simulate(city, parameters);
    incCounter("homigo_simulation_runs_total", { city, kind: "what_if" });

    const interpretation: string[] = [];
    const d = sim.delta;
    if (typeof d.revenuePct === "number") {
      interpretation.push(
        `Revenue moves ${d.revenuePct >= 0 ? "+" : ""}${d.revenuePct}% — driven by how much of the changed demand can actually be served, since fulfilment is capped by supply.`,
      );
    }
    if (typeof d.supplyGapPct === "number" && d.supplyGapPct > 0) {
      interpretation.push(
        `Demand-to-supply pressure rises ${d.supplyGapPct}%. Above the surge clamp of 3x the model cannot express further scarcity, so real pressure may exceed what is shown.`,
      );
    }
    if (typeof d.etaPct === "number" && d.etaPct !== 0) {
      interpretation.push(`ETA moves ${d.etaPct >= 0 ? "+" : ""}${d.etaPct}%, from traffic and from any change in available supply.`);
    }
    if (interpretation.length === 0) {
      interpretation.push("The scenario produced no material movement against the baseline.");
    }

    logger.info("what_if_evaluated", {
      category: "APPLICATION",
      city,
      scenarioId: sim.scenarioId,
      snapshotId: sim.snapshotId,
    });

    return {
      question: sim.parameters,
      baseline: sim.baseline,
      scenario: sim.projected,
      delta: sim.delta,
      interpretation,
      assumptions: sim.assumptions,
      limitations: sim.limitations,
      dataFreshness: sim.dataFreshness,
      modelVersion: sim.modelVersion,
      scenarioId: sim.scenarioId,
      confidence: sim.confidence,
      financialProjection: {
        available: false,
        reason:
          "A rupee figure would require multiplying an unvalidated percentage by real revenue outside the authoritative finance services. The percentage carries its provenance; a currency amount would not.",
      },
    };
  }
}

export const scenarioSimulationService = new ScenarioSimulationService();
