# Risk Intelligence Report — HOMIGO V5

**Scope:** Phase 3 — Trust & Risk Command Center. Real-data only.

## Implemented (real data, wired in `RiskHqDashboard`)

| Feature | Backend source | Status |
|---|---|---|
| Fraud risk score (GPS anomaly index) | `GET /api/geo-intel/fraud` → `riskScore`, `suspiciousCount` | ✅ live |
| High-risk users (score, level, factors) | `GET /api/admin/fraud/high-risk-users` | ✅ live |
| Risk distribution | `GET /api/admin/fraud/overview` → `riskDistribution` | ✅ live |
| Fraud alerts timeline | `GET /api/admin/fraud/alerts` | ✅ available (paginated) |
| Financial risk cases + holds | `GET /api/admin/finance/risk` | ✅ available |
| Compliance / GDPR queue | `GET /api/compliance/admin/requests` | ✅ live |
| KYC status | `GET /api/admin/users`, `/api/admin/providers` (`kycStatus`) | ✅ available per-record |

## Missing backend → proposed APIs

| Feature | Why missing | Proposed API | Integration path |
|---|---|---|---|
| **Unified Trust Score (0–100)** | Sub-scores exist separately (fraud, finance health, settlement health, KYC) but no composite | `GET /api/admin/risk/trust-score?entity=customer|partner|platform` | Weighted blend: fraud risk (30%) + payment risk (25%) + compliance/KYC (20%) + settlement health (15%) + dispute rate (10%); expose `{ score, breakdown[] }` |
| **Fraud Confidence Score** | Raw scores exist; no model-confidence field | Extend `fraud/high-risk-users` with `confidence` | Emit model probability from scoring pipeline (`fraud_risk_scores`) |
| **Account Takeover Risk** | `FraudEventType` has no ATO type | `GET /api/admin/risk/ato` + new `FraudEventType.ACCOUNT_TAKEOVER` | Signals: new-device + geo-velocity + password reset + payout-method change; migration adds enum value (additive) |
| **Payment Fraud Risk (dedicated)** | Embedded in finance risk cases | `GET /api/admin/risk/payment` | Aggregate chargebacks + failed-3DS + velocity from `Payment`/`Chargeback` |
| **Unified Risk Events Timeline** | `FinancialRiskEvent` is write-only (`recordEvent()`), no read API | `GET /api/admin/risk/events?limit=&type=` | Add read endpoint over `FinancialRiskEvent` + merge fraud alerts into one time-ordered feed |
| **Investigation Queue / Escalation Center** | Escalation exists per-case (chargebacks, fraud cases) but no unified queue | `GET /api/admin/risk/investigations` + `POST .../:id/escalate` | Union view over open fraud cases, financial holds, high-severity alerts with assignee/state |

## SOC-style presentation
`RiskHqDashboard` uses red-glow panels, live risk distribution meters, and ranked high-risk users — a Security-Operations-Center layout. Trust score and ATO render `DataUnavailable` with the proposed API rather than a fabricated 0–100 number.

## Runtime evidence
Type-check clean; `/hq/risk` served via code-split `RiskHqDashboard`; queries `staleTime: 120s`, no polling storms.
