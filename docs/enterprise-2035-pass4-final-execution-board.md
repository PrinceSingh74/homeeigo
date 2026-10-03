# HOMEEIGO — PASS 4 FINAL EXECUTION BOARD

**2026-09-21 · every claim below is measured against a running system or a real database.**

Pass 3 ended with P1 = 0, P2 = 1, 289 tests green and 5/5 gates passing. Pass 4's instruction was
not to confirm that. It was to assume the pass that produced it could not see its own blind spots.

It could not. **Pass 4 found one P1 and five P2s, four of which were introduced or missed by the
tooling built in Pass 3 to prevent exactly them.**

---

## 1. Environment preflight

| Check | Value | Verdict |
|---|---|---|
| **C: free** | **1.9 GB of 293 GB (0.6%)** | **CRITICAL — standing safety condition** |
| D: free | 121 GB of 184 GB (65.7%) | fine |
| Postgres | `homigo_db` @ :5433, 1,060 MB | up |
| Prometheus | `homigo-prometheus` | up |
| Alertmanager | `homigo-alertmanager`, cluster ready | up |
| Backend | :3000, serving `/metrics` | up, **stale build — see §7** |

C: never recovered during this pass, so the full 2,633-test suite, DB clones and parallel suites were
**not run**, per the standing rule. All disposable output went to D: or the session scratchpad; C:
free was 1.8 GB at the start and 1.9 GB at the end.

---

## 2. The board

| ID | Sev | Finding | Status |
|---|---|---|---|
| **MIG-6** | **P1** | The generated Prisma client cannot read `users`, `bookings` or `refund_requests` from `homigo_db` — P2022 on every bare find | **BLOCKED — one operator command** |
| **MIG-7** | P2 | `verify-migration-authority.ts` reported **29/29 PASS** while MIG-6 was true; two checks were structurally incapable of failing | **FIXED + proven** |
| **OBS-10** | P2 | Prometheus scraped `:3010`; nothing has ever listened there. 114 healthy rules, none able to fire | **FIXED + verified** |
| **OBS-11** | P2 | `DatabaseDown` keyed to a target that was down on every scrape regardless of the database | **FIXED + proven both directions** |
| **OBS-7** | P2 | `FinancialIntegrityBelow100` defined twice with different labels → two pages, one on the wrong route | **FIXED + verified** |
| **OBS-8** | P2 | `PaymentSuccessRateLow` fired as a **P0 because nothing was happening** (`clamp_min` denominator) | **FIXED + verified** |
| **DQ-7** | P2 | `analyticsWhere()` had **zero adopters**; refund console 97.1% test data *(the "GMV overstated 22%" figure originally here is withdrawn — see Pass 5)* | **FIXED + gated** |
| **OBS-9** | P3 | `ProviderAcceptanceLow` pages on a sample of one | OPEN — owner-owned threshold |
| **DQ-8** | P3 | Certification bookings contaminate **real** partners' scores, which drive payouts | OPEN — owner decision |
| **EVT-3** | P3 | A wildcard stub consumer owns 38% of `event_consumer_receipts` to write a log line | OPEN — documented, owner's call |
| ALERT_DELIVERY | — | Machine delivery **PROVEN**; human delivery **EXTERNAL_BLOCKED** | see §4 |

---

## 3. MIG-6 — the P1

`prisma/schema.prisma` declares `dataOrigin` on three models and the client was regenerated. The
migration adding the column has **never been applied to `homigo_db`**.

```
tables with data_origin: (none)          DataOrigin enum: (missing)

  FAIL  user.findFirst()            code=P2022
  FAIL  booking.findFirst()         code=P2022
  FAIL  refundRequest.findFirst()   code=P2022
  OK    user.findFirst({ select: { id: true } })
  OK    booking.count()
```

An explicit `select` asks only for the columns it names, so it works. A **bare find** selects every
scalar the client believes exists, so it throws — and most application code does bare finds.

**The running backend survives only because it holds a client generated before the schema changed.**
`/ready` answers, `/metrics` serves, and a restart breaks login, bookings and refunds. Nothing in the
health surface says so, because nothing in the health surface does a bare find.

Three migrations are pending, all authored this session, all idempotent (`IF [NOT] EXISTS` on all 24
DDL statements). The destructive-looking `DROP INDEX` statements are **verified no-ops** — those
indexes are already absent. Measured work: **5 indexes on tables of ≤1.4 MB**, three nullable
columns, autovacuum settings on 8 tables. Roughly 5 MB.

```bash
cd apps/backend && bunx prisma migrate deploy   # refused in this environment as a production deploy
```

Not performed, and not worked around. Full analysis: `enterprise-2035-migration-authority-pass4.md`.

---

## 4. Observability — four defects behind a healthy dashboard

Pass 3 verified 114 rules loaded, `promtool` clean, 0 health errors, and concluded observability was
fixed. Every one of those measurements was true.

