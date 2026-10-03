# PHASE 15 — Remediation Report

Every prior finding was re-verified from zero rather than carried forward. Three of my own earlier
statements turned out to be wrong, and those corrections are recorded here because they changed what
the remediation actually needed to be.

**Date:** 2026-09-05. **Production was read, never written.**

---

## A. Re-verification of the source-of-truth claims

| Claim from the previous report | Re-verified | Result |
|---|---|---|
| Production 100 applied / 107 on disk | ✓ | **Confirmed** |
| Production `trace_id` still UNIQUE | ✓ | **Confirmed** |
| `ml_model_versions` absent in production | ✓ | **Confirmed** |
| `ai_budget_*` absent in production | ✓ | **Confirmed** |
| 3 migration records `finished_at IS NULL` | ✓ | **Confirmed** — and investigated properly this time (§B) |
| Model-evaluation routes unmapped in RBAC | ✓ | **Already fixed**; both entries present at lines 124–125 |
| No Phase-15 model serving | ✓ | Confirmed |
| Phase-14 and Phase-15 tests pass | ✓ | 26/26 and 47/47 |

---

## B. §G — the migration ledger, investigated to a conclusion

The previous report flagged the three unfinished records and left it there. This is the answer.

### What actually happened

```
20260816120000_automation_workflow_engine        started 2026-08-19 09:02  steps=0  rolled_back 12:02
20260817100000_notification_platform             started 2026-08-19 12:02  steps=0  rolled_back 12:03
20260825140000_audit_log_action_created_at_index started 2026-08-25 07:36  steps=0  rolled_back 08-29
logs: "A migration failed to apply. New migrations cannot be applied before the error is recovered from."
```

All three **genuinely failed** with `applied_steps_count = 0`, and someone ran
`prisma migrate resolve --rolled-back` to unblock further deployment. The ledger is therefore
**accurate about what Prisma did**. Their tables exist because a `db push` created them — a history
this repository already acknowledges in the migration named
`20260609130000_baseline_repair_db_push_drift`.

### Does the drift threaten deployment?

**No, and this was tested rather than reasoned about.** A clean database run through the full chain
produces **107 migrations, 0 unfinished, exit 0**. Prisma skips a `rolled_back_at` record rather
than re-applying it.

### Is the production schema actually correct?

Tested by diffing production's full column inventory against a schema built from migrations alone:

```
homigo_db            : 2,715 columns
migration-built ref  : 2,824 columns
```

Every difference is explained. After excluding the tables from the 11 known-missing migrations, the
only remaining gaps were:

| Column | Traced to |
|---|---|
| `chargebacks.risk_level` | `20260609130000_baseline_repair_db_push_drift` — **unapplied** |
| `geofences.service_categories` | same migration — **unapplied** |
| `ai_tool_policy_logs.policy_version` | `20260907090000_phase14_governance` — **unapplied** |
| all `support_ai_recommendations.*` | `20260903090000_support_ai_recommendations` — **unapplied** |

**No unexplained drift exists.** The ledger is misleading to a human reading it, and the schema is
consistent with its own migration history once the 11 pending ones are accounted for.

**Recommendation, not action:** `prisma migrate resolve --applied` on the three records would make
the ledger tell the truth. Not done here — §G says not to modify migration history without
evidence, and while the evidence now supports it, it is a release-owned decision with no deployment
urgency.

---

## C. Defects found and fixed in this pass

### C1 — `providers.acceptanceRate` fabricated a perfect score

**The most consequential finding of this remediation**, and it sits in a service Phase 15 did not
create.

`assignment-engine.refreshProviderAcceptanceRate` computed:

```ts
const rate = total > 0 ? Math.round((accepted / total) * 10000) / 100 : 100;
```

An empty 30-day window wrote **100**. A provider who went quiet for a month was re-scored as a
**perfect acceptor** the moment they were dispatched to again.

**Why this matters here specifically:** this phase's own evaluation established that
`providers.acceptanceRate` is the deterministic predictor that **beats the learned model**
(baseline AUC 0.9642 vs candidate 0.9528). §N and §P both direct that when the baseline wins, it
should be the operationalised predictor — so its correctness became this phase's business.

**Scale of the misstatement:** the platform-wide acceptance rate is **7.5%**, and only **16 of 54**
dispatched providers have ever accepted anything. 100 is the most misleading value the column can
hold. It is read by the admin provider list, ETA intelligence and partner context.

**Fixed:** with no evidence in the window the function now **returns without writing**, leaving the
last real measurement in place. The `.catch(() => {})` that silently swallowed update failures now
logs.

**Verified by reintroduction:** restoring the `: 100` branch makes the guard test fail; restoring
the fix passes.

