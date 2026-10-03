import { logger } from "../lib/logger";
import { digitalTwinService, SUPPORTED_CITIES } from "./digital-twin.service";

/**
 * Phase 9, Capability 8 — Digital Twin narratives.
 *
 * ── What the Digital Twin actually is, traced not assumed ──────────────────────
 *
 * `cityTwin(city)` composes six geo-intelligence reads plus weather into ten layers for one city,
 * cached 45 s. `simulate(city, scenario)` applies delta multipliers to that composed state.
 * `executiveInsights(city)` emits threshold-triggered sentences. Scope is **city-level** across seven
 * cities — tier 0 Delhi / Gurugram / Noida, tier 1 Mumbai / Bangalore / Hyderabad / Pune. There is no
 * zone-level twin, so nothing here is described as one.
 *
 * ── Confidence: constants and one derivation, none of them measured ────────────
 *
 * `simulate()` returns `confidence: 0.8` unconditionally, `executiveInsights()` `0.85`, `cities()`
 * `0.9` — all literals that vary with nothing. `cityTwin()` is different: it averages the surge and
 * revenue services' confidences with hardcoded 0.7 / 0.6 fallbacks, so it is *derived* rather than
 * typed, though derived from figures that are themselves partly constants.
 *
 * `statedConfidence.basis` records which of the two a number is, and `measured` is false in both
 * cases because nothing in the twin measures its confidence against outcomes.
 *
 * ── Assumptions the simulation applies silently ────────────────────────────────
 *
 * `rainStart` multiplies demand by 1.25 **and** traffic by 1.2. `festival` multiplies demand by 1.6.
 * Conversion is modelled as `exp(-0.6 * surgeDelta)`. The simulation's own output returns the
 * scenario inputs but not these multipliers, so a reader cannot see what "rainStart: true" actually
 * did. They are extracted and published here as explicit assumptions.
 *
 * ── Writes ─────────────────────────────────────────────────────────────────────
 *
 * The twin performs **zero business writes** and nine telemetry writes (`setGauge`, `incCounter`,
 * `observeHist`). Calling `simulate()` increments `digital_twin_scenarios_total`. That is technical
 * persistence, not business-state mutation, and it is documented rather than described as read-only.
 */

export const TWIN_NARRATIVE_RULES_VERSION = "exec.twin.v1";

/** What kind of thing a number is. A simulation is never a forecast; a forecast is never an actual. */
export type TwinStateKind =
  | "LIVE_OPERATIONAL_STATE"
  | "SIMULATED_STATE"
  | "SCENARIO"
  | "FORECAST"
  | "OBSERVATION"
  | "ASSUMPTION";

export type TwinNarrativeState =
  | "TWIN_AVAILABLE"
  | "DIGITAL_TWIN_UNSUPPORTED_SCOPE"
  | "MODEL_UNAVAILABLE"
  | "INCOMPLETE_SIMULATION"
  | "DATA_QUALITY_ISSUE";

export const TWIN_REASON = {
  UNSUPPORTED_CITY: "DIGITAL_TWIN_UNSUPPORTED_SCOPE",
  SOURCE_UNAVAILABLE: "TWIN_SOURCE_UNAVAILABLE",
  CONFIDENCE_NOT_MEASURED: "CONFIDENCE_STATED_NOT_MEASURED",
  ASSUMPTIONS_IMPLICIT_IN_SOURCE: "ASSUMPTIONS_IMPLICIT_IN_SOURCE",
  NO_ZONE_SCOPE: "TWIN_HAS_NO_ZONE_SCOPE",
  TELEMETRY_WRITE_ON_SIMULATE: "TELEMETRY_WRITE_ON_SIMULATE",
} as const;

/**
 * A confidence figure with its provenance.
 *
 * The distinction is the whole point: 0.8 that was computed and 0.8 that was typed look identical on
 * a screen, and neither is 0.8 that was validated against outcomes.
 */
export type StatedConfidence = {
  value: number;
  /**
   * How the figure came to be.
   *
   * `CONSTANT` is a literal in the source. `DERIVED_FROM_UPSTREAM` is computed from other services'
   * confidences — which may themselves be constants, so it is not the same as measured. Neither is
   * `MEASURED`, and that value is deliberately absent: nothing in the twin measures its own
   * confidence.
   */
  basis: "CONSTANT" | "DERIVED_FROM_UPSTREAM";
  measured: false;
  note: string;
};

export type TwinAssumption = {
  trigger: string;
  effect: string;
  multiplier: number;
  /** Where the constant lives, so a reviewer can check it. */
  source: string;
};

export type TwinNarrative = {
  city: string;
  scope: "CITY";
  tier: 0 | 1 | null;
  state: TwinNarrativeState;
  stateKind: TwinStateKind;
  /** Layer values exactly as the twin composed them. Never recomputed. */
  layers: Record<string, unknown> | null;
  statedConfidence: StatedConfidence | null;
  generatedAt: string | null;
  freshness: string | null;
  source: string | null;
  limitations: string[];
  evidence: Array<{ signal: string; value: number | string | null; source: string }>;
  reasonCode?: string;
  rulesVersion: string;
  /** No model version: the twin publishes none. Never invented. */
  modelVersion: null;
};

