# Risk Intelligence Certification — HOMIGO V6

Generated: 2026-07-03T09:18:43.275Z
Window: trailing 30 days
Data policy: composite trust score from live fraud, chargeback, compliance and finance integrity signals.

## Verdict: **PASS**

All gates passed.

## Unified Trust Score (0–100)
| Field | Value |
|---|---|
| Score | **98.6** |
| Definition | Weighted composite 0-100 from live fraud, payment, compliance and finance health signals |

### Breakdown
| Component | Score |
|---|---|
| Customer trust | 100 |
| Partner trust | 100 |
| Payment risk (inverted) | 94.4 |
| Fraud risk (inverted) | 0 |
| Compliance risk (inverted) | 0 |

## Fraud confidence
| Field | Value |
|---|---|
| Score | 100 |
| Avg risk score | 0 |
| High-risk users | 0 |
| Open alerts | 0 |

## Payment risk
| Field | Value |
|---|---|
| Score | 94.4 |
| Chargeback ratio % | 1.12 |
| Open exposure | 0 |

## Compliance risk
| Field | Value |
|---|---|
| Score | 100 |
| Open requests | 2 |
| Overdue requests | 0 |

## Finance health score
100

## Risk timeline (10 events)
- 2026-06-12T10:46:11.916Z [CRITICAL] financial_risk: REFUND_ABUSE
- 2026-06-12T10:46:11.575Z [CRITICAL] financial_risk: REFUND_ABUSE
- 2026-06-12T10:46:11.494Z [CRITICAL] financial_risk: REFUND_ABUSE
- 2026-06-12T10:46:11.447Z [CRITICAL] financial_risk: REFUND_ABUSE
- 2026-06-12T10:46:09.808Z [CRITICAL] financial_risk: REFUND_ABUSE
- 2026-06-12T10:46:09.566Z [CRITICAL] financial_risk: REFUND_ABUSE
- 2026-06-12T10:46:09.203Z [CRITICAL] financial_risk: REFUND_ABUSE
- 2026-06-12T10:46:09.179Z [CRITICAL] financial_risk: REFUND_ABUSE
- 2026-06-12T10:46:09.146Z [HIGH] financial_risk: REFUND_ABUSE
- 2026-06-12T09:45:33.777Z [HIGH] financial_risk: REFUND_ABUSE

## Endpoint
- `GET /api/admin/risk/intelligence?days=30`

## Prometheus gauges
`risk_unified_trust_score`, `risk_fraud_confidence`, `risk_payment_risk_score`, `risk_compliance_risk_score`.
