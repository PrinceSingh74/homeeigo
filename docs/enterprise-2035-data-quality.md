# HOMEEIGO — Data Quality and Provenance

**Status: SOURCE QUALITY GENUINELY CLEAN · BUSINESS VOLUMES HEAVILY CONTAMINATED · PROVENANCE NOW FIRST-CLASS (DQ-2 FIXED)**

---

## 1. Two different questions that share one score

`homigo_data_quality_score = 100` is **correct and honest**. It is also routinely misread.

| Question | Answer | Measured by |
|---|---|---|
| Is the Postgres source data internally consistent? | **Yes — 100** | `analytics/data-quality/engine.ts`, 5,905+ `data_quality_results` rows, latest `evaluated_at` 2026-09-20 |
| Is the BigQuery warehouse fresh? | **No — zero successful exports since 2026-08-19** | `etl_job_executions` |
| Do the business volumes describe the business? | **No — see §2** | this document |

The Master Audit initially suspected the score was a hardcoded boot constant. **It is not** — it is computed from real rules against real rows. The confusion is structural: a clean source score says nothing about warehouse freshness and nothing about whether the rows are real customers.

**A clean source score must never be cited as evidence that the warehouse is current or that the data is production truth.**

---

## 2. DQ-1 (P1, DATA) — 97 % of refunds are test artifacts, and nothing marks them

Classified by `refund_requests.reason`:

| Class | Count | Value | Share |
|---|---|---|---|
| **CERTIFICATION** (`f2 cert`, `phase-5a certification`, `t07 race`, `adv rbac test`, `independent audit`) | **289** | ₹1,838 | **85.3 %** |
| **TEST** (`E2E cleanup`, `E2E wallet refund test`, `Created accidentally during automated UI verification`) | **38** | ₹19,371.90 | 11.2 % |
| **FAULT_INJECTION** (`gateway rejection`, `gateway timeout`) | 2 | ₹2 | 0.6 % |
| **REAL?** (`Cancelled by partner`) | **10** | ₹6,342 | **2.9 %** |

Of 18 distinct refund reasons in the database, **only two read as genuine business events**.

### Why this matters beyond tidiness

Every refund analytic — approval rate, failure rate, mean time to resolve, the console's "needs retry" tile — is computed over a population that is **97 % synthetic**. The figures are arithmetically correct and describe test activity.

Concretely: the 53 `INDETERMINATE` refunds that look like ₹445 of stranded customer money are **all `f2 cert` fault-injection artifacts**, ₹1 each. The 250 `FAILED` are overwhelmingly certification too.

The same contamination reaches bookings: **55 bookings** are linked to `f2 cert` refunds, and **88 of 882 users (10 %)** carry a synthetic-looking e-mail. Project memory records ~231 fixture bookings (~34 %).

### The actual defect: there is no provenance column

`refund_requests` has no `origin` / `is_synthetic` / `environment` field. Neither do `bookings`, `users` or `payments`. Provenance survives **only** as free text someone happened to type into `reason`, which means:

- classification is a regex over prose, and this document's own numbers depend on that regex;
- a future certification run that omits a marker is **indistinguishable from real business**;
- no query can reliably exclude synthetic rows, so no analytic can be trusted without one.

**This is what needs fixing.** Deleting rows is not the fix, and is explicitly not proposed.

---

## 3. DQ-2 — durable provenance — **IMPLEMENTED**

### Schema

`20260921120000_data_provenance` — hand-written, additive, validated on a fresh rebuild
(**29/29 migration-authority PASS**, no schema drift).

```sql
CREATE TYPE "DataOrigin" AS ENUM (
  'REAL','FIXTURE','TEST','CERTIFICATION','SYNTHETIC',
  'INFERRED_FIXTURE','INFERRED_TEST','INFERRED_CERTIFICATION','INFERRED_SYNTHETIC');

ALTER TABLE users           ADD COLUMN IF NOT EXISTS data_origin "DataOrigin";
ALTER TABLE bookings        ADD COLUMN IF NOT EXISTS data_origin "DataOrigin";
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS data_origin "DataOrigin";
```

**Three tables, not five.** `payments` and `wallet_transactions` deliberately have no column: every
payment has a parent booking (verified — 0 orphan payments), so a payment's origin *is* its
booking's. Two more columns would be two more places for the truth to disagree with itself. Children
derive; they do not duplicate.

**Nullable with no default.** A default of `REAL` would silently relabel every historical row as
genuine business data — the exact failure the column exists to prevent.

**`INFERRED_*` is a distinct value.** A label derived from a regex over historical prose is not the
same fact as one a script declared about a row it was creating. Conflating them would let this
document's own guesswork harden into data.

### Classification rules — `src/lib/data-provenance.ts`

One rule set, used by both the report and the backfill. Every rule carries the pattern that fired and
why, so a label always traces back to its evidence.

Tested against the **real** population — all 18 distinct reason strings read from `homigo_db` with
their row counts, not a synthetic fixture:

| | |
|---|---|
| Classified | **329 of 339** |
| Left UNKNOWN | **10** (`Cancelled by partner`, `… unable to complete`) |

The two properties that matter most are asserted explicitly, because a classifier fails in opposite
directions:

- a REAL row must never be labelled synthetic — it would vanish from business analytics;
- an unrecognised row must never be labelled REAL — it would launder unknown data as business.

Over-matching is deliberately avoided. `"test"` inside ordinary prose is **not** a rule: real people
have addresses like `testa.rossi@gmail.com`, and only RFC 2606 reserved domains (`example.com`,
`.test`, `.invalid` — which cannot be deliverable mailboxes) and explicit `+e2e`-style tags classify
a user.

### Backfill — `scripts/provenance-report.ts`

