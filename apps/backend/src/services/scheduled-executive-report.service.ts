import { logger } from "../lib/logger";
import { executiveReportingService, type ReportPeriod } from "./executive-reporting.service";
import { executiveIntelligenceService } from "./executive-intelligence.service";
import { executiveKpiExplainer, type KpiExplanation } from "./executive-kpi-explainer.service";
import { revenueAnomalyService } from "./revenue-anomaly.service";
import { demandSupplyWarningService } from "./demand-supply-warning.service";
import { financeNarrativeService } from "./finance-narrative.service";
import { fraudNarrativeService } from "./fraud-narrative.service";
import { forecastExplainerService } from "./forecast-explainer.service";
import { digitalTwinNarrativeService } from "./digital-twin-narrative.service";
import { recommendedActionsService } from "./recommended-actions.service";

/**
 * Phase 9, Capability 11 — the content of a scheduled executive report.
 *
 * ── What this is not ───────────────────────────────────────────────────────────
 *
 * Not a report engine. `executiveReportingService` stays authoritative for every underlying number,
 * and capabilities 1-9 stay authoritative for provenance, state and narrative. Nothing here
 * recalculates GMV, re-detects an anomaly, or re-derives a forecast interval. This module composes
 * what those services already produced and classifies each piece so a reader can tell a measurement
 * from a projection.
 *
 * Not a scheduler either. `ScheduledJob` + `runScheduledJobTick` + the leader lock are the platform's
 * one scheduler, and the job handler in `events/jobs/executive-report.job.ts` registers with it.
 *
 * Not a delivery mechanism. `routeNotification` is the only way a message leaves the platform, and
 * this module hands it a recipient id and a template — never an address, never an adapter.
 *
 * ── Freshness is re-evaluated here, at assembly time ───────────────────────────
 *
 * The one thing a scheduled report can get catastrophically wrong is presenting yesterday's numbers
 * as today's. Every source is called at assembly time and its own `freshness` / `state` is carried
 * verbatim; nothing is cached across runs. A stale source makes the whole report STALE and says
 * which source, rather than quietly aging.
 *
 * ── Known defects are carried, never smoothed ──────────────────────────────────
 *
 * `netRevenue` is `DATA_QUALITY_ISSUE` in the context because it mixes period bases, and it stays
 * that way here: it appears as a FACT whose state says so, and it also appears as a LIMITATION. A
 * scheduled report that quietly printed the number would be the single easiest way for that defect
 * to become a board figure.
 */

export const SCHEDULED_REPORT_RULES_VERSION = "exec.report.v1";

/**
 * What a line in the report *is*.
 *
 * Kept as separate kinds rather than one prose blob because the difference is the whole point: a
 * forecast read as a fact is a lie about certainty, and a recommendation read as an instruction is a
 * lie about authority.
 */
export type ReportItemKind =
  | "FACT"
  | "ANOMALY"
  | "FORECAST"
  | "WARNING"
  | "RECOMMENDATION"
  | "LIMITATION";

/** The report's own lifecycle state. Delivery states are separate and come from the router. */
export type ReportState =
  | "GENERATED"
  | "STALE"
  | "INCOMPLETE"
  | "FAILED";

/**
 * What happened to the delivery attempt.
 *
 * `QUEUED` is this layer's own; every `WOULD_*` and `SKIPPED` value is the notification router's
 * verdict carried through unchanged, so a report's delivery state and a workflow's shadow evidence
 * mean the same thing.
 */
export type ReportDeliveryState =
  | "QUEUED"
  | "WOULD_SEND"
  | "WOULD_DEFER"
  | "WOULD_SUPPRESS"
  | "WOULD_BLOCK"
  | "SKIPPED"
  | "SENT"
  | "FAILED"
  | "NOT_ATTEMPTED";