### C2 — two hypotheses I formed and disproved

Recorded because both would have produced wrong remediation:

| Hypothesis | Reality |
|---|---|
| "New providers default to 100, biasing dispatch toward the unproven" | The column default is **0**, not 100. 256 never-dispatched providers all carry 0. The `: 100` branch is reachable only for a provider *returning after a quiet window* — narrower than I assumed, and still wrong |
| "`acceptanceRate` feeds dispatch ranking, so the fabrication skews assignment" | It does **not** appear in the dispatch scoring path. It is displayed to admins and consumed by ETA intelligence and partner context — a reporting defect, not a routing one |

Both corrections narrow the severity. Reporting the original framing would have overstated it.

### C3 — a deeper issue the fix does not close

`providers.acceptance_rate` is `NOT NULL DEFAULT 0`. It **cannot represent "unknown"**: 0 reads as
"always refuses" and 100 as "always accepts", and a provider with no history is neither.

Writing 0 instead of 100 would be the same fabrication pointing the other way. Leaving the previous
value is the honest action available without a schema change.

**Follow-up, not done here:** a nullable column plus every consumer taught to render UNKNOWN. That
is a migration with a wide blast radius across admin display, ETA intelligence and partner context —
exactly the kind of change §B warns against making as a side effect.

---

## D. Items re-checked and found already correct

| Item | State |
|---|---|
| Model-evaluation RBAC | Both routes mapped `ANALYTICS/READ`; unmapped `/api/admin/*` denies by default |
| Provider bypass coverage | 3 governed paths; guard matches adapter names **and** provider hosts; verified by deletion |
| Audit fail-closed on draft review | Throws and **compensates** the status back to `DRAFT` |
| Simulation write isolation | Verified by counting bookings/payments/ledger before and after |
| Workflow ACTION refusal | Verified by adding `ACTION` to the allowlist and watching the suite fail |

---

## E. Items deliberately not "completed"

Each was assessed against §AH — *"fully operational" does not mean "every conceivable model is
live"*.

| Item | Why not |
|---|---|
| **Promote the cancellation model** | Advantage is 0.24 SE. §P: do not promote. |
| **Promote the provider-acceptance model** | The baseline **beats** it. §N: do not force a learned model into production. |
| **Connect vision → LLM** | Creates an indirect prompt-injection path. §L: do not connect for checkbox completion; prove why first. The proof is that no injection-defence design or content-influence policy exists |
| **Build voice** | No STT adapter, no TTS adapter, no streaming, `expo-av` on one client, no consent policy. §M: do not fabricate a provider |
| **Build fraud ML** | 9 adjudicated labels. §O: operationalise governed fraud intelligence instead — which already exists and was not degraded |
| **Apply production migrations** | **No authorization present in this context.** §E: do not mutate production. Fully rehearsed instead |
| **Repair the migration ledger** | Evidence now supports it; it is a release decision with no urgency |

---

## F. Production remains the gate

**Re-measured precisely, and it corrects a number this report previously stated loosely.**

Earlier passes said "100 applied / 107 on disk". 100 is the number of ROWS in the migration ledger,
not the number applied. Measured directly:

```
_prisma_migrations : 100 rows
                      97 finished and not rolled back   <-- actually applied
                       3 rolled back
migrations on disk : 108  (107 pre-existing + the booking-slot migration authored in this pass)
                      11 not applied to production
```

The gate itself is unchanged and re-verified read-only:

| Check | State |
|---|---|
| `enterprise_audit_logs_trace_id_key` | **still UNIQUE** — the Phase-14 audit fix is not deployed |
| `ml_model_versions`, `ai_budget_*` | still absent |
| `bookings_provider_slot_excl` | still `'[]'` — the back-to-back booking fix is not deployed |

A caution about the first row: a check against `pg_constraint` reported `trace_id` as **not**
unique, contradicting every earlier pass. The contradiction was in the query, not the database —
the uniqueness is a unique **index**, which `pg_constraint` does not list. `pg_indexes` confirms
`CREATE UNIQUE INDEX`. Recorded because a mis-scoped catalog query is exactly how a real blocker
gets reported as resolved.

The deployment path remains measured rather than theoretical: `prisma migrate deploy` on a clone of
production completed **exit 0 in 25,966 ms** with **zero data loss across 352,753 audit rows** and a
clean boot including the workflow fingerprint gate.

**No authorized production mutation was performed.** One *unauthorized* one occurred by accident and
is reported in full in `PHASE_15_TEST_ISOLATION_INCIDENT.md`: a test run launched from the wrong
directory wrote 141 fixture bookings and 60 payments into `homigo_db`. They remain in place, because
deleting production rows also requires authorization.
