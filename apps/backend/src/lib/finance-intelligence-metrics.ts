/**
 * Finance Intelligence Prometheus gauges — REAL values sampled at scrape time from
 * Postgres + env-config assumptions (no mock data). Registered once at boot (index.ts).
 *
 *   fin_canonical_gmv_inr                  ← payment-based GMV (30d)
 *   fin_net_revenue_inr                    ← commission + subscription revenue (30d)
 *   fin_gross_profit_inr                   ← net revenue − COGS (30d)
 *   fin_gross_margin_pct                   ← gross profit / net revenue * 100
 *   fin_contribution_forecast_monthly_inr  ← monthly contribution run-rate
 *
 * Config-dependent gauges are set ONLY when their inputs exist (else absent from the
 * scrape — an honest "no data" rather than a misleading 0):
 *   fin_ebitda_inr, fin_ebitda_margin_pct  ← require OPERATING_EXPENSE_MONTHLY
 *   fin_monthly_burn_inr                   ← require OPERATING_EXPENSE_MONTHLY
 *   fin_profit_forecast_monthly_inr        ← require OPERATING_EXPENSE_MONTHLY
 *   fin_runway_months                      ← require OPERATING_EXPENSE_MONTHLY + CASH_ON_HAND
 *
 * Finance config gauges (from finance_config table, env fallback):
 *   fin_config_opex_monthly_inr
 *   fin_config_cash_on_hand_inr
 *   fin_config_gateway_fee_pct
 *   fin_config_opex_source_db (1=db, 0=env/missing)
 *   fin_config_cash_source_db
 */
import { setGauge, registerScrapeSampler } from "./metrics";
import { financeIntelligenceService } from "../services/finance-intelligence.service";
import { financeConfigService } from "../services/finance-config.service";

const TTL_MS = 60_000;
let last = 0;

export function registerFinanceIntelligenceSamplers(): void {
  registerScrapeSampler(async () => {
    const now = Date.now();
    if (now - last < TTL_MS) return;
    last = now;

    const fi = await financeIntelligenceService.getFinanceIntelligence(30).catch(() => null);
    if (!fi) return;

    setGauge("fin_canonical_gmv_inr", Math.round(fi.revenue.grossRevenue));
    setGauge("fin_net_revenue_inr", Math.round(fi.revenue.netRevenue));
    setGauge("fin_gross_profit_inr", Math.round(fi.grossMargin.grossProfit));
    if (fi.grossMargin.grossMarginPct != null) {
      setGauge("fin_gross_margin_pct", fi.grossMargin.grossMarginPct);
    }
    setGauge("fin_contribution_forecast_monthly_inr", Math.round(fi.forecast.contributionForecastMonthly));

    if (fi.ebitda.available && fi.ebitda.ebitda != null) {
      setGauge("fin_ebitda_inr", Math.round(fi.ebitda.ebitda));
      if (fi.ebitda.ebitdaMarginPct != null) setGauge("fin_ebitda_margin_pct", fi.ebitda.ebitdaMarginPct);
    }
    if (fi.burnRate.available && fi.burnRate.monthlyBurn != null) {
      setGauge("fin_monthly_burn_inr", Math.round(fi.burnRate.monthlyBurn));
    }
    if (fi.forecast.profitForecastMonthly != null) {
      setGauge("fin_profit_forecast_monthly_inr", Math.round(fi.forecast.profitForecastMonthly));
    }
    if (fi.cashRunway.available && fi.cashRunway.runwayMonths != null) {
      setGauge("fin_runway_months", fi.cashRunway.runwayMonths);
    }

    const cfg = await financeConfigService.resolve().catch(() => null);
    if (cfg) {
      if (cfg.operatingExpenseMonthly != null) {
        setGauge("fin_config_opex_monthly_inr", Math.round(cfg.operatingExpenseMonthly));
      }
      if (cfg.cashOnHand != null) {
        setGauge("fin_config_cash_on_hand_inr", Math.round(cfg.cashOnHand));
      }
      setGauge("fin_config_gateway_fee_pct", cfg.gatewayFeePct);
      setGauge("fin_config_opex_source_db", cfg.sources.operatingExpenseMonthly === "db" ? 1 : 0);
      setGauge("fin_config_cash_source_db", cfg.sources.cashOnHand === "db" ? 1 : 0);
    }
  });
}