export type ScenarioNarrative = {
  city: string;
  scope: "CITY";
  state: TwinNarrativeState;
  /** Always SIMULATED_STATE. A scenario result is not a forecast and cannot be typed as one. */
  stateKind: "SIMULATED_STATE";
  inputs: Record<string, unknown>;
  /** The multipliers the source applies without reporting them. */
  assumptions: TwinAssumption[];
  baseline: Record<string, unknown> | null;
  projected: Record<string, unknown> | null;
  impact: Record<string, unknown> | null;
  statedConfidence: StatedConfidence | null;
  generatedAt: string | null;
  source: string | null;
  limitations: string[];
  /** Advisory only. A scenario never authorises an operational change. */
  reviewPrompts: string[];
  requiresHumanApproval: false;
  reasonCode?: string;
  rulesVersion: string;
  modelVersion: null;
};

/**
 * The multipliers `simulate()` applies internally.
 *
 * Restated here only so they can be *published*, never to recompute anything — the simulation's own
 * numbers are carried verbatim. If the source changes a constant, this table is wrong and a test
 * that reads the source will say so.
 */
const IMPLICIT_ASSUMPTIONS: Record<string, TwinAssumption[]> = {
  rainStart: [
    { trigger: "rainStart", effect: "demand multiplied", multiplier: 1.25, source: "digital-twin.service.ts simulate()" },
    { trigger: "rainStart", effect: "traffic multiplied", multiplier: 1.2, source: "digital-twin.service.ts simulate()" },
  ],
  festival: [
    { trigger: "festival", effect: "demand multiplied", multiplier: 1.6, source: "digital-twin.service.ts simulate()" },
  ],
};

/** Conversion elasticity constant used by the simulation. Published, never applied here. */
const CONVERSION_ELASTICITY = -0.6;

function cityTier(city: string): 0 | 1 | null {
  const norm = (c: string) => c.trim().toLowerCase();
  if (SUPPORTED_CITIES.tier0.some((c) => norm(c) === norm(city))) return 0;
  if (SUPPORTED_CITIES.tier1.some((c) => norm(c) === norm(city))) return 1;
  return null;
}