export const REPORT_REASON = {
  SCHEDULE_UNSET: "EXECUTIVE_REPORT_SCHEDULE_UNSET",
  FLAG_DISABLED: "EXECUTIVE_REPORT_FLAG_DISABLED",
  SOURCE_STALE: "EXECUTIVE_REPORT_SOURCE_STALE",
  SOURCE_UNAVAILABLE: "EXECUTIVE_REPORT_SOURCE_UNAVAILABLE",
  DOMAIN_INCOMPLETE: "EXECUTIVE_REPORT_DOMAIN_INCOMPLETE",
  NARRATIVE_DETERMINISTIC: "EXECUTIVE_REPORT_NARRATIVE_DETERMINISTIC",
  NARRATIVE_MODEL_UNAVAILABLE: "EXECUTIVE_REPORT_NARRATIVE_MODEL_UNAVAILABLE",
  NO_RECIPIENTS: "EXECUTIVE_REPORT_NO_RECIPIENTS",
} as const;

export type ReportItem = {
  kind: ReportItemKind;
  /** A short label. Never a sentence that asserts a cause. */
  label: string;
  /** Exactly what the source produced. Never re-rounded, never re-derived. */
  value: number | string | null;
  unit?: string;
  /** The source's own state string, carried verbatim so a warning cannot be dropped here. */
  state: string;
  /** The service that produced it, so any line can be traced back. */
  source: string;
  observedAt: string | null;
  freshness: string | null;
  confidence: number | null;
  reasonCode?: string;
};

export type ExecutiveReportBundle = {
  reportType: "EXECUTIVE_BRIEF";
  period: ReportPeriod;
  periodDays: number;
  state: ReportState;
  /** Assembly time. A scheduled report is about *now*, and this is when now was. */
  generatedAt: string;
  items: ReportItem[];
  /**
   * Prose, and only prose.
   *
   * `text` never carries a number that is not already in `items` — asserted by test, not by
   * intention. `generatedBy` says whether a language model wrote it, so a reader can tell.
   */
  narrative: {
    text: string;
    generatedBy: "DETERMINISTIC" | "LLM";
    reasonCode: string;
  };
  /** Named sources that were stale or failed at assembly time. Empty means everything answered. */
  staleSources: string[];
  unavailableSources: string[];
  /**
   * Domains the platform has never implemented.
   *
   * Kept apart from `unavailableSources` because they are a permanent property of the platform, not
   * a fault in this run. Collapsing the two made every report INCOMPLETE forever.
   */
  structuralGaps: string[];
  /** Every version that shaped this report, so two identical-looking reports can be told apart. */
  versions: {
    reportRulesVersion: string;
    contextRulesVersion: string | null;
    modelVersions: Record<string, string | null>;
  };
  /** Decisions a human still owes. Carried into the report rather than left in a doc. */
  humanDecisions: string[];
  /** Timings, so an N+1 shows up as a number rather than an opinion. */
  timings: { totalMs: number; sourceMs: Record<string, number> };
};

/** Measures one source call without letting its failure take the report down. */
async function timed<T>(
  name: string,
  fn: () => Promise<T>,
  sink: Record<string, number>,
  unavailable: string[],
): Promise<T | null> {
  const t0 = Date.now();
  try {
    const out = await fn();
    sink[name] = Date.now() - t0;
    return out;
  } catch (err) {
    sink[name] = Date.now() - t0;
    unavailable.push(name);
    logger.warn("scheduled_report_source_unavailable", {
      source: name,
      error: String(err).slice(0, 200),
    });
    return null;
  }
}

/** True when a carried state means the figure should not be read at face value. */
function isDegraded(state: string): boolean {
  return (
    state === "STALE" ||
    state === "KPI_STALE" ||
    state === "UNAVAILABLE" ||
    state === "KPI_UNAVAILABLE" ||
    state === "MODEL_UNAVAILABLE" ||
    state === "FORECAST_STALE" ||
    state === "FORECAST_UNAVAILABLE"
  );
}

