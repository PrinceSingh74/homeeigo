# W2-D3 — Fabricated provider scores · FROZEN

## Defect, as measured

The matching scorer invented a value for every signal it had no evidence for — and on live that was
not an edge case, it was the norm.

| Signal | Invented value | Live providers affected (of 84 dispatchable) |
|---|---|---|
| rating | flat **15/30** for fewer than 5 reviews — ranked a no-review provider above anyone measured below 3.0 | **80 (95%)** |
| distance | an invented **15 km** when coordinates were missing, which became a real distance score **and a customer-facing ETA** | **66 (79%)** have no coordinates |
| completion | `completionRate` defaulted to 0 → scored 1/10, indistinguishable from a real 0% | — |
| response | `rating.service` **wrote** `responseRate = 100` whenever a partner had no recent bookings | 6 stored at exactly 100 |

Two more found while fixing, neither in the Wave 1 audit:

- `calculateAvailabilityScore` carried a **second** invented distance as a parameter default,
  `distanceKmValue = 15`.
- The premium boost read the raw stored rating, so a stored 5.0 over one review earned the top tier.
- Ties were broken by input order, and input order was `ORDER BY rating DESC, completion_rate DESC` —
  the very stored columns carrying the fabricated values.

## Fix

- **`src/lib/matching-signals.ts`** — each signal is a number **or `null`**. Evidence thresholds:
  5 reviews for rating, 3 terminal jobs for completion, 3 recent jobs for response.
- **Excluded, not zeroed.** `normalisedMatchScore` divides by the weight of the KNOWN signals, so an
  unknown signal neither helps nor hurts — zero would punish having no history, which is the other half
  of the owner's rule.
- **Real history ranks exactly as before.** `DEFAULT_WEIGHTS` are proportional to `MAX_POINTS`, so with
  every signal known the new score equals the old additive sum; the test asserts it to 9 decimal places.
- **Evidence is counted, not trusted.** `loadEvidenceMap` counts terminal and recent bookings per
  candidate in **one grouped query per call**, because the stored rates have no denominators.
- **Unknown position → `distance: null`, `eta: null`**, and the provider does not pass the distance
  boundary. In practice these are the same providers the presence/location gate already refuses —
  `locations` is upserted by the same heartbeat — so the live dispatch pool is not reduced.
- **Deterministic ties**: score → more KNOWN signals → provider id.
- **Source fixed**: `rating.service` no longer writes a rate it has no denominator for; the column
  keeps its last measured value.
- The four `provider_match_scores` component columns become nullable so the decision record can say
  "excluded" instead of storing a fake number (no reader aggregates them — only DELETE and COUNT).

## Why the evidence is counted at match time and not stored

Adding columns was considered and rejected: the live backend hot-reloads this code, and a regenerated
Prisma client **selecting** a column the live database does not have would take matching down.
Relaxing NOT NULL (below) is safe for the same reason adding would not be — it changes no column set.

## Migration `20260924090000_match_score_unknown_signals`

Four `ALTER COLUMN ... DROP NOT NULL` — relaxing only; no column added, removed, retyped or renamed,
no row touched. Hand-written (never `migrate diff`).

| Database | State |
|---|---|
| `homigo_test` | applied, verified `is_nullable = YES` ×4 |
| `homigo_migrations_test` | applied, verified ×4 |
| `homigo_db` (live) | **NOT applied — OPERATOR_ACTION** |

Applied to the test databases with `psql` directly, not `migrate deploy`: `migrate status` against
`homigo_test` also lists two **unrelated, pre-existing** pending migrations
(`20260609250000_wallet_pending_hardening`, `20260617100000_settlement_pending_status`), and
`migrate deploy` would have tried to apply those too.

**Live behaviour until the operator applies it:** matching is unaffected. The analytics write is a
single `createMany` inside `.catch(() => {})`; when any returned provider has an unknown signal, the
live NOT NULL constraint rejects the whole batch and that call's analytics rows are lost. No user-facing
effect, no crash. Apply with `bunx prisma migrate deploy` from `apps/backend` once the live pending
list contains only this migration.

## Evidence

| Suite | Result |
|---|---|
| `w2-d3-unknown-signals.test.ts` (unit + structural) | **25 / 25** |
| `w2-d3-unknown-signals.integration.test.ts` (real matching + bookings) | **6 / 6** |
| 11 matching / rating / dispatch / e2e / concurrency suites | **91 / 91** |
| `tsc --noEmit` | clean |

## Tracked forward item

**D3-F1** — the candidate query still truncates at `take: 500` ordered by stored `rating DESC`. In a
pool over 500 the survivors are chosen by the stored rating before scoring. No live service is near
500 candidates (84 dispatchable providers in total). Belongs to **P11.14 Hard matching filter**, where
candidate selection is bounded by distance/zone instead.
