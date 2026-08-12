/**
 * Finance Intelligence certification — evidence-based, real data only.
 * Verifies canonical GMV, gross margin, EBITDA, burn rate, cash runway and
 * profit forecast compute from live data + documented config inputs.
 *
 * Run: bun --env-file=.env run scripts/enterprise/finance-intelligence-certification.ts
 *
 * Verdict policy:
 *  - Always-real metrics (GMV, net revenue, gross margin, contribution forecast)
 *    MUST compute without error → otherwise FAIL.
 *  - Config-dependent metrics (EBITDA, burn, runway, profit forecast) are reported
 *    as ENABLED or INPUT_REQUIRED (documented, not a failure) depending on env.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { financeIntelligenceService } from "../../src/services/finance-intelligence.service";

const DOCS = join(import.meta.dir, "../../../admin-panel/docs/v5");
const inr = (n: number | null | undefined) =>
  n == null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);

async function main() {
  if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });

  const gmv = await financeIntelligenceService.getCanonicalGmv(30);
  const fi = await financeIntelligenceService.getFinanceIntelligence(30);

  const blockers: string[] = [];

  // Gate 1 — canonical GMV computes and is non-negative.
  if (!Number.isFinite(gmv.gmv) || gmv.gmv < 0) blockers.push(`Canonical GMV invalid: ${gmv.gmv}`);
  // Gate 2 — net revenue + gross margin compute.
  if (!Number.isFinite(fi.revenue.netRevenue)) blockers.push("Net revenue did not compute");
  if (fi.revenue.netRevenue > 0 && fi.grossMargin.grossMarginPct == null)
    blockers.push("Gross margin null despite positive net revenue");
  // Gate 3 — contribution forecast (always real) computes.
  if (!Number.isFinite(fi.forecast.contributionForecastMonthly))
    blockers.push("Contribution forecast did not compute");

  const ebitdaState = fi.ebitda.available ? "ENABLED" : "INPUT_REQUIRED";
  const burnState = fi.burnRate.available ? "ENABLED" : "INPUT_REQUIRED";
  const runwayState = fi.cashRunway.status === "input_required" ? "INPUT_REQUIRED" : "ENABLED";
  const profitState = fi.forecast.profitForecastMonthly != null ? "ENABLED" : "INPUT_REQUIRED";

  const verdict = blockers.length === 0 ? "PASS" : "FAIL";

  const md = `# Finance Intelligence Certification — HOMIGO V5

Generated: ${new Date().toISOString()}
Window: trailing ${fi.periodDays} days
Data policy: real transactional data + documented env-config inputs. No mock data. Config-dependent metrics render "input required" rather than a fabricated value.

## Verdict: **${verdict}**

${blockers.length ? `### Blockers\n${blockers.map((b) => `- ${b}`).join("\n")}` : "All always-real metric gates passed."}

## Canonical GMV (single source of truth)
| Field | Value |
|---|---|
| Canonical GMV (payment-based) | ${inr(gmv.gmv)} |
| Definition | \`${gmv.canonicalDefinition}\` |
| Successful payments | ${gmv.successfulPayments} |
| Booking-based (reconciliation) | ${inr(gmv.reconciliation.bookingBased)} |
| Completed bookings | ${gmv.reconciliation.completedBookings} |
| Delta (payment vs booking) | ${pct(gmv.reconciliation.deltaPct)} |

## Revenue & COGS (real)
| Field | Value |
|---|---|
| Gross revenue (GMV) | ${inr(fi.revenue.grossRevenue)} |
| Commission revenue | ${inr(fi.revenue.commissionRevenue)} |
| Subscription revenue | ${inr(fi.revenue.subscriptionRevenue)} |
| Net revenue (top line) | ${inr(fi.revenue.netRevenue)} |
| Refunds | ${inr(fi.revenue.refunds)} |
| Payment gateway fees (${fi.cogs.gatewayFeePct}%, ${fi.assumptions.gatewayFeePctSource}) | ${inr(fi.cogs.gatewayFees)} |
| COGS total | ${inr(fi.cogs.total)} |

## Gross Margin (real)
| Field | Value |
|---|---|
| Gross profit | ${inr(fi.grossMargin.grossProfit)} |
| Gross margin % | ${pct(fi.grossMargin.grossMarginPct)} |
| Basis | ${fi.grossMargin.basis} |

## EBITDA — ${ebitdaState}
| Field | Value |
|---|---|
| Operating expense (monthly) | ${inr(fi.assumptions.operatingExpenseMonthly)} (${fi.assumptions.sources.operatingExpenseMonthly}) |
| EBITDA | ${inr(fi.ebitda.ebitda)} |
| EBITDA margin % | ${pct(fi.ebitda.ebitdaMarginPct)} |
${fi.ebitda.note ? `\n> ${fi.ebitda.note}` : ""}

## Burn Rate — ${burnState}
| Field | Value |
|---|---|
| Net monthly cash flow | ${inr(fi.burnRate.netMonthlyCashFlow)} |
| Monthly burn | ${inr(fi.burnRate.monthlyBurn)} |
| Profitable? | ${fi.burnRate.isProfitable == null ? "—" : fi.burnRate.isProfitable ? "yes" : "no"} |
${fi.burnRate.note ? `\n> ${fi.burnRate.note}` : ""}

## Cash Runway — ${runwayState}
| Field | Value |
|---|---|
| Cash on hand | ${inr(fi.cashRunway.cashOnHand)} (source: ${fi.assumptions.sources.cashOnHand}) |
| Runway (months) | ${fi.cashRunway.runwayMonths == null ? (fi.cashRunway.status === "profitable" ? "∞ (profitable)" : "—") : fi.cashRunway.runwayMonths} |
| Status | ${fi.cashRunway.status} |
${fi.cashRunway.note ? `\n> ${fi.cashRunway.note}` : ""}

## Profit Forecast — contribution: ENABLED · profit: ${profitState}
| Field | Value |
|---|---|
| Contribution forecast (monthly) | ${inr(fi.forecast.contributionForecastMonthly)} |
| Contribution forecast (annual) | ${inr(fi.forecast.contributionForecastAnnual)} |
| Profit forecast (monthly) | ${inr(fi.forecast.profitForecastMonthly)} |
| Profit forecast (annual) | ${inr(fi.forecast.profitForecastAnnual)} |
${fi.forecast.note ? `\n> ${fi.forecast.note}` : ""}

## Config inputs (finance_config DB → env fallback)
| Key | Purpose | Value | Source |
|---|---|---|---|
| \`OPERATING_EXPENSE_MONTHLY\` | EBITDA, burn, profit | ${fi.assumptions.operatingExpenseMonthly != null ? inr(fi.assumptions.operatingExpenseMonthly) : "—"} | ${fi.assumptions.sources.operatingExpenseMonthly} |
| \`CASH_ON_HAND\` | cash runway | ${fi.assumptions.cashOnHand != null ? inr(fi.assumptions.cashOnHand) : "—"} | ${fi.assumptions.sources.cashOnHand} |
| \`PAYMENT_GATEWAY_FEE_PCT\` | COGS gateway rate | ${fi.assumptions.gatewayFeePct}% | ${fi.assumptions.sources.gatewayFeePct} |

Set values in Finance HQ → **CFO Config** (\`/finance/config\`).

Missing inputs this run: ${fi.missingInputs.length ? fi.missingInputs.join(", ") : "none"}

## Endpoints
- \`GET /api/admin/finance/gmv?days=30\` — canonical GMV
- \`GET /api/admin/finance/intelligence?days=30\` — full P&L intelligence

## Prometheus gauges
Always-real: \`fin_canonical_gmv_inr\`, \`fin_net_revenue_inr\`, \`fin_gross_profit_inr\`, \`fin_gross_margin_pct\`, \`fin_contribution_forecast_monthly_inr\`.
Config-gated (appear only when inputs present): \`fin_ebitda_inr\`, \`fin_ebitda_margin_pct\`, \`fin_monthly_burn_inr\`, \`fin_runway_months\`, \`fin_profit_forecast_monthly_inr\`.
`;

  writeFileSync(join(DOCS, "finance-intelligence-certification.md"), md);
  console.log(`Finance Intelligence certification: ${verdict}`);
  console.log(`GMV=${inr(gmv.gmv)} NetRev=${inr(fi.revenue.netRevenue)} GrossMargin=${pct(fi.grossMargin.grossMarginPct)}`);
  console.log(`EBITDA=${ebitdaState} Burn=${burnState} Runway=${runwayState} Profit=${profitState}`);
  if (blockers.length) console.log("Blockers:", blockers.join("; "));
  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