export const scheduledExecutiveReportService = {
  /**
   * Assemble one report.
   *
   * Read-only end to end: every call below is a read on a service that was itself proven not to
   * write in capabilities 1-9. The only thing this function decides is *classification* — which of
   * the six kinds a line is — and classification is taken from the producing service's own type,
   * never from the value.
   */
  async build(
    period: ReportPeriod = "daily",
    opts?: { now?: Date; customDays?: number },
  ): Promise<ExecutiveReportBundle> {
    const now = opts?.now ?? new Date();
    const t0 = Date.now();
    const generatedAt = now.toISOString();
    const sourceMs: Record<string, number> = {};
    const unavailable: string[] = [];
    const items: ReportItem[] = [];
    const humanDecisions = new Set<string>();

    const periodDays = executiveReportingService.periodToDays(period, opts?.customDays);

    /**
     * The context is built once and handed to the KPI explainer.
     *
     * `explainAll` accepts an injected context precisely so a dashboard does not refetch per card;
     * the same applies to a report. Without this the finance, demand and supply reads would happen
     * twice for one document.
     */
    const context = await timed(
      "context",
      () => executiveIntelligenceService.getContext(period, { now, customDays: opts?.customDays }),
      sourceMs,
      unavailable,
    );

    const kpis = context
      ? await timed<KpiExplanation[]>(
          "kpis",
          () => executiveKpiExplainer.explainAll(period, { now, context }),
          sourceMs,
          unavailable,
        )
      : null;

    for (const k of kpis ?? []) {
      items.push({
        kind: "FACT",
        label: `${k.domain}.${k.kpi}`,
        value: k.value,
        unit: k.unit,
        state: k.state,
        source: k.source,
        observedAt: k.observedAt,
        freshness: k.freshness,
        confidence: k.confidence,
        reasonCode: k.reasonCode,
      });

      /**
       * A KPI the context flagged is *also* a limitation.
       *
       * `netRevenue` is the live example: it mixes period bases, so the number is arithmetically
       * real and still unsafe to read as a period figure. Printing it once as a fact and never
       * saying so is exactly how a known defect becomes a board slide.
       */
      if (k.factState === "DATA_QUALITY_ISSUE" || k.state === "KPI_DATA_QUALITY") {
        items.push({
          kind: "LIMITATION",
          label: `${k.domain}.${k.kpi} has a known data-quality issue`,
          value: k.definition ?? k.statement,
          state: k.factState,
          source: k.source,
          observedAt: k.observedAt,
          freshness: k.freshness,
          confidence: null,
          reasonCode: k.reasonCode,
        });
      }
    }

    const [anomaly, ds, finance, fraud, forecast] = await Promise.all([
      timed("anomaly", () => revenueAnomalyService.evaluate("gmv"), sourceMs, unavailable),
      timed("demandSupply", () => demandSupplyWarningService.assess({ now }), sourceMs, unavailable),
      timed("finance", () => financeNarrativeService.build(period, { now }), sourceMs, unavailable),
      timed("fraud", () => fraudNarrativeService.consumerFraudSurface(), sourceMs, unavailable),
      timed("forecast", () => forecastExplainerService.explainDemandForecast({ now }), sourceMs, unavailable),
    ]);

    if (anomaly) {
      items.push({
        kind: "ANOMALY",
        label: `revenue anomaly (${anomaly.metric})`,
        value: anomaly.observedValue,
        state: anomaly.state,
        source: anomaly.source,
        observedAt: anomaly.generatedAt,
        freshness: null,
        confidence: anomaly.confidence,
        reasonCode: anomaly.reasonCode,
      });
      // A detector that refused is a limitation, not a clean bill of health.
      if (anomaly.state !== "EVALUATED") {
        items.push({
          kind: "LIMITATION",
          label: "revenue anomaly detection did not produce a verdict",
          value: anomaly.baselineDefinition,
          state: anomaly.state,
          source: anomaly.source,
          observedAt: anomaly.generatedAt,
          freshness: null,
          confidence: null,
          reasonCode: anomaly.reasonCode,
        });
      }
    }

    if (ds) {
      items.push({
        kind: "FORECAST",
        label: "demand forecast (global)",
        value: ds.globalForecast.value,
        unit: "bookings",
        state: ds.globalForecast.state,
        source: "demandSupplyWarningService",
        observedAt: ds.globalForecast.observedAt,
        freshness: null,
        confidence: ds.globalForecast.confidence,
        reasonCode: ds.globalForecast.reasonCode,
      });
      for (const z of ds.zones) {
        items.push({
          kind: "WARNING",
          label: `zone ${z.zoneId}`,
          value: z.state,
          state: z.state,
          source: "demandSupplyWarningService",
          observedAt: ds.generatedAt,
          freshness: null,
          confidence: null,
          reasonCode: z.reasonCode,
        });
      }
      if (!ds.supplyQuality.usable) {
        items.push({
          kind: "LIMITATION",
          label: "supply telemetry is not usable",
          value: ds.supplyQuality.reasonCode ?? null,
          state: "UNAVAILABLE",
          source: "demandSupplyWarningService",
          observedAt: ds.generatedAt,
          freshness: null,
          confidence: null,
          reasonCode: ds.supplyQuality.reasonCode,
        });
      }
    }

    if (finance) {
      for (const n of finance.narratives) {
        items.push({
          kind: "FACT",
          label: n.metric,
          value: n.value,
          unit: n.currency ?? undefined,
          state: n.state,
          source: n.source,
          observedAt: n.observedAt,
          freshness: null,
          confidence: null,
          reasonCode: n.reasonCode,
        });
      }
      if (finance.reconciliation.state === "DELTA_PRESENT") {
        items.push({
          kind: "WARNING",
          label: "ledger and operational balances disagree",
          value: finance.reconciliation.accountsWithDelta,
          unit: "accounts",
          state: finance.reconciliation.state,
          source: "financeNarrativeService.readReconciliation",
          observedAt: finance.generatedAt,
          freshness: null,
          confidence: null,
          reasonCode: finance.reconciliation.reasonCode,
        });
      }
      items.push({
        kind: "FACT",
        label: "financial integrity run",
        value: finance.integrity.status,
        state: finance.integrity.status === null ? "UNAVAILABLE" : "OK",
        source: "financeNarrativeService.readIntegrity",
        observedAt: finance.integrity.observedAt,
        freshness: null,
        confidence: null,
        reasonCode: finance.integrity.reasonCode,
      });
    }

    if (fraud) {
      items.push({
        kind: "WARNING",
        label: "consumer fraud surface",
        value: fraud.alertCount,
        unit: "alerts",
        state: fraud.state,
        source: "fraudNarrativeService.consumerFraudSurface",
        observedAt: generatedAt,
        freshness: null,
        confidence: null,
        reasonCode: fraud.reasonCode,
      });
    }

    if (forecast) {
      items.push({
        kind: "FORECAST",
        label: `${forecast.metric} forecast`,
        value: forecast.value,
        unit: forecast.unit,
        state: forecast.state,
        source: forecast.model ?? "forecastExplainerService",
        observedAt: forecast.forecastGeneratedAt ?? forecast.retrievedAt,
        freshness: forecast.freshness,
        confidence: forecast.derivedConfidence?.value ?? null,
        reasonCode: forecast.reasonCode,
      });
      for (const l of forecast.limitations) {
        items.push({
          kind: "LIMITATION",
          label: "forecast limitation",
          value: l,
          state: forecast.state,
          source: "forecastExplainerService",
          observedAt: forecast.retrievedAt,
          freshness: forecast.freshness,
          confidence: null,
        });
      }
    }

    /**
     * Recommended actions, carried as advisory lines and nothing more.
     *
     * `generate()` re-reads anomaly, demand/supply, finance and forecast internally. That is four
     * duplicate reads per report, and it is measured rather than assumed — see `timings.sourceMs`.
     * It is not restructured here: Capability 9 is complete and its service is the authority on how
     * an action is derived. The cost is stated as a limitation instead of silently absorbed.
     */
    const actions = await timed("actions", () => recommendedActionsService.generate({ now }), sourceMs, unavailable);
    for (const a of actions?.actions ?? []) {
      items.push({
        kind: "RECOMMENDATION",
        label: a.title,
        value: a.description,
        state: a.state,
        source: a.capability,
        observedAt: a.generatedAt,
        freshness: null,
        confidence: a.confidence,
        reasonCode: a.reasonCodes[0],
      });
    }
    for (const d of actions?.humanDecisions ?? []) humanDecisions.add(d);

    /**
     * The Digital Twin is named, and deliberately not aggregated.
     *
     * Capability 8 established that the twin is **city-scoped** across seven cities and that no
     * platform-level or zone-level twin exists. An executive brief is platform-scoped, so there is
     * no twin figure to put in it. Averaging seven cities into one number would manufacture a
     * quantity the twin never produced, and picking one city would silently make the brief about
     * that city. The scope mismatch is therefore reported as a limitation rather than resolved by
     * inventing a value.
     */
    items.push({
      kind: "LIMITATION",
      label: "digital twin is city-scoped; this brief is platform-scoped",
      value: digitalTwinNarrativeService.supportedCities().join(", "),
      state: "SCOPE_MISMATCH",
      source: "digitalTwinNarrativeService",
      observedAt: generatedAt,
      freshness: null,
      confidence: null,
      reasonCode: "TWIN_SCOPE_IS_CITY_NOT_PLATFORM",
    });

    /**
     * Staleness is decided from what the sources said, at this moment.
     *
     * Nothing is compared against a previous run, because there is no previous run to compare to —
     * and if there were, trusting it would be exactly the cached-yesterday failure this guards.
     */
    const staleSources = [
      ...new Set(
        items
          .filter((i) => isDegraded(i.state) || i.freshness === "STALE")
          .map((i) => i.source),
      ),
    ];

    /**
     * A missing domain is named by its domain and its reason, not stringified.
     *
     * The first real observation of this report printed `Did not answer: [object Object]`, because
     * `unavailableDomains` carries `{ domain, reasonCode }` and this line had coerced the object.
     * A report whose own limitation section is unreadable is worse than one that omits it, so the
     * shape is destructured rather than trusted.
     */
    const missingDomains = (context?.unavailableDomains ?? []).map(
      (d) => `context domain ${d.domain} (${d.reasonCode})`,
    );

    /**
     * A domain that was never built is not an incident, and must not be counted as one.
     *
     * The second real observation showed every report coming back INCOMPLETE, permanently: the
     * executive context declares eight domains it has never implemented, so the count of
     * "unavailable" sources could never reach zero and the state could never be GENERATED. A state
     * that is always the same value carries no information, and an operator who sees INCOMPLETE on
     * every report will stop reading it — which is exactly when the one genuinely incomplete report
     * arrives.
     *
     * So the two are separated. `SOURCE_NOT_IMPLEMENTED` is structural: it is always true, it is
     * listed as a limitation, and it does not degrade the report. A source that threw *at assembly
     * time* is an incident, and that is what INCOMPLETE now means.
     */
    const STRUCTURAL_ABSENCE = "SOURCE_NOT_IMPLEMENTED";
    const failedDomains = (context?.unavailableDomains ?? [])
      .filter((d) => d.reasonCode !== STRUCTURAL_ABSENCE)
      .map((d) => `context domain ${d.domain} (${d.reasonCode})`);
    const unavailableSources = [...new Set([...unavailable, ...failedDomains])];
    const structuralGaps = missingDomains.filter((m) => m.includes(STRUCTURAL_ABSENCE));

    /**
     * Each absent domain is also a line in the report, not only a field on the envelope.
     *
     * Labelled "context domain" on purpose. The executive context never implemented a FRAUD domain,
     * while Capability 6's fraud narrative service is a separate source that *does* answer — so a
     * bare "FRAUD unavailable" would sit in the same report as a fraud warning and contradict it.
     * Naming which layer is missing removes the contradiction without hiding either fact.
     */
    for (const d of context?.unavailableDomains ?? []) {
      items.push({
        kind: "LIMITATION",
        label: `executive context has no ${d.domain} domain`,
        value: d.reasonCode,
        state: d.reasonCode === STRUCTURAL_ABSENCE ? "NOT_IMPLEMENTED" : "UNAVAILABLE",
        source: "executiveIntelligenceService",
        observedAt: generatedAt,
        freshness: null,
        confidence: null,
        reasonCode: d.reasonCode,
      });
    }

    let state: ReportState = "GENERATED";
    if (unavailableSources.length > 0) state = "INCOMPLETE";
    else if (staleSources.length > 0) state = "STALE";

    const narrative = buildDeterministicNarrative({
      period, items, staleSources, unavailableSources, structuralGaps,
    });

    return {
      reportType: "EXECUTIVE_BRIEF",
      period,
      periodDays,
      state,
      generatedAt,
      items,
      narrative,
      staleSources,
      unavailableSources,
      structuralGaps,
      versions: {
        reportRulesVersion: SCHEDULED_REPORT_RULES_VERSION,
        contextRulesVersion: context?.rulesVersion ?? null,
        modelVersions: context?.modelVersions ?? {},
      },
      humanDecisions: [...humanDecisions],
      timings: { totalMs: Date.now() - t0, sourceMs },
    };
  },
};

