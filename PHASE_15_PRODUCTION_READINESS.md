# PHASE 15 — Production Readiness

**Verdict: `PHASE_15_BLOCKED_BY_PRODUCTION_MATURITY`.**

Not because Phase-15 work is incomplete, but because the governance foundation it sits on has never
been deployed. This was measured directly against `homigo_db` before any Phase-15 code was written,
as §2 requires.

---

## A. The gate, measured

Every row is a live query against production, not a claim carried forward from a prior report.

| # | Prerequisite | Expected | Production | Result |
|---|---|---|---|---|
| A | Audit `trace_id` no longer UNIQUE | 0 unique indexes | **1** (`enterprise_audit_logs_trace_id_key`) | **FAIL** |
| B | Multiple governance events per trace possible | > 1 | **max = 1** | **FAIL** |
| C | `ai_tool_policy_logs.policy_version` present | 1 column | **0** | **FAIL** |
| D | Approval→promotion trace preservation | possible | impossible while (A) holds | **FAIL** |
| E | Governed audit fail-closed | code deployed | code not deployed | **FAIL** |
| F | AI budget enforcement | 2 tables | **0** | **FAIL** |
| G | AI rate limiting | present | present (pre-Phase-14) | **PASS** |
| H | Direct-provider bypass protection | vision governed | code not deployed | **FAIL** |
| I | PII log scrubbing | deployed | code not deployed | **FAIL** |
| J | Retention categories | 3 enum values | **0** | **FAIL** |
| K | Workflow governance | 25 definitions | **25** | **PASS** |
| L | Rollback governance | `ml_model_versions` | **table absent** | **FAIL** |
| M | DR readiness | scripts exist | scripts exist; no production drill | **PARTIAL** |
| N | Event replay safety | outbox + receipts | present | **PASS** |
| O | Model promotion governance | registry | **table absent** | **FAIL** |
| P | Observability | Prometheus/Grafana | present | **PASS** |
| Q | Alerting | 20 rules | present, thresholds unset | **PARTIAL** |
| R | Migration state | current | **10 behind** | **FAIL** |
| S | Runtime/version consistency | code == schema | code ahead of schema | **FAIL** |

**11 FAIL, 2 PARTIAL, 4 PASS.**

---

## B. Root cause — one, not many

Production is **10 migrations behind**, spanning three phases:

```
20260609130000_baseline_repair_db_push_drift      (infrastructure)
20260817110000_notification_delivery_claim        (Phase 6E')
20260903090000_support_ai_recommendations         (Phase 10)
20260904090000_knowledge_base                     (Phase 11 — RAG)
20260905090000_knowledge_authority                (Phase 11 — RAG)
20260906090000_ml_model_governance                (Phase 12 — MODEL REGISTRY)
20260907090000_phase14_governance                 (Phase 14 — budget, policy version)
20260907090100_audit_trace_not_unique             (Phase 14 — THE AUDIT DEFECT)
20260907090200_retention_categories               (Phase 14 — retention)
20260907100000_partner_lifecycle_verified         (partner)
```

Everything in §A follows from this single fact. There is no separate Phase-15 production defect.

**Three consequences worth naming plainly:**

1. **There is no model registry in production.** `ml_model_versions` and `ml_shadow_predictions` do
   not exist, so no model could be governed there even if one were ready to promote.
2. **There is no spend cap in production.** `ai_budget_policies` does not exist, so the enforcement
   path degrades to `BUDGET_UNAVAILABLE` — permissive by design and correct as a failure mode, but
   not a control.
3. **The audit log still holds at most one governance event per request.** An approval and the
   promotion it authorises share a trace, so that pair is exactly what is lost.

---

## C. What Phase 15 did about it

Nothing to production, deliberately. §26 and §2 both forbid mutating production to make a phase
pass, and §78 forbids claiming production maturity that does not exist.

| Action | Taken |
|---|---|
| Applied any migration to production | **No** |
| Wrote to `homigo_db` | **No** — read-only queries throughout |
| Claimed any capability production LIVE | **No** |
| Continued unblocked engineering | **Yes** — capabilities 5, 6, 7, 8 built in development |

---

## D. Phase-15 production requirements, once the gate clears

One additive migration, and it is not urgent.

| Migration | Contents | Risk |
|---|---|---|
| `20260908090000_phase15_workflow_drafts` | 2 enums, 1 table, 2 indexes | **Additive only.** Touches no existing table or column |

**Deployment order:** after the ten outstanding migrations. It has no dependency on them, but
deploying Phase-15 schema ahead of the Phase-14 audit fix would mean draft approvals writing
governance audit rows into a log that can still only hold one per trace.

Phase-15 **application** code degrades safely without its table: the drafting routes fail on a
missing relation, which is a visible error rather than a silent one. The simulation service needs
no schema at all.

---

## E. Environment status — stated separately, never collapsed

| Environment | Phase-15 state | Evidence |
|---|---|---|
| **Development** | **OPERATIONAL** | 3 services integrated, routed, RBAC-mapped; 29/29 tests |
| **Test** (`homigo_test`) | **OPERATIONAL** | Migration applied; suite green |
| **Staging** | **NOT DEPLOYED** | No migration, no code |
| **Production** | **NOT DEPLOYED — BLOCKED** | Gate fails on 11 of 19 prerequisites |

"Operational" means integrated and working in development. It is not "production LIVE", and this
phase does not use the two as synonyms.

---

## F. Feature-flag / release posture

No Phase-15 capability is on a customer-facing path:

| Capability | Reachability | Default posture |
|---|---|---|
| Scenario simulation | `requireRole("ADMIN")` | Admin-only; read-only |
| Executive what-if | `requireRole("ADMIN")` | Admin-only; read-only |
| Workflow drafting | `/api/admin`, RBAC-mapped | Admin-only; produces drafts that cannot execute |
| Cancellation model | `/api/admin`, `ANALYTICS/READ` | Offline evaluation; **not serving** |

No traffic flip is required to deploy any of them, and none changes existing behaviour. A feature
flag was not added because there is no traffic to gate — adding one would imply a rollout decision
nobody has to make.

---

## G. Remaining work, by owner

| # | Item | Owner | Type |
|---|---|---|---|
| 1 | Apply 10 outstanding migrations to production | Release | **PRODUCTION_DEPLOYMENT_REQUIRED** |
| 2 | Apply `20260908090000_phase15_workflow_drafts` | Release | **PRODUCTION_DEPLOYMENT_REQUIRED** |
| 3 | Decide TTS/STT provider + streaming transport | Architecture | **EXTERNAL_DEPENDENCY** |
| 4 | Voice consent and recording-retention policy | Legal | **LEGAL_DECISION_REQUIRED** |
| 5 | Whether to register the cancellation candidate at all | ML owner | **HUMAN_DECISION_REQUIRED** |
| 6 | Backtesting store for simulation validation | Engineering | **FOLLOW_UP** |
| 7 | Repeat-booking depth for recommendation | Business | **DATA_BLOCKER** |
| 8 | Adjudicated fraud outcomes | Trust & Safety | **DATA_BLOCKER** |

Items 1 and 2 are the only ones that stand between Phase 15 and production, and item 1 is not
Phase-15 work.
