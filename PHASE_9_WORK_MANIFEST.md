# Phase 9 — Work Manifest

**Status:** Capabilities 1-12 complete · Final reconciliation done — see `PHASE_9_FINAL_RECONCILIATION.md`
**Verdict:** `PHASE_9_COMPLETE_WITH_FOLLOWUPS`

Baseline carried in (verified at Phase-8 close, 2026-08-29): backend typecheck 0 · partner-web
typecheck 0 · 289 pass / 0 fail across 13 suites · AI catalog 57 tools (31/12/14) with HIGH_RISK
0/14 bound · LIVE blocked everywhere.

---

## Capability matrix

| # | Capability | Status | Blocker |
|---|---|---|---|
| 0 | Discovery / data-source audit | **COMPLETE** | — |
| 1 | ExecutiveIntelligenceContext | **COMPLETE** | — |
| 2 | AI Executive Brief (LLM prose) | **DEFERRED** | deterministic brief shipped instead; no model in any Phase-9 path (asserted by test) |
| 3 | KPI explanations | **COMPLETE** | — |
| 4 | Revenue anomaly explanation | **COMPLETE** (gated) | baseline not computable on current data |
| 5 | Demand / supply warnings | **COMPLETE** (gated) | supply telemetry unusable; threshold `HUMAN_DECISION_REQUIRED` |
| 6 | Finance narratives | **COMPLETE** | — |
| 7 | Fraud narratives | **COMPLETE** | — |
| 8 | Forecast explanations | **COMPLETE** | — |
| 9 | Digital Twin narratives | **COMPLETE** | — |
| 10 | Recommended actions | **COMPLETE** | priority + compensation semantics `HUMAN_DECISION_REQUIRED` |
| 11 | Human Approval Center | **COMPLETE** (verified, not rebuilt) | two engine defects referred to the Phase-5 freeze owner |
| 12 | Scheduled reports | **COMPLETE** (gated) | schedule, recurrence and timezone all `HUMAN_DECISION_REQUIRED` |
| 13 | Admin UI integration | **COMPLETE** | zero routes added; intelligence mounted on existing surfaces |
| 14 | Real-data verification | **COMPLETE** | live read-only observation on every capability |
| 15 | Shadow evidence | **SHADOW** | mechanism proven by test; 0 production rows — flag absent, schedule UNSET |
| 16 | Certification readiness | **HUMAN_DECISION_REQUIRED** | 0 certifications written during Phase 9; a named approver is required |
| 17 | Final reconciliation | **COMPLETE** | `PHASE_9_FINAL_RECONCILIATION.md` |

No capability is claimed complete on the strength of an existing dashboard.

---

## What already exists (do not rebuild)

| Thing | Location |
|---|---|
| Executive report + PDF/CSV/XLSX export | `apps/backend/src/services/executive-reporting.service.ts` |
| Finance truth | `financeDashboardService`, `finance-analytics.service.ts`, ledger |
| Approval engine (frozen, Phase 5) | `apps/backend/src/ai-tools/approval/approval-engine.ts`, model `AiToolApproval` |
| 14 HIGH_RISK tools, 0/14 bound | `apps/backend/src/ai-tools/registry/tool-catalog.ts` |
| AI Gateway | `apps/backend/src/ai/gateway/ai-gateway.ts` |
| Prompt security | `apps/backend/src/ai/security/prompt-security.ts` |
| Evidence contract (Phase 8) | `apps/backend/src/services/partner-insight-evidence.types.ts` |
| Digital Twin | `apps/backend/src/services/digital-twin.service.ts` |
| Demand / surge / weather | `geo-intelligence.service.ts`, `weather.service.ts` |
| Stale-demand rule | `isDemandForecastStale()` in `shift-planning.service.ts` |
| Scheduler + leader lock | `ScheduledJob`, `runScheduledJobTick`, `runWithLeaderLock` |
| RBAC | `rbac.service.ts`, `admin-route-permissions.ts` |
| Audit | `ActivityLog` |
| Feature flags | `PlatformFeatureFlag` → `platform_feature_flags` (2 rows, both off) |
| 88 admin routes | `apps/admin-panel/src/app/(console)/` |

---

## Human decisions required

| # | Decision | Why it cannot be defaulted |
|---|---|---|
| 1 | Executive report schedule (time / frequency) | No canonical business schedule exists; same shape as Phase 8's unresolved morning time. |
| 2 | Revenue anomaly threshold | No threshold exists anywhere. Will be published against a measured distribution before being asked. |
| 3 | `AdminResource` mapping for executive intelligence and approvals | Enum has 12 values, none executive-specific. Mapping to `ANALYTICS` is plausible but is a permissions decision. |
| 4 | Is CUSTOMER_COMPENSATION a wallet adjustment or its own governed action? | No dedicated high-risk tool exists for it. |
| 5 | Should `platformMarginPct` be `null` rather than `0` at zero GMV? | Margin is undefined at zero GMV; changing it touches an existing authoritative service. |