**The stack was scraping a port nothing has ever listened on.** Every rule keyed on a `homigo_*` or
`financial_*` series evaluated against no data — 114 healthy rules, all structurally incapable of
firing, including every money-integrity alert.

Fixing the port produced, for the first time in the stack's existence:

```
FIRING   FinanceIntegrityFailure       value = 52.3
FIRING   FinancialIntegrityBelow100    value = 92
```

The ₹32 wallet drift had been true the whole time. This is the first moment it was ever alerted on.

Then the alerts that appeared exposed two more defects:

- `FinancialIntegrityBelow100` arrived **twice in one webhook batch** with different label sets — two
  definitions across two rule files, one carrying `priority: P0` and a runbook, one carrying neither
  and therefore taking the ordinary critical route.
- `PaymentSuccessRateLow` was FIRING as a **P0** at value 0 against `payment_success_total 0` and
  `payment_failed_total 0`. `clamp_min(denominator, 1)` turns an idle window into a catastrophe.
  Dividing by the true denominator gives `0/0 = NaN`, and NaN comparisons are false.

`DatabaseDown` was keyed to `up{job="homigo-ready"}` — and `/ready` returns `application/json`, which
Prometheus cannot parse, so that target was down on every scrape regardless of the database. The
alert was permanently true. A `database_up` gauge now mirrors `redis_up`, **proven in both
directions**: `database_up 1` against the live database, `database_up 0` with an unreachable
`DATABASE_URL`.

### Alert delivery

| Hop | Status | Evidence |
|---|---|---|
| exposition → scrape | **VERIFIED** | target `up`, alerts carry live values |
| scrape → rule | **VERIFIED** | 113/113 `health=ok` |
| rule → Alertmanager | **VERIFIED** | alerts received (was 0 in its entire life) |
| Alertmanager → receiver | **VERIFIED** | full webhook payloads captured; failure path also confirmed |
| receiver → a human | **EXTERNAL_BLOCKED** | see below |

Alertmanager routes every severity to one webhook at `host.docker.internal:45678` — a certification
harness that is not running, so notifications are dropped silently. A disposable listener was bound
there and three real notifications arrived and were captured. In the canonical production config the
Slack, SMTP and PagerDuty credentials are deploy-time placeholders, inventoried by name only.
**No human delivery has been observed and none is claimed.**

Detail: `enterprise-2035-observability-pass4.md`.

---

## 5. DQ-7 — closed, with numbers

`analyticsWhere()` existed, was tested, and was called by **nothing**. Measured against the live
database:

```
total bookings           all=    705   business=    602   excluded=  103  (14.6%)
GMV (finalAmount, paid)  all= 249,207  business= 194,358  excluded=54,849 (22.0%)
completed revenue        all= 139,752  business= 111,782  excluded=27,970 (20.0%)
refund requests          all=    339   business=     10   excluded=  329  (97.1%)
  failed                 all=    250   business=      0   excluded=  250  (100.0%)
  indeterminate          all=     53   business=      0   excluded=   53  (100.0%)
```

> **Withdrawn in Pass 5.** The booking/GMV/revenue rows above rested on an uncorroborated provenance rule; re-derived with same-run evidence the GMV difference is 0.2%, not 22%. The refund rows stand. See `enterprise-2035-pass5-final-execution-board.md`.

**Every FAILED and every INDETERMINATE refund in the database is a certification artifact.** The
three refund alerts added in Pass 3 were verified then as "non-vacuous — every one fires on the
current state". They do fire. They were pointing operators at test fixtures. "Verified non-vacuous"
was true and useless.

The fix was not a codemod. 118 call sites were inventoried and classified, because most **must** see
every row: a reconciliation that skips fixture rows cannot detect drift caused by them, a dispatcher
double-books their slots, a pagination total that is scoped beside an unscoped list breaks the page.

```
  A   48  business analytics — SCOPE            E    2  model input — SCOPE
  B   28  operational control — NEVER SCOPE     F    1  compliance — NEVER SCOPE
  C    7  liability / integrity — NEVER SCOPE   H    4  listing totals, diagnostics
  D   27  per-entity — no-op (see DQ-8)         I    1  owner decision
```

That classification is **data, not prose**: `scripts/classify-analytics-call-sites.ts` is now in
`prebuild` and exits 1 if any call site is unassigned or any scope-required site is unscoped.

Three things surfaced only because the work was done properly:

1. **Partial scoping is worse than none.** `payments` has no provenance column. Scoping the booking
   count while leaving GMV unscoped would have made contribution margin wrong in a way that no
   longer looks like an inflated total. `analyticsWhereVia()` inherits through the mandatory FK.
