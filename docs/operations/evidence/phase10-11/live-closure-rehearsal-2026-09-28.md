# Live-closure rehearsal — 2026-09-28 (scratch copy of live, not live)

**What this proves:** the owner runbook (`apps/backend/scripts/owner-live-closure-runbook.md`) executes end to end on production-shaped data and the verifier reaches its final state. **What it does not prove:** anything about `homigo_db` itself — nothing in this file was run against the live database. Live state is in `live-closure-run.md`.

## Setup

| Item | Value |
|---|---|
| Source | `apps/backend/backups/homigo_pre-op9_2026-09-28T07-10-22Z.dump` — `pg_dump -Fc` of `homigo_db` taken 12:40 IST today, 71,561,123 bytes, 240 TABLE DATA entries, sha256 `08647680e203b8a605f0…` (full hash beside the file) |
| Target | `homigo_rehearsal_test_0928` on the same server (`homigo-postgres`, Postgres 16.14), `pg_restore --no-owner`, 0 errors |
| Parity with live after restore | bookings 723 / 723 · users 885 / 885 · services 71 / 71 · `_prisma_migrations` 145 / 145 · capability rows 55 / 55 |
| Backend | :3100, `DATABASE_URL`=rehearsal, `REDIS_URL`=:6380, `APP_ENV=rehearsal`, no Google credentials, preload refusing **every** non-loopback connection (fetch, http/https, net/tls, http2) and refusing to start on any other database. 8 connections to the rehearsal DB, 0 to `homigo_db`; egress log: no outbound attempt |
| Actor | SUPER_ADMIN `cmq9h67pk0000tz8s6tvnpet5` (present in the copy) |
| Approval file | emitted as `REHEARSAL-not-owner` — not an owner approval, used only on the copy |

## Step results

