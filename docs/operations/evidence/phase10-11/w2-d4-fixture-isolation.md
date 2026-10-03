# W2-D4 — Provider fixture isolation

## What was measured on homigo_db — read-only, counts only, no PII printed

| | |
|---|---|
| providers with provenance set | **0 of 324** — every one UNKNOWN; the backfill had never run |
| dispatchable providers | 84 |
| … on RFC 2606 reserved domains (`@example.com`, `.test`, `.invalid`) — cannot receive mail | **37 (44%)** |
| … no rule fires, genuinely ambiguous | 47 |
| real customers' bookings assigned to such partners | **9, of which 4 are still live** |
| certification bookings on real partners' calendars | 4, of which **0 live** (capacity pollution today: nil) |

Classification used the codebase's own evidence-based rules (`data-provenance.ts`: reserved domains,
suite plus-tags), through the same resolver `provenance-report` uses. Nothing was invented.

## Root cause — two halves

**Switched off in data.** `analytics-scope` is sound, but no creation path ever set `data_origin`:
signup, both OAuth providers, partner registration, and the test harness all created rows UNKNOWN, and
UNKNOWN counts as business. So the isolation that existed never engaged.

**Bypassed in code.** Matching's candidate query applied a population, but every *other* place a
partner is chosen did not:

| Path | Gap |
|---|---|
| matching | asymmetric — a non-business customer got **no filter at all**, so a certification run could be matched to a real partner |
| availability projection | no population — a real customer's slots could be backed entirely by fixture partners |
| customer names a partner by id | no population check — **and** it skipped `complianceRestricted` and the dispatch lifecycle, which matching filters on |
| admin reassign | no population check |
| rating aggregation | counted every rating on the partner, including other-population ones |
| completion/response evidence (added in D3) | counted every booking on the partner |

## Why not `Provider.dataOrigin`

The brief allows "`Provider.dataOrigin` or an equivalent typed canonical field". `analytics-scope`
already defines that field: a provider **inherits** provenance from its user (`INHERITS_PROVENANCE_VIA`),
with the reasoning written in the module — one source of truth, nothing to backfill twice. A second
column on Provider could disagree with the user's, which is the duplication the architecture forbids,
and adding a column would also risk the live backend (a regenerated client selecting a column the live
database does not have). A structural test now asserts Provider has no such column.

## Fix

- **Born classified.** `provenanceForNewUser(email)` applies the existing rules at creation, in all five
  runtime creation paths and in the test harness. A rule firing sets the inferred origin; no rule leaves
  the column UNKNOWN. It **never declares REAL** — that would be inventing a classification. The app's
  own phone-signup placeholder (`@phone.homeeigo.invalid`) is excluded by the classifier itself.
- **Disjoint populations** at every choosing point: matching (now symmetric), availability, direct
  selection, admin reassign. Admin population refusal is **not** covered by the emergency override —
  that override exists for stale presence/location, and a partner who does not exist is not an emergency.
- **Direct selection now mirrors matching**: `complianceRestricted` and the dispatch lifecycle are
  checked when a customer names a partner by id.
- **A partner's metrics are its own population's**: rating aggregation and D3's evidence counting both
  filter by the partner's population, through the single predicate in `analytics-scope`.

## Live behaviour

On homigo_db every row is UNKNOWN, so all of the above is **inert on live** until classification runs:
UNKNOWN = business on both sides, which is exactly today's behaviour. Nothing changes for a live customer
from the code alone.

## OPERATOR_ACTION — not taken, deliberately

1. **Apply the classification.** `bun run scripts/provenance-report.ts --url <homigo_db> --apply` fills
   `data_origin` only where it is NULL and a rule fires; it never overwrites and never promotes to REAL.
   Measured effect: 685 users, including **37 dispatchable providers** who would leave real matching.
   This is a live data write with a real effect on supply, and the owner's instruction for real data is
   read-only verification, so it was not run.
2. **Four live bookings** belong to real customers and are assigned to partners on reserved-domain
   accounts. Those customers are waiting on partners who cannot exist. They need reassignment by support.
   No live booking was modified.
3. **47 dispatchable providers** match no rule. They stay business by policy and are listed for owner
   review rather than quarantined: quarantining UNKNOWN would remove every dispatchable partner on live.

## The test harness had the same defect as production — and the regression proved it

Classifying the harness's own users at creation made the first full regression fail **15 tests**. Every
one was a test creating rows that production would classify, **without** classifying them, while the
harness partner now was. Three shapes, one root:

| Shape | Tests | What the test did |
|---|---|---|
| A — customer-less matching | 2 (+ a manual runner) | called `findBestProviders` with no customer — a business query — and expected the fixture partner in it |
| B — direct fixture customers | 6 | created `@adv.test` customers straight through `prisma.user.create`, unclassified, then booked the fixture partner |
| C — raw bookings | 6 | inserted bookings with raw SQL and no `data_origin`, then rated the fixture partner with them |
| my own D3 test | 1 | asserted the evidence query's text before D4 aliased its table |

None was a production defect. Each was fixed by making the test do what production does:

- **A** — 7 calls now name the suite's fixture customer and ask within the fixture world.
- **B** — every direct `user.create` in the suite (35 calls, 20 files) now spreads
  `provenanceForNewUser(email)` first: a reserved-domain address is born classified exactly as at
  runtime, any other address gets `{}` — no change — and an explicit `dataOrigin` later in the object
  still wins.
- **C** — the raw insert now inherits the customer's non-business origin with the same rule
  `bookingService.create` applies.

This matters beyond the tests. The harness creating unclassified business-shaped rows is how test
activity reached `homigo_db` looking real (see the hazard "bun test pollutes live DB"): had these rows
been born classified, the leaked ones would have been isolated automatically.

`partner-operations.integration.test.ts` (shape A) is the one changed before the full run; it is
recorded here so none of these can be mistaken for tests relaxed to go green.

## Full regression after the realignment

One clean run of the whole backend suite from `apps/backend` against the isolated test DB, with no reruns:

```
 3396 pass
 0 fail
 67726 expect() calls
Ran 3396 tests across 280 files. [379.63s]
exit=0
```

The first full run had 15 failures, all classified above as harness misalignment and fixed by making the tests do what production does. The second run is the one recorded here. No test was skipped, relaxed or retried to reach it.

**D4 frozen.**
