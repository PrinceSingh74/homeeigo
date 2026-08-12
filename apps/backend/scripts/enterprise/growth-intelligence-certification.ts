/**
 * Growth Intelligence certification — ROAS, CAC, LTV, attribution.
 * Run: bun --env-file=.env run scripts/enterprise/growth-intelligence-certification.ts
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { growthIntelligenceService } from "../../src/services/growth-intelligence.service";

const DOCS = join(import.meta.dir, "../../../admin-panel/docs/v6");
const inr = (n: number | null | undefined) => (n == null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);

async function main() {
  if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });

  const data = await growthIntelligenceService.getIntelligence(30);
  const blockers: string[] = [];

  if (!Number.isFinite(data.cac) && data.newCustomers > 0) blockers.push("CAC did not compute despite new customers");
  if (!Number.isFinite(data.ltv)) blockers.push("LTV did not compute");
  if (data.cac > 0 && data.ltv > 0 && data.ltvCacRatio == null) blockers.push("LTV:CAC null despite positive CAC/LTV");
  if (!data.attribution || !Array.isArray(data.attribution.channels)) blockers.push("Attribution channels missing");

  const roasState = data.roas.value != null ? "ENABLED" : "INPUT_REQUIRED";
  const verdict = blockers.length === 0 ? "PASS" : "FAIL";

  const md = `# Growth Intelligence Certification — HOMIGO V6

Generated: ${new Date().toISOString()}
Window: trailing ${data.periodDays} days
Data policy: unit economics + finance intelligence + campaigns/referrals + marketing_attribution_touches. ROAS requires MARKETING_SPEND_MONTHLY env when no ad-spend table exists.

## Verdict: **${verdict}**

${blockers.length ? `### Blockers\n${blockers.map((b) => `- ${b}`).join("\n")}` : "All always-real metric gates passed."}

## Unit economics
| Metric | Value |
|---|---|
| CAC | ${inr(data.cac)} |
| LTV | ${inr(data.ltv)} |
| LTV : CAC | ${data.ltvCacRatio != null ? `${data.ltvCacRatio}x` : "—"} |
| New customers | ${data.newCustomers} |

## ROAS — ${roasState}
| Field | Value |
|---|---|
| ROAS | ${data.roas.value ?? "—"} |
| Marketing spend (window) | ${inr(data.roas.marketingSpend)} |
| Attributed revenue | ${inr(data.roas.attributedRevenue)} |
| Spend source | ${data.roas.spendSource} |

## Payback period
| Field | Value |
|---|---|
| Payback (months) | ${data.paybackMonths.value ?? "—"} |
| Monthly ARPU | ${inr(data.paybackMonths.monthlyArpu)} |
| Gross margin % | ${data.paybackMonths.grossMarginPct}% |

## Campaign ROI (${data.campaignRoi.length} campaigns)
${data.campaignRoi.length ? data.campaignRoi.map((c) => `- **${c.code}**: revenue ${inr(c.revenue)}, cost ${inr(c.cost)}, ROI ${c.roi != null ? `${c.roi}%` : "—"}`).join("\n") : "_No campaigns with redemptions or configured cost._"}

## Referral ROI
| Field | Value |
|---|---|
| ROI % | ${data.referralRoi.roiPct ?? "—"} |
| Referred GMV | ${inr(data.referralRoi.referredGmv)} |
| Commission paid | ${inr(data.referralRoi.commissionPaid)} |

## Attribution engine
Touch table populated: ${data.attribution.touchTablePopulated ? "yes" : "no"}
${data.attribution.note ? `\n> ${data.attribution.note}` : ""}

Channels:
${data.attribution.channels.length ? data.attribution.channels.map((c) => `- ${c.channel}: ${inr(c.revenue)} revenue, ${c.touches} touches`).join("\n") : "_No attribution touches in window; referral/coupon channels shown when applicable._"}

## Endpoint
- \`GET /api/admin/growth/intelligence?days=30\`

## Prometheus gauges
\`growth_cac_inr\`, \`growth_ltv_inr\`, \`growth_ltv_cac_ratio\`, \`growth_roas\` (when spend configured), \`growth_payback_months\`.
`;

  writeFileSync(join(DOCS, "growth-intelligence-certification.md"), md);
  console.log(`Growth Intelligence certification: ${verdict}`);
  console.log(`CAC=${inr(data.cac)} LTV=${inr(data.ltv)} LTV:CAC=${data.ltvCacRatio ?? "—"} ROAS=${roasState}`);
  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
