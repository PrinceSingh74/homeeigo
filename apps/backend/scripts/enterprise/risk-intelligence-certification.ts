/**
 * Risk Intelligence certification — unified trust score, fraud, payment, compliance, timeline.
 * Run: bun --env-file=.env run scripts/enterprise/risk-intelligence-certification.ts
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { riskIntelligenceService } from "../../src/services/risk-intelligence.service";

const DOCS = join(import.meta.dir, "../../../admin-panel/docs/v6");

async function main() {
  if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });

  const data = await riskIntelligenceService.getIntelligence(30);
  const blockers: string[] = [];

  const trust = data.unifiedTrustScore.score;
  if (!Number.isFinite(trust) || trust < 0 || trust > 100) blockers.push(`Trust score out of range: ${trust}`);
  if (!Array.isArray(data.riskTimeline)) blockers.push("riskTimeline not an array");
  if (!Number.isFinite(data.fraudConfidence.score)) blockers.push("fraudConfidence invalid");
  if (!Number.isFinite(data.paymentRisk.score)) blockers.push("paymentRisk invalid");
  if (!Number.isFinite(data.complianceRisk.score)) blockers.push("complianceRisk invalid");

  const verdict = blockers.length === 0 ? "PASS" : "FAIL";

  const md = `# Risk Intelligence Certification — HOMIGO V6

Generated: ${new Date().toISOString()}
Window: trailing ${data.periodDays} days
Data policy: composite trust score from live fraud, chargeback, compliance and finance integrity signals.

## Verdict: **${verdict}**

${blockers.length ? `### Blockers\n${blockers.map((b) => `- ${b}`).join("\n")}` : "All gates passed."}

## Unified Trust Score (0–100)
| Field | Value |
|---|---|
| Score | **${trust}** |
| Definition | ${data.unifiedTrustScore.definition} |

### Breakdown
| Component | Score |
|---|---|
| Customer trust | ${data.unifiedTrustScore.breakdown.customerTrust} |
| Partner trust | ${data.unifiedTrustScore.breakdown.partnerTrust} |
| Payment risk (inverted) | ${data.unifiedTrustScore.breakdown.paymentRisk} |
| Fraud risk (inverted) | ${data.unifiedTrustScore.breakdown.fraudRisk} |
| Compliance risk (inverted) | ${data.unifiedTrustScore.breakdown.complianceRisk} |

## Fraud confidence
| Field | Value |
|---|---|
| Score | ${data.fraudConfidence.score} |
| Avg risk score | ${data.fraudConfidence.avgRiskScore} |
| High-risk users | ${data.fraudConfidence.highRiskUsers} |
| Open alerts | ${data.fraudConfidence.openAlerts} |

## Payment risk
| Field | Value |
|---|---|
| Score | ${data.paymentRisk.score} |
| Chargeback ratio % | ${data.paymentRisk.chargebackRatioPct} |
| Open exposure | ${data.paymentRisk.openExposure} |

## Compliance risk
| Field | Value |
|---|---|
| Score | ${data.complianceRisk.score} |
| Open requests | ${data.complianceRisk.openRequests} |
| Overdue requests | ${data.complianceRisk.overdueRequests} |

## Finance health score
${data.financeHealthScore}

## Risk timeline (${data.riskTimeline.length} events)
${data.riskTimeline.slice(0, 10).map((e) => `- ${e.at} [${e.severity}] ${e.type}: ${e.title}`).join("\n") || "_No risk events in window._"}

## Endpoint
- \`GET /api/admin/risk/intelligence?days=30\`

## Prometheus gauges
\`risk_unified_trust_score\`, \`risk_fraud_confidence\`, \`risk_payment_risk_score\`, \`risk_compliance_risk_score\`.
`;

  writeFileSync(join(DOCS, "risk-intelligence-certification.md"), md);
  console.log(`Risk Intelligence certification: ${verdict}`);
  console.log(`Trust=${trust} FraudConf=${data.fraudConfidence.score} Timeline=${data.riskTimeline.length} events`);
  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
