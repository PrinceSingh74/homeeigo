# Phase 2 — ETA Intelligence · FREEZE MANIFEST

**Frozen:** 2026-08-09 · **Base commit:** `74aa839d9a7e508225aeb50bbe70ecb51488a0d2`
**Branch:** `cursor/stage-e-step-13-certification` · **State:** working tree, uncommitted

Phase 2 is closed to further feature work. What follows is collection, not construction.

---

## What "frozen" means

| Allowed | Not allowed |
| --- | --- |
| Read-only monitoring | New lifecycle features |
| Bug fixes with a reproducing case | Changing the duration anchor |
| Real-data collection | Changing the 50-label threshold |
| Documentation | Loosening geofence thresholds |
| | Marking synthetic data eligible |
| | Enabling ETA ML inference |

Any change to a frozen file below requires a reproducing failure, not a preference.

## Frozen surface

| File | SHA256 (16) |
| --- | --- |
| `src/services/tracking.service.ts` | `20f83edef7667a4b` |
| `src/services/booking.service.ts` | `6375ab3d293e9041` |
| `src/services/eta-intelligence.service.ts` | `3122f23028df33f0` |
| `src/events/catalog/partner.events.ts` | `0aa95e98d224ffca` |
| `src/routes/bookings.ts` | `373f6398a0ac2ec5` |
| `src/lib/eta-metrics.ts` | `f7c17ce93fb1f545` |
| `analytics/eta/validation.ts` | `790b33138fdb0a4e` |
| `scripts/eta-revalidate-labels.ts` | `85cff71ec9c893ba` |
| `monitoring/rules/homigo-alerts.yml` | `3bf88c38c8aff9b7` |
| `monitoring/grafana/dashboards/homigo-eta-intelligence.json` | `53d1c09363aeba04` |

Clients: `apps/partner-web` (api client, mutations, types, `BookingRequestCard`, `DashboardLiveTracking`) and `homigo-partner-mobile` (api client, types, `RequestsScreen`, `use-partner-tracking-publisher`).

## Frozen contracts

| Contract | Value |
| --- | --- |
| Duration anchor | `arrived_at − en_route_at` — never substituted |
| Training window | 60 s ≤ duration ≤ 14 400 s |
| Quality threshold | ≥ 70 |
| Training threshold | **50 real eligible labels** |
| Valid provenance | `explicit_partner_action`, `gps_geofence`, `job_start` |
| Unknown provenance | blocked (`historical_provenance_unknown`) |
| Synthetic allowlist | `/^HOMIGO-\d{8}-\d{5}$/` — fails closed |
| Customer ETA | Google Maps |
| ML inference | OFF |

## Evidence at freeze

| Suite | Result |
| --- | --- |
| Real-flow (dev API → Postgres → outbox → label) | **28/28** |
| Race + ordering hardening | **18/18** |
| Security probes | **19/19** |
| Contract assertions | **30/30** |
| `bun test` (runnable suites) | **20/20** |
| Enterprise certification gates | **29/29**, 0 FAIL |
| Promotion-path proof | **6 proven · 9 correctly blocked · 2 not verified · 0 invariants broken** |
| Typecheck | backend / partner-web / partner-mobile all clean |

Capture at freeze: `enRouteAt` 3 → 12 bookings, `arrivedAt` 4 → 12, **0 inverted timestamps**.

## Known-open at freeze

Carried forward deliberately, none blocking:

1. **Real eligible labels 0/50** — by design; collection has not started.
2. **Mobile real-device** — NOT VERIFIED. Plan: `docs/operations/ETA-LIFECYCLE-MOBILE-TEST-PLAN.md`.
3. **Staging** — NOT VERIFIED; the staging database is unprovisioned (0 tables).
4. **BigQuery / ETL / Phase 1** — NOT VERIFIED; no GCP credentials in this environment.
5. **Performance** — NOT VERIFIED; no Phase-2 SLO exists and none was invented.
6. **3 historical labels** carry unknown provenance — correctly blocked, not fabricated.
7. **6 dormant legacy `eta.*` outbox rows** — terminal, left in place by decision.
8. **`bun test` segfaults** on suites importing `eta-intelligence.service` — pre-existing, reproduced on pristine HEAD; those assertions run via `bun run`.

## Forward path

```
PHASE 2 FROZEN
      ↓
Real trips collection
      ↓
Telemetry monitoring          ← scripts/eta-collection-monitor.ts
      ↓
Automatic label generation
      ↓
Validation
      ↓
Training eligibility
      ↓
50+ real labels
      ↓
Real feature contract audit   ← processed/real-feature-contract-gap.json
      ↓
Real-vs-Google baseline
      ↓
Temporal evaluation
      ↓
Long-trip / severe-traffic evaluation
      ↓
Candidate comparison          ← eta-candidate-50k-v1-455b946bfdc7
      ↓
Human approval
      ↓
ONLY THEN promotion
```

Full detail: `docs/architecture/eta-model-promotion-path.md`.

## Monitoring

```bash
bun --env-file=.env run scripts/eta-collection-monitor.ts          # human readable
bun --env-file=.env run scripts/eta-collection-monitor.ts --json   # for scheduling
```

Read-only. Reports the capture funnel, blocking reasons, arrival-provenance mix, and
projected time to the 50-label gate.

**Reading at freeze:** 110 completed · 5 with both timestamps (4.5 % capture) · **0 in the
duration window** · 0 eligible.
Diagnosis: *capture works, durations too short* — the five captured trips are 0–4 s test
taps. This is the expected pre-launch state and no code change addresses it.

The signal to watch is **arrival provenance**. Labels arriving as `explicit_partner_action`
mean partners are using the lifecycle actions. A rise in `job_start` instead means they
are skipping straight to starting the job, and the travel-start anchor is being lost.
