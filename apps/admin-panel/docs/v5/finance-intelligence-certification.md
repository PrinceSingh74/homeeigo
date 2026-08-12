# Finance Intelligence Certification — HOMIGO V5

Generated: 2026-07-03T08:58:48.160Z
Window: trailing 30 days
Data policy: real transactional data + documented env-config inputs. No mock data. Config-dependent metrics render "input required" rather than a fabricated value.

## Verdict: **PASS**

All always-real metric gates passed.

## Canonical GMV (single source of truth)
| Field | Value |
|---|---|
| Canonical GMV (payment-based) | ₹47,366 |
| Definition | `SUM(payment.amountPaid) WHERE status=SUCCESS AND completedAt in window` |
| Successful payments | 89 |
| Booking-based (reconciliation) | ₹28,565 |
| Completed bookings | 54 |
| Delta (payment vs booking) | 39.69% |

## Revenue & COGS (real)
| Field | Value |
|---|---|
| Gross revenue (GMV) | ₹47,366 |
| Commission revenue | ₹5,317 |
| Subscription revenue | ₹8,093 |
| Net revenue (top line) | ₹13,410 |
| Refunds | ₹7,707 |
| Payment gateway fees (2%, undefined) | ₹947 |
| COGS total | ₹8,654 |

## Gross Margin (real)
| Field | Value |
|---|---|
| Gross profit | ₹4,756 |
| Gross margin % | 35.46% |
| Basis | netRevenue = commission + subscriptions |

## EBITDA — INPUT_REQUIRED
| Field | Value |
|---|---|
| Operating expense (monthly) | — (missing) |
| EBITDA | — |
| EBITDA margin % | — |

> Set values in Finance HQ → CFO Config (or legacy env vars until migrated).

## Burn Rate — INPUT_REQUIRED
| Field | Value |
|---|---|
| Net monthly cash flow | — |
| Monthly burn | — |
| Profitable? | — |

> Set values in Finance HQ → CFO Config (or legacy env vars until migrated).

## Cash Runway — INPUT_REQUIRED
| Field | Value |
|---|---|
| Cash on hand | — (source: missing) |
| Runway (months) | — |
| Status | input_required |

> Set values in Finance HQ → CFO Config (or legacy env vars until migrated).

## Profit Forecast — contribution: ENABLED · profit: INPUT_REQUIRED
| Field | Value |
|---|---|
| Contribution forecast (monthly) | ₹4,756 |
| Contribution forecast (annual) | ₹57,067 |
| Profit forecast (monthly) | — |
| Profit forecast (annual) | — |

> Set values in Finance HQ → CFO Config (or legacy env vars until migrated).

## Config inputs (finance_config DB → env fallback)
| Key | Purpose | Value | Source |
|---|---|---|---|
| `OPERATING_EXPENSE_MONTHLY` | EBITDA, burn, profit | — | missing |
| `CASH_ON_HAND` | cash runway | — | missing |
| `PAYMENT_GATEWAY_FEE_PCT` | COGS gateway rate | 2% | default |

Set values in Finance HQ → **CFO Config** (`/finance/config`).

Missing inputs this run: OPERATING_EXPENSE_MONTHLY, CASH_ON_HAND

## Endpoints
- `GET /api/admin/finance/gmv?days=30` — canonical GMV
- `GET /api/admin/finance/intelligence?days=30` — full P&L intelligence

## Prometheus gauges
Always-real: `fin_canonical_gmv_inr`, `fin_net_revenue_inr`, `fin_gross_profit_inr`, `fin_gross_margin_pct`, `fin_contribution_forecast_monthly_inr`.
Config-gated (appear only when inputs present): `fin_ebitda_inr`, `fin_ebitda_margin_pct`, `fin_monthly_burn_inr`, `fin_runway_months`, `fin_profit_forecast_monthly_inr`.
