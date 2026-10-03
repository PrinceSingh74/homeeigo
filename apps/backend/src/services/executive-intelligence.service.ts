import { logger } from "../lib/logger";
import { resolveModelIdentity } from "../lib/model-identity";
import { executiveReportingService } from "./executive-reporting.service";
import type { ReportPeriod } from "./executive-reporting.service";
import { geoIntelligenceService } from "./geo-intelligence.service";
import { isDemandForecastStale } from "./shift-planning.service";
import { CADENCE_DEFAULT_TIMEZONE } from "../notifications/governance/timezone";
import {
  EXECUTIVE_CONTEXT_RULES_VERSION,
  EXEC_REASON,
  fact,
  missingFact,
  suspectFact,
} from "./executive-intelligence.types";
import type {
  ExecutiveDomain,
  ExecutiveIntelligenceContext,
  ExecutivePeriod,
  FactState,
} from "./executive-intelligence.types";

/**
 * Phase 9, Capability 1 — provenance for executive facts.
 *
 * Source systems calculate; this proves and normalises. No financial arithmetic, no fraud scoring,
 * no demand prediction, no ranking, no anomaly detection, no forecast generation. Every number is
 * carried from the service that owns it. What is added: a period basis, a source, an observation
 * time, a freshness, a state, and — only where the producer publishes them — confidence and model
 * version.
 *
 * Two source problems are surfaced rather than fixed, because fixing either means changing an
 * authoritative service and that is not this layer's decision to make. See `collectFinance`.
 */

const TZ = CADENCE_DEFAULT_TIMEZONE;
const DAY_MS = 86400000;
const FINANCE_SOURCE = "finance-dashboard:getOverview";

function rollingPeriod(days: number, now: Date): ExecutivePeriod {
  return {
    basis: "ROLLING",
    from: new Date(now.getTime() - days * DAY_MS).toISOString(),
    to: now.toISOString(),
    days,
    timezone: TZ,
  };
}

function pointInTime(now: Date): ExecutivePeriod {
  return { basis: "POINT_IN_TIME", from: null, to: now.toISOString(), days: null, timezone: TZ };
}

function mixedPeriod(days: number, now: Date): ExecutivePeriod {
  return {
    basis: "MIXED",
    from: new Date(now.getTime() - days * DAY_MS).toISOString(),
    to: now.toISOString(),
    days,
    timezone: TZ,
  };
}

