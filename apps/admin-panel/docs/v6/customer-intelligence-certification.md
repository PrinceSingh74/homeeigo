# Customer Intelligence Certification — HOMIGO V6

Generated: 2026-07-03T09:18:41.048Z
Window: trailing 30 days
Data policy: real Rating, SupportTicket, CxSurveyResponse. Survey NPS/CSAT preferred; transactional rating proxy when surveys insufficient.

## Verdict: **PASS**

All gates passed.

## NPS
| Field | Value |
|---|---|
| Score | 33.33 |
| Source | transactional_rating |
| Sample size | 3 |
| Definition | Transactional NPS proxy from post-booking ratings (5★ promoters, 1-3★ detractors) |

## CSAT
| Field | Value |
|---|---|
| Score % | 66.67 |
| Source | transactional_rating |
| Sample size | 3 |
| Definition | CSAT % (4-5★) from post-booking ratings |

## Composite scores
| Metric | Value |
|---|---|
| Customer Happiness Score | 40.29 |
| Service Satisfaction Index | 86.67 |

## Components
| Field | Value |
|---|---|
| Avg rating (1-5) | 4.33 |
| SLA compliance % | 0 |
| Repeat customer rate % | 18.75 |
| Ratings count | 3 |
| Tickets count | 23 |
| Survey NPS rows | 0 |
| Survey CSAT rows | 0 |

## Complaint trend (0 days with complaints)
_No complaint-category tickets in window._

## Endpoint
- `GET /api/admin/cx/intelligence?days=30`

## Prometheus gauges
`cx_nps_score`, `cx_csat_pct`, `cx_happiness_score`, `cx_service_satisfaction_index` (set when data exists).
