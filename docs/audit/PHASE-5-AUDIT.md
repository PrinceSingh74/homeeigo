# Phase 5 Audit — Tool & Action Layer

**Functional score: 90%** · **Release integrity: BROKEN** · **HEAD:** `b582ead` · Audit-only

## Summary

Functionally the best-engineered layer in the platform — the safety model is not only complete but exceeds the roadmap in two places. It is also **entirely absent from version control**, which is a P0 blocker independent of code quality.

## Runtime Evidence

```
tool registry:    55 tools
executions:       { SUCCESS: 13188, FAILED: 46, DENIED: 115 }
approvals:        10
policy logs:      13310
```

`DENIED: 115` matters — it proves the policy engine is actively refusing calls, not decorating them.

## Roadmap Tool Coverage — complete

**Read tools (9 required):** `getBooking`, `getBookingStatus`, `getWallet`, `getProviders`, `getServices`, `getWeather`, `getForecast`, `getEarnings` (as `getPartnerEarnings`), `getFraudSummary` — all present, plus ~20 more (`getSubscription`, `getTraffic`, `getETA`, `getDemand`, `getSupply`, `getOperations`, `getRevenue`, …).

**Controlled write tools (4 required):** `createBooking`, `rescheduleBooking`, `cancelBooking`, `createSupportTicket` — all present, all `riskLevel: MEDIUM`, all bound to ownership policies (`customer.ownership`).

**High-risk tools (6 required):** all present plus 8 more —

| Roadmap | Tool ID |
|---|---|
| Refund | `high_risk.finance.refund` |
| Payout | `high_risk.finance.payout` |
| Settlement | `high_risk.finance.settlement` |
| Wallet adjustment | `high_risk.finance.walletAdjustment` |
| Ledger change | `high_risk.finance.ledgerEntry` |
| Account freeze | `high_risk.compliance.accountFreeze` |

Extras: `financeApproval`, `partnerSuspend`, `customerBan`, `roleEscalation`, `featureFlagChange`, `secrets`, `configuration`, `infrastructure`.

All carry `riskLevel: CRITICAL`, `approvalRequired: true`, `auditRequired: true`, `maxRetries: 0`.

## The Safety Chain — verified

The roadmap's core principle is *AI Recommendation → Policy/Rules → Human Approval → Existing Service*. Each link was verified in source:

1. **Policy** — `evaluatePolicy()` runs before any handler. Decision `REQUIRES_APPROVAL` short-circuits execution (`execution-engine.ts:179-212`): an approval record is created, an audit row written with `status: PENDING_APPROVAL`, and the call returns without touching the service. **AI cannot execute a high-risk action.**

2. **Human approval** — `approval-engine.ts` enforces:
   - **Expiry** (`:33-38`) — expired approvals flip to `EXPIRED` and throw `APPROVAL_EXPIRED`
   - **Self-approval denial** (`:40-42`) — `requestedBy === approverId` throws `SELF_APPROVAL_DENIED`
   - **Stale sweeper** (`:94-97`) — `expireStaleApprovals()`

3. **Tamper protection** — beyond the roadmap: `execution-engine.ts:219-221` re-hashes the arguments at execution time and compares against the approved hash, throwing `APPROVAL_TAMPER` on mismatch. This closes the approve-then-swap attack, which many approval systems miss.

4. **Service reuse** — every tool declares a `serviceMapping` (e.g. `finance.service.refund`), routing through existing services rather than bypassing to the data layer.

## Other Requirements

**Tool metadata/schemas — IMPLEMENTED.** Version, owner, `requiredPermission`, `requiredRole`, `requiredPolicy`, `riskLevel`, typed parameters, `validationSchema`, `timeoutMs`, `maxRetries`, `costEstimateUsd`, `status`.

**Audit with hashing — IMPLEMENTED.** `hashArguments` / `hashResult` — arguments and results are hashed rather than stored raw, which is the right privacy posture.

**Idempotency — IMPLEMENTED.** `idempotencyKey` threaded through execution and audit.

**Circuit breaker — NOT_VERIFIED.** Present in the AI router; not evidenced in tool execution.

**Metrics / alerts / dashboard / UI — IMPLEMENTED.** `lib/ai-tools-metrics.ts`; **6** distinct `ai_tool` alert references (best coverage of any phase); `homigo-ai-tools.json` present in `_obsstack/dashboards/` — the **only** new-phase dashboard actually mounted in the running Grafana; `/ai-brain/tools` admin page.

## Release Integrity — BROKEN (P0-1)

```
git ls-files apps/backend/src/ai-tools/        ->  0 files
git status                                     ->  ?? apps/backend/src/ai-tools/
migration 20260807200000_phase5_ai_tools       ->  NOT TRACKED
```

Also untracked: `routes/ai-tools.routes.ts`, `lib/ai-tools-metrics.ts`, `__tests__/ai-tools.test.ts` — 39 files under `src` in total.

HEAD's `index.ts` contains **no** ai-tools reference, so HEAD is internally self-consistent as a Phase 0–4 build. The working tree's `index.ts` wires Phase 5 at lines 39, 211, 310, 313. Consequence: **the running system — 13,188 executions — is serving from code that exists at no commit**, and a clone of HEAD produces a platform with no tool layer.

No Phase 5 certification can reference a SHA until this is committed.

## Gaps

| ID | Gap | Priority |
|---|---|---|
| P0-1 | Entire phase untracked in git, including migration | **P0** |
| — | Tool-execution circuit breaker unverified | P2 |
