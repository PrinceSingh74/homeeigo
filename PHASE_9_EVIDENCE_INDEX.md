# PHASE 9 — Evidence Index

One row per capability: what was built, what proves it, and what a reviewer should re-run to check
the claim themselves. Every figure here was measured; none is estimated.

Last updated 2026-09-01, after Capability 12.

## How to reproduce any row

The Phase-9 suites run against the **isolated** `homigo_p39` database and abort on any other:

```
cd apps/backend
DATABASE_URL="postgresql://postgres:homigo_dev@localhost:5433/homigo_p39" \
  bun test "D:/homigo/apps/backend/src/__tests__/<suite>.ts"
```

Two things about that command are deliberate. The path is **absolute** — `bun test` segfaults on a
relative path to a Prisma-importing file. And each suite runs in **its own process**: all 23 in one
invocation gives unstable counts and cascading `beforeAll` failures, because they share one Postgres
and one Prisma pool.

`homigo_db` is read-only in this phase. No migration was applied to it, and no suite writes to it.

## Capabilities

| # | Capability | Rules version | Service | Suite | Tests / assertions |
|---|---|---|---|---|---|
| 1 | Executive Intelligence Context | `exec.context.v1` | `executive-intelligence.service.ts` | `executive-intelligence.integration.test.ts` | 26 / 143 |
| 2 | KPI Explanations | `exec.kpi.v1` | `executive-kpi-explainer.service.ts` | `executive-kpi-explainer.integration.test.ts` | 26 / 241 |
| 3 | Revenue Anomaly Intelligence | `exec.anomaly.v1` | `revenue-anomaly.service.ts` | `revenue-anomaly.integration.test.ts` | 29 / 78 |
| 4 | Demand / Supply Warnings | `exec.ds.v1` | `demand-supply-warning.service.ts` | `demand-supply-warning.integration.test.ts` | 34 / 469 |
| 5 | Finance Narratives | `exec.finance.v1` | `finance-narrative.service.ts` | `finance-narrative.integration.test.ts` | 34 / 320 |
| 6 | Fraud Narratives | `exec.fraud.v1` | `fraud-narrative.service.ts` | `fraud-narrative.integration.test.ts` | 35 / 208 |
| 7 | Forecast Explanations | `exec.forecast.v1` | `forecast-explainer.service.ts` | `forecast-explainer.integration.test.ts` | 36 / 114 |
| 8 | Digital Twin Narratives | `exec.twin.v1` | `digital-twin-narrative.service.ts` | `digital-twin-narrative.integration.test.ts` | 36 / 97 |
| 9 | Recommended Actions | `exec.actions.v1` | `recommended-actions.service.ts` | `recommended-actions.integration.test.ts` | 37 / 295 |
| 10 | Human Approval Center | *(reused, Phase 5)* | `ai-tools/approval/approval-engine.ts` | `approval-center.integration.test.ts` | 32 / 77 |
| 11 | Scheduled Executive Reports | `exec.report.v1` | `scheduled-executive-report.service.ts` | `scheduled-reports.integration.test.ts` | 42 / 277 |
| 12 | Admin Integration | *(no rules version — a surface, not a rules engine)* | `routes/admin-intelligence.ts` | `admin-intelligence-routes.integration.test.ts` | 25 / 160 |
| 12 | Admin Integration (UI) | — | `admin-panel: components/hq/ExecutiveIntelligenceBrief.tsx` | `admin-panel: src/lib/__tests__/` | 39 / 604 |

Capability 10 built no service. The engine, the `/approvals` routes and the 279-line admin screen at
`ai-brain/approvals` already existed and were frozen in Phase 5; the deliverable is the suite that
proves their guarantees hold.

Capability 11 built no scheduler, report engine or delivery system either — all three exist. It
added a job handler (`events/jobs/executive-report.job.ts`), a recipient resolver, a delivery
adapter over `routeNotification`, and a schedule boundary holding three undecided business
questions open.

## Regression, measured

| After capability | Suites | Pass | Fail | Assertions |
|---|---|---|---|---|
| 1 | 12 | — | 0 | — |
| 4 | 15 | — | 0 | — |
| 5 | 16 | 407 | 0 | 3,181 |
| 8 | 19 | 514 | 0 | — |
| 9 | 20 | 551 | 0 | 4,479 |
| 10 | 23 | 585 | 0 | 5,145 |
| 11 | 24 | 627 | 0 | 5,880 |
| 12 | 28 backend + 2 admin | **682** + **39** | **0** | **6,964** + **604** |

