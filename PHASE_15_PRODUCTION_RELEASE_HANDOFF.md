# PHASE 15 — Production Release Handoff

# STATUS: `RELEASE_BLOCKED_AUTHORIZATION`

Secondary blockers, in the order they must be cleared: `RUNTIME`, then `DATA_RECONCILIATION`.

Every engineering blocker that could be resolved safely has been resolved. What remains is three
decisions and one deployment that only a human with production access can make.

**All facts below were re-measured for this handoff. Nothing is carried forward on trust.**

---

## A. Authorization — searched exhaustively, absent

| Where | Result |
|---|---|
| Shell environment | 0 matches |
| Repository authorization files | none |
| Codebase convention (`PRODUCTION_MIGRATION_AUTHORIZED`, `ALLOW_PRODUCTION`, `CONFIRM_PRODUCTION`, `--force-production`) | 0 matches |
| CI/CD workflows | `ci.yml`, `e2e.yml`, **`staging-deploy.yml`** |
| GitHub environments | **`staging` only** — no `production` environment, so no approval gate exists |
| Secret manager | `lib/secrets.ts` exists, but it fetches runtime secrets; it is not a release gate |

`staging-deploy.yml` states it in its own header comment:

```
# Manual staging deployment — pins exact commit SHA. Does NOT deploy production.
```

**There is no production deployment path in this repository.** That is not an oversight I should
route around; it is the boundary.

---

## B. Production, re-measured

```
application ports listening : 0
applied migrations          : 97   (100 ledger rows, 3 rolled back)
public tables               : 203
trace_id unique             : true      <- Phase-14 blocker still live
ml_model_versions           : ABSENT
ai_budget_policies          : ABSENT
slot ranges half-open       : false
feature flags               : 2 total, 0 with environment='production'
```

---

## C. Schema reconciliation — object level, not migration count

Production diffed against a clone with the full release applied:

| | Production | Target | Delta |
|---|---|---|---|
| Tables | 203 | 212 | **+9** |
| Columns | — | — | **+163, and 0 removed** |
| Indexes | 853 | 889 | +36, **−1** |
| Foreign keys | 161 | 165 | +4 |

**New tables:** `ai_budget_policies`, `ai_budget_windows`, `ai_workflow_drafts`,
`knowledge_authority_rules`, `knowledge_chunks`, `knowledge_documents`, `ml_model_versions`,
`ml_shadow_predictions`, `support_ai_recommendations`.

**Exactly one index is dropped: `enterprise_audit_logs_trace_id_key`** — the intended audit fix, and
nothing else. No column is removed anywhere. The release is additive apart from that single
deliberate drop.

---

## D. Audit integrity — proven at runtime, both directions

**Production today**, read-only, across all 353,220 audit rows:

```sql
SELECT max(c) FROM (SELECT count(*) c FROM enterprise_audit_logs
                    WHERE trace_id IS NOT NULL GROUP BY trace_id) t;   -- 1
```

No trace has ever held more than one event. The governance chain physically cannot be recorded.

**On the migrated clone**, the same chain inserted for real:

```
MODEL_APPROVAL -> MODEL_PROMOTION -> MODEL_ROLLBACK -> WORKFLOW_ACTIVATION
inserted 4/4 · persisted on one trace: 4 · PASS
```

The fix works, and it is the migration that delivers it.

---

## E. ML registry and AI budget — target shapes verified

`MlModelStage`: `TRAINING, TRAINED, EVALUATED, CANDIDATE, SHADOW, APPROVED, PRODUCTION,
ROLLED_BACK, REJECTED, RETIRED` — a superset of the required lifecycle.

`ml_model_versions` carries the governance fields that matter, not just state:
`beats_baseline`, `baseline_name`, `approved_by`, `approval_note`, `rolled_back_by`,
`rolled_back_reason`, `superseded_version_id`.

`ai_budget_windows`: `reserved_usd`, `settled_usd`, `request_count`, **`unknown_cost_requests`** —
reserve-then-settle accounting with an explicit column for spend that cannot be priced, rather than
a fabricated zero.

