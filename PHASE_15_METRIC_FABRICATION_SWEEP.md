# PHASE 15 — §14 Derived-Metric Fabrication Sweep

§14 asked for a global sweep of every derived metric for the fabrication patterns
`empty → 100`, `empty → 0`, `missing → perfect`. Only `providers.acceptanceRate` had been done.
This is the rest of it.

**Result: the acceptanceRate defect was not an isolated bug. It was one instance of a family, and
the sweep found seven more — including one metric that was never measured at all.**

---

## A. How the sweep was run

A pattern search across `services`, `lib` and `routes` for a ratio whose denominator can be zero
resolving to a flattering constant:

```
(total|count|length|denominator|n)\s*[><=!]+\s*0\s*\?[^:]{0,120}:\s*(100|1|95|90)
```

Then each hit was read in context, its consumers traced to the UI, and its severity judged on what
a reader of that screen would conclude. Presentation-layer defaults (`?? 100`, `?? 0`) were swept
separately, because a backend can be perfectly honest and still be overridden by the component
rendering it — which is exactly what was happening here.

---

## B. Findings

| # | Location | Fabrication | Severity |
|---|---|---|---|
| **F1** | `finance-analytics.service.ts` `settlementAccuracyPct` | **Never measured anything.** `100 - (chargebackExposure > 0 ? 2 : 0)` | **Critical** |
| **F2** | `settlement-sync.service.ts` `runSync` | Sync that saw zero settlements **persisted `accuracy_pct = 100`** | **Critical** |
| F3 | `settlement-sync.service.ts` `metricsSummary` | `avgAccuracy ?? 100` — never reconciled reads as reconciled perfectly | High |
| F4 | `refund-workflow.service.ts` `approvalRatePct` | Zero refunds → `100` | High |
| F5 | `settlement-resolution.service.ts` `resolutionRate` | Zero discrepancies → `100`, and `healthScore` derived from it | High |
| F6 | `settlement-sync.service.ts` `reconciliationSuccessPct` | A **second name for the same number**, zero consumers | Medium |
| F7 | `settlement-sync/page.tsx` | `?? 100` on **three** KPI cards, independent of the backend | High |
| F8 | `refunds/page.tsx` | `?? 0` → "0% approval rate", the same defect pointing the other way | Medium |
| F9 | `risk-intelligence.service.ts` | `integrity.score ?? 70` — a magic constant, currently unreachable | Low |

### F1 is the worst of them

```ts
settlementAccuracyPct: 100 - (Number(overview.chargebackExposure ?? 0) > 0 ? 2 : 0),
```

This never touched a settlement. It could only ever return **98 or 100**, and it moved on
chargeback exposure — an unrelated signal. A finance dashboard displayed it as *settlement
accuracy*. It is not a stale metric or a bad estimate; it is a number with the shape of a
measurement and none of the substance.

It now reads the value the platform actually records on each completed sync run, and reports
`null` when no run has ever completed.

### F2 is the one that made the others worse

```ts
const accuracyPct = gatewaySettlements.length > 0 ? round2(...) : 100;
```

A sync that fetched **zero** gateway settlements wrote a **100% accuracy row into
`settlement_sync_runs`**. Those rows feed the platform-wide average — so every empty sync silently
raised the reported accuracy. Fixing the readers (F1, F3) without this would have left them
faithfully averaging fabricated inputs.

`accuracy_pct` was already nullable, so no migration was needed. **Found only because a guard test
dumped the file it was asserting against and the fabrication was visible in the dump** — I had not
found it by reading.

### F7 — the fabrication the backend cannot prevent

```tsx
value={`${healthData.resolutionRate ?? 100}%`}
```

Three cards on the settlement screen substituted **100** for a missing value. Had I fixed only the
services, every one of those nulls would have been re-rendered as a perfect score, and the fix
would have looked complete while changing nothing a user sees.

---

## C. What was deliberately **not** changed

### The `→ 0` family

`cac`, `contributionMarginPct`, `revenueEfficiencyPct`, `refundRatePct`, `avgLtv` all resolve an
undefined ratio to `0`. Formally the same defect — but the consumers already treat 0 as unknown:

```tsx
value={cac > 0 ? inr(cac) : "—"}
sub={cac > 0 ? "per new customer (30d)" : "CAC pending spend feed"}
```

A fabricated **0** renders as an em dash with an explanation; a fabricated **100** renders as a
green perfect score. The reader is misled by one and not the other. Converting these to null means
re-typing every `num()` call site across six HQ dashboard components — a wide change with no
improvement to what anyone sees. **Recorded as a follow-up, not done as a side effect of this
phase.**

### The compliance risk score

`complianceOpen > 0 ? ... : 100` in `risk-intelligence` looks like the same pattern but is not:
zero open compliance requests is a **real measured zero**, and "nothing at risk" is the correct
reading of it. Left as is.

---

## D. Verification: every guard fails when the fabrication returns

A guard that has never failed is not evidence. All five were verified by reintroducing the exact
original code and re-running:

```
refund approval rate is null, not 100 .................... FAIL
settlement resolution rate and health score null together . FAIL
settlement accuracy reports UNMEASURED ................... FAIL
finance analytics no longer invents an accuracy figure ... FAIL
risk intelligence carries no magic fallback score ........ FAIL
                                                  47 pass, 5 fail
```

Then restored from checksum-verified copies (all five hashes identical before and after) and
re-run: **52 pass / 0 fail.**

The guards assert on **source**, not on returned values, and deliberately so: the fabrication is
reachable only on an empty database, and a shared test database is never empty. A behavioural
assertion would have passed without ever exercising the branch — the vacuous-guard failure mode
that has already caught me twice in this project.

---

## E. Honest limits

- **The sweep is pattern-driven.** It finds fabrications shaped like a zero-denominator ternary or a
  `??` default. A metric fabricated some other way — a hardcoded constant with no conditional, an
  average over a filtered-empty set — would not match. F1 was found this way only because it
  happened to contain `: 100`-adjacent arithmetic; **F2 was missed by the sweep entirely** and
  surfaced by accident.
- **Frontend coverage is limited to the screens reached from the affected metrics.** A full
  `?? 100` sweep across all admin components was not run.
- **No historical data was repaired.** Existing `settlement_sync_runs` rows written with a
  fabricated `accuracy_pct = 100` are still in the database and still in the average. Correcting
  them means mutating recorded financial history and **requires authorization that was not given**.
  Flagged, not fixed.
