# Phase 9 — Discovery

**Method:** repository read, live schema queries against `homigo_db`, runtime enumeration of the AI
tool catalog. Nothing below is taken from the roadmap; every claim names where it was found.

**Headline:** far more exists than the roadmap implies, and the gap is not "no executive reporting" —
it is **no provenance**. Real, ledger-derived executive numbers are already produced and exported;
what is absent is per-fact source, freshness, state and confidence, plus anomaly detection and a
general approval surface.

---

## 1. Admin panel — what is already there

88 routes under `apps/admin-panel/src/app/(console)/`. Relevant to Phase 9:

| Area | Existing routes |
|---|---|
| Command / analytics | `command-center`, `analytics`, `observability` (+ alerts, logs, email) |
| Finance | 15 routes: `dashboard`, `reconciliation`, `refunds`, `payouts`, `adjustments`, `integrity`, `liabilities`, `risk`, `reports`, `chargebacks`, `settlement-sync`, `validation`, `config`, `backfill`, `hcoin-expiry` |
| Fraud / risk | `fraud`, `trust-safety` (+ `risk`, `risk/[providerId]`, `incidents`, `compliance`) |
| Intelligence | `digital-twin`, `eta-intelligence`, `geospatial`, `heatmap`, `weather`, `coverage` |
| AI | `ai`, `ai-brain` (+ `approvals`, `context`, `memory`, `prompts`, `timeline`, `tools`), `vision` |
| Partners / customers | `vendors`, `vendors/[id]`, `workforce`, `customers`, `reviews`, `support` |

**Not present:** `/admin/executive`. **Not present:** a general `/admin/approvals`.

Two domain-specific approval surfaces exist — `ai-brain/approvals` and
`partner-acquisition/approvals` — so a third, general one must extend rather than duplicate them.

---

## 2. Executive reporting — EXISTS, and is real

`apps/backend/src/services/executive-reporting.service.ts` (385 lines), wired into
`routes/admin.ts:1046`.

Provides: `buildExecutiveReport(period)`, `computeFinanceHealthScore()`, `exportCsv/Xlsx/Pdf()` with
a branded PDF layout including `drawExecutiveInsight()`.

Returns real ledger-derived figures via `financeDashboardService.getOverview()` and `dailyTrend()`:
GMV, revenue, netRevenue, platform margin, MRR, gift-card / wallet / cashback / provider liabilities,
chargeback exposure, total liabilities, trend, chargeback analytics.

**The gap, precisely:**

| Present | Absent |
|---|---|
| Real numbers from an authoritative source | Per-fact `source` |
| One `generatedAt` for the whole report | Per-fact `observedAt`, `freshness` |
| Period + days | Per-fact `state` (OK / STALE / UNAVAILABLE / …) |
| PDF/CSV/XLSX export | Per-fact `confidence`, rules/model version |

**Discovery finding (DATA_QUALITY):** `platformMarginPct` is set to `0` when `gmv === 0`. Margin is
undefined at zero GMV, not zero — this is the "missing becomes 0" pattern Phase 9 forbids. Recorded,
not yet changed; the existing service is authoritative until a decision is made.

---

## 3. Approval architecture — EXISTS and is frozen

`apps/backend/src/ai-tools/approval/approval-engine.ts` with model `AiToolApproval`.

Exports: `createApprovalRequest`, `decideApproval`, `consumeApproval`, `listPendingApprovals`,
`listHighRiskQueue`, `cancelApproval`, `expireStaleApprovals`, `getApprovalById`,
`getApprovalStatistics`.

The model already satisfies most of Phase 9's Approval Center requirements:

| Phase 9 requirement | Existing field |
|---|---|
| requestId | `approvalId` (unique) |
| action / capability | `toolId` → `AiToolRegistry` |
| subject | `resourceRef` |
| evidence visible before approval | `argumentsPreview` (redacted, *explicitly not* used for authorization) |
| scope cannot widen | `argumentsHash` — the **sole** binding |
| requestedBy / approvedBy / rejectedBy | present, plus `requestedRole` |
| expiry | `expiresAt` + `expireStaleApprovals()` |
| replay protection | `consumedAt` / `consumedBy` / `consumedExecutionId`, set atomically |
| separation of duties | `approvalMode`, `requiredApprovers` |
| risk | `riskScore` |

A second, finance-specific model exists: `FinancialAdjustmentApproval`.

**Phase 5 froze this engine.** Phase 9 must consume it, not modify its contracts.

---

## 4. High-risk actions — already modelled, deliberately unexecutable

Runtime enumeration of the tool catalog: **57 tools — 31 READ / 12 WRITE / 14 HIGH_RISK**, with
**HIGH_RISK 0/14 bound** (no handler; fail-closed).

Phase 9's four high-risk suggestion types map exactly onto existing tools:

| Phase 9 action | Existing tool |
|---|---|
| REFUND | `high_risk.finance.refund` |
| FINANCIAL_ADJUSTMENT | `high_risk.finance.walletAdjustment`, `high_risk.finance.ledgerEntry` |
| FRAUD_ACTION | `high_risk.compliance.accountFreeze`, `.partnerSuspend`, `.customerBan` |
| CUSTOMER_COMPENSATION | **no dedicated tool** — nearest is `walletAdjustment` |

Remaining HIGH_RISK tools: `finance.settlement`, `finance.payout`, `finance.financeApproval`,
`security.roleEscalation`, `platform.featureFlagChange`, `platform.secrets`,
`platform.configuration`, `platform.infrastructure`.

