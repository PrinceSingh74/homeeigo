# Growth Intelligence Certification — HOMIGO V6

Generated: 2026-07-03T09:18:42.224Z
Window: trailing 30 days
Data policy: unit economics + finance intelligence + campaigns/referrals + marketing_attribution_touches. ROAS requires MARKETING_SPEND_MONTHLY env when no ad-spend table exists.

## Verdict: **PASS**

All always-real metric gates passed.

## Unit economics
| Metric | Value |
|---|---|
| CAC | ₹0 |
| LTV | ₹260 |
| LTV : CAC | — |
| New customers | 182 |

## ROAS — INPUT_REQUIRED
| Field | Value |
|---|---|
| ROAS | — |
| Marketing spend (window) | ₹0 |
| Attributed revenue | ₹13,410 |
| Spend source | missing |

## Payback period
| Field | Value |
|---|---|
| Payback (months) | — |
| Monthly ARPU | ₹74 |
| Gross margin % | 35.46% |

## Campaign ROI (0 campaigns)
_No campaigns with redemptions or configured cost._

## Referral ROI
| Field | Value |
|---|---|
| ROI % | — |
| Referred GMV | ₹0 |
| Commission paid | ₹0 |

## Attribution engine
Touch table populated: no

> First/last/multi-touch from marketing_attribution_touches when ingested; referral/coupon channels shown from live transactions.

Channels:
_No attribution touches in window; referral/coupon channels shown when applicable._

## Endpoint
- `GET /api/admin/growth/intelligence?days=30`

## Prometheus gauges
`growth_cac_inr`, `growth_ltv_inr`, `growth_ltv_cac_ratio`, `growth_roas` (when spend configured), `growth_payback_months`.
