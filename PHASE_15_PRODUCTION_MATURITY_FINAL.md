# PHASE 15 — Production Maturity, Final

**Re-verified from zero in the remediation pass.** Every figure below was re-measured against
`homigo_db`, not carried forward. The state is unchanged: **100 applied, 107 on disk**.

Performed from zero against `homigo_db`. No prior report was trusted, and one hypothesis formed
during this audit turned out to be **wrong** — that correction is recorded in §D because it
materially changes the deployment plan.

**Date:** 2026-09-05. **Production was read, never written.**

---

## A. Migration state

| Measure | Value |
|---|---|
| Migrations on disk | **107** |
| Applied in production | **100** |
| Recorded with `finished_at IS NULL` | **3** |
| **Missing from production** | **11** |

### The 11 missing, in dependency (timestamp) order

| # | Migration | Phase |
|---|---|---|
| 1 | `20260609130000_baseline_repair_db_push_drift` | infrastructure |
| 2 | `20260817110000_notification_delivery_claim` | 6E′ |
| 3 | `20260903090000_support_ai_recommendations` | 10 |
| 4 | `20260904090000_knowledge_base` | 11 — RAG |
| 5 | `20260905090000_knowledge_authority` | 11 — RAG |
| 6 | `20260906090000_ml_model_governance` | 12 — **model registry** |
| 7 | `20260907090000_phase14_governance` | 14 — budget, policy version |
| 8 | `20260907090100_audit_trace_not_unique` | 14 — **the audit defect** |
| 9 | `20260907090200_retention_categories` | 14 — retention |
| 10 | `20260907100000_partner_lifecycle_verified` | partner |
| 11 | `20260908090000_phase15_workflow_drafts` | 15 |

---

## B. Schema state — what is actually absent

| Object | Phase | Production |
|---|---|---|
| `enterprise_audit_logs_trace_id_key` (UNIQUE) | 14 | **STILL PRESENT — defect live** |
| Max governance events on any one trace | — | **1** |
| `ai_budget_policies`, `ai_budget_windows` | 14 | **absent** |
| `ai_tool_policy_logs.policy_version` | 14 | **absent** |
| `AI_TELEMETRY` / `AUTOMATION_TELEMETRY` / `OPERATIONAL_ACTIVITY` | 14 | **absent** (0 of 3) |
| `ml_model_versions` | 12 | **absent** |
| `ml_shadow_predictions` | 12 | **absent** |
| `knowledge_documents` | 11 | **absent** |
| `knowledge_authority_rules` | 11 | **absent** |
| `ai_workflow_drafts` | 15 | **absent** |
| `ai_gateway_requests`, `ai_tool_approvals`, `vision_analyses`, `platform_feature_flags`, `notification_cadence_windows` | ≤10 | present |

**Three consequences, stated plainly:**

1. **There is no model registry in production.** No model could be governed there.
2. **There is no spend cap.** Enforcement degrades to `BUDGET_UNAVAILABLE` — permissive by design
   and correct as a failure mode, but not a control.
3. **The audit log holds at most one governance event per request** — and an approval plus the
   promotion it authorises share a trace, so that is exactly the pair being lost.

---

## C. The three unfinished migration records

| Migration | Started | Finished | Rolled back |
|---|---|---|---|
| `20260816120000_automation_workflow_engine` | 2026-08-19 09:02 | **NULL** | 2026-08-19 12:02 |
| `20260817100000_notification_platform` | 2026-08-19 12:02 | **NULL** | 2026-08-19 12:03 |
| `20260825140000_audit_log_action_created_at_index` | 2026-08-25 07:36 | **NULL** | 2026-08-29 10:06 |

All three are marked `rolled_back_at`, and **all three of their target objects exist in
production**: `workflow_definitions` (25 rows), `notification_templates` (41 rows), and the
`enterprise_audit_logs_action_created_at_idx` index.

---

## D. A hypothesis I formed, tested, and found wrong

**The hypothesis.** Prisma marks a migration resolved by setting `rolled_back_at`. I reasoned that
`migrate deploy` would therefore attempt to **re-apply** those three — and since
`automation_workflow_engine` has **0 `IF NOT EXISTS` guards across 15 `CREATE` statements** and its
tables already exist, the deploy would fail on "relation already exists" before ever reaching the
11 missing migrations. That would have been a hard, silent deployment blocker.

**The test.** Rather than report it, I cloned production and ran the real command:

```
pg_dump homigo_db -Fc                      54,252,072 bytes
pg_restore -> homigo_p15_rehearse          exit 0, 203 tables, 100 migrations (3 unfinished)
prisma migrate deploy                      exit 0, elapsed 25,966 ms
```

**The result: the hypothesis was wrong.** Prisma treats a `rolled_back_at` record as *resolved and
skipped*, not as work to redo. After the deploy:

```
total migrations   : 111   (100 -> 111, the 11 missing applied)
still unfinished   : 3     (unchanged — skipped, not re-applied)
rolled_back present: 3     (unchanged)
```

**Recorded because the correction changes the plan.** Had I reported the blocker without testing
it, the release team would have been sent to write idempotency guards into two historical
migrations for no reason.

