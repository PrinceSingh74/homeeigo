/**
 * Customer Intelligence certification — NPS, CSAT, complaint trend, happiness, SSI.
 * Run: bun --env-file=.env run scripts/enterprise/customer-intelligence-certification.ts
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { customerIntelligenceService } from "../../src/services/customer-intelligence.service";

const DOCS = join(import.meta.dir, "../../../admin-panel/docs/v6");

async function main() {
  if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });

  const data = await customerIntelligenceService.getIntelligence(30);
  const blockers: string[] = [];

  if (!data.generatedAt) blockers.push("Missing generatedAt");
  if (!Array.isArray(data.complaintTrend)) blockers.push("complaintTrend not an array");
  if (data.nps.source === "missing" && data.components.ratingsCount === 0 && data.components.surveyNpsCount === 0) {
    // honest empty state — not a failure
  } else if (data.nps.source !== "missing" && data.nps.score == null) {
    blockers.push("NPS source set but score null");
  }
  if (data.csat.source !== "missing" && data.csat.scorePct == null) {
    blockers.push("CSAT source set but scorePct null");
  }

  const verdict = blockers.length === 0 ? "PASS" : "FAIL";

  const md = `# Customer Intelligence Certification — HOMIGO V6

Generated: ${new Date().toISOString()}
Window: trailing ${data.periodDays} days
Data policy: real Rating, SupportTicket, CxSurveyResponse. Survey NPS/CSAT preferred; transactional rating proxy when surveys insufficient.

## Verdict: **${verdict}**

${blockers.length ? `### Blockers\n${blockers.map((b) => `- ${b}`).join("\n")}` : "All gates passed."}

## NPS
| Field | Value |
|---|---|
| Score | ${data.nps.score ?? "—"} |
| Source | ${data.nps.source} |
| Sample size | ${data.nps.sampleSize} |
| Definition | ${data.nps.definition} |

## CSAT
| Field | Value |
|---|---|
| Score % | ${data.csat.scorePct ?? "—"} |
| Source | ${data.csat.source} |
| Sample size | ${data.csat.sampleSize} |
| Definition | ${data.csat.definition} |

## Composite scores
| Metric | Value |
|---|---|
| Customer Happiness Score | ${data.customerHappinessScore ?? "—"} |
| Service Satisfaction Index | ${data.serviceSatisfactionIndex ?? "—"} |

## Components
| Field | Value |
|---|---|
| Avg rating (1-5) | ${data.components.avgRating ?? "—"} |
| SLA compliance % | ${data.components.slaCompliancePct ?? "—"} |
| Repeat customer rate % | ${data.components.repeatCustomerRatePct ?? "—"} |
| Ratings count | ${data.components.ratingsCount} |
| Tickets count | ${data.components.ticketsCount} |
| Survey NPS rows | ${data.components.surveyNpsCount} |
| Survey CSAT rows | ${data.components.surveyCsatCount} |

## Complaint trend (${data.complaintTrend.length} days with complaints)
${data.complaintTrend.length ? data.complaintTrend.map((d) => `- ${d.date}: ${d.count}`).join("\n") : "_No complaint-category tickets in window._"}

## Endpoint
- \`GET /api/admin/cx/intelligence?days=30\`

## Prometheus gauges
\`cx_nps_score\`, \`cx_csat_pct\`, \`cx_happiness_score\`, \`cx_service_satisfaction_index\` (set when data exists).
`;

  writeFileSync(join(DOCS, "customer-intelligence-certification.md"), md);
  console.log(`Customer Intelligence certification: ${verdict}`);
  console.log(`NPS=${data.nps.score ?? "—"} (${data.nps.source}) CSAT=${data.csat.scorePct ?? "—"}% Happiness=${data.customerHappinessScore ?? "—"}`);
  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
