# HOMEEIGO — DQ-7: scoping business analytics to the business

**Status: CLOSED in code, BLOCKED on one operator command before it can run against the live database.**

DQ-7 was "adopt `analyticsWhere()`". Before this pass it had **zero adopters** — the module existed,
was tested, and was called by nothing. That is measured, not assumed:

```
$ grep -rn "analyticsWhere|analyticsSqlPredicate|isBusinessRow" src/ analytics/ scripts/
scripts/provenance-report.ts:141:   ...counted as business by analytics-scope.     ← a comment
```

---

## 1. What the wrong fix would have been

Adding `WHERE data_origin ...` everywhere the pattern matched. There were **116** such call sites
across 45 files when this pass started (118 after the two the scoping itself adds), and most of them
**must** see every row that exists:

- a reconciliation that skips fixture rows cannot detect drift caused by fixture rows;
- a dispatcher that skips them double-books their slots;
- a quota check that skips them lets a partner exceed the quota;
- a DSAR export that skips them breaks the law.

So the first step was an inventory, not an edit: `scripts/inventory-analytics-call-sites.ts` extracts
every aggregate over a provenance-bearing model with its enclosing function, its filter, and whether
it is already narrowed to one entity.

---

## 2. Classification

The assignment is **data, not prose**: `scripts/classify-analytics-call-sites.ts` holds one rule per
file (with per-query overrides for mixed files, matched on query text rather than line number so the
assignment survives edits) and **exits 1 if any call site is unassigned, or if a site classified as
scope-required is not scoped**. A classification kept in a document drifts the moment someone adds a
query, and the site nobody considered is the one that gets the default. Here it breaks the build.

Counts below are that script's output, not an estimate:

```
[dq7] 118 call sites over provenance-bearing models

  A   48  business analytics — SCOPE
  B   28  operational control — NEVER SCOPE
  C    7  financial integrity / liability — NEVER SCOPE
  D   27  per-entity, already narrowed — no-op (see DQ-8)
  E    2  model input — SCOPE
  F    1  compliance / audit — NEVER SCOPE
  H    4  internal health, listing totals, diagnostics — do not scope
  I    1  ambiguous — owner decision

[dq7] PASS — every site classified, every scope-required site scoped
```

| | Category | Decision |
|---|---|---|
| **A** | Business analytics — a statement about the real business | **SCOPE** |
| **B** | Operational control — dispatch, queue depth, capacity, quota | **NEVER SCOPE** — must see every row or the system mis-operates |
| **C** | Financial integrity — liabilities, ledger reconciliation | **NEVER SCOPE** — excluding a balance manufactures drift |
| **D** | Per-entity — already narrowed to one provider or customer | **NO-OP** — see DQ-8 below |
| **E** | Model inputs — pricing conversion | **SCOPE** — fixtures distort the model |
| **F** | Compliance / production validation | **NEVER SCOPE** |
| **G** | Test and fixture code | excluded from the inventory |
| **H** | Listing totals, diagnostics | do not scope — a scoped total beside an unscoped list breaks pagination |
| **I** | Ambiguous, owner decision | documented, not changed |

Building that gate found two things reading could not have. A `where,` object shorthand and a
`const where = { ..., ...analyticsWhere() }` reused across five queries both read as *unscoped* to a
naive matcher, producing eleven false alarms — and a check that cries wolf gets muted. It also found
one real miss: `dynamic-pricing.service.ts` computed realized conversion from unscoped booking
counts.

> **Corrected in Pass 5.** This was first written up as "the demand anchor multiplied into every
> customer quote… moves the price for real customers". That claim was **wrong** and is withdrawn.
> `base` is a constant factor in the optimizer's argmax so it cannot change which multiplier wins,
> and nothing customer-facing reads the service at all — `/api/pricing/*` has no consumer in any web
> or mobile app, and checkout never touches it. Scoping it is still correct, because a reported
> conversion rate should describe the real business, but it is a reporting-accuracy fix.
> See `enterprise-2035-pass5-final-execution-board.md` §6 for the measurement that settled it.