Backend typecheck 0 and admin-panel typecheck 0 at every one of those points. The AI tool catalog is
57 tools — 31 READ, 12 WRITE, 14 HIGH_RISK — with **HIGH_RISK 0 of 14 bound** throughout. No handler
was bound to make any capability appear functional.

## Findings carried forward

| Finding | Capability | Class | State |
|---|---|---|---|
| `netRevenue` period basis undefined | 1 | `HUMAN_DECISION_REQUIRED` | open |
| Margin semantics at zero GMV | 1 | `HUMAN_DECISION_REQUIRED` | open |
| Revenue anomaly threshold not set | 3 | `HUMAN_DECISION_REQUIRED` | open |
| Supply telemetry 82.5% incomplete | 4 | observed | reported, not worked around |
| Derived confidence clamped at its 0.50 floor | 7 | observed | reported with its formula |
| Twin confidences are constants, not measurements | 8 | observed | `measured: false` on every figure |
| No recommendation priority policy | 9 | `HUMAN_DECISION_REQUIRED` | open |
| No CUSTOMER_COMPENSATION tool or semantics | 9 | `HUMAN_DECISION_REQUIRED` | open |
| `stableStringify` does not sort keys | 10 | `REAL_APPLICATION_DEFECT` | referred to freeze owner |
| `NO_HANDLER` consumes an approval and audits nothing | 10 | `REAL_APPLICATION_DEFECT` | referred to freeze owner |
| `registerAllTemplates()` threw, killing the outbox and job processors for 3 days | 11 | `REAL_APPLICATION_DEFECT` | mine, fixed, runtime-verified |
| Five `AUDIT_LOGS`/`EXPORT` route rules unreachable behind a prefix rule | 11 | `SECURITY_DEFECT` | reported; changing it removes access 5 admins use |
| Executive report schedule, recurrence and timezone | 11 | `HUMAN_DECISION_REQUIRED` | open |
| `bunfig.toml` `[test] timeout` is not applied; bun uses a 5 s per-test default | 11 | `HARNESS_DEFECT` | worked around with `--timeout 30000` |
| Capabilities 1-11 had no HTTP route — ten tested services unreachable from Admin | 12 | `REAL_APPLICATION_DEFECT` | fixed: 3 read-only routes added |
| `mixed is not defined` in `executive-intelligence.service.ts` (53 tests down) | 12 | `REAL_APPLICATION_DEFECT` | not mine; fixed |
| `paymentStatus === "pending"` can never match — partner pending earnings always ₹0 | 12 | `REAL_APPLICATION_DEFECT` + `HUMAN_DECISION_REQUIRED` | made explicit; semantics referred |
| `?? 0` fake zeros on the board report page | 12 | `REAL_APPLICATION_DEFECT` | fixed via shared render guards |
| `EarningSettlementStatus` type missing from every database (pending migration 20260902120000) | 12 | `STALE_TYPE_CONTRACT` | applied to `homigo_p39` only; `homigo_db` untouched |
| netRevenue mixed-period defect | 1, 5, 11 | **RESOLVED** | repaired at source; verified 21,283 − 2,732 = 18,551; guarded by a new arithmetic test |

## Live observations, all read-only against `homigo_db`

| Capability | Observation |
|---|---|
| 9 | 3 actions, all REVIEW_REQUIRED, all `amount: null`, all `toolId: null`; `aiToolApproval` unchanged at 106 |
| 12 | Executive brief through the real route: 61 items, 1,859 ms, one request, zero side effects across 10 counters; netRevenue now OK, margin still flagged for zero-GMV; 11 recipients derived from RBAC |
| 11 | One report: 62 items, 1.72 s, state STALE, zero side effects across 8 tables, 11 recipients derived from RBAC; netRevenue / forecast / anomaly defects all carried through as stated limitations |
| 10 | 106 approvals — 43 CONSUMED, 25 EXPIRED, 20 APPROVED, 18 CANCELLED, 0 PENDING; 0 self-approvals; 0 reused execution ids; 0 CONSUMED rows without an approver; 33 of 43 consumed execution ids match an audit row |