---

## Discovery findings carried forward

| Finding | Class |
|---|---|
| `platformMarginPct: 0` when GMV is 0 | `DATA_QUALITY_DEFECT` (reported, not yet changed) |
| No revenue anomaly detection of any kind | `DATA_SOURCE_MISSING` |
| No general `/admin/approvals`; two domain-specific surfaces exist | design input |
| ARIMA demand model stale | `MODEL_STALENESS` (already detected at runtime) |
| Flag table is `platform_feature_flags`, not `feature_flags` | corrected assumption |
| No dedicated CUSTOMER_COMPENSATION tool | `HUMAN_DECISION_REQUIRED` |

---

## Hard rules in force for this phase

No LIVE activation. No self-certification. No handler bound to any HIGH_RISK tool. No LLM-authored
number presented as fact. No fabricated KPI, threshold, confidence, forecast or Digital Twin value.
No second engine of any kind. No modification of Phase-7 or Phase-8 signed evidence. The ledger
remains the financial authority.

---

## Next action

Begin capability 1 — `ExecutiveIntelligenceContext` — as a provenance wrapper over the sources
inventoried above, adding no business number of its own.


---

## Capability 1 delivered (2026-08-30)

| Artifact | Path |
|---|---|
| Fact contract | `apps/backend/src/services/executive-intelligence.types.ts` |
| Context service | `apps/backend/src/services/executive-intelligence.service.ts` |
| Tests (26 / 143) | `apps/backend/src/__tests__/executive-intelligence.integration.test.ts` |

Rules version `exec.context.v1`. No existing file modified.

**Two defects surfaced, values carried unchanged:** `netRevenue` mixes rolling GMV with an all-time
refund total (7-day netRevenue read **-2,018.7** against **zero** in-window refunds — 120.4% of GMV
distortion); `platformMarginPct` cannot distinguish an undefined ratio from a genuine zero.

**Regression:** backend 0 · admin-panel 0 · 284 pass / 0 fail / 1,820 assertions across 12 suites.


## Capability 2 delivered (2026-08-30)

| Artifact | Path |
|---|---|
| KPI explainer | `apps/backend/src/services/executive-kpi-explainer.service.ts` |
| Tests (26 / 241) | `apps/backend/src/__tests__/executive-kpi-explainer.integration.test.ts` |

Rules version `exec.kpi.v1`. Comparison DERIVED for `gmv`/`revenue`/`subscriptionRevenue` only,
verified exact against direct queries; refused for `netRevenue`, margin and all balances. No
materiality threshold invented. **Regression: 310 pass / 0 fail / 2,098 assertions, 13 suites.**

New findings: `scoreGrowth` compares unequal spans of a sparse series (`REAL_APPLICATION_DEFECT`);
`dailyTrend` omits zero-GMV days (`DATA_QUALITY_DEFECT`).


## Capability 3 delivered (2026-08-30)

| Artifact | Path |
|---|---|
| Detector + unset policy | `apps/backend/src/services/revenue-anomaly.service.ts` |
| Tests (29 / 78) | `apps/backend/src/__tests__/revenue-anomaly.integration.test.ts` |

Rules version `exec.anomaly.v1`, method `STATISTICAL`, `modelVersion` null.

**Measured first:** 174 payments / 82 days; 65.9% zero-activity; median 0; **MAD 0**; CV 2.85; one
day 5.4x the next. All three candidate baselines (robust, classical, day-of-week) are mathematically
degenerate, so no threshold was invented **and none was requested** — a threshold implies a workable
detector, which the data does not yet support.

Built a detector that measures baseline stability at runtime and refuses when degenerate. Live result:
`UNSTABLE_BASELINE / BASELINE_MAD_ZERO`. `netRevenue` excluded by name. Zero side effects.

**Regression: 339 pass / 0 fail / 2,212 assertions, 14 suites.**


## Capability 4 delivered (2026-08-31)

| Artifact | Path |
|---|---|
| Warning service + unset policy | `apps/backend/src/services/demand-supply-warning.service.ts` |
| Tests (34 / 469) | `apps/backend/src/__tests__/demand-supply-warning.integration.test.ts` |