The C category deserves emphasis because it is the one a careless adoption would have broken.
`finance-dashboard.service.ts` sums `users.walletBalance`. That is a **liability**: the platform owes
that money to whoever holds the balance, and a fixture user's balance is still a row the ledger
reconciliation must account for. Scoping it would have made this figure disagree with
`ledger-reconciliation.service.ts` and manufactured a ₹-drift that does not exist. It is now marked
in the code as deliberately unscoped, next to a refund total in the same `Promise.all` that *is*
scoped — the distinction is per-figure, not per-file.

---

## 3. What scoping actually changes

Measured against the live database with `scripts/dq7-scope-impact.ts`, which classifies in memory
using the same rules as the backfill and writes nothing:

```
admin dashboard
  total customers          all=    398   business=    392   excluded=    6  ( 1.5%)
  total bookings           all=    705   business=    602   excluded=  103  (14.6%)
  completed bookings       all=    255   business=    208   excluded=   47  (18.4%)
  GMV (finalAmount, paid)  all= 249,207  business= 194,358  excluded=54,849 (22.0%)

executive KPIs
  completed revenue        all= 139,752  business= 111,782  excluded=27,970 (20.0%)
  cancelled bookings       all=    168   business=    128   excluded=   40  (23.8%)

refund console
  refund requests          all=    339   business=     10   excluded=  329  (97.1%)
    completed              all=     36   business=     10   excluded=   26  (72.2%)
    failed                 all=    250   business=      0   excluded=  250  (100.0%)
    indeterminate          all=     53   business=      0   excluded=   53  (100.0%)
```

> **WITHDRAWN in Pass 5 — the GMV, booking, revenue and cancellation figures above are wrong.**
>
> They came from a provenance rule that labelled a booking as certification whenever a refund raised
> against it carried a certification reason. Measured in Pass 5, 100 of the 103 bookings it excluded
> were classified *only* that way, belonged to just 5 established accounts, and only **1 of 100**
> showed the "harness created account, booking and refund together" pattern the rule assumed; 62 were
> booked by accounts over a week old, 46 refunded over a week after booking, 71 carry live-shaped
> gateway ids and 5 have written reviews. A test refund says the *refund* was a test — not who made
> the booking.
>
> With inheritance restricted to same-run evidence (`classifyBookingFromRefunds`, now enforced), the
> re-derived differences are: **GMV 0.2% (₹500)**, completed bookings 1.6%, completed revenue 1.7%,
> cancellations 0%. The **refund-console figures stand** (97.1% non-business): those are classified
> by evidence on the refund row itself, not inherited.
>
> Whether the 5 accounts are QA accounts or real customers is a BUSINESS_DECISION the data cannot
> settle. Until someone decides, their bookings stay UNKNOWN, which counts as business — the policy's
> fail-safe direction for real history.

