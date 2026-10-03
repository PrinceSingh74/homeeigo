# PHASE 15 — Failure and Chaos

Failures were injected, not simulated. Where a dependency had to be removed, it was genuinely
removed — a renamed table, a killed process — because a stubbed failure tests the stub.

**Environment:** `homigo_test` and `homigo_p39`. `homigo_db` was read-only throughout.

---

## A. Injected failures

| # | Dependency | Method | Expected | Result |
|---|---|---|---|---|
| 1 | Audit store | `ALTER TABLE enterprise_audit_logs RENAME TO …` | Governance act refuses | **PASS** — throws `GOVERNANCE_AUDIT_UNAVAILABLE`; **found a real defect**, see §B |
| 2 | Audit store | same, during a low-risk read | Read proceeds | **PASS** — scenario simulation unaffected |
| 3 | Audit store | same, during `LOGIN` | Proceeds | **PASS** — fail-open default intact |
| 4 | Drafts table | `ALTER TABLE ai_workflow_drafts RENAME TO …` | Visible failure | **PASS** — throws rather than returning a fabricated draft id |
| 5 | Notification registry empty | no `ACTIVE` templates | Warn or refuse, never silently accept | **PASS** — `NOTIFICATION_TYPE_UNKNOWN` / `NOTIFICATION_REGISTRY_EMPTY` |
| 6 | Condition registry empty | unbooted process | Refuse every draft | **PASS** — fails closed; the suite asserts non-empty allowlists first so this cannot masquerade as success |
| 7 | Twin snapshot unreadable | `.catch(() => null)` path | Freshness `UNKNOWN`, never "fresh" | **PASS** — `basis: "UNKNOWN"`, `observedAt: "UNKNOWN"` |
| 8 | Thin evaluation holdout | `evaluate(0.01)` | Refuse to score | **PASS** — `DATA_INSUFFICIENT`, names the holdout |
| 9 | Backend against migrated production clone | full boot | Clean start | **PASS** — 0 error lines, workflow fingerprint gate passed |

---

## B. The defect chaos testing found

Test 1 did not merely confirm expected behaviour — it exposed a real ordering defect.

The review path was: **resolve the race → update status → audit**. The optimistic
`updateMany … where status = DRAFT` must come first, because it is what makes two simultaneous
reviewers resolve to one winner. But that left a window where the status commits and the audit
throws:

```
before : threw GOVERNANCE_AUDIT_UNAVAILABLE
         draft status = APPROVED, reviewedBy set, NO audit row
```

A draft approved with nobody's name on it. My first instinct was to document it as a limitation;
it is a defect, because the decision is real either way and only the accountability disappears.

**Fixed by compensation:** on audit failure the draft is returned to `DRAFT` with `reviewedBy`,
`reviewedAt` and `reviewNote` cleared, and the error rethrown.

```
after  : threw GOVERNANCE_AUDIT_UNAVAILABLE
         draft status = DRAFT, reviewedBy = null
```

If the compensation itself fails, that state is logged at `error` as
`ai_workflow_draft_review_unaudited` — the one case nobody could reconstruct later, so it is
shouted about rather than swallowed.

---

## C. Concurrency

| # | Scenario | Expected | Result |
|---|---|---|---|
| 1 | Two reviewers, one draft, `Promise.all(APPROVE, REJECT)` | Exactly one wins | **PASS** — 1 succeeds, 1 `LOST_RACE`, one terminal state |
| 2 | Second review of an already-decided draft | Refused | **PASS** — `ALREADY_REVIEWED` |
| 3 | Ten concurrent audit writes on one trace | All ten stored | **PASS** — 10/10 |
| 4 | 30 concurrent budget reservations against a cap for 5 | Cap holds exactly | **PASS (Phase 14)** — committed `$0.138000` = limit |

Decided by optimistic conditional update carrying the observed state — the same discipline Phase 14
used for workflow recovery, reused rather than reinvented.

---

## D. Idempotency

| Operation | Repeatable safely? | Mechanism |
|---|---|---|
| Scenario simulation | **Yes** — same inputs + same snapshot ⇒ same `scenarioId` and same output | Deterministic; reads only |
| Executive what-if | **Yes** | Same engine |
| Draft creation | **Intentionally not** — each call is a distinct proposal | A resubmitted intent is a second proposal, and hiding that would lose evidence |
| Draft review | **Yes** — second attempt returns `ALREADY_REVIEWED` | Optimistic status guard |
| Model evaluation | **Yes** — deterministic given the same data | No stored state |

---

## E. Failure modes that cannot produce a fabricated success

| Condition | What is returned |
|---|---|
| Twin unreadable | `dataFreshness.basis: "UNKNOWN"` — never a fresh-looking timestamp |
| Registries empty | Every draft refused — never silently accepted |
| Holdout too thin | `DATA_INSUFFICIENT` — never metrics computed on a handful of positives |
| Provider unpriced | `UNPRICED_PROVIDER` (Phase 14) — never cost `0` |
| Model advantage inside noise | `materiallyBetter: false` — never a bare `beatsBaseline: true` |
| Audit unavailable on a governance act | Throws and compensates — never a silent approval |

**No Phase-15 path converts an unavailable dependency into a confident answer.**

---

## F. Not tested, and why

Stated rather than implied:

- **Provider failure on Phase-15 paths.** Capabilities 5, 6 and 8 make **no provider call** —
  simulation is arithmetic and the model is logistic regression computed in-process. There is no
  provider to break. Capability 7 accepts a draft from whatever generated it.
- **Load and sustained concurrency.** Simulation is a cached read and drafting is a single insert;
  neither is on a traffic-serving path. A synthetic benchmark would be less honest than saying so.
- **Voice / recommendation / fraud failure modes.** Those capabilities were not built.
- **Production chaos.** Nothing was run against production; the maturity gate fails.

---

## G. Verdict

| Area | Result |
|---|---|
| Dependency failure handling | **PASS** — 9 injected failures, all behave correctly |
| Governance fail-closed | **PASS** — and a real defect was found and fixed |
| Fail-open scoping | **PASS** — low-risk reads and `LOGIN` unaffected |
| Concurrency | **PASS** — exactly one winner, no lost updates |
| Idempotency | **PASS** — where applicable; non-idempotent case is deliberate and explained |
| Fabricated-success resistance | **PASS** — six failure modes each return an honest state |