**Consequence for Phase 9:** a high-risk recommendation can be *created and reviewed* end-to-end
without ever becoming executable, because every handler is unbound. That is the correct shape and
must not be "fixed" by binding one.

`CUSTOMER_COMPENSATION` having no dedicated tool is a genuine gap → `HUMAN_DECISION_REQUIRED`
(whether it is a wallet adjustment or its own governed action).

---

## 5. Authoritative data sources

| Domain | Source | Status |
|---|---|---|
| Finance | `financeDashboardService`, `finance-analytics.service.ts`, ledger | **authoritative** |
| Payments / payouts / wallet | Prisma models + reconciliation services | **authoritative** |
| Fraud / risk | `lib/partner-risk-score.ts`, trust-safety routes, `SecurityEvent`-style logging | exists |
| Demand | `geoIntelligenceService.demandForecast()` — BigQuery ARIMA | **exists, known stale** |
| Supply / surge | `geoIntelligenceService.surgePrediction()` — deterministic, 120 s cache | exists |
| Weather | `weatherService.getByCoords()` — OpenWeather | exists |
| Geo / zones | `Geofence` + `geo-intelligence.service.ts` | exists |
| Digital Twin | `digital-twin.service.ts` — real class, `SUPPORTED_CITIES` | **exists** (not a roadmap fiction) |
| Platform intelligence | `platform-intelligence.service.ts` | exists |
| Audit | `ActivityLog` | exists |
| AI | `src/ai/gateway/ai-gateway.ts`, `src/ai/security/prompt-security.ts` | exists |
| Feature flags | `PlatformFeatureFlag` → table `platform_feature_flags` | exists |

**Live flag state in `homigo_db`:** exactly two rows, both `enabled=false`, environment `dev` —
`AI_BOOKING_RECOVERY`, `AI_PERSONALIZED_RECOMMENDATIONS`. This confirms the fail-closed behaviour
relied on throughout Phase 8: an absent flag evaluates to `FLAG_MISSING` = off.

*(Note: the table is `platform_feature_flags`, not `feature_flags`.)*

---

## 6. Gaps

| Gap | Classification |
|---|---|
| No revenue anomaly detection anywhere | `DATA_SOURCE_MISSING` — threshold is `HUMAN_DECISION_REQUIRED` |
| No anomaly thresholds of any kind | `HUMAN_DECISION_REQUIRED` |
| No per-fact provenance on executive figures | buildable — the core of Phase 9 |
| No `/admin/executive` route | buildable |
| No general `/admin/approvals` route | buildable, must extend the frozen engine |
| No `AdminResource` for executive intelligence or approvals | `HUMAN_DECISION_REQUIRED` — enum has only USERS, PAYMENTS, WALLET, BOOKINGS, DISPUTES, CAMPAIGNS, GIFT_CARDS, MEMBERSHIPS, ANALYTICS, SETTINGS, AUDIT_LOGS, ADMIN_USERS. Mapping executive intelligence to `ANALYTICS` is plausible but is a permissions decision, not a code choice. |
| No canonical executive report schedule | `HUMAN_DECISION_REQUIRED` — same shape as Phase 8's morning time |
| No dedicated CUSTOMER_COMPENSATION tool | `HUMAN_DECISION_REQUIRED` |
| ARIMA demand model stale | `MODEL_STALENESS` — already detected at runtime by `isDemandForecastStale()` |

---

## 7. Reused, never rebuilt

Automation engine, workflow/trigger registries, condition registry, notification router and
governance, shadow evidence, certification gate, distributed leader lock, prompt security, AI
Gateway, RBAC service, feature-flag evaluator, `ActivityLog`, and the Phase-8
`InsightEvidence` / `ExplainableInsight` contract — which already solves "every fact carries its
provenance" for partner-facing intelligence and is the natural basis for the executive equivalent.

---

## 8. Recommended implementation order

Dependencies force one change from the default order: **anomaly detection cannot precede a measured
distribution**, so revenue anomaly work begins with measurement, not detection.

1. `ExecutiveIntelligenceContext` — provenance-carrying wrapper over existing sources
2. Executive Brief (deterministic; LLM strictly optional)
3. KPI explanations
4. Revenue anomaly — **measure first**, then `HUMAN_DECISION_REQUIRED` for the threshold
5. Demand / supply warnings (reuse `isDemandForecastStale`)
6. Finance narratives (ledger authoritative)
7. Fraud narratives (explain existing risk signals only)
8. Forecast explanations
9. Digital Twin narratives (real source confirmed)
10. Recommended actions
11. Human Approval Center — extend the frozen engine
12. Scheduled reports — blocked on schedule decision
13. Admin UI — `/executive`, and approvals extending existing surfaces
14–17. Real-data verification, shadow evidence, certification readiness, reconciliation

---

## 9. Human decisions required (carried into architecture)

1. Executive report schedule (time / frequency)
2. Revenue anomaly threshold — against a measured distribution
3. `AdminResource` mapping for executive intelligence and approvals
4. Whether CUSTOMER_COMPENSATION is a wallet adjustment or its own governed action
5. Whether `platformMarginPct` should report `null` rather than `0` at zero GMV

## 10. External artifacts

None newly required. Existing outstanding items (EAS projectId, Sentry DSN, Maps key) are unrelated
to Phase 9.