> **CORRECTED AGAIN in Pass 6 (2026-09-21) — the "0.2%" above was computed blind to 90% of users.**
>
> The Pass 5 re-derivation read `users.email`, which is NULL for 794 of 882 users: under PII
> encryption the address lives in `email_encrypted`. Every e-mail rule therefore saw no address and
> classified the account UNKNOWN, and UNKNOWN counts as business. The tool was not measuring the
> policy; it was measuring its own blindness. `scripts/lib/resolve-user-emails.ts` now decrypts
> through `userPiiService.resolveEmail` (one `DATA_DECRYPTED` audit row per call; 702 rows on this
> run), and `dq7-scope-impact.ts` and `provenance-report.ts` both use it.
>
> Re-derived on 2026-09-21 with resolved addresses (`D:/homigo-ci-tmp/dq7-impact-pass6.txt`):
>
> ```
> admin dashboard
>   total customers          all=    398   business=    141   excluded=  257  (64.6%)
>   total bookings           all=    705   business=    465   excluded=  240  (34.0%)
>   completed bookings       all=    255   business=    197   excluded=   58  (22.7%)
>   GMV (finalAmount, paid)  all= 249,207  business= 189,073  excluded=60,134 (24.1%)
> executive KPIs
>   completed revenue        all= 139,752  business= 111,019  excluded=28,733 (20.6%)
>   cancelled bookings       all=    168   business=    162   excluded=    6  ( 3.6%)
> refund console             unchanged — 97.1% / 72.2% / 100% / 100%
> classification             INFERRED_SYNTHETIC 684, INFERRED_CERTIFICATION 289, UNKNOWN 210, INFERRED_TEST 38
> ```
>
> These come from the **account-level** rules (`@homigo.test` 396, `@adv.test` 242, and the other
> fixture domains), not from the refund-inheritance rule Pass 5 withdrew — that rule stays
> withdrawn, and the 5 established accounts it implicated are still UNKNOWN. The 24.1% is a different
> mechanism from the 22.0% Pass 4 reported, arrived at by evidence on the user row. One exemption was
> added on the way: `@phone.homeeigo.invalid` is the placeholder `routes/auth.ts` gives every real
> phone-only signup, so it is app-generated, not synthetic, and `classifyUserEmail` returns null for
> it (`data-provenance.test.ts` pins this).
>
> Nothing has been applied. The backfill is a BUSINESS_DECISION: applying it drops the admin
> dashboard's customer count from 398 to 141.

### The finding that matters most

**Every FAILED refund and every INDETERMINATE refund in the database is a certification artifact.**

The previous pass added three refund alerts and verified them as "non-vacuous — every one fires on
the current state". They do fire. They were pointing operators at test fixtures:

| Alert | Fired at | What it was actually counting |
|---|---|---|
| `RefundIndeterminateBacklog` | 53 | 53 certification rows |
| `RefundIndeterminateAging` | 35 days | the age of the oldest certification row |
| `RefundActionableBacklogHigh` | 303 | 303 rows, of which ~0 are actionable |

"Verified non-vacuous" was true and useless. An alert that pages a human to investigate a fixture is
worse than one that never fires, because it fires, gets investigated, turns out to be nothing, and
teaches everyone that this alert means nothing.

`src/lib/refund-backlog-metrics.ts` now scopes all five series to the business population and
publishes the excluded rows separately as `homigo_refund_backlog_nonbusiness{status}` — because "97%
of the refund table is test data" is worth watching, it just is not a refund incident. Every existing
alert expression stays valid.

---

## 4. Partial scoping is worse than none — the inheritance

Only `users`, `bookings` and `refund_requests` carry `data_origin`. Analytics do not stop there:
unit economics divides GMV (from `payments`) by completed bookings.

Scoping only the tables that happen to have the column would have made `getUnitEconomics` **worse**:
GMV would still include fixture payments while the booking count excluded the very bookings those
payments were made against. Contribution margin and refund rate would have been wrong in a new way
that no longer looks like an inflated total.

Every such table has a mandatory FK to a provenance-bearing parent, so `analyticsWhereVia()` derives
the child's classification from the parent — no second column, nothing to backfill:

| Model | Inherits via | Parent FK |
|---|---|---|
| `payment`, `rating` | `booking` | required |
| `userSubscription`, `provider`, `membershipBenefitUsage` | `user` | required |
| `walletTransaction` | `user` | **nullable** |

Two defects were found building it, both by the test rather than by reading:

1. **`{ userId: null }` against a required FK is not a filter that matches nothing — Prisma rejects
   the query outright.** The first version admitted parentless rows for every model, which made
   `analyticsWhereVia` a runtime error for five of the six. Only `walletTransaction.user_id` is
   nullable, and only there does the orphan branch apply.