Read-only by default; `--apply` writes. It only ever fills a **NULL** column, never overwrites, never
deletes, and never promotes an unclassified row to `REAL`. Requires an explicit `--url`.

**Not applied to `homigo_db`** — that is an operator action (§7).

### Analytics policy — `src/lib/analytics-scope.ts`

The obvious next step would be to sprinkle `WHERE data_origin = …` through the analytics code. That
is the failure mode this module prevents: dozens of ad-hoc predicates drift, and the one that is
forgotten silently reintroduces the problem.

**One policy, stated once.** Default population is `REAL` **plus** `UNKNOWN (NULL)` — UNKNOWN is
included deliberately, because historical rows predate the column and excluding them would erase
genuine business history the day this shipped. `INFERRED_*` is treated exactly as its declared
counterpart: the prefix records *how* a row was classified, never *whether* it counts. `ALL` must be
asked for by name so it can never be the accidental default.

### DQ-6 — self-maintaining — `scripts/check-provenance-declaration.ts`

Hand-editing the 43 scripts that create business rows is not a control: it fixes today and does
nothing about the 44th. So the rule is enforced the way this repository already enforces
"a script that reaches a database must state which one" — mechanically, at a gate.

- Scans **new/modified** scripts via git (matching `check-migration-safety`), so it cannot be
  disabled on day one by 43 pre-existing failures.
- **15 scripts / 37 create-sites were flagged and all 15 were fixed**, not allow-listed:
  chaos and section-cert scripts now declare `CERTIFICATION`, e2e scripts `TEST`,
  `seed-agent-staging` `FIXTURE`, `presence-load-baseline` `SYNTHETIC`.
- **Proven to fail**: removing one declaration made the gate exit 1 naming the file; restoring it
  returned exit 0.

A future certification run can no longer produce rows indistinguishable from real business.

## 4. What is NOT contaminated

Stated because the contamination is easy to over-generalise:

| Area | State |
|---|---|
| **Double-entry ledger** | 975 journals, global debit − credit = **0**, zero unbalanced journals, zero NULL paise |
| **Wallet reconstruction** | Ops side reconstructs to the rupee from seeds + transactions; **zero** out-of-band balance changes |
| **Source data-quality rules** | 100, computed from real evaluations |
| **Schema constraints** | 1,838 CHECK constraints, 171 FKs, 34 triggers |
| **Migration authority** | Fresh rebuild passes 29/29 |

The *structure* is sound. The *population* is not representative.

---

## 5. Consequence for every figure in this audit

**Every business volume quoted anywhere in these documents — 705 bookings, 419 payments, 882 users, 324 providers, 339 refunds — describes a contaminated development database, not a production baseline.**

They are correct as measurements of `homigo_db`. They are not a description of HOMEEIGO's business, and no capacity plan, conversion metric or ML training set should be derived from them until §3 exists.

---

## 6. Findings

| ID | Sev | Finding | Status |
|---|---|---|---|
| DQ-1 | **P1** | 97 % of refunds are test/certification artifacts | **MEASURED** |
| DQ-2 | **P1** | No provenance column on any business table | **FIXED — migration + rules + policy + gate** |
| DQ-3 | P2 | Analytics could not exclude synthetic populations | **UNBLOCKED** — `analytics-scope.ts` is the single policy; call sites still to adopt it (DQ-7) |
| DQ-4 | P2 | 88 of 882 users synthetic; 55 bookings linked to `f2 cert` | **MEASURED — classifiable** |
| DQ-5 | P3 | `homigo_data_quality_score` misread as warehouse freshness | **DOCUMENTED** — §1 |
| DQ-6 | P2 | Future scripts could create unmarked business rows | **FIXED — gate, 15 scripts retrofitted, proven to fail** |
| DQ-7 | P2 | Existing analytics call sites do not yet apply `analyticsWhere()` | **OPEN** — see below |

### DQ-7 — adopting the policy at the call sites

`analytics-scope.ts` exists and is tested, but the existing analytics queries have **not** been
migrated onto it. They are unchanged and therefore still count synthetic rows.

This was left deliberately. Rewriting every analytics query in the same pass that introduces the
column would change reported business figures **before** anyone has reviewed the backfill that
decides which rows are synthetic. The safe order is: apply the backfill → review the classifications
→ then switch the call sites, so any movement in a KPI has an explained cause.

## 7. Operator actions

| # | Action | Command |
|---|---|---|
| 1 | Apply the provenance migration to `homigo_db` | `DATABASE_URL=… bunx prisma migrate deploy` |
| 2 | Review the classification report (read-only) | `bun run scripts/provenance-report.ts --url …` |
| 3 | Apply the backfill once reviewed | `… --apply` |
| 4 | Adopt `analyticsWhere()` at the call sites (DQ-7) | engineering, after 3 |

Expected effect of 1: **three nullable columns and one enum type. No row read, written or deleted.**

> The test database (`homigo_test`) already has the column — it was added additively so the suite
> could run. `setup-test-db` provisions from `schema.prisma`, so a fresh test database gets it
> automatically.

---

## 8. Status

| Item | Status |
|---|---|
| Source data quality engine | **RUNTIME_VERIFIED** |
| BigQuery warehouse freshness | **EXTERNAL_BLOCKED** |
| Refund population provenance | **MEASURED — 97 % synthetic** |
| Provenance schema | **FIXED — fresh rebuild 29/29** |
| Classification rules | **TEST_VERIFIED — 34 assertions against the live population** |
| Analytics policy module | **TEST_VERIFIED** |
| Future-script enforcement | **FIXED — gate proven to fail** |
| Backfill applied to `homigo_db` | **OPERATOR_ACTION** |
| Analytics call-site adoption | **OPEN — DQ-7** |
| Deleting contaminated rows | **NOT PROPOSED** |