export const executiveIntelligenceService = {
  /**
   * Assemble the context for one requested period.
   *
   * A domain that throws is recorded in `unavailableDomains` and the rest is still returned — a
   * brief missing one section is more useful than no brief, and the absence is stated, not hidden.
   */
  async getContext(
    period: ReportPeriod = "monthly",
    opts?: { now?: Date; customDays?: number },
  ): Promise<ExecutiveIntelligenceContext> {
    const now = opts?.now ?? new Date();
    const generatedAt = now.toISOString();
    const days = executiveReportingService.periodToDays(period, opts?.customDays);

    const domains: ExecutiveIntelligenceContext["domains"] = {};
    const unavailableDomains: ExecutiveIntelligenceContext["unavailableDomains"] = [];
    const modelVersions: Record<string, string | null> = {};

    await Promise.all([
      this.collectFinance(days, now, domains, unavailableDomains),
      this.collectDemand(now, domains, unavailableDomains, modelVersions),
      this.collectSupply(now, domains, unavailableDomains),
    ]);

    /**
     * Domains with no authoritative source are named, not silently omitted. An executive reading a
     * brief with no fraud section should be told the section does not exist, rather than being left
     * to assume there was nothing to report.
     */
    const notImplemented: ExecutiveDomain[] = [
      "FRAUD", "CUSTOMERS", "PARTNERS", "GEO", "WEATHER", "OPERATIONS", "FORECASTS", "DIGITAL_TWIN",
    ];
    for (const d of notImplemented) {
      if (!domains[d]) {
        unavailableDomains.push({ domain: d, reasonCode: EXEC_REASON.SOURCE_NOT_IMPLEMENTED });
      }
    }

    const caveats: ExecutiveIntelligenceContext["caveats"] = [];
    for (const key of Object.keys(domains) as ExecutiveDomain[]) {
      const facts = domains[key];
      if (!facts) continue;
      for (const [name, f] of Object.entries(facts)) {
        if (f.state !== "OK") {
          caveats.push({
            domain: key,
            fact: name,
            state: f.state,
            reasonCode: f.reasonCode ?? "UNSPECIFIED",
          });
        }
      }
    }

    return {
      requestedPeriod: rollingPeriod(days, now),
      domains,
      unavailableDomains,
      caveats,
      generatedAt,
      rulesVersion: EXECUTIVE_CONTEXT_RULES_VERSION,
      modelVersions,
    };
  },

  /**
   * Finance and revenue, carried verbatim from the authoritative report.
   *
   * Each figure is labelled with the basis it is *actually* on, which for several differs from the
   * basis the caller asked for: a liability is a balance and has no period, GMV is the rolling
   * window, a refund total is unbounded. Saying so is the whole point of this layer.
   *
   * `platformMarginPct` — 0 when GMV is 0, which the source cannot distinguish from a genuine zero
   * margin. Escalated, not reinterpreted.
   */
  async collectFinance(
    days: number,
    now: Date,
    domains: ExecutiveIntelligenceContext["domains"],
    unavailable: ExecutiveIntelligenceContext["unavailableDomains"],
  ): Promise<void> {
    let report: Awaited<ReturnType<typeof executiveReportingService.buildExecutiveReport>>;
    try {
      report = await executiveReportingService.buildExecutiveReport("custom", days);
    } catch (err) {
      logger.warn("exec_context_finance_unavailable", { error: String(err).slice(0, 200) });
      unavailable.push({ domain: "REVENUE", reasonCode: EXEC_REASON.SOURCE_UNAVAILABLE });
      unavailable.push({ domain: "FINANCE", reasonCode: EXEC_REASON.SOURCE_UNAVAILABLE });
      return;
    }

    /**
     * The aggregate describes the database at the instant it was queried, so `now` is the honest
     * observation time — not a fabricated one. Sources that publish their own timestamp (demand,
     * below) use theirs instead.
     */
    const observedAt = now.toISOString();
    const rolling = rollingPeriod(days, now);
    const balance = pointInTime(now);

    const netRevenue = fact({
      value: report.netRevenue,
      unit: "INR",
      period: rolling,
      source: FINANCE_SOURCE,
      observedAt,
      definition:
        "Trailing " + days + "-day GMV minus refunds completed in the same window",
    });

    const marginBase = fact({
      value: report.platformMarginPct,
      unit: "percent",
      period: mixedPeriod(days, now),
      source: FINANCE_SOURCE,
      observedAt,
    });
    const margin = report.gmv === 0
      ? suspectFact(
          marginBase,
          EXEC_REASON.MARGIN_SEMANTICS_HUMAN_DECISION_REQUIRED,
          "GMV is zero, so margin is undefined. The source returns 0, indistinguishable from a " +
            "genuine zero margin. Value preserved; the interpretation is a business decision.",
        )
      : suspectFact(
          marginBase,
          EXEC_REASON.MIXED_PERIOD_BASIS,
          "Derived from figures on different period bases.",
        );

    domains.REVENUE = {
      gmv: fact({
        value: report.gmv, unit: "INR", period: rolling, source: FINANCE_SOURCE, observedAt,
        definition: "Successful payments completed in the trailing " + days + " days",
      }),
      revenue: fact({
        value: report.revenue, unit: "INR", period: rolling, source: FINANCE_SOURCE, observedAt,
        definition: "Gross payment volume over the trailing " + days + " days",
      }),
      netRevenue,
      platformMarginPct: margin,
      subscriptionRevenue: fact({
        value: report.subscriptionRevenue, unit: "INR", period: rolling,
        source: FINANCE_SOURCE, observedAt,
        definition: "Paid subscription invoices created in the trailing " + days + " days",
      }),
    };

    domains.FINANCE = {
      walletLiability: fact({
        value: report.walletLiability, unit: "INR", period: balance, source: FINANCE_SOURCE,
        observedAt, definition: "Customer wallet balances as they stand now. Not a period figure.",
      }),
      giftCardLiability: fact({
        value: report.giftCardLiability, unit: "INR", period: balance, source: FINANCE_SOURCE,
        observedAt, definition: "Balance on active gift cards, as it stands now.",
      }),
      cashbackLiability: fact({
        value: report.cashbackLiability, unit: "INR", period: balance, source: FINANCE_SOURCE,
        observedAt, definition: "Pending membership cashback, as it stands now.",
      }),
      providerLiability: fact({
        value: report.providerLiability, unit: "INR", period: balance, source: FINANCE_SOURCE,
        observedAt, definition: "Provider wallet balances payable, as they stand now.",
      }),
      chargebackExposure: fact({
        value: report.chargebackExposure.amount, unit: "INR", period: balance,
        source: FINANCE_SOURCE, observedAt,
        definition: "Amount under open chargeback statuses, as it stands now.",
      }),
      totalLiabilities: suspectFact(
        fact({
          value: report.totalLiabilities, unit: "INR", period: mixedPeriod(days, now),
          source: FINANCE_SOURCE, observedAt,
        }),
        EXEC_REASON.MIXED_PERIOD_BASIS,
        "Sums point-in-time balances with an all-time refund total. Carried unchanged from source.",
      ),
    };
  },

  /**
   * Demand, using the staleness rule the platform already agreed on.
   *
   * `isDemandForecastStale` is imported rather than restated — one definition of stale demand serves
   * partner and executive intelligence alike. A stale forecast keeps its value and is marked STALE,
   * never presented as current reality.
   */
  async collectDemand(
    now: Date,
    domains: ExecutiveIntelligenceContext["domains"],
    unavailable: ExecutiveIntelligenceContext["unavailableDomains"],
    modelVersions: Record<string, string | null>,
  ): Promise<void> {
    let res: Awaited<ReturnType<typeof geoIntelligenceService.demandForecast>>;
    try {
      res = await geoIntelligenceService.demandForecast(24);
    } catch (err) {
      logger.warn("exec_context_demand_unavailable", { error: String(err).slice(0, 200) });
      unavailable.push({ domain: "DEMAND", reasonCode: EXEC_REASON.SOURCE_UNAVAILABLE });
      return;
    }

    const data = res.data as { horizonHours?: number; totalPredicted?: number; points?: unknown[] } | null;
    const horizon = data?.horizonHours ?? 24;
    const forecastPeriod: ExecutivePeriod = {
      basis: "FORECAST",
      from: now.toISOString(),
      to: new Date(now.getTime() + horizon * 3600000).toISOString(),
      days: null,
      timezone: TZ,
    };

    if (!data || !Array.isArray(data.points) || data.points.length === 0) {
      domains.DEMAND = {
        totalPredicted: missingFact<number>({
          state: "INSUFFICIENT_DATA", reasonCode: "DEMAND_NO_POINTS",
          source: res.source ?? "demand-forecast", period: forecastPeriod, unit: "bookings",
        }),
      };
      return;
    }

    /**
     * The model's version, not its provenance.
     *
     * This assigned `res.source` — a string like "bigquery:arima_plus" — to a field named
     * modelVersion, while `fact({ source })` below already carries that same provenance. The real
     * version was never reported anywhere on this surface, and the explainer reported `v1` for the
     * very same model, so one model had two identities depending on which screen you looked at.
     *
     * Null when the registry cannot be reached: an unknown version is a fact, an invented one is not.
     */
    const demandIdentity = await resolveModelIdentity("model_demand_forecast");
    modelVersions.demand = demandIdentity?.version ?? null;
    const stale = isDemandForecastStale(res.freshness ?? null, data, now.getTime());

    const base = fact({
      value: data.totalPredicted ?? 0,
      unit: "bookings",
      period: forecastPeriod,
      source: res.source ?? "demand-forecast",
      /**
       * The retrieval time, and labelled as such after Capability 7 traced it.
       *
       * `geoIntelligenceService.demandForecast()` sets `freshness: new Date().toISOString()` when it
       * builds its cache entry, so this is when the platform fetched the forecast — not when the
       * model produced it. ARIMA exposes no generation timestamp at all. An earlier comment here
       * claimed this was "the model's own timestamp", which was wrong.
       *
       * Staleness is unaffected: `isDemandForecastStale` reads the last predicted hour from the
       * points and only falls back to this value when there are none. The forecast's true target
       * window is reported by the Capability-7 explainer, which reads those hours directly.
       */
      observedAt: res.freshness ?? null,
      confidence: res.confidence ?? null,
      modelVersion: demandIdentity?.version ?? null,
      definition: "Predicted bookings over the next " + horizon + " hours",
    });

    domains.DEMAND = {
      totalPredicted: stale
        ? { ...base, state: "STALE" as FactState, freshness: "STALE", reasonCode: EXEC_REASON.FORECAST_STALE }
        : base,
    };
  },

  /**
   * Supply, from the deterministic surge source.
   *
   * Counting rows is not a business calculation: both figures are cardinalities of what the source
   * returned. No surge value is recomputed, and no threshold of this layer's own is applied — the
   * comparison is against the source's own baseline of 1.0, and alerting thresholds remain UNSET
   * business decisions elsewhere.
   */
  async collectSupply(
    now: Date,
    domains: ExecutiveIntelligenceContext["domains"],
    unavailable: ExecutiveIntelligenceContext["unavailableDomains"],
  ): Promise<void> {
    let res: Awaited<ReturnType<typeof geoIntelligenceService.surgePrediction>>;
    try {
      res = await geoIntelligenceService.surgePrediction();
    } catch (err) {
      logger.warn("exec_context_supply_unavailable", { error: String(err).slice(0, 200) });
      unavailable.push({ domain: "SUPPLY", reasonCode: EXEC_REASON.SOURCE_UNAVAILABLE });
      return;
    }

    const rows = Array.isArray(res.data) ? (res.data as Array<Record<string, unknown>>) : [];
    const period = pointInTime(now);
    if (rows.length === 0) {
      domains.SUPPLY = {
        activeZones: missingFact<number>({
          state: "INSUFFICIENT_DATA", reasonCode: "NO_ZONES",
          source: res.source ?? "surge-prediction", period, unit: "count",
        }),
      };
      return;
    }

    const underPressure = rows.filter((r) => Number(r.predictedSurge ?? 1) > 1).length;

    domains.SUPPLY = {
      activeZones: fact({
        value: rows.length, unit: "count", period,
        source: res.source ?? "surge-prediction", observedAt: res.freshness ?? null,
        confidence: res.confidence ?? null,
        definition: "Active zones returned by the surge source.",
      }),
      zonesUnderPressure: fact({
        value: underPressure, unit: "count", period,
        source: res.source ?? "surge-prediction", observedAt: res.freshness ?? null,
        confidence: res.confidence ?? null,
        definition: "Zones whose predictedSurge exceeds the source baseline of 1.0.",
      }),
    };
  },
};