2. **Spreading it next to an existing filter on the same relation silently widens the query.**
   `{ user: mine, ...analyticsWhereVia("provider") }` discards `mine` — later keys win in an object
   literal — and the count came back **242** instead of 0. It does not error; the number just gets
   bigger, which is the worst way for a scoping bug to present itself. The module now documents
   `{ AND: [existing, analyticsWhereVia(...)] }` and the test asserts the composed form.

---

## 5. Adopted

| File | What it feeds |
|---|---|
| `src/services/admin.service.ts` | dashboard totals, the 30-day analytics report |
| `src/services/geo-intelligence.service.ts` | executive KPIs, revenue forecast |
| `src/lib/partner-exec-metrics.ts` | the business gauges Prometheus scrapes |
| `src/services/refund-workflow.service.ts` | the refund console (now returns `scope` and `excluded`) |
| `src/lib/refund-backlog-metrics.ts` | the refund alerts that page a human |
| `src/services/stats.service.ts` | counters shown to customers on the public site |
| `src/services/finance-analytics.service.ts` | unit economics, both sides of every ratio |
| `src/services/finance-dashboard.service.ts` | refund totals (liability sums left alone) |
| `src/services/membership-analytics.service.ts` | upgrade funnel |
| `src/ai-brain/context/collectors/{admin,finance,operations}-context.ts` | what the assistant says about the business |
| `src/routes/admin.ts` | premium-match ratio, numerator and denominator together |
| `src/services/dynamic-pricing.service.ts` | realized conversion — a reported figure, not a charged one (see Pass 5 correction) |

Left unscoped on purpose, with the reason written at the call site: provider online counts, active-job
counts, queue depth, quota checks, wallet and gift-card liability sums.

---

## 6. DQ-8 (NEW, P3, OPEN — owner decision)

The 25 category-D sites are narrowed to one `providerId`: a partner's completion rate, cancellation
rate, risk score and performance nudges. Scoping them is a no-op *for the provider's identity* but
not for the question, because a certification run that created 50 bookings against a **real** partner
contaminates that real partner's score — and those scores drive payouts and risk decisions.

Not changed here. Whether a partner's standing should be computed over real jobs only is a policy
decision with money attached, and inventing the answer is exactly the fabrication this audit exists
to prevent.

---

## 7. Regression coverage

`src/__tests__/analytics-scope-adoption.test.ts` — 18 assertions against `homigo_test` with a
contrastive fixture: one user per population (REAL, UNKNOWN, FIXTURE, TEST, CERTIFICATION, SYNTHETIC,
INFERRED_CERTIFICATION), each assertion naming an exact expected count.

The fixture is selected **by id, not by a marker in the e-mail** — `users.email` is encrypted at rest,
so the first version's `startsWith` matched nothing and every count assertion compared 0 to 0 and
passed for the wrong reason.

**Proven non-vacuous.** Making `analyticsWhere("BUSINESS")` return `{}` and stripping the predicate
from `admin.service.ts` failed 3 assertions by name; restoring returned 18/18.

---

## 8. BLOCKER — one operator command

`prisma/migrations/20260921120000_data_provenance` has **never been applied to `homigo_db`**. See
`enterprise-2035-migration-authority-pass4.md`: the generated client already selects `data_origin`,
so every bare `findFirst`/`findMany` on users, bookings and refund_requests throws **P2022** today.

Everything above is verified against `homigo_test`, which has the column. None of it takes effect on
the live database until:

```bash
cd apps/backend && bunx prisma migrate deploy
```

Three migrations are pending, all authored and reviewed this session, all idempotent
(`IF [NOT] EXISTS` on all 24 DDL statements), and the destructive-looking `DROP INDEX` statements are
verified no-ops — those indexes are already absent. Measured work: 5 indexes on tables of ≤1.4 MB,
three nullable columns, and autovacuum settings on 8 tables.