export const digitalTwinNarrativeService = {
  /** The seven supported cities, read from the service rather than restated. */
  supportedCities(): string[] {
    return [...SUPPORTED_CITIES.tier0, ...SUPPORTED_CITIES.tier1];
  },

  /**
   * Explain a city's live twin state.
   *
   * An unsupported city is refused outright — interpolating from a neighbouring city would invent
   * an operational state that was never measured.
   */
  async explainCityState(city: string): Promise<TwinNarrative> {
    const generatedAt = new Date().toISOString();
    const tier = cityTier(city);
    const shell = {
      city,
      scope: "CITY" as const,
      tier,
      layers: null,
      statedConfidence: null,
      generatedAt: null,
      freshness: null,
      source: null,
      evidence: [] as TwinNarrative["evidence"],
      rulesVersion: TWIN_NARRATIVE_RULES_VERSION,
      modelVersion: null as null,
    };

    if (tier === null) {
      return {
        ...shell,
        state: "DIGITAL_TWIN_UNSUPPORTED_SCOPE",
        stateKind: "LIVE_OPERATIONAL_STATE",
        limitations: [
          "This city is not modelled by the Digital Twin. No state is inferred from any other city.",
        ],
        reasonCode: TWIN_REASON.UNSUPPORTED_CITY,
      };
    }

    let res: Awaited<ReturnType<typeof digitalTwinService.cityTwin>>;
    try {
      res = await digitalTwinService.cityTwin(city);
    } catch (err) {
      logger.warn("twin_narrative_source_unavailable", { city, error: String(err).slice(0, 200) });
      return {
        ...shell,
        state: "MODEL_UNAVAILABLE",
        stateKind: "LIVE_OPERATIONAL_STATE",
        limitations: ["The Digital Twin source did not respond."],
        reasonCode: TWIN_REASON.SOURCE_UNAVAILABLE,
      };
    }

    const data = res.data as { layers?: Record<string, unknown> } | null;
    const layers = data?.layers ?? null;

    return {
      ...shell,
      state: layers ? "TWIN_AVAILABLE" : "DATA_QUALITY_ISSUE",
      stateKind: "LIVE_OPERATIONAL_STATE",
      layers,
      statedConfidence: {
        value: res.confidence,
        basis: "DERIVED_FROM_UPSTREAM",
        measured: false,
        /**
         * `cityTwin` averages the surge and revenue services' own confidences, with hardcoded
         * fallbacks of 0.7 and 0.6 when either is absent. So it is derived rather than typed — but
         * derived from figures that are themselves partly constants, which is why `measured` stays
         * false.
         */
        note: "Mean of the surge and revenue services' confidences (fallbacks 0.7 / 0.6). " +
          "Derived from upstream figures, not measured against outcomes.",
      },
      generatedAt: res.generatedAt ?? generatedAt,
      freshness: res.freshness ?? null,
      source: res.source ?? "digital-twin",
      limitations: [
        "The Digital Twin is city-scoped. It models no zones, so nothing here may be attributed to one.",
        "The twin publishes no model version.",
        "The confidence figure is published by the twin, not computed from the layers.",
      ],
      evidence: [
        { signal: "CITY_TIER", value: tier, source: "digital-twin:SUPPORTED_CITIES" },
        { signal: "LAYER_COUNT", value: layers ? Object.keys(layers).length : 0, source: "digital-twin:cityTwin" },
        { signal: "TWIN_SOURCE", value: res.source ?? null, source: "digital-twin:cityTwin" },
        { signal: "TWIN_FRESHNESS", value: res.freshness ?? null, source: "digital-twin:cityTwin" },
      ],
      ...(layers ? {} : { reasonCode: TWIN_REASON.SOURCE_UNAVAILABLE }),
    };
  },

  /**
   * Explain a scenario result.
   *
   * The result is always `SIMULATED_STATE`. The type admits nothing else, so a caller cannot label a
   * simulation a forecast even by mistake.
   */
  async explainScenario(
    city: string,
    scenario: { demandDeltaPct?: number; providerDeltaPct?: number; trafficDeltaPct?: number; rainStart?: boolean; festival?: boolean },
  ): Promise<ScenarioNarrative> {
    const shell = {
      city,
      scope: "CITY" as const,
      stateKind: "SIMULATED_STATE" as const,
      inputs: { ...scenario },
      assumptions: this.assumptionsFor(scenario),
      baseline: null,
      projected: null,
      impact: null,
      statedConfidence: null,
      generatedAt: null,
      source: null,
      reviewPrompts: [] as string[],
      requiresHumanApproval: false as const,
      rulesVersion: TWIN_NARRATIVE_RULES_VERSION,
      modelVersion: null as null,
    };

    if (cityTier(city) === null) {
      return {
        ...shell,
        state: "DIGITAL_TWIN_UNSUPPORTED_SCOPE",
        limitations: ["This city is not modelled by the Digital Twin, so no scenario can be run for it."],
        reasonCode: TWIN_REASON.UNSUPPORTED_CITY,
      };
    }

    let res: Awaited<ReturnType<typeof digitalTwinService.simulate>>;
    try {
      res = await digitalTwinService.simulate(city, scenario);
    } catch (err) {
      logger.warn("twin_narrative_simulation_unavailable", { city, error: String(err).slice(0, 200) });
      return {
        ...shell,
        state: "INCOMPLETE_SIMULATION",
        limitations: ["The simulation did not complete."],
        reasonCode: TWIN_REASON.SOURCE_UNAVAILABLE,
      };
    }

    const d = res.data as {
      baseline?: Record<string, unknown>;
      projected?: Record<string, unknown>;
      impact?: Record<string, unknown>;
    } | null;

    return {
      ...shell,
      state: d?.projected ? "TWIN_AVAILABLE" : "INCOMPLETE_SIMULATION",
      baseline: d?.baseline ?? null,
      projected: d?.projected ?? null,
      impact: d?.impact ?? null,
      statedConfidence: {
        value: res.confidence,
        basis: "CONSTANT",
        measured: false,
        note: "A literal in the simulation source. It does not vary with the scenario, its inputs, " +
          "or the state being simulated.",
      },
      generatedAt: res.generatedAt ?? null,
      source: res.source ?? "twin-simulation",
      limitations: [
        "These are simulated values under the stated assumptions, not a forecast and not an observation.",
        "The simulation applies multipliers that its own output does not report; they are listed as assumptions here.",
        "Conversion is modelled as exp(" + CONVERSION_ELASTICITY + " * surge change) — an assumed elasticity, not a measured one.",
        "The confidence figure is a constant in the source rather than a measurement.",
        "Running a scenario increments the telemetry counter digital_twin_scenarios_total. No business state changes.",
      ],
      reviewPrompts: d?.projected
        ? ["Consider reviewing supply in " + city + " under this scenario."]
        : [],
    };
  },

  /** The multipliers a given scenario will silently trigger, made explicit before it runs. */
  assumptionsFor(scenario: Record<string, unknown>): TwinAssumption[] {
    const out: TwinAssumption[] = [];
    for (const [key, list] of Object.entries(IMPLICIT_ASSUMPTIONS)) {
      if (scenario[key] === true) out.push(...list);
    }
    return out;
  },

  /** Exposed so tests assert the constants against the source rather than restating them. */
  conversionElasticity(): number {
    return CONVERSION_ELASTICITY;
  },

  implicitAssumptions(): Readonly<Record<string, TwinAssumption[]>> {
    return IMPLICIT_ASSUMPTIONS;
  },
};