Rules version `exec.ds.v1`. Comparison shape is checked before values: SCOPE_MISMATCH,
TIME_MISMATCH, DEMAND_FORECAST_STALE, INCOMPARABLE, and one permitted pairing (CURRENT_VS_CURRENT).

**Supply telemetry measured unusable:** 33 of 40 online providers have no `Location` row (82.5%
undercount); the 7 that do are 4.3-71.6 days old; 0 within the 60 s presence window. Supply is
withheld as null rather than shown. Live result: 7/7 zones `SUPPLY_UNAVAILABLE`.

**Forecast proven global:** its only `zone_id` is `"unzoned"`, matching 0 of 7 geofence ids.

**Regression: 373 pass / 0 fail / 2,717 assertions, 15 suites.**


## Capability 5 delivered (2026-08-31)

| Artifact | Path |
|---|---|
| Narrative service | `apps/backend/src/services/finance-narrative.service.ts` |
| Tests (34 / 320) | `apps/backend/src/__tests__/finance-narrative.integration.test.ts` |

Rules version `exec.finance.v1`. Read-only: uses `buildReport()` (verified zero mutations) and
`getLatestReport()`, never `reconcile()` or `validate()` — the latter persists a run row.

**Defect found and fixed:** the informational "Pending Cashback (info)" reconciliation row was being
counted as drift (false `DELTA_PRESENT`, 36,176.80). Now excluded from the drift count while still
displayed. Live result: `CLEAN`.

**Environment resolved:** `homigo_test` had an empty `_prisma_migrations` and 95/97 provider columns;
refreshed from a read-only dump of `homigo_db`. `homigo_db` untouched.

**Regression: 407 pass / 0 fail / 3,181 assertions, 16 suites.**


## Capability 6 delivered (2026-08-31)

| Artifact | Path |
|---|---|
| Narrative service | `apps/backend/src/services/fraud-narrative.service.ts` |
| Tests (35 / 208) | `apps/backend/src/__tests__/fraud-narrative.integration.test.ts` |

Rules version `exec.fraud.v1`.

**No verdict exists to emit:** `FraudAlertStatus` and `PartnerRiskReviewStatus` contain no
CONFIRMED_FRAUD; dispositions are review states. `riskLevel` is quoted (stored enum), never derived.

**Freshness measured, not aged:** a profile is STALE exactly when a signal is newer than
`lastEvaluatedAt` — no age constant exists in the code, because risk evaluation is event-driven.

**Privacy:** no device/IP/user-agent/fingerprint/coordinate column is selected; the raw evidence blob
is never carried. Live PII check: 8/8 absent.

**Live:** 4 partner profiles (1 REVIEW/HIGH/score 53/11 signals still "no conclusion recorded"),
consumer-fraud surface EMPTY and reported. Zero side effects. HIGH_RISK re-verified 0/14 bound.

**Regression: 442 pass / 0 fail / 3,463 assertions, 17 suites.**


## Capability 7 delivered (2026-08-31)

| Artifact | Path |
|---|---|
| Explainer | `apps/backend/src/services/forecast-explainer.service.ts` |
| Tests (36 / 114) | `apps/backend/src/__tests__/forecast-explainer.integration.test.ts` |

Rules version `exec.forecast.v1`. One real forecast function exists (`forecastDemand`, ARIMA_PLUS);
model versions come from the live `mlopsService.registry()` (8 models: 3 TRAINED, 2 PARTIALLY_TRAINED,
3 BLOCKED).

**Three source problems surfaced:** confidence is derived from interval width and clamped (live 0.50 =
the floor); `freshness` is the retrieval time, not generation (Capability-1 comment corrected);
`zone_id = "unzoned"` matches 0 of 7 geofences, so scope is GLOBAL.

**New finding:** the 80% interval is **[-39.12, 136.66]** around a point of 48.7 — negative bookings
are impossible, so the interval is uninformative. Flagged, never truncated.

**Regression: 478 pass / 0 fail / 3,651 assertions, 18 suites.**


## Capability 8 delivered (2026-08-31)

| Artifact | Path |
|---|---|
| Narrative service | `apps/backend/src/services/digital-twin-narrative.service.ts` |
| Tests (36 / 97) | `apps/backend/src/__tests__/digital-twin-narrative.integration.test.ts` |

Rules version `exec.twin.v1`. Scope is **city-level, seven cities** — no zone twin exists, so none is
claimed. An unsupported city is refused outright rather than interpolated.

**Confidence provenance made explicit:** `simulate()` 0.8, `executiveInsights()` 0.85, `cities()` 0.9
are literals; `cityTwin()` 0.6 is derived from upstream confidences. `basis` records which, and
`measured` is false for all — the type has no MEASURED value.

