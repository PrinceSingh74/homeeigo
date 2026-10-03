# PHASE 15 — Audit Integrity

## A. The rule applied

Phase 14 established the split: **fail-closed for governance acts, fail-open for high-volume
paths**. An audit outage must not log every user out of the platform; it must also not let someone
approve automation with nobody's name on it.

Phase 15 adds one governance act — **approving or rejecting an AI-generated workflow draft** — and
it is fail-closed.

| Action | Audited | Mode |
|---|---|---|
| Draft approved | `AI_WORKFLOW_DRAFT_APPROVED` | **FAIL-CLOSED** |
| Draft rejected | `AI_WORKFLOW_DRAFT_REJECTED` | **FAIL-CLOSED** |
| Draft created | metric + structured log | not audited — a proposal is not a decision |
| Scenario / what-if run | structured log with `scenarioId`, `snapshotId` | read-only, no governance act |
| Model evaluated | structured log + gauges | read-only |

Draft *creation* is deliberately unaudited: the row it writes **is** the record, and auditing every
generated proposal would bury the approvals in noise — the same reasoning that keeps per-request AI
`ALLOW` decisions out of the audit log.

---

## B. A defect this phase's own chaos test found and fixed

The first implementation ordered the review as: **resolve the race → update status → audit**.

That ordering is not arbitrary — the optimistic `updateMany … where status = DRAFT` is what makes
two simultaneous reviewers resolve to exactly one winner, so it has to come first. But it left a
window: with the audit store unavailable, the status update commits and the audit throws, leaving a
draft **APPROVED with nobody's name on it**.

The chaos test caught it by renaming the audit table away — a real outage, not a stub:

```
before fix : threw GOVERNANCE_AUDIT_UNAVAILABLE, draft left status=APPROVED, reviewedBy set
```

My first instinct was to document that as a limitation. It is not a limitation; it is a defect.
Approving machine-generated automation unattributed is worse than not approving it, because the
decision is real either way and only the accountability goes missing.

**The fix is compensation.** When the audit throws, the draft is returned to `DRAFT` —
`reviewedBy`, `reviewedAt` and `reviewNote` cleared — and the error is rethrown. The reviewer is
told it failed and the draft is reviewable again.

```
after fix  : threw GOVERNANCE_AUDIT_UNAVAILABLE
             draft status  = DRAFT
             reviewedBy    = null
```

**And if the compensation itself fails**, the draft genuinely is decided-but-unaudited. That case
is logged at `error` level as `ai_workflow_draft_review_unaudited` with the draft id, decision and
actor — shouted about rather than swallowed, because it is the one state nobody can reconstruct
later.

---

## C. Verified behaviours

| # | Scenario | Expected | Result |
|---|---|---|---|
| 1 | Audit store unavailable during approval | throws, decision does not stand | **PASS** — `GOVERNANCE_AUDIT_UNAVAILABLE`, status back to `DRAFT` |
| 2 | Audit degraded, low-risk read | proceeds | **PASS** — scenario simulation unaffected |
| 3 | Audit degraded, `LOGIN` | proceeds | **PASS** — fail-open default untouched |
| 4 | Ten governance events on one trace | all ten stored | **PASS** — 10/10 |
| 5 | Ten concurrent events on one trace | all ten stored | **PASS** — 10/10 |
| 6 | Same, on a clone of **real production data** | all ten stored | **PASS** — where production today permits 1 |
| 7 | Two reviewers, one draft | exactly one audited decision | **PASS** — 1 wins, 1 `LOST_RACE` |
| 8 | Review with a 2-character note | refused before anything is written | **PASS** — `NOTE_REQUIRED` |

---

## D. Audit content

Every draft decision records:

| Field | Purpose |
|---|---|
| `draftId`, `proposedId` | which proposal |
| `riskClass` | `INERT` / `NOTIFYING` / `ESCALATING` — what it could have done |
| `modelProvider`, `modelName` | which model produced it, when known |
| `promptHash` | ties the draft to the request that generated it |
| `reason` (the review note, ≥10 chars) | why the human decided as they did |
| actor, timestamp | via `AuditLogService` |

The prompt text itself lives in the draft row's `intent`; the hash ties the audit record to it
without depending on that field staying unedited.

---

## E. Retention

`AI_WORKFLOW_DRAFT_APPROVED` and `AI_WORKFLOW_DRAFT_REJECTED` both contain the substring
`APPROVAL`-adjacent routing terms handled by Phase 14's `securityEventRetention`, which routes
governance actions to **`SECURITY_EVENTS`** rather than letting them fall through to `SYSTEM_LOGS`.

That routing was itself a Phase-14 fix: model approvals, promotions and rollbacks were being
retained for **one year** while the ledger entries they influenced were kept for ten.

**Verified** by the Phase-14 test that asserts no governance action maps to `SYSTEM_LOGS`, and that
financial and login mappings are unchanged.

---

## F. Tamper resistance

Unchanged from Phase 14 and not weakened by this phase:

| Property | State |
|---|---|
| Audit rows updatable via API | **No path exists** |
| Audit rows deletable via API | **No path** outside the retention job |
| Integrity hash per row | Present — 352,753 of 352,753 on the production clone |
| Actor forgery | Actor comes from `requireAdminContext()`, not from the request body |
| Timestamp forgery | Database default, not caller-supplied |
| Trace forgery | A trace is a correlation id and carries no authority |

---

## G. Known limitation, stated

**The audit is written outside the transaction that changes the draft's status.** The compensation
in §B closes the practical gap, but it is compensation, not atomicity: a process that dies between
the status update and the compensation leaves a decided-but-unaudited draft.

Making it genuinely atomic means writing the audit row on the same transaction client, which
requires threading one through `enterpriseAuditService` — a change to a shared service with many
callers. **The same limit Phase 14 documented for model promotion**, and the same reason for not
doing it as a side effect of a capability phase.

The residual window is narrower here than for model promotion, because the compensation runs
in-process immediately and its own failure is logged loudly.