/**
 * The report's prose, written without a language model.
 *
 * This is the fallback the directive requires — "if LLM unavailable, deterministic report remains
 * usable" — and it is also the default. Prose is presentation; a model is allowed to rewrite these
 * sentences later, but it is never allowed to supply the counts, and the counts here come from
 * `items` rather than from any source read a second time.
 *
 * Every sentence is a count or a name. None asserts a cause, none calls a change significant, and
 * none describes a degraded figure as reliable.
 */
export function buildDeterministicNarrative(input: {
  period: ReportPeriod;
  items: ReportItem[];
  staleSources: string[];
  unavailableSources: string[];
  structuralGaps: string[];
}): ExecutiveReportBundle["narrative"] {
  const count = (k: ReportItemKind) => input.items.filter((i) => i.kind === k).length;
  const parts = [
    `Executive brief for the ${input.period} period.`,
    `${count("FACT")} measured figure(s), ${count("ANOMALY")} anomaly check(s), ` +
      `${count("FORECAST")} forecast(s), ${count("WARNING")} warning(s), ` +
      `${count("RECOMMENDATION")} recommendation(s) for review.`,
  ];
  if (input.staleSources.length > 0) {
    parts.push(`Stale at generation: ${input.staleSources.join(", ")}.`);
  }
  if (input.unavailableSources.length > 0) {
    parts.push(`Did not answer: ${input.unavailableSources.join(", ")}.`);
  }
  if (input.structuralGaps.length > 0) {
    // Worded as a permanent gap, not a failure — an executive should not read eight
    // never-built domains as eight things that broke this morning.
    parts.push(`${input.structuralGaps.length} domain(s) are not implemented on this platform.`);
  }
  if (count("LIMITATION") > 0) {
    parts.push(`${count("LIMITATION")} limitation(s) are listed and are part of the report.`);
  }
  parts.push("Recommendations are advisory. Nothing in this report executes.");
  return {
    text: parts.join(" "),
    generatedBy: "DETERMINISTIC",
    reasonCode: REPORT_REASON.NARRATIVE_DETERMINISTIC,
  };
}