**The residual finding is smaller and real:** the migration ledger disagrees with the schema. Three
migrations say "rolled back" while their tables exist and hold live data. The schema is correct;
the ledger is misleading, and anyone reading it to understand how this database was built will be
misled. Not a blocker; worth resolving with `prisma migrate resolve --applied` at some point.

---

## E. Post-migration verification on the clone

Every Phase-11/12/14/15 target satisfied:

| Check | Expected | Result |
|---|---|---|
| `trace_id` UNIQUE index | 0 | **0** |
| `trace_id` plain index | 1 | **1** |
| `ai_budget_*` tables | 2 | **2** |
| `policy_version` column | 1 | **1** |
| New retention categories | 3 | **3** |
| `ml_model_versions` | 1 | **1** |
| `ml_shadow_predictions` | 1 | **1** |
| `knowledge_documents` | 1 | **1** |
| `ai_workflow_drafts` | 1 | **1** |
| Partial unique index (one PRODUCTION model) | 1 | **1** |

### Data integrity — zero loss

| Table | Production | After migration |
|---|---|---|
| `bookings` | 529 | **529** |
| `payments` | 332 | **332** |
| `ledger_entries` | 2,003 | **2,003** |
| `users` | 792 | **792** |
| `providers` | 310 | **310** |
| `enterprise_audit_logs` | **352,753** | **352,753** |
| `workflow_definitions` | 25 | **25** |
| `notification_templates` | 41 | **41** |

**Audit hashes preserved: 352,753 of 352,753.**

---

## F. Application compatibility

The real backend was booted against the migrated clone:

```
DATABASE_URL=...homigo_p15_rehearse PORT=3011 bun run src/index.ts
  booted after 2 readiness attempts
  GET /metrics -> 200
  boot-log error lines -> 0
```

This exercises the strictest startup gate on the platform: the workflow registry's boot-time
fingerprint check, which **refuses to boot** if an activated definition's steps have changed. It
passed against real production workflow data.

### Governance verified live on production data

```
audit : 10 governance events on ONE trace -> 10 stored          PASS
budget: decision = NO_POLICY_CONFIGURED                          PASS  (table present, no cap set)
governed audit (fail-closed path)                                PASS
retention policies present: 5                                    (the original categories; the 3
                                                                  new ones deliberately unset)
```

The audit fix works on a clone of real production data — 10 events on one trace where production
today permits exactly 1.

---

## G. Risk assessment

| Risk | Assessment |
|---|---|
| Deploy fails partway | **Low.** Full chain rehearsed on a production clone, exit 0 |
| Data loss | **None observed.** 8 tables byte-identical, 352,753 hashes preserved |
| Duration | **~26 s** for all 11 on production-sized data |
| Locking | `20260907090100` swaps an index on `enterprise_audit_logs` (~1.5 s measured in Phase 14, blocking audit **writes** only). The rest are additive |
| Application incompatibility | **None observed.** Backend boots clean, workflow fingerprint gate passes |
| Rolled-back records re-applied | **No** — verified, they are skipped |
| Rollback | Additive migrations drop cleanly. `audit_trace_not_unique` is **roll-forward only** once traces start sharing: reverting to UNIQUE will fail on the duplicates it exists to permit |

---

## G2. Ledger reconciliation — resolved to a conclusion

The three `finished_at IS NULL` records were investigated to completion in the remediation pass.

**What happened:** all three failed with `applied_steps_count = 0`, logging *"A migration failed to
apply. New migrations cannot be applied before the error is recovered from."* Someone ran
`prisma migrate resolve --rolled-back` to unblock deployment. Their tables exist because a
`db push` created them — a history this repository already acknowledges in the migration named
`20260609130000_baseline_repair_db_push_drift`.

**Does it threaten deployment?** No — tested, not reasoned. A clean database run through the whole
chain produces **107 migrations, 0 unfinished, exit 0**.

**Is the production schema correct?** Tested by diffing production's full column inventory against a
schema built from migrations alone:

```
homigo_db           : 2,715 columns
migration-built ref : 2,824 columns
```

Every difference is accounted for by the 11 pending migrations:

| Column | Traced to |
|---|---|
| `chargebacks.risk_level` | `baseline_repair_db_push_drift` — unapplied |
| `geofences.service_categories` | same — unapplied |
| `ai_tool_policy_logs.policy_version` | `phase14_governance` — unapplied |
| all `support_ai_recommendations.*` | `support_ai_recommendations` — unapplied |

**No unexplained drift exists.**

**Recommendation, not action:** `prisma migrate resolve --applied` on the three records would make
the ledger tell the truth to a human reading it. Not done here — the evidence now supports it, but
it is a release-owned decision with no deployment urgency, and §G forbids modifying migration
history without cause.

---

## H. Verdict

**`PHASE_15_BLOCKED_BY_PRODUCTION_MATURITY`** — 11 migrations outstanding, and until they are
applied there is no model registry, no spend cap and no working governance audit in production.

**The blocker is not Phase-15 work**, and the path through it is now measured rather than
theoretical: one `prisma migrate deploy`, ~26 seconds, rehearsed end-to-end on a clone of real
production data with zero loss and a clean application boot.

**No production mutation was performed.** Authorization for that is a release decision, and this
audit does not assume it.