2. **`dynamic-pricing.service.ts` computed realized conversion from unscoped counts.** Now scoped.
   > **Severity corrected in Pass 5.** This was written up as "the demand anchor multiplied into
   > every customer quote… pushing the price for real customers". That is **withdrawn**: `base` is
   > a constant factor in the optimizer's argmax so it cannot change which multiplier wins, and
   > nothing customer-facing reads the service — `/api/pricing/*` has no consumer in any web or
   > mobile app and checkout never touches it. It is a reporting-accuracy fix. Pass 5 did find a
   > separate, real rounding defect in the same optimizer while proving this.
3. **Spreading a relation filter silently widens the query.** `{ user: mine, ...analyticsWhereVia(...) }`
   discards `mine` — later keys win — and the count came back 242 instead of 0. No error; the number
   just gets bigger.

Detail: `enterprise-2035-data-quality-dq7.md`.

---

## 6. The pattern connecting almost all of it

Every P2 in this pass is a **control that could not fail**:

- 114 alert rules, all `health=ok`, scraping a port nothing listens on.
- `DatabaseDown` keyed to a target down on every scrape regardless of the database.
- `PaymentSuccessRateLow` firing *because* nothing happened.
- A migration verifier whose client probes used narrow selects, avoiding exactly the columns that drift.
- A directory check derived from rows, so a directory with no row was invisible to it.
- Refund alerts verified "non-vacuous" against a population that was 97% test data.

None is caught by asking *does the check pass?*. All are caught by asking *what would make this check
fail, and can that happen?* — which is why every fix here was reintroduced deliberately and watched
to fail before being restored.

Two of my own new checks failed that test on the first run and had to be fixed: one matched the
`homigo-ready` string inside the comment explaining why `homigo-ready` was removed, and the comment
strip meant to fix it silently did nothing because the rule files are CRLF and JavaScript's `.` does
not match a carriage return.

---

## 7. Verification state

| Gate | Result |
|---|---|
| `tsc --noEmit` | **exit 0** |
| `check-log-governance` | exit 0 |
| `check-migration-safety` | exit 0 |
| `check-ddl-guard-coverage` | exit 0 |
| `check-provenance-declaration` | exit 0 |
| `check-alert-rule-drift` | exit 0, **re-proven to fail** on a modified mirror |
| `classify-analytics-call-sites` (new) | exit 0 |
| `bun run prebuild` (all gates) | **exit 0** |
| Session regression suites (10 files) | **103 pass / 0 fail** |
| Service regression (9 files) | **188 pass / 0 fail** |
| Prometheus runtime | 113 rules, **113 `health=ok`**, target `up` |

Every regression test written this pass was **proven to fail** when its defect was reintroduced:
3 assertions on the scrape wiring, 2 on the alert definitions, 3 on DQ-7, 1 on the refund queue.

One existing test had to be **relaxed, not deleted**: `refund-queue-priority.test.ts` pinned the exact
punctuation `INDETERMINATE }})`, so adding the DQ-7 predicate to that `where` broke it while the
count it protects got strictly better. It now pins the property and was re-proven to fail when the
count is removed.

---

## 8. OPERATOR_ACTIONS, in order

1. **Apply the pending migrations** — unblocks MIG-6 and everything DQ-7 delivers.
   ```bash
   cd apps/backend && bunx prisma migrate deploy
   bun run scripts/verify-migration-authority.ts --url "$DATABASE_URL"   # must print 29/29
   ```

2. **Restart the backend** — *after* step 1, never before. The running process predates every change
   in this pass: `/metrics` currently exposes neither `database_up` nor the refund-backlog series, so
   `DatabaseDown` has no series to evaluate and the DQ-7 scoping is not live. Restarting before
   step 1 replaces a stale-but-working process with one that throws P2022 on login.

3. **Decide the three open P3s**: the acceptance-rate minimum sample (OBS-9), whether certification
   data may contaminate a real partner's score (DQ-8), and the wildcard stub consumer (EVT-3).

4. **Recover C: drive space.** At 0.6% free, the historical failure chain — C: → 0 → logging failure
   → Docker failure → PostgreSQL interruption — is one large operation away.

---

## 9. What Pass 4 did NOT cover

Stated plainly, because a board that lists only what was done reads as completeness:

| Area | Status |
|---|---|
| AI budget enforcement, approval-binding argument hash, `NO_HANDLER` audit gap | **not re-examined this pass** — carried from `approval-binding-and-audit-gaps.md` |
| Security deep pass (runtime 401/403/IDOR re-probe) | **not re-run** — last verified in Pass 3 |
| Unwired-capability re-measure | **not re-run** |
| DB hygiene / ETL re-measure | **not re-run** |
| Full 2,633-test baseline | **deliberately not run** — C: at 0.6% free |

`P1 = 1 (blocked on an operator command), P2 = 0, P3 = 3 (all owner decisions).` The P1 is not
closable from here, and the five areas above are the honest remaining surface for a Pass 5.