---

## F. The release blocker this pass found and fixed

**No Phase-15 capability was behind a feature flag.** Measured:

```
scenario-simulation.service    evaluateFlag calls: 0
ai-workflow-draft.service      evaluateFlag calls: 0
cancellation-risk.service      evaluateFlag calls: 0
provider-acceptance.service    evaluateFlag calls: 0
```

The brief requires progressive rollout through DRAFT → SHADOW → CONTROLLED → PRODUCTION. With no
flag, the only available states were "unreachable" and "on for everyone" — **a canary was not
possible, at all.** That is a release blocker in code, not a configuration gap.

**Fixed.** Two keys now gate the two production-facing capabilities:

| Flag | Gates | Behaviour with no flag row |
|---|---|---|
| `PHASE15_SCENARIO_SIMULATION` | `scenarioSimulationService.simulate` | refuses — `SIMULATION_DISABLED:FLAG_MISSING` |
| `PHASE15_AI_WORKFLOW_DRAFTING` | `aiWorkflowDraftService.createDraft` | refuses — `WORKFLOW_DRAFTING_DISABLED:FLAG_MISSING` |

`evaluateFlag` fails closed, so **both capabilities are OFF in production until an operator creates
and enables the flag.** No deploy is needed to switch either off again.

The gate sits on draft *creation*, not on `validate` or `review`: turning drafting off should stop
new drafts, not strand ones already awaiting a human decision.

**Verified by three tests that fail if the gate is removed** — one per capability proving refusal
while disabled, and one proving an absent flag returns `FLAG_MISSING` rather than defaulting open.

### An operational detail found while testing this

Flag decisions are cached for 30 seconds in memory and in Redis. Flipping a flag in the database is
therefore **not** immediate — `invalidateFlagCache(key)` exists and publishes on a Redis channel to
fan the invalidation out across instances. **A kill switch used without that call takes up to 30
seconds to bite.** The runbook must call it; the tests now do.

---

## G. Regression after all changes

```
half 1 : 1152 pass / 1 fail   (batch-order flake — the file passes 1/1 in isolation)
half 2 :  849 pass / 0 fail
Phase-15 suite : 55 pass / 0 fail   (52 + 3 new release-gate tests)
deadlocks : 0
```

---

## H. What is handed over, and to whom

| # | Blocker | Owner | Prepared |
|---|---|---|---|
| 1 | **Production authorization** | Release owner | Nothing to prepare — it is a decision |
| 2 | **Deploy a runtime** | SRE | `Dockerfile`, `service.yaml`, systemd unit all ready; **one deployable unit**, not four |
| 3 | **Create production feature flags** | Release owner | Exact keys, defaults and rollback states in `PHASE_15_PRODUCTION_FLAGS_FINAL.md` |
| 4 | **Fixture data reconciliation** | Ledger/Finance owner | Record-level map in `PHASE_15_PRODUCTION_DATA_RECONCILIATION.md` |

**Item 4 is the one that is not an engineering decision.** 14 CREDITED earnings have already moved
provider wallet balances; removing them requires either a compensating adjustment or a determination
that those balances were never real. Whoever owns the ledger makes that call. Everything up to the
decision is prepared and reversible.

---

## I. Execution order, when the boundary clears

1. Backup + **verified restore** (the drill passes today at RTO 25.64 s — re-run it against the day's data).
2. Re-clone production, re-run `prisma migrate deploy`, re-time it.
3. Apply the 12 migrations; schedule the `bookings` GiST rebuild in a maintenance window.
4. Verify post-deploy invariants with **direct SQL**, not logs.
5. Build and deploy the image; start the single runtime.
6. Confirm `/health`, then that the scheduled-job processor and event consumers logged their start.
7. Create the two Phase-15 flags **disabled**, then enable one, for a small cohort, and watch.
8. Reconcile the fixture data with its authorized owner before trusting any production figure.

Steps 1–4 are rehearsed. Steps 5–8 require the runtime and the decisions above.