| Step | Command (as in the runbook, `--url` = rehearsal) | Result |
|---|---|---|
| A | `prisma migrate status` → `migrate deploy` → `status` | 6 pending → "All migrations have been successfully applied" → "Database schema is up to date!"; the capability migration re-ran over the 9 tables already present, 55 rows untouched; the unknown-locally history row warned, did not abort |
| C dry run | `phase10-content-apply-plan.ts --summary` | 31 services · 25 would apply · 6 refused (status) · 0 invalid on target |
| C apply | `… --apply --approved-by … --owner-approval … --actor-id …` | 25 applied · 0 failed; 25 `service_config_versions` rows by the actor. **Defect found:** 24 enterprise audit rows, not 25 (see below) |
| C re-run | same | 0 applied · 25 identical |
| D report / apply / re-run | `phase10-apply-held-safety.ts` | 6 × WOULD_APPLY (execution, safety, quality) → 6 applied (versions 3→4, fasade 4→5), WORK steps withheld → 6 × SKIP_IDENTICAL |
| E report / apply / re-run | `phase10-apply-age-policy.ts` | 33 would apply, 0 owner decisions → 33 applied → 33 identical |
| E2 report / apply / re-run | `phase10-apply-published-dispute-policy.ts` | 33 would apply → 33 applied (complaint window 2 days, rework-first warranty, fee waived — the published 48-hour promise) → 33 identical; C / D / E re-checked afterwards: 25 identical, 6 identical, 33 identical; verifier "E2 dispute policy" 33/33 PASS (run after the backend was stopped, so that run's runtime gates read FAIL "backend not reachable") |
| F baseline / apply / re-run | `phase11-capability-backfill.ts --write-baseline` → `--apply` → report | 33 services · 80 providers · 688 rows · shrink 0 · growth 0 → 688 inserted, in-transaction parity EXACT for all 33 services → 743 rows, 0 to insert |
| G dry run | verifier "G strict dry run" (`?mode=STRICT` vs `?mode=LEGACY_FALLBACK`) | PASS — identical per candidate on 3 upcoming business bookings |
| G enable | `PATCH /api/admin/platform/flags` with `environment: "rehearsal"` (what that backend reads) | 200, flag row written by the admin route with actor and reason |

## Final verifier output (rehearsal)

```
[live-closure-verify] homigo_rehearsal_test_0928 @ 2026-09-28T08:42:25.380Z · backend http://127.0.0.1:3100 (flag env "rehearsal") · actor cmq9h67pk0000tz8s6tvnpet5
PASS     A migrations                   all 147 repository migrations applied
PASS     A schema objects               39/39 present
PENDING  B stale bookings               none of the four dispositioned
PASS     C content (25 services)        25/25 identical to the approved draft · 0 untouched
PASS     D held services (6)            6/6 identical to the approved draft · 0 untouched
BLOCKED  C2 services without a draft    2 active business service(s) have no execution/safety/quality content and no draft: personal-hygiene-bathing-care, spa
PASS     E age policy                   33/33 active business services carry an explicit policy
PASS     F capability backfill          688 rows · 33 services · 80 providers · strict pool == baseline pool exactly (shrink 0, growth 0) · dup 0 · orphan 0
PASS     G strict flag                  env=rehearsal enabled=true rollout=100 … reason="closure rehearsal step G (scratch copy)"
PASS     R cases route                  GET /api/admin/cases → 200
PASS     R policy route                 deployed=true
PASS     R quality route                enforced=true
PASS     G strict dry run               STRICT reproduces the legacy decision for every candidate on 3 booking(s) (2 candidate evaluations)
PASS     G runtime strict parity        STRICT reproduces the legacy decision for every candidate on 3 booking(s) (2 candidate evaluations)
14 gates: 12 PASS · 1 PENDING · 0 FAIL · 1 BLOCKED
```

B was deliberately not rehearsed: it calls the payment provider, and the copy carries a real gateway payment id. The runtime strict comparison is thin (3 upcoming business bookings, 2 online candidates) — the presence-independent proof is F's pool parity over all 33 services and 80 providers.

## Planted faults — the verifier can fail

| Fault planted on the copy | Verifier | After restoring |
|---|---|---|
| Flag rewritten with `environment: "production"` (what the previous runbook said) | `FAIL G strict flag — environment "production" but the backend reads "rehearsal" — the flag is invisible to it`; runtime PENDING (backend still LEGACY_FALLBACK) | 12 PASS |
| One backfilled row set to SUSPENDED | `FAIL F — 1 new row(s) not ACTIVE; pool SHRINK 1: <provider>@<service>`; `FAIL G strict flag — step F is not PASS` | 12 PASS |

## Defects the rehearsal found (all fixed before the runbook was re-issued)

1. **Step G environment.** The admin route defaults the flag's environment to `production`; flag reads are scoped to `APP_ENV`, which is `dev` for the backend on this machine. The old runbook would have left strict matching off while the flag row looked enabled. Runbook now passes `$FLAG_ENV` read from `.env`; the verifier fails a flag written for another environment.
2. **Lost audit row at script exit.** `catalogService.update` records its audit fire-and-forget; the apply script disconnected the database client while the last write was in flight (25 versions, 24 enterprise audit rows). Fix: `AuditLogService.drain()` (in-flight tracking of both audit writes); the three apply scripts await it before exiting. Test `audit-log-drain.integration.test.ts` 2/2; break-the-fix: untracking the enterprise write → 3 of 5 rows, red; restored → green.
3. **Verifier weaknesses.** `≥ 25 / ≥ 31 / ≥ 600` thresholds, row counting by `verified_by` (3 pre-existing rows matched it), a strict comparison that passed with zero candidates, and an age scan that read requirement ids (`adult-present`) as booking-age rules. Now: exact service sets compared to the approved draft by content, version rows by the actor, F bound to a baseline recorded before the apply (rows since the baseline, shrink and growth both zero), FAIL on a vacuous comparison, BLOCKED for missing real-world facts.

## Scratch database

`homigo_rehearsal_test_0928` is left in place for inspection. It contains a copy of live personal data; drop it when done: `docker exec homigo-postgres dropdb -U postgres homigo_rehearsal_test_0928`.
