# PHASE 15 — Production Checklist

| Status | Meaning |
|---|---|
| `DEVELOPMENT_VERIFIED` | Implemented, integrated and proven by execution in development |
| `STAGING_VERIFIED` | Proven on the staging stack |
| `PRODUCTION_VERIFIED` | Proven against production state |
| `PRODUCTION_DEPLOYMENT_REQUIRED` | Built and verified; not live |
| `BLOCKED` | Cannot proceed — reason stated |

---

## A. The blocker is not Phase-15 work

Phase 15 cannot be production-operational because **production is 10 migrations behind**, spanning
Phases 11, 12 and 14. Measured directly against `homigo_db`:

| Missing in production | Phase | Consequence for Phase 15 |
|---|---|---|
| `20260906090000_ml_model_governance` | 12 | **No model registry exists.** No Phase-15 model could be governed there |
| `20260907090000_phase14_governance` | 14 | **No spend cap.** Budget enforcement degrades to `BUDGET_UNAVAILABLE` |
| `20260907090100_audit_trace_not_unique` | 14 | **Audit holds one event per trace.** Approval + promotion is exactly the pair lost |
| `20260907090200_retention_categories` | 14 | Telemetry retention cannot run |
| `20260904090000_knowledge_base` | 11 | RAG tables absent |
| `20260905090000_knowledge_authority` | 11 | Knowledge authority absent |
| + 4 others | 6E′, 10, infra, partner | — |

**Deploy order:** the ten outstanding migrations first, then Phase-15's one. Phase-15 schema has no
dependency on them, but deploying it first would mean draft approvals writing governance audit rows
into a log that still holds only one per trace.

---

## B. Phase-15 migration

| Migration | Contents | Risk |
|---|---|---|
| `20260908090000_phase15_workflow_drafts` | 2 enums, 1 table, 2 indexes | **Additive only.** No existing table or column touched |

Applied to `homigo_p39` and `homigo_test`. **Not applied to production or staging.**

Post-deploy verification:

```sql
SELECT count(*) FROM information_schema.tables WHERE table_name = 'ai_workflow_drafts';
-- expect 1

SELECT count(*) FROM pg_type WHERE typname IN ('ai_workflow_draft_status','ai_workflow_risk_class');
-- expect 2

SELECT count(*) FROM ai_workflow_drafts;
-- expect 0 — an empty proposal table is the correct initial state
```

---

## C. Capability status

| # | Capability | Development | Staging | Production | Blocker |
|---|---|---|---|---|---|
| 1 | Voice AI | **not built** | — | — | `BLOCKED` — no TTS/STT adapter, no streaming, no voice policy |
| 2 | Multimodal assistant | `DEVELOPMENT_VERIFIED` | not deployed | **`PRODUCTION_DEPLOYMENT_REQUIRED`** | Phase-14 governance not deployed |
| 3 | Recommendation ML | **not built** | — | — | `BLOCKED_BY_DATA` — 30 customers with repeat behaviour |
| 4 | Fraud ML | **not built** | — | — | `BLOCKED_BY_DATA` — 9 labels |
| 5 | Scenario simulation | `DEVELOPMENT_VERIFIED` | not deployed | **`PRODUCTION_DEPLOYMENT_REQUIRED`** | Code only; no schema needed |
| 6 | Executive what-if | `DEVELOPMENT_VERIFIED` | not deployed | **`PRODUCTION_DEPLOYMENT_REQUIRED`** | Code only |
| 7 | AI workflow drafting | `DEVELOPMENT_VERIFIED` | not deployed | **`PRODUCTION_DEPLOYMENT_REQUIRED`** | Needs §B migration |
| 8 | Predictive operations | `DEVELOPMENT_VERIFIED` | not deployed | **`PRODUCTION_DEPLOYMENT_REQUIRED`** | Code only; **and should not serve** — see §E |

---

## D. Pre-deployment verification

| # | Check | Result |
|---|---|---|
| 1 | Backend typecheck | **0 errors from Phase-15 code** |
| 2 | Phase-15 test suite | **29 pass / 0 fail** |
| 3 | Provider-bypass guard proven by deletion | **PASS** — fails when the bypass returns |
| 4 | ACTION-step guard proven by removal | **PASS** — fails when ACTION is allowed |
| 5 | Simulation write isolation | **PASS** — booking/payment/ledger counts unchanged |
| 6 | Concurrent draft review | **PASS** — 1 wins, 1 `LOST_RACE` |
| 7 | RBAC entries mapped | **PASS** — 4 added; unmapped admin routes deny by default |
| 8 | Migration applied to isolated DBs only | **PASS** — `homigo_p39`, `homigo_test` |
| 9 | `homigo_db` writes | **none** — read-only throughout |

---

## E. Things deployment does NOT do

- **It does not serve any model.** The cancellation candidate is offline. Its advantage over the
  baseline rule is 0.24 standard errors, and `materiallyBetter` is `false`. Promoting it would be
  promoting a coin flip.
- **It does not let AI create workflows.** An approved draft still needs a developer to commit the
  code definition. There is no API that activates one.
- **It does not change existing behaviour.** Every new route is additive and admin-gated; nothing
  on a customer or partner path changes.
- **It adds no feature flag**, because there is no traffic to gate. Adding one would imply a
  rollout decision nobody has to make.

---

## F. Rollback

| Capability | Rollback |
|---|---|
| Simulation / what-if | Remove the two routes. The underlying `/simulate` route is untouched and keeps its original consumers |
| Workflow drafting | Remove the routes. The table can stay — it holds proposals, not state anything depends on |
| Cancellation evaluation | Remove the route. Nothing consumes the model |
| Migration | `DROP TABLE ai_workflow_drafts; DROP TYPE ai_workflow_draft_status, ai_workflow_risk_class;` — safe while no draft is being relied on as a record |

No Phase-15 change is on a path that would be mid-flight during a rollback.

---

## G. Outstanding, by owner

| # | Item | Owner | Type |
|---|---|---|---|
| 1 | Apply the 10 outstanding migrations | Release | **PRODUCTION_DEPLOYMENT_REQUIRED** |
| 2 | Apply `20260908090000_phase15_workflow_drafts` | Release | **PRODUCTION_DEPLOYMENT_REQUIRED** |
| 3 | Staging rehearsal of both | Release | Recommended before production |
| 4 | TTS/STT provider + streaming transport decision | Architecture | **EXTERNAL_DEPENDENCY** |
| 5 | Voice consent + recording-retention policy | Legal | **LEGAL_DECISION_REQUIRED** |
| 6 | Whether to register the cancellation candidate | ML owner | **HUMAN_DECISION_REQUIRED** |
| 7 | Backtesting store for simulation validation | Engineering | **FOLLOW_UP** |
| 8 | Repeat-booking depth | Business | **DATA_BLOCKER** |
| 9 | Adjudicated fraud outcomes | Trust & Safety | **DATA_BLOCKER** |

Only items 1 and 2 stand between Phase 15 and production, and item 1 is not Phase-15 work.