**Silent assumptions published:** `rainStart` -> demand x1.25 and traffic x1.2, `festival` -> x1.6,
conversion `exp(-0.6 * surge change)`. A test reads the twin source so the published table cannot
drift.

**Write distinction stated:** zero business writes, nine telemetry writes; `simulate()` increments
`digital_twin_scenarios_total` and the narrative discloses it.

**Regression: 514 pass / 0 fail across 19 suites, two consecutive clean runs.**


## Capability 9 delivered (2026-08-31)

| Artifact | Path |
|---|---|
| Action service | `apps/backend/src/services/recommended-actions.service.ts` |
| Tests (37 / 295) | `apps/backend/src/__tests__/recommended-actions.integration.test.ts` |

Rules version `exec.actions.v1`. Action taxonomy = the existing `TOOL_CATALOG`; risk levels quoted
from it (`high_risk.finance.refund` -> CRITICAL), never derived here.

**Structural guarantees:** the service imports no executor, performs no write, and does not create
approvals. Binding uses the platform `hashArguments()` — proven to differ across booking id and
amount.

**Live:** 3 actions, all REVIEW_REQUIRED, all amount=null, all toolId=null. Zero anomaly and zero
supply actions because both detectors correctly refuse. `aiToolApproval` count unchanged.

**Human decisions:** no recommendation priority policy exists; no CUSTOMER_COMPENSATION tool or
semantics exist.

**Regression: 551 pass / 0 fail / 4,479 assertions, 20 suites. HIGH_RISK 0/14 bound.**


## Capability 10 delivered (2026-08-31)

| Artifact | Path |
|---|---|
| Verification suite (32 / 77) | `apps/backend/src/__tests__/approval-center.integration.test.ts` |
| Fixture correction | `apps/backend/src/__tests__/helpers/adversarial-fixtures.ts` |

**Nothing was built.** The Approval Center already exists — engine, API and admin screen were built
in Phase 5 and frozen — so this capability is verification, not construction. Reusing it was the
requirement; a second approval engine would have been the failure.

| Reused, not rebuilt | Path |
|---|---|
| Engine | `apps/backend/src/ai-tools/approval/approval-engine.ts` |
| API | `apps/backend/src/routes/ai-tools.routes.ts` (`/approvals`, `/decide`, `/cancel`) |
| Admin screen | `apps/admin-panel/src/app/(console)/ai-brain/approvals/page.tsx` (279 lines) |
| Redaction | `apps/backend/src/ai-tools/security/tool-security.ts` |

**Properties proven against the real engine:** an approval authorises exactly one tool, one actor and
one argument set — four single-field substitutions (booking, customer, larger amount, amount as a
string) are all refused as `APPROVAL_TAMPER`, the same arguments under another tool as
`APPROVAL_WRONG_TOOL`, another actor as `APPROVAL_WRONG_ACTOR`. Expiry is enforced at use, not only
at decision. Rejected, cancelled and still-pending approvals authorise nothing. A requester cannot
decide their own request in either direction. The preview is display-only: rewriting it in the
database changes nothing about what may execute, and instruction-shaped text in a preview or a
decision reason is inert.

**Concurrency proven, with a control.** Ten simultaneous consumptions of one approval yield exactly
one success. The control matters: the same ten-way race against an *unguarded* claim produced
**10 winners of 10**, so the guarded result is the guard working, not the harness serialising.

**Three findings, none repaired here:**

| Finding | Class |
|---|---|
| `stableStringify` does not sort keys — reordered arguments break the binding (fail-closed) | `REAL_APPLICATION_DEFECT`, frozen Phase-5 code |
| `NO_HANDLER` consumes the approval and writes no execution audit row — 10 of 43 live consumed approvals name an execution that does not exist | `REAL_APPLICATION_DEFECT`, frozen Phase-5 code, reproduced |
| Fixture created an approved-but-never-activated partner, and a COMPLETED booking with no `completedAt` | `FIXTURE_DEFECT`, fixed |

**Live, read-only:** 106 approvals — 43 CONSUMED, 25 EXPIRED, 20 APPROVED, 18 CANCELLED, 0 PENDING.
Zero self-approvals, zero reused execution ids, zero CONSUMED rows without an approver. The controls
have held on real data, not only in tests.

**Regression: 585 pass / 0 fail / 5,145 assertions, 23 suites. HIGH_RISK 0/14 bound.**


## Capability 11 delivered (2026-08-31)

| Artifact | Path |
|---|---|
| Schedule boundary | `apps/backend/src/services/executive-report-schedule.config.ts` |
| Report assembly | `apps/backend/src/services/scheduled-executive-report.service.ts` |
| Recipient derivation | `apps/backend/src/services/scheduled-report-recipients.ts` |
| Delivery | `apps/backend/src/services/scheduled-report-delivery.service.ts` |
| Job handler | `apps/backend/src/events/jobs/executive-report.job.ts` |
| Tests (42 / 277) | `apps/backend/src/__tests__/scheduled-reports.integration.test.ts` |

Rules version `exec.report.v1`. **No second scheduler, report engine or delivery system was built** —
asserted by test that none of `setInterval`, `runWithLeaderLock`, `FOR UPDATE`, `SKIP LOCKED`,
`scheduledJob.create` or `cron` appears in the new code.

**P0 found and fixed first.** `registerAllTemplates()` threw because the Item 6/7 templates used
undeclared variables; the throw escaped into `bootstrapWorkflows()`, whose catch returns before
`startOutboxProcessor()` and `startScheduledJobProcessor()`. The outbox and job processor had been
dead for three days. Live recovery verified: outbox 203 → 0 pending (2,195 → 2,422 published), jobs
2,119 → 2,287 completed. No test had ever called that function; one does now.

**Schedule UNSET.** Three decisions owed — schedule, recurrence, timezone. `assertScheduleIsNotBorrowed`
refuses an hour copied from quiet-hours end or from the partner morning brief.

**Recipient security.** `resolveReportRecipients()` takes no arguments; the job payload may name a
period and nothing else (asserted by extracting every `payload.*` read). Four forged payloads change
nothing.

**Delivery.** `routeNotification` only, `executionMode: "SHADOW"` as a literal. Templates carry
counts and a state — never a figure, an address or a free-text summary.

**Live:** 62 items, 1.72 s, state STALE (genuinely stale forecast), zero side effects across eight
tables, 11 recipients derived from RBAC. netRevenue's period defect, the forecast's sub-zero interval
and the anomaly refusal all survive into the report as stated limitations.

**Security finding, reported not changed:** five `AUDIT_LOGS`/`EXPORT` rules are unreachable behind a
broad `GET /api/admin/finance/` prefix rule, so financial exports gate on `PAYMENTS/READ`.
FINANCE_ADMIN (5 admins) holds it; no role holds `AUDIT_LOGS/EXPORT`.

**Regression: 627 pass / 0 fail / 5,880 assertions, 24 suites, two consecutive clean runs.**


## Capability 12 delivered (2026-09-01)

| Artifact | Path |
|---|---|
| HTTP surface (3 GET routes) | `apps/backend/src/routes/admin-intelligence.ts` |
| Route permissions (3 rules) | `apps/backend/src/lib/admin-route-permissions.ts` |
| Route tests (25 / 160) | `apps/backend/src/__tests__/admin-intelligence-routes.integration.test.ts` |
| Brief panel | `apps/admin-panel/src/components/hq/ExecutiveIntelligenceBrief.tsx` |
| Schedule status | `apps/admin-panel/src/components/hq/ScheduledReportStatus.tsx` |
| Render guards | `apps/admin-panel/src/lib/intelligence-render.ts` |
| Admin tests (39 / 604) | `apps/admin-panel/src/lib/__tests__/` |

**Discovery finding:** capabilities 1-11 had **no HTTP route at all** — ten tested services,
unreachable from the console. That, not the UI, was the gap.

**Zero admin routes added.** The brief mounts on the existing `/` dashboard, the schedule status on
the existing `/finance/reports`. A test walks the real route tree: no `-v2`, no `-ai`, all 45 nav
hrefs resolve, none duplicated.

**One request, not eleven** — the backend builds the executive context once. Measured: 61 items in
1,859 ms, one round trip, zero side effects across 10 counters.

**RBAC quoted:** `ANALYTICS`/`READ` (brief, schedule) and `ADMIN_USERS`/`READ` (recipients), all
pre-existing. Six 401/403 cases proven through the real middleware.

**netRevenue defect repaired at the source and verified:** 30-day GMV 21,283 − in-period refunds
2,732 = 18,551, where the old formula gave −10,070.70. Four tests inverted to guard the fix, plus a
new arithmetic test against `getOverview`.

**Three defects fixed in files not written here:** an undefined `mixed` (53 tests down), a
permanently-zero pending-earnings filter, and a surge publisher scan that counted a declaration as a producer.

**Regression: 682 pass / 0 fail / 6,964 assertions, 28 backend suites (two clean runs) · 39 pass /
0 fail, 2 admin suites · both typechecks 0 · admin build exit 0.**
